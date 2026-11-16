// 처음 설치, 사용자(선생님) 관리, 설정 저장
import { json, uid, readJson, normEmail, EMAIL_RE, HttpError, safeEqual } from './util.js';
import { hasEncKey, isPlaceholder } from './crypto.js';
import { saveSettings, listForAdmin, getSetting } from './settings.js';
import { mailReady } from './mail.js';
import { PROFILE_FIELDS, pickProfile, displayName } from './profile.js';
import { redirectUri, createSession, testGoogleCredentials } from './auth.js';

// ── 처음 설치 ───────────────────────────────────────────

async function adminCount(env) {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").first();
  return r ? r.n : 0;
}

export async function setupStatus(env, request) {
  return json({
    needsSetup: (await adminCount(env)) === 0,
    encKeyOk: hasEncKey(env),
    setupKeyOk: !!env.SETUP_KEY && !isPlaceholder(env.SETUP_KEY),
    redirectUri: redirectUri(request),
  });
}

export async function runSetup(env, request) {
  if ((await adminCount(env)) > 0) throw new HttpError(409, 'already_setup', '이미 설치가 끝났어요.');
  if (!hasEncKey(env)) throw new HttpError(500, 'enc_key_missing', 'ENC_KEY 비밀값이 없거나 안내 문장 그대로예요. Cloudflare → Workers → jina-recorder → 설정 → 변수와 비밀에서 16자 이상 문장으로 바꿔 주세요.');
  if (!env.SETUP_KEY || isPlaceholder(env.SETUP_KEY)) {
    throw new HttpError(500, 'setup_key_missing', 'SETUP_KEY 비밀값이 안내 문장 그대로예요. Cloudflare → Workers → jina-recorder → 설정 → 변수와 비밀에서 바꿔 주세요.');
  }

  const body = await readJson(request);
  if (!(await safeEqual(body.setupKey || '', env.SETUP_KEY))) {
    throw new HttpError(403, 'bad_setup_key', '설치 코드가 맞지 않아요.');
  }
  const email = normEmail(body.adminEmail);
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'bad_email', '관리자 이메일을 확인해 주세요.');
  if (!String(body.googleClientId || '').trim() || !String(body.googleClientSecret || '').trim()) {
    throw new HttpError(400, 'google_required', '구글 클라이언트 ID와 보안 비밀번호를 넣어 주세요.');
  }

  await saveSettings(env, {
    'app.name': body.appName || '지나기록기',
    'google.client_id': body.googleClientId,
    'google.client_secret': body.googleClientSecret,
  }, null);

  const id = uid();
  await env.DB.prepare(
    `INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, 'admin')
     ON CONFLICT(email) DO UPDATE SET role = 'admin', active = 1`
  ).bind(id, email, (body.adminName || '').trim() || null).run();

  return json({ ok: true });
}

// ── 사용자 관리 ─────────────────────────────────────────

const USER_COLS = 'id, email, name, role, active, picture, created_at, last_login_at, ' + PROFILE_FIELDS.join(', ');

export async function listUsers(env) {
  const { results } = await env.DB.prepare(
    `SELECT ${USER_COLS} FROM users ORDER BY active DESC, role = 'admin' DESC, COALESCE(name, email)`
  ).all();
  return json({ users: results });
}

export async function addUser(env, request) {
  const body = await readJson(request);
  const email = normEmail(body.email);
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'bad_email', '이메일 형식을 확인해 주세요.');
  const role = body.role === 'admin' ? 'admin' : 'teacher';
  const prof = pickProfile(body);
  const name = displayName(prof, (body.name || '').trim() || null);
  const exists = await env.DB.prepare('SELECT id, active FROM users WHERE email = ?').bind(email).first();
  if (exists && exists.active) throw new HttpError(409, 'exists', '이미 등록된 이메일이에요.');
  const vals = PROFILE_FIELDS.map((f) => prof[f] ?? null);
  if (exists) {
    await env.DB.prepare(
      `UPDATE users SET active = 1, role = ?, name = COALESCE(?, name), ${PROFILE_FIELDS.map((f) => `${f} = COALESCE(?, ${f})`).join(', ')} WHERE id = ?`
    ).bind(role, name, ...vals, exists.id).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO users (id, email, name, role, ${PROFILE_FIELDS.join(', ')}) VALUES (?, ?, ?, ?, ${PROFILE_FIELDS.map(() => '?').join(', ')})`
    ).bind(uid(), email, name, role, ...vals).run();
  }
  const user = await env.DB.prepare(`SELECT ${USER_COLS} FROM users WHERE email = ?`).bind(email).first();
  return json({ user }, 201);
}

export async function updateUser(env, request, me, id) {
  const body = await readJson(request);
  const target = await env.DB.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).bind(id).first();
  if (!target) throw new HttpError(404, 'not_found', '사용자를 찾을 수 없어요.');

  const role = body.role === undefined ? target.role : (body.role === 'admin' ? 'admin' : 'teacher');
  const active = body.active === undefined ? target.active : (body.active ? 1 : 0);
  const prof = { ...Object.fromEntries(PROFILE_FIELDS.map((f) => [f, target[f]])), ...pickProfile(body) };
  let name = body.name === undefined ? target.name : ((body.name || '').trim() || null);
  if (PROFILE_FIELDS.some((f) => body[f] !== undefined)) name = displayName(prof, name);

  const losingAdmin = target.role === 'admin' && target.active && (role !== 'admin' || !active);
  if (losingAdmin && (await adminCount(env)) <= 1) {
    throw new HttpError(400, 'last_admin', '관리자가 최소 한 명은 있어야 해요.');
  }
  if (id === me.id && !active) throw new HttpError(400, 'self_disable', '내 계정은 끌 수 없어요.');

  const stmts = [env.DB.prepare(
    `UPDATE users SET role = ?, active = ?, name = ?, ${PROFILE_FIELDS.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`
  ).bind(role, active, name, ...PROFILE_FIELDS.map((f) => prof[f] ?? null), id)];
  if (!active) stmts.push(env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id));
  await env.DB.batch(stmts);

  const user = await env.DB.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).bind(id).first();
  return json({ user });
}

export async function deleteUser(env, me, id) {
  const target = await env.DB.prepare('SELECT id, role, active FROM users WHERE id = ?').bind(id).first();
  if (!target) throw new HttpError(404, 'not_found', '사용자를 찾을 수 없어요.');
  if (id === me.id) throw new HttpError(400, 'self_delete', '내 계정은 지울 수 없어요.');
  if (target.role === 'admin' && target.active && (await adminCount(env)) <= 1) {
    throw new HttpError(400, 'last_admin', '관리자가 최소 한 명은 있어야 해요.');
  }
  const rec = await env.DB.prepare('SELECT COUNT(*) AS n FROM recordings WHERE owner_id = ?').bind(id).first();
  if (rec && rec.n > 0) {
    // 기록이 남아 있으면 지우지 않고 접속만 막는다.
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET active = 0 WHERE id = ?').bind(id),
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
    ]);
    return json({ ok: true, deactivated: true });
  }
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  return json({ ok: true, deleted: true });
}

// ── 설정 ────────────────────────────────────────────────

export async function getAdminSettings(env, request) {
  return json({ settings: await listForAdmin(env), redirectUri: redirectUri(request) });
}

export async function putAdminSettings(env, request, me) {
  const body = await readJson(request);
  await saveSettings(env, body.values || {}, me.id);
  return json({ settings: await listForAdmin(env) });
}

export async function testGoogle(env, request) {
  return json(await testGoogleCredentials(env, request));
}

// 내 정보 고치기 (이메일·권한은 못 바꿈)
export async function updateMe(env, request, me) {
  const body = await readJson(request);
  const cur = await env.DB.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).bind(me.id).first();
  const prof = { ...Object.fromEntries(PROFILE_FIELDS.map((f) => [f, cur[f]])), ...pickProfile(body) };
  const name = displayName(prof, cur.name);
  await env.DB.prepare(
    `UPDATE users SET name = ?, ${PROFILE_FIELDS.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`
  ).bind(name, ...PROFILE_FIELDS.map((f) => prof[f] ?? null), me.id).run();
  const user = await env.DB.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).bind(me.id).first();
  return json({ user });
}

// 누구나 볼 수 있는 기본 정보 (로그인 화면용)
export async function publicConfig(env) {
  const [name, clientId, emailReady] = await Promise.all([
    getSetting(env, 'app.name'), getSetting(env, 'google.client_id'), mailReady(env),
  ]);
  return json({ appName: name || '지나기록기', googleReady: !!clientId, emailReady });
}

export { createSession };
