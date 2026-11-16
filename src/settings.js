// 설정 페이지에 저장되는 값들.
// 새 파트를 붙일 때는 여기 DEFS 에 항목만 추가하면 저장·암호화·화면 표시가 같이 된다.
import { encrypt, decrypt } from './crypto.js';
import { HttpError } from './util.js';

export const DEFS = {
  'app.name':             { secret: false, max: 60, label: '사이트 이름' },
  'google.client_id':     { secret: false, max: 200, label: '클라이언트 ID',
                            pattern: /^[\w.-]+\.apps\.googleusercontent\.com$/,
                            hint: '…apps.googleusercontent.com 으로 끝나야 해요.' },
  'google.client_secret': { secret: true,  max: 200, label: '클라이언트 보안 비밀번호' },
  'email.resend_key':     { secret: true,  max: 200, label: 'Resend API 키', pattern: /^re_[\w-]+$/,
                            hint: 're_ 로 시작해야 해요.' },
  'email.from':           { secret: false, max: 200, label: '보내는 주소',
                            pattern: /^([^<>]*<)?[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>?$/,
                            hint: '예: 지나기록기 <noreply@도메인>' },
};

export async function getSetting(env, key) {
  const def = DEFS[key];
  if (!def) throw new Error(`unknown setting ${key}`);
  const row = await env.DB.prepare('SELECT value, is_secret FROM settings WHERE key = ?').bind(key).first();
  if (!row || row.value == null) return null;
  return row.is_secret ? decrypt(env, row.value) : row.value;
}

export async function getSettings(env, keys) {
  const out = {};
  for (const k of keys) out[k] = await getSetting(env, k);
  return out;
}

function mask(v) {
  if (!v) return '';
  return '••••' + v.slice(-4);
}

// 관리자 화면용: 비밀값은 끝 4자리만 보여준다.
export async function listForAdmin(env) {
  const { results } = await env.DB.prepare('SELECT key, value, is_secret, updated_at FROM settings').all();
  const byKey = Object.fromEntries(results.map((r) => [r.key, r]));
  const out = {};
  for (const [key, def] of Object.entries(DEFS)) {
    const row = byKey[key];
    if (!row || row.value == null) {
      out[key] = { set: false, value: def.secret ? '' : '' };
      continue;
    }
    if (def.secret) {
      let hint = '••••';
      try { hint = mask(await decrypt(env, row.value)); } catch { hint = '(복호화 실패)'; }
      out[key] = { set: true, value: '', hint, updatedAt: row.updated_at };
    } else {
      out[key] = { set: true, value: row.value, updatedAt: row.updated_at };
    }
  }
  return out;
}

// values: { key: string | null }
//  - 일반 값: 빈 문자열이면 지움
//  - 비밀 값: 빈 문자열이면 그대로 둠, null 이면 지움
export async function saveSettings(env, values, userId) {
  const stmts = [];
  for (const [key, raw] of Object.entries(values || {})) {
    const def = DEFS[key];
    if (!def) throw new HttpError(400, 'unknown_setting', `알 수 없는 설정: ${key}`);
    if (raw === null || (!def.secret && String(raw).trim() === '')) {
      stmts.push(env.DB.prepare('DELETE FROM settings WHERE key = ?').bind(key));
      continue;
    }
    const v = String(raw).trim();
    if (def.secret && v === '') continue;
    if (v.length > def.max) throw new HttpError(400, 'too_long', `${def.label || key} 값이 너무 길어요.`);
    if (def.pattern && !def.pattern.test(v)) throw new HttpError(400, 'bad_format', `${def.label || key} 형식이 맞지 않아요. ${def.hint || ''}`.trim());
    const stored = def.secret ? await encrypt(env, v) : v;
    stmts.push(
      env.DB.prepare(
        `INSERT INTO settings (key, value, is_secret, updated_at, updated_by)
         VALUES (?, ?, ?, datetime('now'), ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, is_secret = excluded.is_secret,
           updated_at = excluded.updated_at, updated_by = excluded.updated_by`
      ).bind(key, stored, def.secret ? 1 : 0, userId || null)
    );
  }
  if (stmts.length) await env.DB.batch(stmts);
}
