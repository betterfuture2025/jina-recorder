// 사용자 정보 칸: 성, 이름, 영어 이름, 영어 성, 직책, 전화번호
import { HttpError } from './util.js';

export const PROFILE_FIELDS = ['last_name', 'first_name', 'first_name_en', 'last_name_en', 'position', 'phone'];
const MAX = { last_name: 30, first_name: 30, first_name_en: 40, last_name_en: 40, position: 40, phone: 30 };

// body 에서 정보 칸만 골라 정리한다. 없는 칸은 건드리지 않는다(undefined).
export function pickProfile(body) {
  const out = {};
  for (const f of PROFILE_FIELDS) {
    if (body[f] === undefined) continue;
    const v = String(body[f] ?? '').trim();
    if (v.length > MAX[f]) throw new HttpError(400, 'too_long', '입력이 너무 길어요.');
    if (f === 'phone' && v && !/^[0-9+()\-.\s]{6,30}$/.test(v)) {
      throw new HttpError(400, 'bad_phone', '전화번호는 숫자와 + - ( ) 만 넣어 주세요.');
    }
    out[f] = v || null;
  }
  return out;
}

// 한국어 이름으로 보여 줄 이름 만들기 (없으면 영어 이름)
export function displayName(p, fallback) {
  const ko = `${p.last_name || ''}${p.first_name || ''}`.trim();
  if (ko) return ko;
  const en = `${p.first_name_en || ''} ${p.last_name_en || ''}`.trim();
  return en || fallback || null;
}
