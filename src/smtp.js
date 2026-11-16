// 아주 작은 SMTP 보내기 (Gmail 앱 비밀번호용). 465 포트 TLS 로 바로 연결한다.
import { connect } from 'cloudflare:sockets';

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64utf8(str) {
  const bytes = enc.encode(str);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
// 긴 base64 는 76자마다 줄바꿈
const wrap76 = (s) => s.replace(/(.{76})/g, '$1\r\n');
const encHeader = (s) => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64utf8(s)}?=`;

function parseAddr(from) {
  const m = String(from).match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return m ? { name: m[1].replace(/^"|"$/g, ''), addr: m[2] } : { name: '', addr: String(from).trim() };
}

export async function smtpSend({ host = 'smtp.gmail.com', port = 465, user, pass, from, to, subject, text, html }) {
  const socket = connect({ hostname: host, port }, { secureTransport: 'on', allowHalfOpen: false });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  let buf = '';

  async function read() {
    // 마지막 줄이 "123 ..." (숫자 뒤 공백) 일 때까지 읽는다
    for (;;) {
      const lines = buf.split('\r\n');
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3} /.test(lines[i])) {
          const resp = lines.slice(0, i + 1).join('\n');
          buf = lines.slice(i + 1).join('\r\n');
          return { code: Number(lines[i].slice(0, 3)), text: resp };
        }
      }
      const { value, done } = await reader.read();
      if (done) throw new Error('메일 서버 연결이 끊겼어요');
      buf += dec.decode(value, { stream: true });
    }
  }
  async function cmd(line, expect) {
    if (line !== null) await writer.write(enc.encode(line + '\r\n'));
    const r = await read();
    if (!expect.includes(r.code)) {
      const e = new Error(`SMTP ${r.code}: ${r.text.split('\n').pop()}`);
      e.smtpCode = r.code;
      throw e;
    }
    return r;
  }

  const sender = parseAddr(from);
  const boundary = 'b' + crypto.randomUUID().replace(/-/g, '');
  const msg = [
    `From: ${sender.name ? `${encHeader(sender.name)} <${user}>` : user}`,
    `To: <${to}>`,
    `Subject: ${encHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@jina-recorder>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64utf8(text || '')),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64utf8(html || text || '')),
    `--${boundary}--`,
    '',
  ].join('\r\n');

  try {
    await cmd(null, [220]);
    await cmd('EHLO jina-recorder', [250]);
    await cmd('AUTH LOGIN', [334]);
    await cmd(b64utf8(user), [334]);
    await cmd(b64utf8(pass.replace(/\s+/g, '')), [235]);
    await cmd(`MAIL FROM:<${user}>`, [250]);
    await cmd(`RCPT TO:<${to}>`, [250, 251]);
    await cmd('DATA', [354]);
    await cmd(msg + '\r\n.', [250]);
    await cmd('QUIT', [221]).catch(() => {});
  } finally {
    try { await writer.close(); } catch {}
    try { socket.close(); } catch {}
  }
}
