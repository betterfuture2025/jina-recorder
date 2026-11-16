// 이메일 인증번호 로그인
// 1) 이메일을 넣으면 6자리 번호를 메일로 보낸다 (10분 유효)
// 2) 번호를 넣으면 로그인된다 (5번 틀리면 그 번호는 못 씀)
// 등록되지 않은 이메일이어도 똑같이 "보냈어요"라고 답해서, 누가 등록됐는지 알아낼 수 없게 한다.
import { json, readJson, normEmail, EMAIL_RE, HttpError, uid, sha256Hex, safeEqual } from './util.js';
import { sendMail, mailReady } from './mail.js';
import { createSession } from './auth.js';
import { getSetting } from './settings.js';

const CODE_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const MAX_PER_HOUR = 5;

function sqlAfterMinutes(min) {
  return new Date(Date.now() + min * 60e3).toISOString().replace('T', ' ').slice(0, 19);
}

function sixDigits() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  return String(n).padStart(6, '0');
}

const hashCode = (email, code) => sha256Hex(`login:${email}:${code}`);

export async function startEmailLogin(env, request) {
  if (!(await mailReady(env))) throw new HttpError(400, 'mail_not_configured', '이메일 로그인이 아직 설정되지 않았어요.');
  const body = await readJson(request);
  const email = normEmail(body.email);
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'bad_email', '이메일 주소를 확인해 주세요.');

  const user = await env.DB.prepare('SELECT id FROM users WHERE email = ? AND active = 1').bind(email).first();
  if (!user) return json({ ok: true }); // 등록 여부를 알려 주지 않는다

  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM login_codes WHERE email = ? AND created_at > datetime('now', '-1 hour')"
  ).bind(email).first();
  if (recent && recent.n >= MAX_PER_HOUR) {
    throw new HttpError(429, 'too_many', '인증번호를 너무 많이 요청했어요. 1시간 뒤 다시 해 주세요.');
  }

  const code = sixDigits();
  await env.DB.batch([
    env.DB.prepare('UPDATE login_codes SET used = 1 WHERE email = ? AND used = 0').bind(email),
    env.DB.prepare('INSERT INTO login_codes (id, email, code_hash, expires_at) VALUES (?, ?, ?, ?)')
      .bind(uid(), email, await hashCode(email, code), sqlAfterMinutes(CODE_MINUTES)),
  ]);

  const appName = (await getSetting(env, 'app.name')) || '지나기록기';
  const spaced = code.split('').join(' ');
  await sendMail(env, {
    to: email,
    subject: `[${appName}] 로그인 인증번호 ${code}`,
    text: `${appName} 로그인 인증번호: ${code}\n\n${CODE_MINUTES}분 안에 입력해 주세요. 직접 요청하지 않았다면 이 메일은 무시하세요.`,
    html: `<div style="font-family:-apple-system,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;max-width:420px;margin:0 auto;padding:24px;color:#1B2430">
      <p style="margin:0 0 8px;font-weight:600">${appName} 로그인 인증번호</p>
      <p style="font-size:34px;font-weight:700;letter-spacing:6px;margin:12px 0 16px">${spaced}</p>
      <p style="margin:0;color:#5B6675;font-size:14px">${CODE_MINUTES}분 안에 입력해 주세요.<br>직접 요청하지 않았다면 이 메일은 무시하세요.</p>
    </div>`,
  });
  return json({ ok: true });
}

export async function verifyEmailLogin(env, request) {
  const body = await readJson(request);
  const email = normEmail(body.email);
  const code = String(body.code || '').replace(/\D/g, '');
  if (!EMAIL_RE.test(email) || code.length !== 6) {
    throw new HttpError(400, 'bad_code', '인증번호 6자리를 확인해 주세요.');
  }
  const row = await env.DB.prepare(
    `SELECT id, code_hash, attempts FROM login_codes
      WHERE email = ? AND used = 0 AND expires_at > datetime('now')
      ORDER BY created_at DESC LIMIT 1`
  ).bind(email).first();
  if (!row || row.attempts >= MAX_ATTEMPTS) {
    throw new HttpError(400, 'code_expired', '인증번호가 만료됐어요. 새 번호를 받아 주세요.');
  }
  const ok = await safeEqual(row.code_hash, await hashCode(email, code));
  if (!ok) {
    await env.DB.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?').bind(row.id).run();
    const left = MAX_ATTEMPTS - row.attempts - 1;
    throw new HttpError(400, 'wrong_code', left > 0 ? `인증번호가 맞지 않아요. (${left}번 남음)` : '인증번호를 너무 많이 틀렸어요. 새 번호를 받아 주세요.');
  }
  const user = await env.DB.prepare('SELECT id FROM users WHERE email = ? AND active = 1').bind(email).first();
  if (!user) throw new HttpError(403, 'not_allowed', '등록되지 않은 계정이에요.');

  await env.DB.batch([
    env.DB.prepare('UPDATE login_codes SET used = 1 WHERE id = ?').bind(row.id),
    env.DB.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").bind(user.id),
  ]);
  const sessionCookie = await createSession(env, request, user.id);
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie });
}

// 설정 페이지의 "테스트 메일 보내기": 관리자 본인에게 보낸다
export async function testMail(env, me) {
  const appName = (await getSetting(env, 'app.name')) || '지나기록기';
  await sendMail(env, {
    to: me.email,
    subject: `[${appName}] 메일 연결 테스트`,
    text: `${appName}에서 보낸 테스트 메일이에요. 이 메일이 보이면 메일 보내기가 잘 연결된 거예요.`,
    html: `<p>${appName}에서 보낸 테스트 메일이에요.</p><p>이 메일이 보이면 메일 보내기가 잘 연결된 거예요.</p>`,
  });
  return json({ ok: true, to: me.email });
}
