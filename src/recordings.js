// 녹음 API (파트 2)
// - 녹음 시작 → 20초 조각을 하나씩 올림 → 조각마다 바로 받아쓰기 → 끝내기
// - 조각 파일은 R2(AUDIO)가 있으면 R2에, 없으면 DB(chunk_data)에 저장한다.
import { json, uid, readJson, HttpError } from './util.js';
import { transcribe } from './stt.js';

const KINDS = ['memo', 'meeting', 'consult', 'unassigned'];
const MAX_CHUNK_BYTES = 1.5 * 1024 * 1024; // 20초 조각은 보통 100KB 이하
const AUDIO_TYPES = /^audio\/(webm|mp4|aac|mpeg|ogg|wav|x-m4a|m4a)/i;

function canSee(user, rec) {
  return rec && (rec.owner_id === user.id || user.role === 'admin');
}

async function loadRecording(env, user, id) {
  const rec = await env.DB.prepare(
    `SELECT r.*, u.name AS owner_name, u.email AS owner_email
       FROM recordings r JOIN users u ON u.id = r.owner_id WHERE r.id = ?`
  ).bind(id).first();
  if (!canSee(user, rec)) throw new HttpError(404, 'not_found', '기록을 찾을 수 없어요.');
  return rec;
}

// ── 시작 ──
export async function createRecording(env, request, user) {
  const body = await readJson(request);
  const kind = KINDS.includes(body.kind) ? body.kind : 'unassigned';
  const id = uid();
  const consent = body.consent ? 1 : 0;
  // 시작 시각은 휴대폰 기준(정확한 순간)을 받되, 엉뚱하면 서버 시각
  let startedAt = new Date().toISOString();
  if (body.startedAt && Math.abs(Date.parse(body.startedAt) - Date.now()) < 6 * 3600e3) {
    startedAt = new Date(body.startedAt).toISOString();
  }
  const sqlTime = startedAt.replace('T', ' ').slice(0, 19);
  await env.DB.prepare(
    `INSERT INTO recordings (id, owner_id, kind, title, status, started_at, consent, consent_at)
     VALUES (?, ?, ?, ?, 'recording', ?, ?, ?)`
  ).bind(id, user.id, kind, (body.title || '').trim().slice(0, 120) || null, sqlTime, consent,
    consent ? sqlTime : null).run();
  return json({ id, kind, startedAt: sqlTime }, 201);
}

// ── 조각 올리기 + 받아쓰기 ──
export async function putChunk(env, request, user, id, seqStr) {
  const seq = Number(seqStr);
  if (!Number.isInteger(seq) || seq < 0 || seq > 100000) throw new HttpError(400, 'bad_seq', '조각 번호가 맞지 않아요.');
  const rec = await loadRecording(env, user, id);
  if (rec.owner_id !== user.id) throw new HttpError(403, 'not_owner', '내 녹음에만 올릴 수 있어요.');

  const mime = (request.headers.get('content-type') || 'audio/webm').split(';')[0].trim();
  if (!AUDIO_TYPES.test(mime)) throw new HttpError(415, 'bad_type', '녹음 파일 형식이 맞지 않아요.');
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length) throw new HttpError(400, 'empty', '빈 조각이에요.');
  if (bytes.length > MAX_CHUNK_BYTES) throw new HttpError(413, 'too_big', '조각이 너무 커요.');

  const startMs = Number(request.headers.get('x-start-ms')) || 0;
  const endMs = Number(request.headers.get('x-end-ms')) || 0;

  // 1) 파일 저장 (같은 조각을 다시 올려도 덮어쓰기라 안전)
  let key;
  if (env.AUDIO) {
    key = `r2:rec/${id}/${String(seq).padStart(5, '0')}`;
    await env.AUDIO.put(key.slice(3), bytes, { httpMetadata: { contentType: mime } });
  } else {
    key = `d1:${id}/${seq}`;
    await env.DB.prepare(
      `INSERT INTO chunk_data (recording_id, seq, mime, data) VALUES (?, ?, ?, ?)
       ON CONFLICT(recording_id, seq) DO UPDATE SET mime = excluded.mime, data = excluded.data`
    ).bind(id, seq, mime, bytes).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO chunks (recording_id, seq, r2_key, start_ms, end_ms, bytes) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(recording_id, seq) DO UPDATE SET r2_key = excluded.r2_key, start_ms = excluded.start_ms,
         end_ms = excluded.end_ms, bytes = excluded.bytes`
    ).bind(id, seq, key, startMs, endMs, bytes.length),
    env.DB.prepare(
      `INSERT INTO chunk_text (recording_id, seq, status) VALUES (?, ?, 'pending')
       ON CONFLICT(recording_id, seq) DO UPDATE SET status = 'pending', updated_at = datetime('now')`
    ).bind(id, seq),
    env.DB.prepare("UPDATE recordings SET updated_at = datetime('now') WHERE id = ?").bind(id),
  ]);

  // 2) 받아쓰기 (실패해도 녹음은 이미 저장됨)
  const result = await runStt(env, id, seq, bytes);
  return json({ ok: true, seq, ...result });
}

async function runStt(env, id, seq, bytes) {
  try {
    const r = await transcribe(env, bytes);
    const status = r.text ? 'done' : 'empty';
    await env.DB.prepare(
      `UPDATE chunk_text SET status = ?, text = ?, language = ?, model = ?, error = NULL, updated_at = datetime('now')
        WHERE recording_id = ? AND seq = ?`
    ).bind(status, r.text || null, r.language, r.model, id, seq).run();
    return { status, text: r.text || '' };
  } catch (err) {
    const msg = String(err && err.message || err).slice(0, 300);
    console.error('stt failed', id, seq, msg);
    await env.DB.prepare(
      `UPDATE chunk_text SET status = 'failed', error = ?, updated_at = datetime('now') WHERE recording_id = ? AND seq = ?`
    ).bind(msg, id, seq).run();
    return { status: 'failed', text: '' };
  }
}

// 받아쓰기에 실패한 조각 다시 하기
export async function retryStt(env, user, id) {
  const rec = await loadRecording(env, user, id);
  const { results } = await env.DB.prepare(
    `SELECT c.seq, c.r2_key FROM chunks c JOIN chunk_text t ON t.recording_id = c.recording_id AND t.seq = c.seq
      WHERE c.recording_id = ? AND t.status IN ('failed', 'pending') ORDER BY c.seq LIMIT 30`
  ).bind(rec.id).all();
  let fixed = 0;
  for (const row of results) {
    const file = await readChunk(env, rec.id, row.seq, row.r2_key);
    if (!file) continue;
    const r = await runStt(env, rec.id, row.seq, file.bytes);
    if (r.status !== 'failed') fixed++;
  }
  return json({ ok: true, tried: results.length, fixed });
}

// ── 끝내기 ──
export async function finishRecording(env, request, user, id) {
  const rec = await loadRecording(env, user, id);
  if (rec.owner_id !== user.id) throw new HttpError(403, 'not_owner', '내 녹음만 끝낼 수 있어요.');
  const body = await readJson(request);
  const duration = Math.max(0, Math.min(6 * 3600, Math.round(Number(body.durationSec) || 0)));
  await env.DB.prepare(
    `UPDATE recordings SET status = 'done', ended_at = datetime('now'), duration_sec = ?, updated_at = datetime('now')
      WHERE id = ?`
  ).bind(duration, id).run();
  return json({ ok: true });
}

// ── 고치기: 종류, 제목, 동의 ──
export async function updateRecording(env, request, user, id) {
  const rec = await loadRecording(env, user, id);
  const body = await readJson(request);
  const kind = body.kind === undefined ? rec.kind : (KINDS.includes(body.kind) ? body.kind : rec.kind);
  const title = body.title === undefined ? rec.title : ((body.title || '').trim().slice(0, 120) || null);
  let consent = rec.consent, consentAt = rec.consent_at;
  if (body.consent !== undefined) {
    consent = body.consent ? 1 : 0;
    consentAt = consent ? (rec.consent_at || new Date().toISOString().replace('T', ' ').slice(0, 19)) : null;
  }
  await env.DB.prepare(
    `UPDATE recordings SET kind = ?, title = ?, consent = ?, consent_at = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(kind, title, consent, consentAt, id).run();
  return getRecording(env, user, id);
}

// ── 목록 ──
export async function listRecordings(env, request, user) {
  const url = new URL(request.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
  const kind = url.searchParams.get('kind');
  const all = user.role === 'admin' && url.searchParams.get('all') === '1';
  const where = [];
  const binds = [];
  if (!all) { where.push('r.owner_id = ?'); binds.push(user.id); }
  if (KINDS.includes(kind)) { where.push('r.kind = ?'); binds.push(kind); }
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.kind, r.title, r.status, r.started_at, r.ended_at, r.duration_sec, r.consent,
            u.name AS owner_name, u.email AS owner_email,
            (SELECT group_concat(text, ' ') FROM (SELECT text FROM chunk_text t WHERE t.recording_id = r.id
               AND t.status = 'done' ORDER BY t.seq LIMIT 3)) AS snippet,
            (SELECT COUNT(*) FROM chunks c WHERE c.recording_id = r.id) AS chunk_count
       FROM recordings r JOIN users u ON u.id = r.owner_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY r.started_at DESC LIMIT ?`
  ).bind(...binds, limit).all();
  const items = results.map((r) => ({ ...r, snippet: r.snippet ? r.snippet.slice(0, 140) : '' }));
  return json({ items });
}

// ── 상세 ──
export async function getRecording(env, user, id) {
  const rec = await loadRecording(env, user, id);
  const { results } = await env.DB.prepare(
    `SELECT c.seq, c.start_ms, c.end_ms, c.bytes, t.status, t.text
       FROM chunks c LEFT JOIN chunk_text t ON t.recording_id = c.recording_id AND t.seq = c.seq
      WHERE c.recording_id = ? ORDER BY c.seq`
  ).bind(id).all();
  return json({
    recording: {
      id: rec.id, kind: rec.kind, title: rec.title, status: rec.status,
      started_at: rec.started_at, ended_at: rec.ended_at, duration_sec: rec.duration_sec,
      consent: rec.consent, consent_at: rec.consent_at,
      owner_id: rec.owner_id, owner_name: rec.owner_name, owner_email: rec.owner_email,
    },
    chunks: results,
  });
}

// ── 조각 파일 꺼내기 (다시 듣기) ──
async function readChunk(env, id, seq, key) {
  if (key && key.startsWith('r2:')) {
    if (!env.AUDIO) return null;
    const obj = await env.AUDIO.get(key.slice(3));
    if (!obj) return null;
    return { bytes: new Uint8Array(await obj.arrayBuffer()), mime: obj.httpMetadata?.contentType || 'audio/webm' };
  }
  const row = await env.DB.prepare('SELECT mime, data FROM chunk_data WHERE recording_id = ? AND seq = ?').bind(id, seq).first();
  if (!row) return null;
  const bytes = row.data instanceof ArrayBuffer ? new Uint8Array(row.data) : new Uint8Array(row.data);
  return { bytes, mime: row.mime || 'audio/webm' };
}

export async function getChunkAudio(env, user, id, seqStr) {
  const rec = await loadRecording(env, user, id);
  const seq = Number(seqStr);
  const c = await env.DB.prepare('SELECT r2_key FROM chunks WHERE recording_id = ? AND seq = ?').bind(rec.id, seq).first();
  if (!c) throw new HttpError(404, 'not_found', '녹음 조각이 없어요.');
  const file = await readChunk(env, rec.id, seq, c.r2_key);
  if (!file) throw new HttpError(404, 'not_found', '녹음 파일을 찾을 수 없어요.');
  return new Response(file.bytes, {
    headers: { 'content-type': file.mime, 'cache-control': 'private, max-age=86400' },
  });
}

// ── 지우기 ──
export async function deleteRecording(env, user, id) {
  const rec = await loadRecording(env, user, id);
  if (env.AUDIO) {
    const { results } = await env.DB.prepare("SELECT r2_key FROM chunks WHERE recording_id = ? AND r2_key LIKE 'r2:%'").bind(id).all();
    if (results.length) await env.AUDIO.delete(results.map((r) => r.r2_key.slice(3)));
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM chunk_data WHERE recording_id = ?').bind(rec.id),
    env.DB.prepare('DELETE FROM chunk_text WHERE recording_id = ?').bind(rec.id),
    env.DB.prepare('DELETE FROM chunks WHERE recording_id = ?').bind(rec.id),
    env.DB.prepare('DELETE FROM segments WHERE recording_id = ?').bind(rec.id),
    env.DB.prepare('DELETE FROM summaries WHERE recording_id = ?').bind(rec.id),
    env.DB.prepare('DELETE FROM recording_tags WHERE recording_id = ?').bind(rec.id),
    env.DB.prepare('DELETE FROM participants WHERE recording_id = ?').bind(rec.id),
    env.DB.prepare('DELETE FROM recordings WHERE id = ?').bind(rec.id),
  ]);
  return json({ ok: true });
}
