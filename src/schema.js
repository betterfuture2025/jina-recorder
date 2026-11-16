// DB 표 자동 준비: 사이트가 켜질 때마다(서버 인스턴스당 한 번) schema.sql 을 실행한다.
// 모든 문장이 IF NOT EXISTS 라서 여러 번 실행해도 안전하다.
// 나중에 늘어난 칸은 아래 COLUMNS 에 적어 두면 없을 때만 추가한다.
import SCHEMA from '../schema.sql';

// [표, 칸, 종류]
const PROFILE = ['last_name', 'first_name', 'first_name_en', 'last_name_en', 'position', 'phone'];
const COLUMNS = [
  ...PROFILE.map((c) => ['users', c, 'TEXT']),
  ...PROFILE.map((c) => ['signup_requests', c, 'TEXT']),
];

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

async function addMissingColumns(env) {
  const tables = [...new Set(COLUMNS.map((c) => c[0]))];
  const have = {};
  for (const tb of tables) {
    const { results } = await env.DB.prepare(`PRAGMA table_info(${tb})`).all();
    have[tb] = new Set(results.map((r) => r.name));
  }
  const alters = COLUMNS.filter(([tb, col]) => !have[tb].has(col))
    .map(([tb, col, type]) => env.DB.prepare(`ALTER TABLE ${tb} ADD COLUMN ${col} ${type}`));
  if (alters.length) await env.DB.batch(alters);
}

export function ensureSchema(env) {
  if (!ready) {
    ready = env.DB.batch(statements().map((s) => env.DB.prepare(s)))
      .then(() => addMissingColumns(env))
      .catch((err) => {
        ready = null; // 실패하면 다음 요청에서 다시 시도
        throw err;
      });
  }
  return ready;
}
