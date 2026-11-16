// DB 표 자동 준비: 사이트가 켜질 때마다(서버 인스턴스당 한 번) schema.sql 을 실행한다.
// 모든 문장이 IF NOT EXISTS 라서 여러 번 실행해도 안전하다.
// 그래서 "Deploy to Cloudflare" 버튼으로 올려도 따로 DB 명령을 칠 필요가 없다.
import SCHEMA from '../schema.sql';

let ready = null;

function statements() {
  return SCHEMA
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s && !/^PRAGMA/i.test(s));
}

export function ensureSchema(env) {
  if (!ready) {
    ready = env.DB.batch(statements().map((s) => env.DB.prepare(s))).catch((err) => {
      ready = null; // 실패하면 다음 요청에서 다시 시도
      throw err;
    });
  }
  return ready;
}
