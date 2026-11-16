// npm run setup — Cloudflare에 한 번에 올리는 설치 스크립트
// (컴퓨터에서 올릴 때 쓰는 방법. 폰에서는 README 의 Deploy to Cloudflare 버튼을 쓰면 된다.)
// 하는 일: 로그인 확인 → DB(D1) 만들기 → 배포 → 비밀값(ENC_KEY, SETUP_KEY) 등록
//          → 사이트 주소와 설치 코드 보여 주기. DB 표는 사이트가 켜질 때 스스로 만든다.
// 여러 번 실행해도 안전하다. 이미 있는 것은 그대로 쓴다. (ENC_KEY 는 절대 덮어쓰지 않는다)
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DB_NAME = 'jina-recorder-db';
const TOML = 'wrangler.toml';

const say = (msg) => console.log(`\n▶ ${msg}`);
const ok = (msg) => console.log(`  ✓ ${msg}`);
const stop = (msg) => { console.error(`\n✗ ${msg}\n`); process.exit(1); };

function wrangler(args, { interactive = false, input } = {}) {
  const r = spawnSync('npx', ['wrangler', ...args], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: interactive ? 'inherit' : ['pipe', 'pipe', 'pipe'],
    input,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

// 1. Cloudflare 로그인
say('Cloudflare 로그인 확인');
let who = wrangler(['whoami']);
if (!/associated with the email|You are logged in/i.test(who.out)) {
  console.log('  브라우저가 열리면 Cloudflare 계정으로 로그인하고 "Allow"를 눌러 주세요.');
  wrangler(['login'], { interactive: true });
  who = wrangler(['whoami']);
  if (!/associated with the email|You are logged in/i.test(who.out)) stop('Cloudflare 로그인이 안 됐어요. 다시 npm run setup 을 실행해 주세요.');
}
ok('로그인됨');

// 2. D1 데이터베이스
say(`DB 준비 (${DB_NAME})`);
function findDbId() {
  const r = wrangler(['d1', 'list', '--json']);
  try {
    const list = JSON.parse(r.out.slice(r.out.indexOf('[')));
    const hit = list.find((d) => d.name === DB_NAME);
    return hit ? hit.uuid : null;
  } catch { return null; }
}
let dbId = findDbId();
if (!dbId) {
  // 시드니에서 쓰니까 DB를 오세아니아(oc) 지역에 둔다.
  const r = wrangler(['d1', 'create', DB_NAME, '--location', 'oc']);
  const m = r.out.match(/database_id"?\s*[=:]\s*"([0-9a-f-]{36})"/i);
  dbId = m ? m[1] : findDbId();
  if (!dbId) stop(`DB를 만들지 못했어요.\n${r.out}`);
  ok('새로 만들었어요');
} else ok('이미 있어서 그대로 써요');

let toml = readFileSync(TOML, 'utf8');
if (/database_id = "[^"]*"/.test(toml)) {
  toml = toml.replace(/database_id = "[^"]*"/, `database_id = "${dbId}"`);
} else {
  toml = toml.replace(/database_name = "[^"]*"/, (m) => `${m}\ndatabase_id = "${dbId}"`);
}
writeFileSync(TOML, toml);
ok('wrangler.toml 에 DB 번호를 넣었어요');

// 3. 배포
say('사이트 올리기');
let siteUrl = '';
{
  const r = wrangler(['deploy']);
  if (r.code !== 0) stop(`배포하지 못했어요.\n${r.out}`);
  const m = r.out.match(/https:\/\/[\w.-]+\.workers\.dev/);
  siteUrl = m ? m[0] : '';
  ok(siteUrl ? `올라갔어요: ${siteUrl}` : '올라갔어요');
}

// 4. 비밀값
say('비밀값 등록');
// 목록을 못 읽으면 ENC_KEY 를 실수로 바꾸지 않도록 여기서 멈춘다.
const existing = (() => {
  const r = wrangler(['secret', 'list', '--format', 'json']);
  try {
    return JSON.parse(r.out.slice(r.out.indexOf('['))).map((s) => s.name);
  } catch {
    stop(`등록된 비밀값 목록을 읽지 못했어요. 잠시 뒤 다시 npm run setup 을 실행해 주세요.\n${r.out}`);
  }
})();
const secrets = {};
if (!existing.includes('ENC_KEY')) {
  secrets.ENC_KEY = randomBytes(32).toString('base64');
  ok('ENC_KEY 새로 만듦 (설정에 넣는 API 키를 잠그는 열쇠)');
} else ok('ENC_KEY 는 이미 있어서 그대로 둬요');
const setupKey = randomBytes(9).toString('base64url');
secrets.SETUP_KEY = setupKey;

const tmp = join(tmpdir(), `vn-secrets-${process.pid}.json`);
writeFileSync(tmp, JSON.stringify(secrets), { mode: 0o600 });
try {
  const r = wrangler(['secret', 'bulk', tmp]);
  if (r.code !== 0) stop(`비밀값을 등록하지 못했어요.\n${r.out}`);
} finally {
  try { unlinkSync(tmp); } catch {}
}
ok('등록 완료');
writeFileSync('.setup-key.txt', `${setupKey}\n`);

console.log(`
──────────────────────────────────────────────
  설치가 끝났어요.

  사이트 주소 : ${siteUrl || '(Cloudflare 대시보드 → Workers 에서 확인)'}
  설치 코드   : ${setupKey}
               (.setup-key.txt 에도 저장했어요)

  이제 휴대폰이나 컴퓨터에서 사이트 주소를 열면
  "처음 설치" 화면이 나와요. 설치 코드를 넣고 안내대로 진행하세요.
──────────────────────────────────────────────
`);
