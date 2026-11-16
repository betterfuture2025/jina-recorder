// 이메일 + 비밀번호 로그인
// 비밀번호는 PBKDF2-SHA256 으로 바꿔서 저장한다 (원문은 어디에도 남기지 않음).
import { json, readJson, normEmail, EMAIL_RE, HttpError, safeEqual } from './util.js';
import { createSession } from './auth.js';

const ITER = 20000;          // Workers 무료 요금제 CPU 한도 안에서 도는 횟수
const MIN_LEN = 8;
const MAX_FAILS = 8;         // 15분 안에 이만큼 틀리면 잠깐 잠금

function b64(bytes) { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); }
function unb64(str) { const s = atob(str); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; }

async function derive(password, salt, iter) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
  return new Uint8Array(bits);
}

export function checkPasswordRule(password) {
  const p = String(password || '');
  if (p.length < MIN_LEN) throw new HttpError(400, 'weak_password', `비밀번호는 ${MIN_LEN}자 이상으로 해 주세요.`);
  if (p.length > 128) throw new HttpError(400, 'long_password', '비밀번호가 너무 길어요.');
  return p;
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITER);
  return `pbkdf2$${ITER}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password, stored) {
  if (!stored) return false;
  const [kind, iter, saltB64, hashB64] = stored.split('$');
  if (kind !== 'pbkdf2') return false;
  const hash = await derive(password, unb64(saltB64), Number(iter));
  return safeEqual(b64(hash), hashB64);
}

const nowSql = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

export async function passwordLogin(env, request) {
  const body = await readJson(request);
  const email = normEmail(body.email);
  const password = String(body.password || '');
  if (!EMAIL_RE.test(email) || !password) throw new HttpError(400, 'bad_input', '이메일과 비밀번호를 넣어 주세요.');

  const fails = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM login_failures WHERE email = ? AND created_at > datetime('now', '-15 minutes')"
  ).bind(email).first();
  if (fails && fails.n >= MAX_FAILS) {
    throw new HttpError(429, 'locked', '비밀번호를 여러 번 틀렸어요. 15분 뒤 다시 해 주세요.');
  }

  const user = await env.DB.prepare('SELECT id, password_hash FROM users WHERE email = ? AND active = 1').bind(email).first();
  // 계정이 없어도 같은 시간이 걸리게 한 번 계산한다
  const ok = user && user.password_hash
    ? await verifyPassword(password, user.password_hash)
    : (await verifyPassword(password, 'pbkdf2$' + ITER + '$AAAAAAAAAAAAAAAAAAAAAA==$x'), false);

  if (!ok) {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO login_failures (email) VALUES (?)').bind(email),
      env.DB.prepare("DELETE FROM login_failures WHERE created_at < datetime('now', '-1 day')"),
    ]);
    if (user && !user.password_hash) {
      throw new HttpError(400, 'no_password', '이 계정은 아직 비밀번호가 없어요. 구글이나 인증번호로 로그인한 뒤 내 정보에서 만들 수 있어요.');
    }
    throw new HttpError(400, 'wrong_password', '이메일이나 비밀번호가 맞지 않아요.');
  }

  await env.DB.batch([
    env.DB.prepare('DELETE FROM login_failures WHERE email = ?').bind(email),
    env.DB.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").bind(user.id),
  ]);
  const cookie = await createSession(env, request, user.id);
  return json({ ok: true }, 200, { 'set-cookie': cookie });
}

// 내 비밀번호 바꾸기 (이미 있으면 지금 비밀번호 확인)
export async function changeMyPassword(env, request, me) {
  const body = await readJson(request);
  const next = checkPasswordRule(body.newPassword);
  const row = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(me.id).first();
  if (row && row.password_hash && !(await verifyPassword(String(body.currentPassword || ''), row.password_hash))) {
    throw new HttpError(400, 'wrong_password', '지금 비밀번호가 맞지 않아요.');
  }
  await env.DB.prepare('UPDATE users SET password_hash = ?, password_set_at = ? WHERE id = ?')
    .bind(await hashPassword(next), nowSql(), me.id).run();
  return json({ ok: true });
}

// 관리자가 새 비밀번호 정해 주기 (잊어버린 선생님용). 그 사람의 다른 로그인은 모두 끊는다.
export async function adminSetPassword(env, request, me, id) {
  const body = await readJson(request);
  const next = checkPasswordRule(body.password);
  const target = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(id).first();
  if (!target) throw new HttpError(404, 'not_found', '사용자를 찾을 수 없어요.');
  const stmts = [
    env.DB.prepare('UPDATE users SET password_hash = ?, password_set_at = ? WHERE id = ?').bind(await hashPassword(next), nowSql(), id),
  ];
  if (id !== me.id) stmts.push(env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id));
  await env.DB.batch(stmts);
  return json({ ok: true });
}
