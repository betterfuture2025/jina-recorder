// 메일 템플릿: 관리자가 제목·인사·본문·버튼 글자를 고칠 수 있다.
// 고친 내용은 mail_templates 표에 저장되고, 비어 있으면 아래 기본값을 쓴다.
// 본문 안의 {{이름}} 같은 칸은 보낼 때 실제 값으로 바뀐다.
import { json, readJson, HttpError } from './util.js';
import { getSetting } from './settings.js';
import { sendMail } from './mail.js';

const FIELDS = ['subject', 'heading', 'body', 'button', 'footer'];

export const TEMPLATES = {
  login_code: {
    label: '로그인 인증번호',
    about: '선생님이 "이메일로 인증번호 받기"를 누르면 가는 메일',
    sticker: 'point',
    vars: ['이름', '앱이름', '인증번호', '분'],
    sample: { 이름: '김하늘 선생님', 인증번호: '482913', 분: '10' },
    block: 'code',
    link: '/',
    defaults: {
      subject: '[{{앱이름}}] 로그인 인증번호 {{인증번호}}',
      heading: '로그인 인증번호예요',
      body: '{{이름}}, 안녕하세요.\n아래 6자리 번호를 로그인 화면에 넣어 주세요. {{분}}분 동안만 쓸 수 있어요.',
      button: '',
      footer: '직접 요청하지 않았다면 이 메일은 무시하셔도 돼요. 번호를 다른 사람에게 알려 주지 마세요.',
    },
  },
  signup_admin: {
    label: '가입 신청 알림 (관리자에게)',
    about: '누군가 가입 신청을 하면 관리자에게 가는 메일',
    sticker: 'think',
    vars: ['앱이름', '신청자', '신청자이메일', '직책', '전화번호', '메모'],
    sample: { 신청자: '박서연', 신청자이메일: 'seoyeon@example.com', 직책: '해바라기반 교사', 전화번호: '0412 345 678', 메모: '3월부터 근무해요' },
    block: 'facts',
    link: '/#/admin/users',
    defaults: {
      subject: '[{{앱이름}}] 가입 신청: {{신청자}}',
      heading: '새 가입 신청이 왔어요',
      body: '{{신청자}} 님이 {{앱이름}} 가입을 신청했어요.\n확인하고 승인해 주세요.',
      button: '승인하러 가기',
      footer: '관리자에게만 가는 메일이에요.',
    },
  },
  signup_approved: {
    label: '가입 승인 안내 (신청자에게)',
    about: '관리자가 가입을 승인하면 신청자에게 가는 메일',
    sticker: 'cheer',
    vars: ['이름', '앱이름', '이메일'],
    sample: { 이름: '박서연', 이메일: 'seoyeon@example.com' },
    block: null,
    link: '/',
    defaults: {
      subject: '[{{앱이름}}] 가입이 승인됐어요',
      heading: '환영해요, {{이름}} 님!',
      body: '{{앱이름}} 가입이 승인됐어요.\n이제 {{이메일}} 주소로 로그인할 수 있어요.\n휴대폰 홈 화면에 추가해 두면 앱처럼 바로 열려요.',
      button: '로그인하기',
      footer: '',
    },
  },
  summary: {
    label: '요약 메일',
    about: '녹음이 끝나고 AI가 정리하면 기록한 선생님(과 같이 받을 사람)에게 가는 메일',
    sticker: 'present',
    vars: ['앱이름', '제목', '종류', '일시', '선생님', '길이'],
    sample: {
      제목: '하윤이 어머님 상담 — 낮잠 적응', 종류: '상담', 일시: '2026.11.16 (월) 오후 3:10', 선생님: '김하늘', 길이: '13분',
      __summary: ['아침 등원 때 우는 시간이 첫 주보다 크게 줄었음', '집에서 친구 이름(서아)을 자주 말함', '낮잠은 아직 힘들어함'],
      __decisions: ['다음 주부터 낮잠용 담요를 집에서 가져오기로 함'],
      __todos: ['금요일에 어머님께 낮잠 상황 다시 알리기'],
      __tags: ['하윤', '적응', '낮잠'],
      __link: '/#/records',
    },
    block: 'summary',
    link: '/#/records',
    defaults: {
      subject: '[{{앱이름}}] {{제목}} 요약',
      heading: '{{제목}}',
      body: '{{일시}} · {{종류}} · {{길이}} · {{선생님}}',
      button: '기록 열어 보기',
      footer: 'AI가 받아쓴 글을 정리한 요약이에요. 중요한 내용은 원래 녹음으로 꼭 확인해 주세요.',
    },
  },
  test: {
    label: '연결 테스트',
    about: '설정 페이지에서 "테스트 메일 보내기"를 누르면 가는 메일',
    sticker: 'thumbs',
    vars: ['앱이름', '이름'],
    sample: { 이름: '관리자' },
    block: null,
    link: '/#/admin/settings',
    defaults: {
      subject: '[{{앱이름}}] 메일 연결 테스트',
      heading: '메일이 잘 연결됐어요',
      body: '{{앱이름}}에서 보낸 테스트 메일이에요.\n이 메일이 보이면 인증번호와 안내 메일이 선생님들께 잘 갈 거예요.',
      button: '설정으로 돌아가기',
      footer: '',
    },
  },
};

const C = {
  paper: '#EFF3EE', card: '#FFFFFF', ink: '#1F2328', body: '#3A4048', muted: '#6B7480',
  teal: '#3F6E52', tealDark: '#2C5139', sage: '#DCE8DE', line: '#DDE5DF',
};
const FONT = "'IBM Plex Sans KR','Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',-apple-system,sans-serif";

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fill = (str, vars) => String(str || '').replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (m, k) => (k in vars ? String(vars[k] ?? '') : ''));

async function loadOverrides(env, key) {
  return (await env.DB.prepare('SELECT subject, heading, body, button, footer FROM mail_templates WHERE key = ?').bind(key).first()) || {};
}

function merged(key, over) {
  const d = TEMPLATES[key].defaults;
  const out = {};
  for (const f of FIELDS) out[f] = over[f] != null && over[f] !== '' ? over[f] : d[f];
  // 버튼은 일부러 비울 수 있게: 저장된 값이 빈 문자열 '-' 이면 버튼 없음
  if (over.button === '-') out.button = '';
  return out;
}

function blockHtml(tpl, vars) {
  if (tpl.block === 'code') {
    const code = String(vars['인증번호'] || '').split('').join('&#8202;');
    return `<tr><td style="padding:4px 28px 8px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.sage};border-radius:16px">
        <tr><td align="center" style="padding:22px 12px 8px;font-family:${FONT};font-size:40px;line-height:1;font-weight:700;letter-spacing:10px;color:${C.tealDark}">${code}</td></tr>
        <tr><td align="center" style="padding:0 12px 18px;font-family:${FONT};font-size:13px;color:${C.tealDark}">${esc(vars['분'] || '10')}분 안에 넣어 주세요</td></tr>
      </table></td></tr>`;
  }
  if (tpl.block === 'facts') {
    const rows = [['이름', vars['신청자']], ['이메일', vars['신청자이메일']], ['직책', vars['직책']], ['전화번호', vars['전화번호']], ['메모', vars['메모']]]
      .filter(([, v]) => v);
    if (!rows.length) return '';
    return `<tr><td style="padding:4px 28px 8px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.line};border-radius:14px">
        ${rows.map(([k, v], i) => `<tr>
          <td style="padding:10px 14px;${i ? `border-top:1px solid ${C.line};` : ''}font-family:${FONT};font-size:13px;color:${C.muted};width:76px;vertical-align:top">${k}</td>
          <td style="padding:10px 14px;${i ? `border-top:1px solid ${C.line};` : ''}font-family:${FONT};font-size:15px;color:${C.ink}">${esc(v)}</td></tr>`).join('')}
      </table></td></tr>`;
  }
  if (tpl.block === 'summary') {
    const sec = (title, items, mark) => (items && items.length) ? `
      <tr><td style="padding:6px 28px 4px;font-family:${FONT};font-size:13px;font-weight:700;color:${C.teal}">${title}</td></tr>
      <tr><td style="padding:0 28px 10px">${items.map((x) => `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td width="22" style="vertical-align:top;padding:3px 0;font-family:${FONT};font-size:15px;color:${C.teal}">${mark}</td>
          <td style="padding:3px 0;font-family:${FONT};font-size:15px;line-height:1.6;color:${C.ink};word-break:keep-all">${esc(x)}</td>
        </tr></table>`).join('')}</td></tr>` : '';
    const tags = (vars.__tags || []).length ? `<tr><td style="padding:4px 28px 6px">${vars.__tags.map((x) =>
      `<span style="display:inline-block;margin:0 6px 6px 0;padding:4px 11px;border-radius:999px;background:${C.sage};color:${C.tealDark};font-family:${FONT};font-size:13px;font-weight:600">#${esc(x)}</span>`).join('')}</td></tr>` : '';
    return sec('요약', vars.__summary, '•') + sec('정한 것', vars.__decisions, '✓') + sec('할 일', vars.__todos, '☐') + tags;
  }
  return '';
}

export function buildEmail(key, fields, vars, site) {
  const tpl = TEMPLATES[key];
  const v = { ...vars };
  const subject = fill(fields.subject, v).replace(/\s+/g, ' ').trim();
  const heading = fill(fields.heading, v);
  const bodyText = fill(fields.body, v);
  const footer = fill(fields.footer, v);
  const button = fill(fields.button, v);
  const href = site + (v.__link || tpl.link);
  const appName = v['앱이름'] || '지나기록기';
  const paras = bodyText.split(/\n{2,}/).map((p) =>
    `<p style="margin:0 0 12px;font-family:${FONT};font-size:16px;line-height:1.65;color:${C.body};word-break:keep-all">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');

  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${C.paper}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(bodyText.split('\n')[0]).slice(0, 120)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.paper}">
<tr><td align="center" style="padding:28px 14px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px">
    <tr><td style="padding:0 6px 14px;font-family:${FONT};font-size:15px;font-weight:700;color:${C.tealDark}">
      <img src="${site}/icons/icon-192.png" width="28" height="28" alt="" style="vertical-align:middle;border-radius:8px;margin-right:8px;border:0">${esc(appName)}
    </td></tr>
    <tr><td style="background:${C.card};border-radius:20px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="padding:24px 28px 0">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:bottom;padding-bottom:14px;font-family:${FONT};font-size:23px;line-height:1.35;font-weight:700;color:${C.ink};word-break:keep-all">${esc(heading)}</td>
            <td width="92" align="right" style="vertical-align:bottom"><img src="${site}/jina/${tpl.sticker}.png" width="84" alt="" style="display:block;border:0;height:auto"></td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:18px 28px 6px;border-top:1px solid ${C.line}">${paras}</td></tr>
        ${blockHtml(tpl, v)}
        ${button ? `<tr><td style="padding:12px 28px 4px">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:${C.teal};border-radius:12px">
            <a href="${esc(href)}" style="display:inline-block;padding:14px 26px;font-family:${FONT};font-size:16px;font-weight:700;color:#FFFFFF;text-decoration:none">${esc(button)}</a>
          </td></tr></table></td></tr>` : ''}
        <tr><td style="padding:16px 28px 26px"></td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:16px 10px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${C.muted};word-break:keep-all">
      ${footer ? `${esc(footer)}<br>` : ''}${esc(appName)}에서 자동으로 보낸 메일이에요. · <a href="${esc(site)}" style="color:${C.muted}">${esc(site.replace(/^https?:\/\//, ''))}</a>
    </td></tr>
  </table>
</td></tr></table></body></html>`;

  const facts = tpl.block === 'facts'
    ? '\n' + [['이름', v['신청자']], ['이메일', v['신청자이메일']], ['직책', v['직책']], ['전화번호', v['전화번호']], ['메모', v['메모']]]
      .filter(([, x]) => x).map(([k, x]) => `${k}: ${x}`).join('\n') + '\n' : '';
  const code = tpl.block === 'code' ? `\n인증번호: ${v['인증번호']}\n`
    : tpl.block === 'summary' ? [['요약', v.__summary, '-'], ['정한 것', v.__decisions, '-'], ['할 일', v.__todos, '[ ]']]
      .filter(([, a]) => a && a.length).map(([h, a, m]) => `\n${h}\n${a.map((x) => `${m} ${x}`).join('\n')}`).join('\n') + '\n' : '';
  const text = `${heading}\n\n${bodyText}\n${code}${facts}${button ? `\n${button}: ${href}\n` : ''}${footer ? `\n${footer}\n` : ''}\n— ${appName}`;
  return { subject, html, text };
}

// 실제로 보낼 때 쓰는 함수
export async function sendTemplate(env, key, { to, vars = {}, site }) {
  const appName = (await getSetting(env, 'app.name')) || '지나기록기';
  const fields = merged(key, await loadOverrides(env, key));
  const mail = buildEmail(key, fields, { 앱이름: appName, ...vars }, site);
  return sendMail(env, { to, ...mail });
}

// ---- 관리자 API ----
export async function listTemplates(env) {
  const { results } = await env.DB.prepare('SELECT key, subject, heading, body, button, footer, updated_at FROM mail_templates').all();
  const saved = Object.fromEntries(results.map((r) => [r.key, r]));
  return json({
    templates: Object.entries(TEMPLATES).map(([key, t]) => ({
      key, label: t.label, about: t.about, vars: t.vars, hasButton: !!t.defaults.button,
      defaults: t.defaults,
      fields: merged(key, saved[key] || {}),
      customized: !!saved[key],
      updated_at: saved[key]?.updated_at || null,
    })),
  });
}

function cleanFields(body) {
  const out = {};
  for (const f of FIELDS) {
    const v = String(body[f] ?? '').replace(/\r/g, '');
    out[f] = v.slice(0, f === 'body' ? 2000 : 200);
  }
  if (!out.subject.trim()) throw new HttpError(400, 'subject_required', '메일 제목을 넣어 주세요.');
  return out;
}

export async function saveTemplate(env, request, key) {
  if (!TEMPLATES[key]) throw new HttpError(404, 'not_found', '없는 템플릿이에요.');
  const f = cleanFields(await readJson(request));
  await env.DB.prepare(
    `INSERT INTO mail_templates (key, subject, heading, body, button, footer, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET subject = excluded.subject, heading = excluded.heading, body = excluded.body,
       button = excluded.button, footer = excluded.footer, updated_at = excluded.updated_at`
  ).bind(key, f.subject, f.heading, f.body, f.button === '' && TEMPLATES[key].defaults.button ? '-' : f.button, f.footer).run();
  return json({ ok: true });
}

export async function resetTemplate(env, key) {
  if (!TEMPLATES[key]) throw new HttpError(404, 'not_found', '없는 템플릿이에요.');
  await env.DB.prepare('DELETE FROM mail_templates WHERE key = ?').bind(key).run();
  return json({ ok: true });
}

export async function previewTemplate(env, request, key) {
  const tpl = TEMPLATES[key];
  if (!tpl) throw new HttpError(404, 'not_found', '없는 템플릿이에요.');
  const body = await readJson(request);
  const fields = { ...tpl.defaults, ...cleanFields({ ...tpl.defaults, ...body }) };
  const appName = (await getSetting(env, 'app.name')) || '지나기록기';
  const site = new URL(request.url).origin;
  return json(buildEmail(key, fields, { 앱이름: appName, ...tpl.sample }, site));
}

export async function testTemplate(env, request, key, me) {
  const tpl = TEMPLATES[key];
  if (!tpl) throw new HttpError(404, 'not_found', '없는 템플릿이에요.');
  const body = await readJson(request);
  const fields = { ...tpl.defaults, ...cleanFields({ ...tpl.defaults, ...body }) };
  const appName = (await getSetting(env, 'app.name')) || '지나기록기';
  const site = new URL(request.url).origin;
  const mail = buildEmail(key, fields, { 앱이름: appName, ...tpl.sample, 이름: me.name || tpl.sample['이름'] }, site);
  await sendMail(env, { to: me.email, subject: `[미리보기] ${mail.subject}`, html: mail.html, text: mail.text });
  return json({ ok: true, to: me.email });
}
