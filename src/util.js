// 공용 도구: 응답, 쿠키, 무작위 토큰, 해시

export function json(data, status = 200, extraHeaders = {}) {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  for (const [k, v] of Object.entries(extraHeaders)) {
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else headers.set(k, v);
  }
  return new Response(JSON.stringify(data), { status, headers });
}

export function fail(status, code, message) {
  return json({ error: code, message: message || code }, status);
}

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

export function parseCookies(request) {
  const out = {};
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function cookie(name, value, { maxAge, path = '/', httpOnly = true, secure = true, sameSite = 'Lax' } = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=${path}; SameSite=${sameSite}`;
  if (maxAge !== undefined) c += `; Max-Age=${maxAge}`;
  if (httpOnly) c += '; HttpOnly';
  if (secure) c += '; Secure';
  return c;
}

export function isSecureRequest(request) {
  return new URL(request.url).protocol === 'https:';
}

export const uid = () => crypto.randomUUID();

export function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomToken(bytes = 32) {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 길이가 달라도 시간 차이로 값이 새지 않게 비교
export async function safeEqual(a, b) {
  const [ha, hb] = await Promise.all([sha256Hex(String(a)), sha256Hex(String(b))]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0;
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'bad_json', '요청 내용을 읽을 수 없어요.');
  }
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normEmail(v) {
  return String(v || '').trim().toLowerCase();
}

export function isoAfterDays(days) {
  return new Date(Date.now() + days * 86400e3).toISOString().replace('T', ' ').slice(0, 19);
}

export function nowSql() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}
