// 파트 8: 구글 드라이브 백업
// - 관리자가 설정에서 "드라이브 연결"을 누르면 구글 동의 화면 → 돌아오면 연결 열쇠(refresh token)를 암호화해서 저장
// - 기록마다 드라이브에 폴더를 만들고: 기록.txt(요약+받아쓴 글) + 원본 녹음 조각들을 올린다
// - 권한은 drive.file: 이 사이트가 만든 파일만 볼 수 있다 (드라이브 전체를 보지 않음)
// 한 번에 올릴 수 있는 요청 수가 정해져 있어서, 녹음 조각은 여러 번에 나눠 올린다 (화면이 이어서 부름).
import { json, readJson, HttpError, randomToken, cookie, parseCookies, isSecureRequest } from './util.js';
import { getSettings, saveSettings } from './settings.js';
import { summaryFor, tagsFor } from './summary.js';
import { peopleFor } from './contacts.js';

const STATE = 'vn_drive_state';
const SCOPE = 'https://www.googleapis.com/auth/drive.file openid email';
const ROOT_NAME = '지나기록기 백업';
const PARTS_PER_CALL = 25;
const KIND_KO = { consult: '상담', meeting: '회의', memo: '혼자 메모', unassigned: '미지정' };

const redirectUri = (request) => new URL('/auth/callback', request.url).toString();
const back = (request, params) => {
  const u = new URL('/', request.url);
  u.hash = '/admin/settings?' + new URLSearchParams(params).toString();
  return u.toString();
};
const redirect = (to, cookies = []) => {
  const h = new Headers({ location: to });
  cookies.forEach((c) => h.append('set-cookie', c));
  return new Response(null, { status: 302, headers: h });
};

export function isDriveState(request) {
  const st = new URL(request.url).searchParams.get('state') || '';
  return st.startsWith('drive.');
}

export async function startDrive(env, request) {
  const s = await getSettings(env, ['google.client_id', 'google.client_secret']);
  if (!s['google.client_id'] || !s['google.client_secret']) return redirect(back(request, { drive: 'no_google' }));
  const state = 'drive.' + randomToken(24);
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', s['google.client_id']);
  url.searchParams.set('redirect_uri', redirectUri(request));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPE);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('state', state);
  return redirect(url.toString(), [cookie(STATE, state, { maxAge: 600, path: '/auth', secure: isSecureRequest(request) })]);
}

export async function finishDrive(env, request, me) {
  const url = new URL(request.url);
  const clear = cookie(STATE, '', { maxAge: 0, path: '/auth', secure: isSecureRequest(request) });
  if (url.searchParams.get('error')) return redirect(back(request, { drive: 'cancelled' }), [clear]);
  const state = url.searchParams.get('state');
  if (!state || state !== parseCookies(request)[STATE]) return redirect(back(request, { drive: 'state' }), [clear]);
  const s = await getSettings(env, ['google.client_id', 'google.client_secret']);
  let tokens, info;
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: url.searchParams.get('code') || '', client_id: s['google.client_id'], client_secret: s['google.client_secret'],
        redirect_uri: redirectUri(request), grant_type: 'authorization_code',
      }),
    });
    tokens = await r.json();
    if (!r.ok || !tokens.refresh_token) return redirect(back(request, { drive: 'token' }), [clear]);
    const i = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${tokens.access_token}` } });
    info = i.ok ? await i.json() : {};
  } catch {
    return redirect(back(request, { drive: 'network' }), [clear]);
  }
  await saveSettings(env, {
    'drive.refresh_token': tokens.refresh_token,
    'drive.account': info.email || '',
    'drive.folder_id': '',
  }, me.id);
  return redirect(back(request, { drive: 'ok' }), [clear]);
}

export async function disconnectDrive(env, me) {
  await saveSettings(env, { 'drive.refresh_token': null, 'drive.account': '', 'drive.folder_id': '' }, me.id);
  return json({ ok: true });
}

export async function driveStatus(env) {
  const s = await getSettings(env, ['drive.refresh_token', 'drive.account', 'drive.auto']);
  const { results } = await env.DB.prepare(
    "SELECT COUNT(*) AS total, SUM(CASE WHEN drive_file_id IS NOT NULL THEN 1 ELSE 0 END) AS done FROM recordings WHERE status = 'done'"
  ).all();
  return { connected: !!s['drive.refresh_token'], account: s['drive.account'] || null, auto: s['drive.auto'] === '1', total: results[0]?.total || 0, backedUp: results[0]?.done || 0 };
}

async function accessToken(env) {
  const s = await getSettings(env, ['google.client_id', 'google.client_secret', 'drive.refresh_token']);
  if (!s['drive.refresh_token']) throw new HttpError(400, 'drive_not_connected', '구글 드라이브가 아직 연결되지 않았어요. 관리자 설정에서 연결해 주세요.');
  let r;
  try {
    r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: s['google.client_id'], client_secret: s['google.client_secret'],
        refresh_token: s['drive.refresh_token'], grant_type: 'refresh_token',
      }),
    });
  } catch {
    throw new HttpError(502, 'drive_unreachable', '구글 드라이브에 연결하지 못했어요.');
  }
  const t = await r.json().catch(() => ({}));
  if (!r.ok || !t.access_token) throw new HttpError(502, 'drive_auth', '드라이브 연결이 끊겼어요. 설정에서 다시 연결해 주세요.');
  return t.access_token;
}

async function gfetch(token, url, init = {}) {
  const r = await fetch(url, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers || {}) } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(502, 'drive_failed', `드라이브 오류: ${data?.error?.message || r.status}`);
  return data;
}

async function folder(token, name, parent) {
  const q = [`name = '${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`, "mimeType = 'application/vnd.google-apps.folder'", 'trashed = false'];
  if (parent) q.push(`'${parent}' in parents`);
  const found = await gfetch(token, 'https://www.googleapis.com/drive/v3/files?' + new URLSearchParams({ q: q.join(' and '), fields: 'files(id,name)', pageSize: '1' }));
  if (found.files && found.files[0]) return found.files[0].id;
  const made = await gfetch(token, 'https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', ...(parent ? { parents: [parent] } : {}) }),
  });
  return made.id;
}

async function upload(token, { name, parent, mime, bytes }) {
  const boundary = 'jina' + randomToken(8);
  const meta = JSON.stringify({ name, parents: [parent] });
  const enc = new TextEncoder();
  const head = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`);
  const tail = enc.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head, 0); body.set(bytes, head.length); body.set(tail, head.length + bytes.length);
  return gfetch(token, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST', headers: { 'content-type': `multipart/related; boundary=${boundary}` }, body,
  });
}

function sydneyParts(sql) {
  const d = new Date(String(sql).replace(' ', 'T') + 'Z');
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const g = (t) => (f.find((x) => x.type === t) || {}).value || '';
  return { y: g('year'), m: g('month'), d: g('day'), hh: g('hour'), mm: g('minute') };
}

export async function recordText(env, rec) {
  const sum = await summaryFor(env, rec.id);
  const tags = await tagsFor(env, rec.id);
  const people = await peopleFor(env, rec.id);
  const { results } = await env.DB.prepare(
    `SELECT c.start_ms, t.text FROM chunks c LEFT JOIN chunk_text t ON t.recording_id = c.recording_id AND t.seq = c.seq
      WHERE c.recording_id = ? ORDER BY c.seq`
  ).bind(rec.id).all();
  const p = sydneyParts(rec.started_at);
  const clock = (ms) => { const s = Math.floor((ms || 0) / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
  const L = [
    rec.title || KIND_KO[rec.kind],
    `일시: ${p.y}.${p.m}.${p.d} ${p.hh}:${p.mm}`,
    `종류: ${KIND_KO[rec.kind] || rec.kind}`,
    `기록한 사람: ${rec.owner_name || rec.owner_email || ''}`,
    people.length ? `상대방: ${people.map((x) => x.name).join(', ')}` : null,
    tags.length ? `태그: ${tags.map((x) => '#' + x.name).join(' ')}` : null,
    '',
  ].filter((x) => x !== null);
  if (sum && sum.status === 'done') {
    if (sum.summary.length) L.push('[요약]', ...sum.summary.map((x) => '- ' + x), '');
    if (sum.decisions.length) L.push('[정한 것]', ...sum.decisions.map((x) => '- ' + x), '');
    if (sum.todos.length) L.push('[할 일]', ...sum.todos.map((x) => `${x.done ? '[x]' : '[ ]'} ${x.text}`), '');
  }
  L.push('[받아쓴 글]', ...results.filter((r) => r.text).map((r) => `[${clock(r.start_ms)}] ${r.text}`));
  return L.join('\n') + '\n';
}

async function readChunk(env, recId, seq, key) {
  if (key && key.startsWith('r2:')) {
    if (!env.AUDIO) return null;
    const obj = await env.AUDIO.get(key.slice(3));
    return obj ? { bytes: new Uint8Array(await obj.arrayBuffer()), mime: obj.httpMetadata?.contentType || 'audio/webm' } : null;
  }
  const row = await env.DB.prepare('SELECT mime, data FROM chunk_data WHERE recording_id = ? AND seq = ?').bind(recId, seq).first();
  return row ? { bytes: new Uint8Array(row.data), mime: row.mime || 'audio/webm' } : null;
}

// 한 기록 백업. from: 몇 번째 녹음 조각부터 올릴지 (처음엔 0) → 다 올리면 done:true
export async function backupRecording(env, request, user, id) {
  const rec = await env.DB.prepare(
    'SELECT r.*, u.name AS owner_name, u.email AS owner_email FROM recordings r JOIN users u ON u.id = r.owner_id WHERE r.id = ?'
  ).bind(id).first();
  if (!rec || (rec.owner_id !== user.id && user.role !== 'admin')) throw new HttpError(404, 'not_found', '기록을 찾을 수 없어요.');
  const body = await readJson(request).catch(() => ({}));
  const from = Math.max(0, Number(body.from) || 0);
  const token = await accessToken(env);

  let dir = from > 0 ? body.folderId : null;
  if (!dir) {
    let root = (await getSettings(env, ['drive.folder_id']))['drive.folder_id'];
    if (!root) {
      root = await folder(token, ROOT_NAME, null);
      await saveSettings(env, { 'drive.folder_id': root }, user.id);
    }
    const p = sydneyParts(rec.started_at);
    const month = await folder(token, `${p.y}-${p.m}`, root);
    const name = `${p.y}${p.m}${p.d}_${p.hh}${p.mm}_${(rec.title || KIND_KO[rec.kind] || '기록').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60)}`;
    dir = await folder(token, name, month);
    await upload(token, { name: '기록.txt', parent: dir, mime: 'text/plain; charset=UTF-8', bytes: new TextEncoder().encode('﻿' + await recordText(env, rec)) });
  }
  const { results: chunks } = await env.DB.prepare('SELECT seq, r2_key FROM chunks WHERE recording_id = ? ORDER BY seq').bind(id).all();
  const slice = chunks.slice(from, from + PARTS_PER_CALL);
  for (const c of slice) {
    const f = await readChunk(env, id, c.seq, c.r2_key);
    if (!f) continue;
    const ext = /mp4|m4a|aac/.test(f.mime) ? 'm4a' : /ogg/.test(f.mime) ? 'ogg' : 'webm';
    await upload(token, { name: `녹음_${String(c.seq + 1).padStart(3, '0')}.${ext}`, parent: dir, mime: f.mime, bytes: f.bytes });
  }
  const next = from + slice.length;
  const done = next >= chunks.length;
  if (done) await env.DB.prepare("UPDATE recordings SET drive_file_id = ?, updated_at = datetime('now') WHERE id = ?").bind(dir, id).run();
  return json({ done, next, total: chunks.length, folderId: dir, url: `https://drive.google.com/drive/folders/${dir}` });
}

// 아직 백업 안 된 기록 목록 (관리자 "전체 백업" 버튼이 하나씩 부름)
export async function pendingBackups(env) {
  const { results } = await env.DB.prepare(
    "SELECT id, title, kind, started_at FROM recordings WHERE status = 'done' AND drive_file_id IS NULL ORDER BY started_at LIMIT 200"
  ).all();
  return json({ items: results });
}
