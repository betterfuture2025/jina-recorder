// 파트 7: 관리자 기록 분석 — 숫자 정리 + AI가 기간 전체 흐름을 읽어 주는 분석
// 파트 8: NCMG·엑셀용 내보내기 (CSV)
import { json, uid, readJson, HttpError } from './util.js';
import { chat, pickJson } from './ai.js';

const KIND_KO = { consult: '상담', meeting: '회의', memo: '혼자 메모', unassigned: '미지정' };
const clampDays = (v) => Math.min(365, Math.max(1, Number(v) || 30));
const parse = (v, d) => { try { return v ? JSON.parse(v) : d; } catch { return d; } };

function sydney(sql) {
  const d = new Date(String(sql).replace(' ', 'T') + 'Z');
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' }).formatToParts(d);
  const g = (t) => (f.find((x) => x.type === t) || {}).value || '';
  const wk = { Mon: '월', Tue: '화', Wed: '수', Thu: '목', Fri: '금', Sat: '토', Sun: '일' }[g('weekday')] || '';
  return { date: `${g('year')}.${g('month')}.${g('day')}`, wk, time: `${g('hour')}:${g('minute')}` };
}

async function periodRecords(env, days) {
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.kind, r.title, r.started_at, r.duration_sec, r.owner_id, u.name AS owner_name, u.email AS owner_email,
            s.summary, s.decisions, s.todos, s.status AS sum_status,
            (SELECT group_concat(tg.name, ',') FROM recording_tags rt JOIN tags tg ON tg.id = rt.tag_id WHERE rt.recording_id = r.id) AS tags,
            (SELECT group_concat(c.name, ',') FROM participants p JOIN contacts c ON c.id = p.contact_id WHERE p.recording_id = r.id) AS people
       FROM recordings r JOIN users u ON u.id = r.owner_id LEFT JOIN summaries s ON s.recording_id = r.id
      WHERE r.started_at >= datetime('now', ?) ORDER BY r.started_at DESC LIMIT 500`
  ).bind(`-${days} days`).all();
  return results;
}

export async function insightsOverview(env, request) {
  const days = clampDays(new URL(request.url).searchParams.get('days'));
  const recs = await periodRecords(env, days);
  const byKind = {}; const byTeacher = {}; const tagCount = {};
  const openTodos = []; let minutes = 0; let unsummarized = 0;
  for (const r of recs) {
    byKind[r.kind] = (byKind[r.kind] || 0) + 1;
    const t = byTeacher[r.owner_id] || (byTeacher[r.owner_id] = { name: r.owner_name || r.owner_email, count: 0, minutes: 0 });
    t.count++; t.minutes += Math.round((r.duration_sec || 0) / 60); minutes += (r.duration_sec || 0) / 60;
    for (const tg of (r.tags || '').split(',').filter(Boolean)) tagCount[tg] = (tagCount[tg] || 0) + 1;
    if (r.sum_status !== 'done') unsummarized++;
    for (const td of parse(r.todos, [])) if (!td.done && openTodos.length < 30) openTodos.push({ id: r.id, title: r.title || KIND_KO[r.kind], text: td.text, owner: r.owner_name || r.owner_email, at: r.started_at });
  }
  const { results: history } = await env.DB.prepare(
    'SELECT id, days, record_count, model, provider, created_at FROM insights ORDER BY created_at DESC LIMIT 10'
  ).all();
  const latest = await env.DB.prepare('SELECT * FROM insights ORDER BY created_at DESC LIMIT 1').first();
  return json({
    days, total: recs.length, minutes: Math.round(minutes), unsummarized,
    byKind, teachers: Object.values(byTeacher).sort((a, b) => b.count - a.count),
    tags: Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([name, n]) => ({ name, n })),
    openTodos, history, latest: latest ? { ...latest, body: parse(latest.body, null) } : null,
  });
}

const SYSTEM = `당신은 호주 시드니 어린이집 원장님을 돕는 운영 분석가입니다.
선생님들이 남긴 상담·회의·메모 기록 요약 목록을 읽고, 원장님이 이번 기간에 꼭 알아야 할 것을 정리합니다.
규칙:
- 목록에 실제로 있는 내용만 근거로 씁니다. 지어내지 않습니다.
- 아이·학부모 이름은 필요할 때만, 사실 그대로 씁니다. 평가하거나 낙인찍는 말은 쓰지 않습니다.
- 한국어로 짧고 분명하게 씁니다.
- 반드시 아래 JSON 하나만 답합니다.
{
  "overview": "이번 기간 전체 흐름 2~4문장",
  "themes": [{"title": "반복해서 나온 주제", "detail": "어떤 기록들에서 어떻게 나왔는지 1~2문장"}],
  "watch": [{"who": "아이 또는 학부모 이름", "detail": "계속 지켜보거나 다시 연락이 필요한 이유"}],
  "followups": ["아직 안 끝난 일·약속 중 원장님이 챙길 것"],
  "staff": [{"name": "선생님 이름", "note": "기록에서 보이는 업무 흐름이나 도움이 필요해 보이는 점 (칭찬도 좋음)"}],
  "suggestions": ["운영 개선 제안 2~4개"]
}`;

export async function runInsights(env, request, me) {
  const body = await readJson(request);
  const days = clampDays(body.days);
  const recs = (await periodRecords(env, days)).filter((r) => r.sum_status === 'done').slice(0, 80);
  if (!recs.length) throw new HttpError(400, 'nothing', '이 기간에 요약된 기록이 없어요. 먼저 기록을 요약해 주세요.');
  const lines = recs.map((r) => {
    const t = sydney(r.started_at);
    const todos = parse(r.todos, []).map((x) => `${x.done ? '[완료]' : '[미완]'} ${x.text}`);
    return [
      `■ ${t.date}(${t.wk}) ${t.time} · ${KIND_KO[r.kind]} · ${r.title || ''} · 기록: ${r.owner_name || r.owner_email}${r.people ? ` · 상대: ${r.people}` : ''}`,
      ...parse(r.summary, []).map((x) => `  - ${x}`),
      ...parse(r.decisions, []).map((x) => `  - 정함: ${x}`),
      ...todos.map((x) => `  - 할 일 ${x}`),
      r.tags ? `  태그: ${r.tags}` : '',
    ].filter(Boolean).join('\n');
  });
  let text = lines.join('\n');
  if (text.length > 60000) text = text.slice(0, 60000) + '\n…(이후 생략)';
  const r = await chat(env, 'analysis', { system: SYSTEM, user: `기간: 최근 ${days}일 · 기록 ${recs.length}건\n\n${text}`, maxTokens: 2200 });
  const out = pickJson(r.text);
  if (!out) throw new HttpError(502, 'ai_bad_answer', 'AI 답을 정리하지 못했어요. 다시 시도해 주세요.');
  const clean = {
    overview: String(out.overview || '').slice(0, 1200),
    themes: (out.themes || []).slice(0, 8).map((x) => ({ title: String(x.title || '').slice(0, 80), detail: String(x.detail || '').slice(0, 400) })),
    watch: (out.watch || []).slice(0, 10).map((x) => ({ who: String(x.who || '').slice(0, 60), detail: String(x.detail || '').slice(0, 400) })),
    followups: (out.followups || []).slice(0, 12).map((x) => String(x).slice(0, 300)),
    staff: (out.staff || []).slice(0, 12).map((x) => ({ name: String(x.name || '').slice(0, 60), note: String(x.note || '').slice(0, 400) })),
    suggestions: (out.suggestions || []).slice(0, 6).map((x) => String(x).slice(0, 300)),
  };
  const id = uid();
  await env.DB.prepare('INSERT INTO insights (id, created_by, days, record_count, body, model, provider) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, me.id, days, recs.length, JSON.stringify(clean), r.model, r.provider).run();
  return json({ insight: { id, days, record_count: recs.length, body: clean, model: r.model, provider: r.provider } });
}

export async function getInsight(env, id) {
  const row = await env.DB.prepare('SELECT * FROM insights WHERE id = ?').bind(id).first();
  if (!row) throw new HttpError(404, 'not_found', '분석을 찾을 수 없어요.');
  return json({ insight: { ...row, body: parse(row.body, null) } });
}

// 요약 안 된 기록 id 목록 (관리자 "한꺼번에 요약" 버튼용)
export async function unsummarized(env, request) {
  const days = clampDays(new URL(request.url).searchParams.get('days'));
  const { results } = await env.DB.prepare(
    `SELECT r.id FROM recordings r LEFT JOIN summaries s ON s.recording_id = r.id
      WHERE r.status = 'done' AND r.started_at >= datetime('now', ?) AND (s.status IS NULL OR s.status IN ('failed', 'working'))
        AND EXISTS (SELECT 1 FROM chunk_text t WHERE t.recording_id = r.id AND t.status = 'done') ORDER BY r.started_at DESC LIMIT 100`
  ).bind(`-${days} days`).all();
  return json({ ids: results.map((x) => x.id) });
}

// ── 내보내기 (CSV: 엑셀·NCMG 붙여넣기용) ──
const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function exportCsv(env, request, me) {
  const url = new URL(request.url);
  const days = clampDays(url.searchParams.get('days'));
  const withText = url.searchParams.get('text') !== '0';
  const mark = url.searchParams.get('mark') === '1';
  const recs = await periodRecords(env, days);
  const site = url.origin;
  const head = ['날짜', '요일', '시간', '종류', '제목', '상대방', '기록한 선생님', '길이(분)', '요약', '정한 것', '할 일', '태그', ...(withText ? ['받아쓴 글'] : []), '링크'];
  const rows = [head.map(csvCell).join(',')];
  const texts = new Map();
  if (withText && recs.length) {
    const { results } = await env.DB.prepare(
      `SELECT recording_id, group_concat(text, ' ') AS full FROM (
         SELECT t.recording_id, t.text FROM chunk_text t JOIN recordings r ON r.id = t.recording_id
          WHERE t.status = 'done' AND r.started_at >= datetime('now', ?) ORDER BY t.recording_id, t.seq)
       GROUP BY recording_id`
    ).bind(`-${days} days`).all();
    for (const x of results) texts.set(x.recording_id, x.full);
  }
  for (const r of recs) {
    const t = sydney(r.started_at);
    const full = texts.get(r.id) || '';
    rows.push([
      t.date, t.wk, t.time, KIND_KO[r.kind], r.title || '', r.people || '', r.owner_name || r.owner_email,
      Math.round((r.duration_sec || 0) / 60),
      parse(r.summary, []).join('\n'), parse(r.decisions, []).join('\n'),
      parse(r.todos, []).map((x) => `${x.done ? '[완료] ' : ''}${x.text}`).join('\n'),
      (r.tags || '').split(',').filter(Boolean).map((x) => '#' + x).join(' '),
      ...(withText ? [full] : []), `${site}/#/r/${r.id}`,
    ].map(csvCell).join(','));
  }
  if (mark && recs.length) {
    await env.DB.prepare(`UPDATE recordings SET ncmg_exported_at = datetime('now') WHERE started_at >= datetime('now', ?)`).bind(`-${days} days`).run();
  }
  const today = sydney(new Date().toISOString().replace('T', ' ').slice(0, 19)).date.replace(/\./g, '');
  return new Response('﻿' + rows.join('\r\n'), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`지나기록기_최근${days}일_${today}.csv`)}`,
      'cache-control': 'no-store',
    },
  });
}
