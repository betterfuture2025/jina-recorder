// 지나기록기 — 상담·회의 녹음 기록 — 서버 입구
// 파트 1: 로그인, 처음 설치, 사용자 관리, 설정
import { json, fail, HttpError, normEmail } from './util.js';
import { ensureSchema } from './schema.js';
import {
  currentUser, requireUser, requireAdmin, logout, startGoogleLogin, finishGoogleLogin, createSession,
} from './auth.js';
import {
  setupStatus, runSetup, listUsers, addUser, updateUser, deleteUser,
  getAdminSettings, putAdminSettings, testGoogle, publicConfig,
} from './admin.js';

// 다른 사이트에서 몰래 요청을 보내는 것(CSRF)을 막는다.
function checkOrigin(request) {
  if (request.method === 'GET' || request.method === 'HEAD') return;
  const origin = request.headers.get('origin');
  const self = new URL(request.url).origin;
  if (origin && origin !== self) throw new HttpError(403, 'bad_origin', '허용되지 않은 요청이에요.');
  if (!origin && request.headers.get('x-requested-with') !== 'fetch') {
    throw new HttpError(403, 'bad_origin', '허용되지 않은 요청이에요.');
  }
}

function withCookies(response, cookies) {
  if (!cookies || !cookies.length) return response;
  const r = new Response(response.body, response);
  cookies.forEach((c) => r.headers.append('set-cookie', c));
  return r;
}

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const m = request.method;

  // ── 로그인 ──
  if (path === '/auth/login' && m === 'GET') return startGoogleLogin(env, request);
  if (path === '/auth/callback' && m === 'GET') return finishGoogleLogin(env, request);

  // 로컬 개발 전용 로그인 (.dev.vars 에 DEV_LOGIN=1 이고 localhost 일 때만)
  if (path === '/auth/dev-login' && m === 'GET') {
    const local = ['localhost', '127.0.0.1'].includes(url.hostname);
    if (env.DEV_LOGIN !== '1' || !local) return fail(404, 'not_found');
    const u = await env.DB.prepare('SELECT id FROM users WHERE email = ? AND active = 1')
      .bind(normEmail(url.searchParams.get('email'))).first();
    if (!u) return fail(403, 'not_allowed');
    const c = await createSession(env, request, u.id);
    return new Response(null, { status: 302, headers: { location: '/', 'set-cookie': c } });
  }

  if (!path.startsWith('/api/')) return fail(404, 'not_found');
  checkOrigin(request);

  // ── 누구나 ──
  if (path === '/api/config' && m === 'GET') return publicConfig(env);
  if (path === '/api/setup/status' && m === 'GET') return setupStatus(env, request);
  if (path === '/api/setup' && m === 'POST') return runSetup(env, request);

  // ── 로그인한 사람 ──
  if (path === '/api/me' && m === 'GET') {
    const user = await currentUser(env, request, ctx);
    if (!user) return fail(401, 'login_required');
    return json({ user });
  }
  if (path === '/api/logout' && m === 'POST') return logout(env, request);

  // ── 관리자 ──
  if (path.startsWith('/api/admin/')) {
    const me = await requireAdmin(env, request, ctx);
    if (path === '/api/admin/users' && m === 'GET') return listUsers(env);
    if (path === '/api/admin/users' && m === 'POST') return addUser(env, request);
    const um = path.match(/^\/api\/admin\/users\/([\w-]+)$/);
    if (um && m === 'PATCH') return updateUser(env, request, me, um[1]);
    if (um && m === 'DELETE') return deleteUser(env, me, um[1]);
    if (path === '/api/admin/settings' && m === 'GET') return getAdminSettings(env, request);
    if (path === '/api/admin/settings' && m === 'PUT') return putAdminSettings(env, request, me);
    if (path === '/api/admin/settings/test-google' && m === 'POST') return testGoogle(env, request);
  }

  // 파트 2 이후 기능은 로그인 확인만 해 두고 아직 없음
  await requireUser(env, request, ctx);
  return fail(404, 'not_found', '없는 주소예요.');
}

export default {
  async fetch(request, env) {
    const ctx = { setCookies: [] };
    try {
      await ensureSchema(env);
      const res = await route(request, env, ctx);
      return withCookies(res, ctx.setCookies);
    } catch (err) {
      if (err instanceof HttpError) return fail(err.status, err.code, err.message);
      console.error(err && err.stack ? err.stack : err);
      return fail(500, 'server_error', '서버에서 문제가 생겼어요. 잠시 뒤 다시 해 주세요.');
    }
  },
};
