// 음성 → 글자. 기본은 Cloudflare Workers AI 의 Whisper (API 키 필요 없음).
// 나중에 설정에서 Qwen 등 다른 서비스를 고르면 여기서 갈라진다 (파트 6).
const MODEL = '@cf/openai/whisper-large-v3-turbo';

function toBase64(bytes) {
  let s = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  return btoa(s);
}

// 같은 말이 계속 반복되는 Whisper 환각 줄이기
function clean(text) {
  let t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  // 무음에서 자주 나오는 문구
  if (/^(시청해 주셔서 감사합니다|감사합니다|구독과 좋아요|MBC 뉴스|Thank you\.?|Thanks for watching!?)[.!\s]*$/i.test(t)) return '';
  return t;
}

export async function transcribe(env, bytes) {
  if (!env.AI) throw new Error('Workers AI 가 연결되지 않았어요');
  const out = await env.AI.run(MODEL, {
    audio: toBase64(bytes),
    task: 'transcribe',
    vad_filter: true,
  });
  return {
    text: clean(out && out.text),
    language: out && out.transcription_info ? out.transcription_info.language : null,
    model: MODEL,
  };
}
