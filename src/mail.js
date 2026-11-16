// 메일 보내기 (Resend). 키와 보내는 주소는 설정 페이지에서 넣는다.
import { getSettings } from './settings.js';
import { HttpError } from './util.js';

export async function mailReady(env) {
  const s = await getSettings(env, ['email.resend_key', 'email.from']);
  return !!(s['email.resend_key'] && s['email.from']);
}

export async function sendMail(env, { to, subject, html, text }) {
  const s = await getSettings(env, ['email.resend_key', 'email.from']);
  if (!s['email.resend_key'] || !s['email.from']) {
    throw new HttpError(400, 'mail_not_configured', '메일 보내기가 아직 설정되지 않았어요.');
  }
  let res;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${s['email.resend_key']}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: s['email.from'], to: [to], subject, html, text }),
    });
  } catch {
    throw new HttpError(502, 'mail_unreachable', '메일 서버에 연결하지 못했어요. 잠시 뒤 다시 해 주세요.');
  }
  let body = {};
  try { body = await res.json(); } catch {}
  if (!res.ok) {
    const detail = body.message || body.name || `HTTP ${res.status}`;
    throw new HttpError(502, 'mail_failed', `메일을 보내지 못했어요: ${detail}`);
  }
  return body.id || null;
}
