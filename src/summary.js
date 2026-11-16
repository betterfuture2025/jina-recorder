// 파트 3: 녹음이 끝나면 AI가 요약·할 일·태그·상대방을 정리한다.
// 파트 5: 정리가 끝나면 (설정에 따라) 요약 메일을 보낸다.
import { json, uid, readJson, HttpError } from './util.js';
import { chat, pickJson, aiConfig } from './ai.js';
import { getSettings } from './settings.js';
import { mailReady } from './mail.js';
import { sendTemplate } from './mailTemplates.js';

const KIND_KO = { consult: '상담', meeting: '회의', memo: '혼자 메모', unassigned: '미지정' };

function clock(ms) {
  const s = Math.floor((ms || 0) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function stamp(sql) {
  const d = new Date(String(sql).replace(' ', 'T') + 'Z');
  if (isNaN(d)) return String(sql || '');
  const f = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: 'numeric', minute: '2-digit',
  }).formatToParts(d);
  const g = (t) => (f.find((x) => x.type === t) || {}).value || '';
  return `${g('year')}.${g('month')}.${g('day')} (${g('weekday')}) ${g('dayPeriod')} ${g('hour')}:${g('minute')}`.replace(/\s+/g, ' ');
}

async function loadRec(env, user, id) {
  const rec = await env.DB.prepare(
    `SELECT r.*, u.name AS owner_name, u.email AS owner_email FROM recordings r JOIN users u ON u.id = r.owner_id WHERE r.id = ?`
  ).bind(id).first();
  if (!rec || (user && rec.owner_id !== user.id && user.role !== 'admin')) throw new HttpError(404, 'not_found', '기록을 찾을 수 없어요.');
  return rec;
}

async function transcript(env, id) {
  const { results } = await env.DB.prepare(
    `SELECT c.start_ms, t.text FROM chunks c JOIN chunk_text t ON t.recording_id = c.recording_id AND t.seq = c.seq
      WHERE c.recording_id = ? AND t.status = 'done' AND t.text IS NOT NULL AND t.text != '' ORDER BY c.seq`
  ).bind(id).all();
  return results.map((r) => `[${clock(r.start_ms)}] ${r.text}`);
}

function fitText(lines, max) {
  const all = lines.join('\n');
  if (all.length <= max) return all;
  const head = Math.floor(max * 0.6);
  const tail = max - head - 40;
  return all.slice(0, head) + '\n…(중간 생략)…\n' + all.slice(all.length - tail);
}

const SYSTEM = `당신은 호주 시드니의 어린이집(차일드 케어 센터)에서 일하는 꼼꼼한 기록 담당자입니다.
선생님이 녹음한 상담·회의·메모를 받아쓴 글을 읽고, 바쁜 원장님이 10초 안에 파악할 수 있게 정리합니다.
규칙:
- 받아쓴 글에 실제로 나온 내용만 씁니다. 추측하거나 지어내지 않습니다.
- 받아쓰기 오류로 보이는 이상한 단어는 문맥에 맞게 자연스럽게 읽되, 확실하지 않으면 빼세요.
- 한국어로 짧고 쉬운 문장(~함, ~했음 같은 메모체)으로 씁니다. 원문이 영어여도 한국어로 정리하고, 사람 이름은 원문대로 둡니다.
- 아이·학부모의 민감한 내용은 필요한 만큼만 담담하게 적습니다.
- 반드시 아래 JSON 하나만 답합니다. 다른 말은 쓰지 않습니다.
{
  "title": "기록 제목 (20자 안팎, 예: 하윤이 어머님 상담 — 낮잠 적응)",
  "summary": ["핵심 내용 3~5줄"],
  "decisions": ["정한 것 (없으면 빈 배열)"],
  "todos": ["누가 언제까지 무엇을 할지 (없으면 빈 배열)"],
  "tags": ["검색용 짧은 태그 3~6개, # 없이, 아이 이름·주제 (예: 하윤, 낮잠, 적응)"],
  "people": [{"name": "대화에 나온 아이·학부모·외부인 이름", "relation": "원아/학부모/교사/외부 중 하나"}]
}`;

function cleanList(v, max, len = 160) {
  return (Array.isArray(v) ? v : []).map((x) => String(typeof x === 'string' ? x : x?.text || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean).slice(0, max).map((x) => x.slice(0, len));
}

function normalize(obj) {
  const tags = [...new Set(cleanList(obj.tags, 8, 24).map((t) => t.replace(/^#+/, '').replace(/\s+/g, '').trim()).filter(Boolean))].slice(0, 6);
  const people = (Array.isArray(obj.people) ? obj.people : []).map((p) => ({
    name: String(p?.name || '').trim().slice(0, 40),
    relation: String(p?.relation || '').trim().slice(0, 20),
  })).filter((p) => p.name).slice(0, 6);
  return {
    title: String(obj.title || '').replace(/\s+/g, ' ').trim().slice(0, 60),
    summary: cleanList(obj.summary, 6),
    decisions: cleanList(obj.decisions, 6),
    todos: cleanList(obj.todos, 8).map((text) => ({ text, done: false })),
    tags,
    people,
  };
}

async function setTags(env, recId, tags, source) {
  const stmts = [env.DB.prepare('DELETE FROM recording_tags WHERE recording_id = ? AND source = ?').bind(recId, source)];
  for (const name of tags) {
    stmts.push(env.DB.prepare('INSERT INTO tags (id, name) VALUES (?, ?) ON CONFLICT(name) DO NOTHING').bind(uid(), name));
    stmts.push(env.DB.prepare(
      `INSERT INTO recording_tags (recording_id, tag_id, source) SELECT ?, id, ? FROM tags WHERE name = ? COLLATE NOCASE
       ON CONFLICT(recording_id, tag_id) DO NOTHING`
    ).bind(recId, source, name));
  }
  await env.DB.batch(stmts);
}

export async function tagsFor(env, recId) {
  const { results } = await env.DB.prepare(
    'SELECT t.name, rt.source FROM recording_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.recording_id = ? ORDER BY t.name'
  ).bind(recId).all();
  return results;
}

export async function summaryFor(env, recId) {
  const row = await env.DB.prepare('SELECT * FROM summaries WHERE recording_id = ?').bind(recId).first();
  if (!row) return null;
  const parse = (v, d) => { try { return v ? JSON.parse(v) : d; } catch { return d; } };
  return {
    status: row.status || 'done', error: row.error || null,
    summary: parse(row.summary, []), decisions: parse(row.decisions, []), todos: parse(row.todos, []), people: parse(row.people, []),
    model: row.model, provider: row.provider, updated_at: row.updated_at, edited: !!row.edited_by, emailed_at: row.emailed_at,
  };
}

// 상대방 이름 → 등록된 원아·학부모와 맞으면 자동 연결
async function linkPeople(env, rec, people) {
  if (!people.length) return;
  const { results } = await env.DB.prepare('SELECT id, name FROM contacts').all();
  const byName = new Map(results.map((c) => [c.name.replace(/\s+/g, ''), c.id]));
  const stmts = [];
  for (const p of people) {
    const id = byName.get(p.name.replace(/\s+/g, ''));
    if (!id) continue;
    stmts.push(env.DB.prepare(
      `INSERT INTO participants (id, recording_id, contact_id, role)
       SELECT ?, ?, ?, 'ai' WHERE NOT EXISTS (SELECT 1 FROM participants WHERE recording_id = ? AND contact_id = ?)`
    ).bind(uid(), rec.id, id, rec.id, id));
  }
  if (stmts.length) await env.DB.batch(stmts);
}

export async function summarize(env, request, user, id, { force = false } = {}) {
  const rec = await loadRec(env, user, id);
  const existing = await summaryFor(env, id);
  if (existing && existing.status === 'done' && !force) return json({ summary: existing, tags: await tagsFor(env, id), title: rec.title });

  const lines = await transcript(env, id);
  if (!lines.length) {
    await env.DB.prepare(
      `INSERT INTO summaries (recording_id, status, error, updated_at) VALUES (?, 'empty', NULL, datetime('now'))
       ON CONFLICT(recording_id) DO UPDATE SET status = 'empty', updated_at = datetime('now')`
    ).bind(id).run();
    return json({ summary: { status: 'empty' }, tags: [] });
  }

  await env.DB.prepare(
    `INSERT INTO summaries (recording_id, status, updated_at) VALUES (?, 'working', datetime('now'))
     ON CONFLICT(recording_id) DO UPDATE SET status = 'working', error = NULL, updated_at = datetime('now')`
  ).bind(id).run();

  let out;
  try {
    const { results: contacts } = await env.DB.prepare('SELECT name, kind, relation FROM contacts ORDER BY name LIMIT 150').all();
    const known = contacts.length ? `\n등록된 원아·학부모 이름 (이름이 비슷하면 이 표기를 쓰세요): ${contacts.map((c) => c.name).join(', ')}` : '';
    const { maxChars } = await aiConfig(env, 'summary');
    const header = `종류: ${KIND_KO[rec.kind] || rec.kind}\n제목: ${rec.title || '(없음)'}\n일시: ${stamp(rec.started_at)}\n기록한 선생님: ${rec.owner_name || rec.owner_email}${known}\n\n받아쓴 글:\n`;
    const first = await chat(env, 'summary', { system: SYSTEM, user: header + fitText(lines, maxChars), maxTokens: 1400 });
    let parsed = pickJson(first.text);
    if (!parsed) {
      const retry = await chat(env, 'summary', { system: SYSTEM, user: header + fitText(lines, Math.floor(maxChars * 0.7)) + '\n\n반드시 JSON 하나만 답하세요.', maxTokens: 1400 });
      parsed = pickJson(retry.text);
    }
    if (!parsed) throw new HttpError(502, 'ai_bad_answer', 'AI 답을 정리하지 못했어요. 다시 시도해 주세요.');
    out = { ...normalize(parsed), model: first.model, provider: first.provider };
  } catch (err) {
    await env.DB.prepare("UPDATE summaries SET status = 'failed', error = ?, updated_at = datetime('now') WHERE recording_id = ?")
      .bind(String(err?.message || err).slice(0, 300), id).run();
    throw err;
  }

  await env.DB.prepare(
    `UPDATE summaries SET status = 'done', error = NULL, summary = ?, decisions = ?, todos = ?, people = ?, model = ?, provider = ?,
       edited_by = NULL, updated_at = datetime('now') WHERE recording_id = ?`
  ).bind(JSON.stringify(out.summary), JSON.stringify(out.decisions), JSON.stringify(out.todos), JSON.stringify(out.people),
    out.model, out.provider, id).run();
  if (!rec.title && out.title) {
    await env.DB.prepare("UPDATE recordings SET title = ?, updated_at = datetime('now') WHERE id = ? AND title IS NULL").bind(out.title, id).run();
  }
  await setTags(env, id, out.tags, 'ai');
  await linkPeople(env, rec, out.people);

  // 요약 메일 (처음 정리될 때만, 설정이 켜져 있으면)
  let mailed = null;
  if (!existing || !existing.emailed_at) {
    try { mailed = await maybeMail(env, request, id, false); } catch (err) { mailed = { error: err.message }; }
  }
  const fresh = await loadRec(env, null, id);
  return json({ summary: await summaryFor(env, id), tags: await tagsFor(env, id), title: fresh.title, mailed });
}

// ── 요약 메일 ──
async function maybeMail(env, request, id, manual) {
  const s = await getSettings(env, ['mail.summary_auto', 'mail.summary_cc']);
  if (!manual && s['mail.summary_auto'] === '0') return null;
  if (!(await mailReady(env))) return manual ? Promise.reject(new HttpError(400, 'mail_not_configured', '메일 보내기가 아직 설정되지 않았어요.')) : null;
  const rec = await loadRec(env, null, id);
  const sum = await summaryFor(env, id);
  if (!sum || sum.status !== 'done') throw new HttpError(400, 'no_summary', '아직 요약이 없어요.');
  const tags = await tagsFor(env, id);
  const site = new URL(request.url).origin;
  const to = [rec.owner_email, ...String(s['mail.summary_cc'] || '').split(',').map((x) => x.trim()).filter(Boolean)];
  const uniq = [...new Set(to.map((x) => x.toLowerCase()))];
  const vars = {
    제목: rec.title || KIND_KO[rec.kind], 종류: KIND_KO[rec.kind] || '', 일시: stamp(rec.started_at),
    선생님: rec.owner_name || rec.owner_email, 길이: rec.duration_sec ? `${Math.max(1, Math.round(rec.duration_sec / 60))}분` : '',
    __summary: sum.summary, __decisions: sum.decisions, __todos: sum.todos.map((x) => x.text), __tags: tags.map((x) => x.name),
    __link: `/#/r/${id}`,
  };
  const sent = [];
  for (const addr of uniq) {
    try {
      await sendTemplate(env, 'summary', { to: addr, site, vars });
      await env.DB.prepare("INSERT INTO email_log (id, recording_id, to_addr, status) VALUES (?, ?, ?, 'sent')").bind(uid(), id, addr).run();
      sent.push(addr);
    } catch (err) {
      await env.DB.prepare("INSERT INTO email_log (id, recording_id, to_addr, status, error) VALUES (?, ?, ?, 'failed', ?)")
        .bind(uid(), id, addr, String(err.message).slice(0, 300)).run();
      if (manual) throw err;
    }
  }
  if (sent.length) await env.DB.prepare("UPDATE summaries SET emailed_at = datetime('now') WHERE recording_id = ?").bind(id).run();
  return { sent };
}

export async function mailSummary(env, request, user, id) {
  await loadRec(env, user, id);
  const r = await maybeMail(env, request, id, true);
  return json({ ok: true, ...r });
}

// ── 사람이 고치기: 요약·할 일 체크·태그 ──
export async function editSummary(env, request, user, id) {
  await loadRec(env, user, id);
  const body = await readJson(request);
  const cur = (await summaryFor(env, id)) || { summary: [], decisions: [], todos: [], people: [] };
  const next = {
    summary: body.summary !== undefined ? cleanList(body.summary, 12, 300) : cur.summary,
    decisions: body.decisions !== undefined ? cleanList(body.decisions, 12, 300) : cur.decisions,
    todos: body.todos !== undefined
      ? (Array.isArray(body.todos) ? body.todos : []).map((x) => ({ text: String(x?.text || '').trim().slice(0, 300), done: !!x?.done })).filter((x) => x.text).slice(0, 20)
      : cur.todos,
  };
  await env.DB.prepare(
    `INSERT INTO summaries (recording_id, status, summary, decisions, todos, edited_by, updated_at) VALUES (?, 'done', ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(recording_id) DO UPDATE SET status = 'done', summary = excluded.summary, decisions = excluded.decisions,
       todos = excluded.todos, edited_by = excluded.edited_by, updated_at = excluded.updated_at`
  ).bind(id, JSON.stringify(next.summary), JSON.stringify(next.decisions), JSON.stringify(next.todos), user.id).run();
  return json({ summary: await summaryFor(env, id) });
}

export async function editTags(env, request, user, id) {
  await loadRec(env, user, id);
  const body = await readJson(request);
  const tags = [...new Set(cleanList(body.tags, 12, 24).map((t) => t.replace(/^#+/, '').replace(/\s+/g, '')).filter(Boolean))];
  await env.DB.prepare('DELETE FROM recording_tags WHERE recording_id = ?').bind(id).run();
  await setTags(env, id, tags, 'user');
  return json({ tags: await tagsFor(env, id) });
}

export async function allTags(env, user) {
  const own = user.role === 'admin' ? '' : 'AND r.owner_id = ?';
  const stmt = env.DB.prepare(
    `SELECT t.name, COUNT(*) AS n FROM recording_tags rt JOIN tags t ON t.id = rt.tag_id JOIN recordings r ON r.id = rt.recording_id
      WHERE 1 = 1 ${own} GROUP BY t.id ORDER BY n DESC, t.name LIMIT 40`
  );
  const { results } = await (user.role === 'admin' ? stmt : stmt.bind(user.id)).all();
  return json({ tags: results });
}
