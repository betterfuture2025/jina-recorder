// AI 글쓰기(요약·분석) 연결. 설정에서 일마다 다른 AI를 고를 수 있다.
//  - cf        : Cloudflare 안의 AI (키 필요 없음, 무료 사용량 안에서 0원)
//  - anthropic : Claude (Anthropic API 키)
//  - openai    : OpenAI 방식 주소를 쓰는 모든 서비스 (OpenAI, Qwen(DashScope), DeepSeek 등)
import { getSettings } from './settings.js';
import { HttpError } from './util.js';

export const DEFAULT_CF_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export const DEFAULT_CLAUDE_MODEL = 'claude-haiku-5-5';

const KEYS = [
  'ai.summary_provider', 'ai.analysis_provider', 'ai.cf_model',
  'ai.anthropic_key', 'ai.anthropic_model', 'ai.openai_base', 'ai.openai_key', 'ai.openai_model',
];

export async function aiConfig(env, job) {
  const s = await getSettings(env, KEYS);
  let provider = s[job === 'analysis' ? 'ai.analysis_provider' : 'ai.summary_provider'] || 'cf';
  if (provider === 'anthropic' && !s['ai.anthropic_key']) provider = 'cf';
  if (provider === 'openai' && !(s['ai.openai_key'] && s['ai.openai_base'] && s['ai.openai_model'])) provider = 'cf';
  const model = provider === 'anthropic' ? (s['ai.anthropic_model'] || DEFAULT_CLAUDE_MODEL)
    : provider === 'openai' ? s['ai.openai_model']
    : (s['ai.cf_model'] || DEFAULT_CF_MODEL);
  // 글자 수 한도: Cloudflare 모델은 짧게, Claude 는 길게
  const maxChars = provider === 'cf' ? 18000 : 150000;
  return { provider, model, maxChars, s };
}

async function postJson(url, headers, body) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  } catch {
    throw new HttpError(502, 'ai_unreachable', 'AI 서버에 연결하지 못했어요.');
  }
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || `HTTP ${res.status}`;
    if (res.status === 401 || res.status === 403) throw new HttpError(502, 'ai_auth', `AI 키가 맞지 않아요: ${msg}`);
    throw new HttpError(502, 'ai_failed', `AI가 답하지 못했어요: ${String(msg).slice(0, 200)}`);
  }
  return data;
}

function cfText(out) {
  if (!out) return '';
  if (typeof out === 'string') return out;
  if (typeof out.response === 'string') return out.response;
  if (out.response && typeof out.response === 'object') return JSON.stringify(out.response);
  const c = out.choices?.[0]?.message?.content;
  if (c) return c;
  if (Array.isArray(out.output)) {
    for (const o of out.output) for (const c2 of o.content || []) if (c2.text) return c2.text;
  }
  return '';
}

// system, user 글을 주면 AI 답(글자)을 돌려준다
// 로컬 시험용 가짜 AI (.dev.vars 에 AI_MOCK=1 일 때만). 실제 사이트에는 이 값이 없다.
function mockAnswer(job, user) {
  if (/연결 확인/.test(user)) return '연결됐어요';
  if (job === 'analysis') return JSON.stringify({ overview: '이번 기간에는 적응과 낮잠 이야기가 가장 많았어요.', themes: [{ title: '낮잠 적응', detail: '하윤이 상담에서 낮잠 어려움이 나왔어요.' }], watch: [{ who: '하윤', detail: '금요일에 낮잠 상황을 다시 알리기로 했어요.' }], followups: ['금요일 하윤이 어머님 연락'], staff: [{ name: '김하늘', note: '상담 기록을 꼼꼼히 남겼어요.' }], suggestions: ['낮잠용 개인 담요 안내문 만들기'] });
  return '```json\n' + JSON.stringify({ title: '하윤이 어머님 상담 — 낮잠 적응', summary: ['아침 등원 때 우는 시간이 크게 줄었음', '집에서 친구 이름을 자주 말함', '낮잠은 아직 힘들어함'], decisions: ['다음 주부터 낮잠용 담요를 집에서 가져오기로 함'], todos: ['금요일에 어머님께 낮잠 상황 다시 알리기'], tags: ['하윤', '적응', '#낮잠'], people: [{ name: '하윤', relation: '원아' }] }) + '\n```';
}

export async function chat(env, job, { system, user, maxTokens = 1500 }) {
  if (env.AI_MOCK === '1') return { text: mockAnswer(job, user), provider: 'mock', model: 'mock', maxChars: 18000 };
  const cfg = await aiConfig(env, job);
  const { provider, model, s } = cfg;
  let text = '';
  if (provider === 'anthropic') {
    const data = await postJson('https://api.anthropic.com/v1/messages', {
      'x-api-key': s['ai.anthropic_key'], 'anthropic-version': '2023-06-01',
    }, { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] });
    text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  } else if (provider === 'openai') {
    const base = s['ai.openai_base'].replace(/\/+$/, '');
    const data = await postJson(`${base}/chat/completions`, { authorization: `Bearer ${s['ai.openai_key']}` }, {
      model, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    });
    text = data.choices?.[0]?.message?.content || '';
  } else {
    if (!env.AI) throw new HttpError(500, 'ai_missing', 'Cloudflare AI 가 연결되지 않았어요.');
    let out;
    try {
      out = await env.AI.run(model, { messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: maxTokens });
    } catch (err) {
      if (model !== DEFAULT_CF_MODEL) {
        out = await env.AI.run(DEFAULT_CF_MODEL, { messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: maxTokens });
      } else {
        throw new HttpError(502, 'ai_failed', `Cloudflare AI 오류: ${String(err?.message || err).slice(0, 160)}`);
      }
    }
    text = cfText(out);
  }
  return { text: String(text || '').trim(), provider, model, maxChars: cfg.maxChars };
}

// AI 답에서 JSON 덩어리만 꺼낸다 (앞뒤 설명이나 ``` 가 붙어 와도)
export function pickJson(text) {
  const t = String(text || '').replace(/```(?:json)?/gi, '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch {}
  // 흔한 실수: 끝 쉼표
  try { return JSON.parse(t.slice(a, b + 1).replace(/,\s*([}\]])/g, '$1')); } catch {}
  return null;
}

// 설정 페이지의 "연결 테스트"
export async function testAi(env, job) {
  const r = await chat(env, job, {
    system: '짧게 한국어로만 답하세요.',
    user: '연결 확인입니다. "연결됐어요" 라고만 답해 주세요.',
    maxTokens: 30,
  });
  return { ok: true, provider: r.provider, model: r.model, reply: r.text.slice(0, 80) };
}
