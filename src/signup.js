// 가입 신청: 누구나 신청 → 관리자가 승인하면 그 이메일로 로그인할 수 있다.
import { json, uid, readJson, normEmail, EMAIL_RE, HttpError } from './util.js';
import { mailReady } from './mail.js';
import { sendTemplate } from './mailTemplates.js';
import { getSetting } from './settings.js';
import { PROFILE_FIELDS, pickProfile, displayName } from './profile.js';
import { checkPasswordRule, hashPassword } from './password.js';

export async function submitSignup(env, request) {
  const body = await readJson(request);
  const email = normEmail(body.email);
  const prof = pickProfile(body);
  const name = displayName(prof, String(body.name || '').trim().slice(0, 60));
  const note = String(body.note || '').trim().slice(0, 300) || null;
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'bad_email', '이메일 주소를 확인해 주세요.');
  if (!name) throw new HttpError(400, 'name_required', '이름을 넣어 주세요.');
  const pwHash = body.password ? await hashPassword(checkPasswordRule(body.password)) : null;

  const user = await env.DB.prepare('SELECT active FROM users WHERE email = ?').bind(email).first();
  if (user && user.active) return json({ ok: true, already: true });

  const pending = await env.DB.prepare(
    "SELECT id FROM signup_requests WHERE email = ? AND status = 'pending'"
  ).bind(email).first();
  if (pending) return json({ ok: true, pending: true });

  // 하루 신청 수 제한 (스팸 방지)
  const today = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM signup_requests WHERE created_at > datetime('now', '-1 day')"
  ).first();
  if (today && today.n >= 50) throw new HttpError(429, 'too_many', '오늘은 신청이 너무 많아요. 내일 다시 해 주세요.');

  await env.DB.prepare(
    `INSERT INTO signup_requests (id, email, name, note, password_hash, ${PROFILE_FIELDS.join(', ')}) VALUES (?, ?, ?, ?, ?, ${PROFILE_FIELDS.map(() => '?').join(', ')})`
  ).bind(uid(), email, name, note, pwHash, ...PROFILE_FIELDS.map((f) => prof[f] ?? null)).run();

  // 메일이 설정돼 있으면 관리자들에게 알림 (실패해도 신청은 저장됨)
  try {
    if (await mailReady(env)) {
      const appName = (await getSetting(env, 'app.name')) || '지나기록기';
      const { results } = await env.DB.prepare("SELECT email FROM users WHERE role = 'admin' AND active = 1").all();
      const site = new URL(request.url).origin;
      for (const a of results) {
        await sendTemplate(env, 'signup_admin', {
          to: a.email, site,
          vars: { 신청자: name, 신청자이메일: email, 직책: prof.position || '', 전화번호: prof.phone || '', 메모: note || '' },
        });
      }
    }
  } catch (err) {
    console.error('signup notify failed', err && err.message);
  }
  return json({ ok: true }, 201);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export async function listSignups(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, email, name, note, created_at, ${PROFILE_FIELDS.join(', ')} FROM signup_requests WHERE status = 'pending' ORDER BY created_at DESC LIMIT 100`
  ).all();
  return json({ requests: results });
}

export async function decideSignup(env, request, me, id) {
  const body = await readJson(request);
  const approve = body.approve === true;
  const reqRow = await env.DB.prepare("SELECT * FROM signup_requests WHERE id = ? AND status = 'pending'").bind(id).first();
  if (!reqRow) throw new HttpError(404, 'not_found', '신청을 찾을 수 없어요.');
  const stmts = [
    env.DB.prepare("UPDATE signup_requests SET status = ?, decided_at = datetime('now'), decided_by = ? WHERE id = ?")
      .bind(approve ? 'approved' : 'rejected', me.id, id),
  ];
  if (approve) {
    stmts.push(env.DB.prepare(
      `INSERT INTO users (id, email, name, role, password_hash, password_set_at, ${PROFILE_FIELDS.join(', ')})
       VALUES (?, ?, ?, 'teacher', ?, CASE WHEN ? IS NULL THEN NULL ELSE datetime('now') END, ${PROFILE_FIELDS.map(() => '?').join(', ')})
       ON CONFLICT(email) DO UPDATE SET active = 1, name = COALESCE(users.name, excluded.name),
         password_hash = COALESCE(excluded.password_hash, users.password_hash),
         ${PROFILE_FIELDS.map((f) => `${f} = COALESCE(users.${f}, excluded.${f})`).join(', ')}`
    ).bind(uid(), reqRow.email, reqRow.name, reqRow.password_hash, reqRow.password_hash, ...PROFILE_FIELDS.map((f) => reqRow[f] ?? null)));
  }
  await env.DB.batch(stmts);

  if (approve) {
    try {
      if (await mailReady(env)) {
        const appName = (await getSetting(env, 'app.name')) || '지나기록기';
        const site = new URL(request.url).origin;
        await sendTemplate(env, 'signup_approved', { to: reqRow.email, site, vars: { 이름: reqRow.name, 이메일: reqRow.email } });
      }
    } catch (err) {
      console.error('approve mail failed', err && err.message);
    }
  }
  return json({ ok: true, approved: approve });
}
