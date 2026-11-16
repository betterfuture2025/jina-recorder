// 설정에 저장하는 API 키 암호화 (AES-GCM, 키는 ENC_KEY 비밀값)
// ENC_KEY 는 32바이트 base64 값이거나, 사람이 정한 16자 이상의 아무 문장이면 된다.
// 문장이면 SHA-256 으로 32바이트 열쇠를 만든다.

let cachedKey = null;
let cachedRaw = null;

function b64ToBytes(b64) {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function bytesToB64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function asRawKey(value) {
  try {
    const bytes = b64ToBytes(value);
    if (bytes.length === 32) return bytes;
  } catch {}
  return null;
}

// .dev.vars.example 의 안내 문장을 그대로 넣은 경우는 공개된 값이라 쓰지 않는다.
export function isPlaceholder(v) {
  return /16자 이상|처음 설치 화면에서|바꾸지 마세요|example|change.?me/i.test(String(v || ''));
}

export function hasEncKey(env) {
  const v = (env.ENC_KEY || '').trim();
  if (isPlaceholder(v)) return false;
  return !!asRawKey(v) || v.length >= 16;
}

async function getKey(env) {
  if (!hasEncKey(env)) throw new Error('ENC_KEY is missing or too short (16+ characters)');
  const v = env.ENC_KEY.trim();
  if (cachedKey && cachedRaw === v) return cachedKey;
  let raw = asRawKey(v);
  if (!raw) {
    raw = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('jina-recorder:' + v)));
  }
  cachedKey = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  cachedRaw = v;
  return cachedKey;
}

export async function encrypt(env, plain) {
  const key = await getKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
  return `v1:${bytesToB64(iv)}:${bytesToB64(new Uint8Array(ct))}`;
}

export async function decrypt(env, stored) {
  if (!stored) return null;
  const [ver, ivB64, ctB64] = stored.split(':');
  if (ver !== 'v1' || !ivB64 || !ctB64) throw new Error('unknown secret format');
  const key = await getKey(env);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(ivB64) }, key, b64ToBytes(ctB64));
  return new TextDecoder().decode(pt);
}
