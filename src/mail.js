// 메일 보내기. 설정에서 고른 방법으로 보낸다.
//  - gmail : Gmail 주소 + 앱 비밀번호 (도메인 없이 바로 가능, 하루 500통 정도)
//  - resend: Resend API 키 + 인증한 도메인 주소
import { getSettings } from './settings.js';
import { HttpError } from './util.js';
import { smtpSend } from './smtp.js';

const KEYS = ['email.provider', 'email.gmail_user', 'email.gmail_pass', 'email.resend_key', 'email.from', 'app.name'];

function pickProvider(s) {
  const p = s['email.provider'];
  if (p === 'gmail' || p === 'resend') return p;
  if (s['email.gmail_user'] && s['email.gmail_pass']) return 'gmail';
  if (s['email.resend_key'] && s['email.from']) return 'resend';
  return null;
}

function ready(s) {
  const p = pickProvider(s);
  if (p === 'gmail') return !!(s['email.gmail_user'] && s['email.gmail_pass']);
  if (p === 'resend') return !!(s['email.resend_key'] && s['email.from']);
  return false;
}

export async function mailReady(env) {
  return ready(await getSettings(env, KEYS));
}

export async function sendMail(env, { to, subject, html, text }) {
  const s = await getSettings(env, KEYS);
  if (!ready(s)) throw new HttpError(400, 'mail_not_configured', '메일 보내기가 아직 설정되지 않았어요.');
  const provider = pickProvider(s);
  const appName = s['app.name'] || '지나기록기';

  if (provider === 'gmail') {
    try {
      await smtpSend({
        user: s['email.gmail_user'], pass: s['email.gmail_pass'],
        from: `${appName} <${s['email.gmail_user']}>`, to, subject, text, html,
      });
      return null;
    } catch (err) {
      const msg = String(err && err.message || err);
      if (err && (err.smtpCode === 535 || err.smtpCode === 534)) {
        throw new HttpError(502, 'mail_auth', 'Gmail 로그인이 안 됐어요. Gmail 주소와 앱 비밀번호(16자리)를 다시 확인해 주세요.');
      }
      throw new HttpError(502, 'mail_failed', `메일을 보내지 못했어요: ${msg.slice(0, 160)}`);
    }
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
    throw new HttpError(502, 'mail_failed', `메일을 보내지 못했어요: ${body.message || body.name || `HTTP ${res.status}`}`);
  }
  return body.id || null;
}
