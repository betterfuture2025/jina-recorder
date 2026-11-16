// 구글 로그인과 로그인 상태(세션)
import {
  json, fail, parseCookies, cookie, isSecureRequest, randomToken, sha256Hex,
  normEmail, isoAfterDays, HttpError,
} from './util.js';
import { getSettings } from './settings.js';

const SESSION_COOKIE = 'vn_session';
const STATE_COOKIE = 'vn_oauth_state';
const SESSION_DAYS = 180;        // 한 번 로그인하면 약 6개월 유지
const RENEW_WHEN_DAYS_LEFT = 150; // 쓰는 동안 계속 연장

export function redirectUri(request) {
  return new URL('/auth/callback', request.url).toString();
}

// ── 세션 ────────────────────────────────────────────────

export async function createSession(env, request, userId) {
  const token = randomToken(32);
  const hash = await sha256Hex(token);
  await env.DB.prepare(
    'INSERT INTO sessions (token_hash, user_id, expires_at, user_agent) VALUES (?, ?, ?, ?)'
  ).bind(hash, userId, isoAfterDays(SESSION_DAYS), (request.headers.get('user-agent') || '').slice(0, 200)).run();
  return cookie(SESSION_COOKIE, token, { maxAge: SESSION_DAYS * 86400, secure: isSecureRequest(request) });
}

// 로그인한 사용자를 돌려준다. 없으면 null.
// 만료가 가까우면 연장하고, 새 쿠키를 ctx.setCookies 에 넣는다.
export async function currentUser(env, request, ctx = {}) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role, u.picture, u.last_name, u.first_name, u.first_name_en, u.last_name_en, u.position, u.phone, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND u.active = 1 AND s.expires_at > datetime('now')`
  ).bind(hash).first();
  if (!row) return null;

  const daysLeft = (Date.parse(row.expires_at.replace(' ', 'T') + 'Z') - Date.now()) / 86400e3;
  if (daysLeft < RENEW_WHEN_DAYS_LEFT) {
    await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?')
      .bind(isoAfterDays(SESSION_DAYS), hash).run();
    (ctx.setCookies ||= []).push(
      cookie(SESSION_COOKIE, token, { maxAge: SESSION_DAYS * 86400, secure: isSecureRequest(request) })
    );
  }
  const { expires_at, ...user } = row;
  return user;
}

export async function requireUser(env, request, ctx) {
  const user = await currentUser(env, request, ctx);
  if (!user) throw new HttpError(401, 'login_required', '로그인이 필요해요.');
  return user;
}

export async function requireAdmin(env, request, ctx) {
  const user = await requireUser(env, request, ctx);
  if (user.role !== 'admin') throw new HttpError(403, 'admin_only', '관리자만 할 수 있어요.');
  return user;
}

export async function logout(env, request) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (token) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
  }
  return json({ ok: true }, 200, {
    'set-cookie': cookie(SESSION_COOKIE, '', { maxAge: 0, secure: isSecureRequest(request) }),
  });
}

// ── 구글 로그인 ──────────────────────────────────────────

function back(request, params) {
  const url = new URL('/', request.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

function redirect(location, cookies = []) {
  const headers = new Headers({ location, 'cache-control': 'no-store' });
  cookies.forEach((c) => headers.append('set-cookie', c));
  return new Response(null, { status: 302, headers });
}

export async function startGoogleLogin(env, request) {
  const s = await getSettings(env, ['google.client_id', 'google.client_secret']);
  if (!s['google.client_id'] || !s['google.client_secret']) {
    return redirect(back(request, { error: 'google_not_configured' }));
  }
  const state = randomToken(24);
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', s['google.client_id']);
  url.searchParams.set('redirect_uri', redirectUri(request));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'select_account');
  const hint = new URL(request.url).searchParams.get('hint');
  if (hint) url.searchParams.set('login_hint', hint);
  return redirect(url.toString(), [
    cookie(STATE_COOKIE, state, { maxAge: 600, path: '/auth', secure: isSecureRequest(request) }),
  ]);
}

export async function finishGoogleLogin(env, request) {
  const url = new URL(request.url);
  const clearState = cookie(STATE_COOKIE, '', { maxAge: 0, path: '/auth', secure: isSecureRequest(request) });

  const gErr = url.searchParams.get('error');
  if (gErr) {
    // access_denied 는 사용자가 취소한 것, 나머지는 구글 쪽 설정 문제라 코드를 그대로 보여 준다.
    if (gErr === 'access_denied') return redirect(back(request, { error: 'google_cancelled' }), [clearState]);
    return redirect(back(request, { error: 'google_error', code: gErr.slice(0, 60) }), [clearState]);
  }
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const saved = parseCookies(request)[STATE_COOKIE];
  if (!code || !state || !saved || state !== saved) {
    return redirect(back(request, { error: 'state_mismatch' }), [clearState]);
  }

  const s = await getSettings(env, ['google.client_id', 'google.client_secret']);
  let tokenRes, infoRes;
  try {
  tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: s['google.client_id'] || '',
      client_secret: s['google.client_secret'] || '',
      redirect_uri: redirectUri(request),
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) {
    return redirect(back(request, { error: 'google_token_failed' }), [clearState]);
  }
  const tokens = await tokenRes.json();

  infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  } catch {
    return redirect(back(request, { error: 'google_unreachable' }), [clearState]);
  }
  if (!infoRes.ok) {
    return redirect(back(request, { error: 'google_userinfo_failed' }), [clearState]);
  }
  const info = await infoRes.json();
  const email = normEmail(info.email);
  if (!email || info.email_verified === false) {
    return redirect(back(request, { error: 'email_unverified' }), [clearState]);
  }

  const user = await env.DB.prepare('SELECT id, active FROM users WHERE email = ?').bind(email).first();
  if (!user || !user.active) {
    return redirect(back(request, { error: 'not_allowed', email }), [clearState]);
  }

  await env.DB.prepare(
    `UPDATE users SET name = COALESCE(NULLIF(name, ''), ?), picture = ?, last_login_at = datetime('now') WHERE id = ?`
  ).bind(info.name || null, info.picture || null, user.id).run();

  const sessionCookie = await createSession(env, request, user.id);
  return redirect(new URL('/', request.url).toString(), [clearState, sessionCookie]);
}

// 설정 페이지의 "연결 테스트": 가짜 코드로 토큰을 요청해서
// invalid_grant 면 아이디·비밀번호는 맞은 것, invalid_client 면 틀린 것.
export async function testGoogleCredentials(env, request) {
  const s = await getSettings(env, ['google.client_id', 'google.client_secret']);
  if (!s['google.client_id'] || !s['google.client_secret']) {
    return { ok: false, reason: 'missing' };
  }
  let res;
  try {
    res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: 'connection-test',
      client_id: s['google.client_id'],
      client_secret: s['google.client_secret'],
      redirect_uri: redirectUri(request),
      grant_type: 'authorization_code',
    }),
    });
  } catch {
    return { ok: false, reason: 'network' };
  }
  let body = {};
  try { body = await res.json(); } catch {}
  if (body.error === 'invalid_grant') return { ok: true };
  if (body.error === 'invalid_client' || body.error === 'unauthorized_client') return { ok: false, reason: 'invalid_client' };
  if (body.error === 'redirect_uri_mismatch') return { ok: false, reason: 'redirect_uri_mismatch' };
  return { ok: false, reason: body.error || `http_${res.status}` };
}

export { fail };
