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
  'email.provider':       { secret: false, max: 10, label: '메일 보내는 방법', pattern: /^(gmail|resend)$/ },
  'email.gmail_user':     { secret: false, max: 120, label: 'Gmail 주소', pattern: /^[^\s@]+@(gmail\.com|googlemail\.com|[^\s@]+\.[^\s@]+)$/i,
                            hint: '예: center@gmail.com' },
  'email.gmail_pass':     { secret: true,  max: 40, label: 'Gmail 앱 비밀번호', pattern: /^[a-zA-Z\s]{16,24}$/,
                            hint: '구글에서 만든 16자리 앱 비밀번호를 넣어 주세요.' },
  'email.resend_key':     { secret: true,  max: 200, label: 'Resend API 키', pattern: /^re_[\w-]+$/,
                            hint: 're_ 로 시작해야 해요.' },
  'email.from':           { secret: false, max: 200, label: '보내는 주소',
                            pattern: /^([^<>]*<)?[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>?$/,
                            hint: '예: 지나기록기 <noreply@도메인>' },

  // ── AI (파트 6) ──
  'ai.summary_provider':  { secret: false, max: 12, label: '요약에 쓸 AI', pattern: /^(cf|anthropic|openai)$/ },
  'ai.analysis_provider': { secret: false, max: 12, label: '분석에 쓸 AI', pattern: /^(cf|anthropic|openai)$/ },
  'ai.cf_model':          { secret: false, max: 120, label: 'Cloudflare AI 모델', pattern: /^@cf\/[\w.\/-]+$/,
                            hint: '@cf/ 로 시작해야 해요.' },
  'ai.anthropic_key':     { secret: true,  max: 300, label: 'Claude API 키', pattern: /^sk-ant-[\w-]+$/,
                            hint: 'sk-ant- 로 시작해야 해요.' },
  'ai.anthropic_model':   { secret: false, max: 80, label: 'Claude 모델', pattern: /^claude-[\w.-]+$/ },
  'ai.openai_base':       { secret: false, max: 200, label: '주소 (Base URL)', pattern: /^https:\/\/[^\s]+$/,
                            hint: 'https:// 로 시작하는 주소예요. 예: https://api.openai.com/v1' },
  'ai.openai_key':        { secret: true,  max: 300, label: 'API 키' },
  'ai.openai_model':      { secret: false, max: 120, label: '모델 이름', pattern: /^[\w.:\/-]+$/ },
  'ai.auto_summary':      { secret: false, max: 1, label: '자동 요약', pattern: /^[01]$/ },

  // ── 요약 메일 (파트 5) ──
  'mail.summary_auto':    { secret: false, max: 1, label: '요약 메일 자동 보내기', pattern: /^[01]$/ },
  'mail.summary_cc':      { secret: false, max: 400, label: '요약 메일 같이 받을 사람',
                            pattern: /^\s*[^\s@,]+@[^\s@,]+\.[^\s@,]+(\s*,\s*[^\s@,]+@[^\s@,]+\.[^\s@,]+)*\s*$/,
                            hint: '이메일을 쉼표로 나눠서 넣어 주세요.' },

  // ── 구글 드라이브 (파트 8) ──
  'drive.refresh_token':  { secret: true,  max: 600, label: '드라이브 연결', hidden: true },
  'drive.account':        { secret: false, max: 200, label: '연결한 구글 계정', hidden: true },
  'drive.folder_id':      { secret: false, max: 200, label: '백업 폴더', hidden: true },
  'drive.auto':           { secret: false, max: 1, label: '자동 백업', pattern: /^[01]$/ },
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
