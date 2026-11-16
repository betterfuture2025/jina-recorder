// 지나기록기 — 화면 (파트 1: 로그인, 처음 설치, 홈, 기록, 관리, 내 정보)
import { t, esc, getLang, setLang } from './i18n.js';

const app = document.getElementById('app');
const state = { user: null, config: { appName: '지나기록기', googleReady: false }, redirectUri: '' };

setLang(getLang());

// ── 서버 요청 ─────────────────────────────────────────────

async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'x-requested-with': 'fetch', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error(t('networkError')), { code: 'network' });
  }
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const err = new Error(data.message || t('genericError'));
    err.code = data.error; err.status = res.status;
    throw err;
  }
  return data;
}

// ── 작은 도구 ─────────────────────────────────────────────

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

function initials(u) {
  const s = (u.name || u.email || '?').trim();
  return esc(s.charAt(0).toUpperCase());
}

function avatar(u) {
  if (u.picture) return `<span class="avatar"><img src="${esc(u.picture)}" alt="" referrerpolicy="no-referrer"></span>`;
  return `<span class="avatar" aria-hidden="true">${initials(u)}</span>`;
}

function when(sqlTime) {
  if (!sqlTime) return '';
  const d = new Date(sqlTime.replace(' ', 'T') + 'Z');
  return d.toLocaleString(getLang() === 'ko' ? 'ko-KR' : 'en-AU', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
  const old = btn.textContent;
  btn.textContent = t('copied');
  setTimeout(() => (btn.textContent = old), 1500);
}

const LOGO = `<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="var(--ink)"/><circle cx="16" cy="16" r="6.5" fill="var(--rec)"/></svg>`;

const GOOGLE_G = `<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;

const ICONS = {
  mic: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>`,
  memo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M5 4h10l4 4v12H5z"/><path d="M9 12h6M9 16h4"/></svg>`,
  meeting: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M3 19c.8-3 2.8-4.5 5-4.5s4.2 1.5 5 4.5M11 19c.8-3 2.8-4.5 5-4.5s4.2 1.5 5 4.5"/></svg>`,
  consult: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 6h11v8H9l-5 4z"/><path d="M15 10h5v8l-3-2.5h-5"/></svg>`,
  records: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 6h14M5 12h14M5 18h9"/></svg>`,
  record: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><circle class="tab-rec" cx="12" cy="12" r="4.5" fill="currentColor" stroke="none"/></svg>`,
  admin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>`,
  me: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c1.2-3.6 4-5 7-5s5.8 1.4 7 5" stroke-linecap="round"/></svg>`,
};

function langButton() {
  return `<button class="lang-btn" data-act="lang" type="button">${esc(t('langToggle'))}</button>`;
}

function bindLang(root, rerender) {
  root.querySelectorAll('[data-act="lang"]').forEach((b) =>
    b.addEventListener('click', () => { setLang(getLang() === 'ko' ? 'en' : 'ko'); rerender(); })
  );
}

// ── 로그인 화면 ───────────────────────────────────────────

function renderLogin() {
  const params = new URLSearchParams(location.search);
  const err = params.get('error');
  const email = params.get('email') || '';
  const errText = err ? t('err_' + err, { email, code: params.get('code') || '' }) : '';

  app.innerHTML = `
    <div class="login">
      <div class="login-top">
        <div class="brand">${LOGO}<span>${esc(state.config.appName)}</span></div>
        ${langButton()}
      </div>
      <div class="login-body">
        <div class="jina-hero">
          <img src="/jina/wave.png" alt="${esc(t('jinaWaveAlt'))}">
          <div class="bubble">${t('jinaHello')}</div>
        </div>
        <h1>${esc(t('loginTitle'))}</h1>
        <p>${esc(t('loginBody'))}</p>
        ${errText && !errText.startsWith('err_') ? `<div class="notice error" role="alert">${errText}</div>` : ''}
        <div id="login-msg"></div>
        ${state.config.emailReady ? `
        <form id="email-start" class="login-form" novalidate>
          <label class="field"><span>${esc(t('emailLabel'))}</span>
            <input name="email" type="email" inputmode="email" autocomplete="email" required placeholder="name@example.com" value="${esc(loginEmail)}"></label>
          <button class="btn btn-primary btn-block" type="submit">${esc(t('sendCode'))}</button>
        </form>
        <form id="email-verify" class="login-form" novalidate hidden>
          <p class="code-sent"></p>
          <label class="field"><span>${esc(t('codeLabel'))}</span>
            <input name="code" class="code-input" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*" required></label>
          <button class="btn btn-primary btn-block" type="submit">${esc(t('loginWithCode'))}</button>
          <div class="row" style="margin-top:8px">
            <button class="link-btn" type="button" data-act="resend">${esc(t('resendCode'))}</button>
            <button class="link-btn" type="button" data-act="change-email" style="text-align:right">${esc(t('changeEmail'))}</button>
          </div>
        </form>` : ''}
        ${state.config.emailReady && state.config.googleReady ? `<div class="or"><span>${esc(t('or'))}</span></div>` : ''}
        ${state.config.googleReady || !state.config.emailReady ? `<a class="btn btn-google btn-block" href="/auth/login">${GOOGLE_G}<span>${esc(t('loginGoogle'))}</span></a>` : ''}
        <p class="login-foot">${esc(t('loginOnlyAllowed'))} <a href="/privacy.html">${esc(t('privacy'))}</a></p>
      </div>
    </div>`;
  bindLang(app, renderLogin);
  if (state.config.emailReady) bindEmailLogin();
}

let loginEmail = '';

function bindEmailLogin() {
  const start = app.querySelector('#email-start');
  const verify = app.querySelector('#email-verify');
  const msg = app.querySelector('#login-msg');
  const show = (text, kind = 'error') => { msg.innerHTML = text ? `<div class="notice ${kind}" role="alert">${esc(text)}</div>` : ''; };

  async function sendCode(btn) {
    btn.disabled = true;
    show('');
    try {
      await api('/api/login/email/start', { method: 'POST', body: { email: loginEmail } });
      start.hidden = true;
      verify.hidden = false;
      verify.querySelector('.code-sent').innerHTML = t('codeSent', { email: loginEmail });
      verify.querySelector('[name=code]').value = '';
      verify.querySelector('[name=code]').focus();
    } catch (err) { show(err.message); }
    btn.disabled = false;
  }

  start.addEventListener('submit', (e) => {
    e.preventDefault();
    loginEmail = start.querySelector('[name=email]').value.trim().toLowerCase();
    if (!loginEmail.includes('@')) return show(t('emailInvalid'));
    sendCode(start.querySelector('[type=submit]'));
  });

  verify.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = verify.querySelector('[type=submit]');
    const code = verify.querySelector('[name=code]').value.replace(/\D/g, '');
    if (code.length !== 6) return show(t('codeInvalid'));
    btn.disabled = true;
    show('');
    try {
      await api('/api/login/email/verify', { method: 'POST', body: { email: loginEmail, code } });
      const { user } = await api('/api/me');
      state.user = user;
      history.replaceState(null, '', '/');
      render();
    } catch (err) { show(err.message); btn.disabled = false; }
  });

  // 6자리를 다 넣으면 바로 로그인
  verify.querySelector('[name=code]').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
    if (e.target.value.length === 6) verify.requestSubmit();
  });
  verify.querySelector('[data-act=resend]').addEventListener('click', (e) => { sendCode(e.target); toast(t('codeResent')); });
  verify.querySelector('[data-act=change-email]').addEventListener('click', () => {
    verify.hidden = true; start.hidden = false; show('');
    start.querySelector('[name=email]').focus();
  });
}

// ── 처음 설치 화면 ────────────────────────────────────────

function renderSetup(status) {
  const steps = t('setupGoogleSteps');
  const missing = !status.encKeyOk || !status.setupKeyOk;
  app.innerHTML = `
    <div class="shell">
      <header class="topbar"><h1>${esc(t('appDefault'))}</h1>${langButton()}</header>
      <main>
        <h2 class="page-title">${esc(t('setupTitle'))}</h2>
        <p class="lead">${esc(t('setupBody'))}</p>
        ${missing ? `<div class="notice warn" role="alert">${esc(t('setupMissingSecrets'))}</div>` : ''}
        <form id="setup-form" novalidate>
          <div class="panel">
            <label class="field"><span>${esc(t('setupKey'))}</span>
              <input name="setupKey" type="password" autocomplete="off" required>
              <small>${esc(t('setupKeyHelp'))}</small></label>
          </div>
          <div class="panel">
            <h2>${esc(t('setupAdmin'))}</h2>
            
            <label class="field"><span>${esc(t('setupAdminEmail'))}</span>
              <input name="adminEmail" type="email" autocomplete="email" inputmode="email" required></label>
            <label class="field"><span>${esc(t('setupAdminName'))}</span>
              <input name="adminName" type="text" autocomplete="name"></label>
            <label class="field"><span>${esc(t('setupAppName'))}</span>
              <input name="appName" type="text" value="지나기록기"></label>
          </div>
          <div class="panel">
            <h2>${esc(t('setupGoogle'))}</h2>
            
            <ol class="steps">${steps.map((s) => `<li>${s}</li>`).join('')}</ol>
            <p><a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">${esc(t('openConsole'))}</a></p>
            <span class="field"><span>${esc(t('redirectUri'))}</span></span>
            <div class="copy-box"><code id="ru">${esc(status.redirectUri)}</code>
              <button type="button" class="btn btn-quiet btn-small" data-copy="${esc(status.redirectUri)}">${esc(t('copy'))}</button></div>
            <label class="field"><span>${esc(t('clientId'))}</span>
              <input name="googleClientId" type="text" autocomplete="off" spellcheck="false" required></label>
            <label class="field"><span>${esc(t('clientSecret'))}</span>
              <input name="googleClientSecret" type="password" autocomplete="off" required></label>
          </div>
          <div id="setup-error"></div>
          <button class="btn btn-primary btn-block" type="submit" style="margin-top:16px">${esc(t('setupSubmit'))}</button>
        </form>
      </main>
    </div>`;
  bindLang(app, () => renderSetup(status));
  app.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => copyText(b.dataset.copy, b)));

  const form = app.querySelector('#setup-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    const data = Object.fromEntries(new FormData(form));
    try {
      await api('/api/setup', { method: 'POST', body: data });
      history.replaceState(null, '', '/');
      state.config = await api('/api/config');
      renderLogin();
      toast(t('setupDone'));
    } catch (err) {
      form.querySelector('#setup-error').innerHTML = `<div class="notice error" role="alert">${esc(err.message)}</div>`;
      btn.disabled = false;
    }
  });
}

// ── 로그인 후 틀 ──────────────────────────────────────────

function shell(active, content) {
  const u = state.user;
  const tabs = [
    { id: 'records', href: '#/records', label: t('tabRecords') },
    { id: 'record', href: '#/', label: t('tabRecord') },
    ...(u.role === 'admin' ? [{ id: 'admin', href: '#/admin/users', label: t('tabAdmin') }] : []),
    { id: 'me', href: '#/me', label: t('tabMe') },
  ];
  return `
    <div class="shell">
      <header class="topbar">
        <h1>${esc(state.config.appName)}</h1>
        ${langButton()}
        <a href="#/me" aria-label="${esc(t('tabMe'))}">${avatar(u)}</a>
      </header>
      <main>${content}</main>
    </div>
    <div class="tabbar"><nav aria-label="tabs">
      ${tabs.map((tb) => `<a href="${tb.href}" ${tb.id === active ? 'aria-current="page"' : ''}>${ICONS[tb.id]}<span>${esc(tb.label)}</span></a>`).join('')}
    </nav></div>`;
}

// ── 녹음 (홈) ─────────────────────────────────────────────

function pageRecord() {
  const u = state.user;
  const first = esc((u.name || u.email.split('@')[0]).trim());
  const today = new Date().toLocaleDateString(getLang() === 'ko' ? 'ko-KR' : 'en-AU', { month: 'long', day: 'numeric', weekday: 'long' });
  app.innerHTML = shell('record', `
    <div class="greet">
      <span class="face">${u.picture ? `<img src="${esc(u.picture)}" alt="" referrerpolicy="no-referrer">` : `<img src="/jina/portrait.png" alt="">`}</span>
      <div><div class="greet-date">${esc(today)}</div><div class="greet-name">${t('hello', { name: first })}</div></div>
    </div>
    <section class="rec-hero">
      <button class="rec-button" type="button" data-act="quick-record">
        ${ICONS.mic}<span class="rec-label">${esc(t('quickRecord'))}</span>
      </button>
      <p class="rec-hint">${esc(t('quickRecordHint'))}</p>
    </section>
    <p class="kind-row-title">${esc(t('orChoose'))}</p>
    <div class="kind-row">
      <button class="kind-btn" type="button" data-kind="memo">${ICONS.memo}${esc(t('kindMemo'))}</button>
      <button class="kind-btn" type="button" data-kind="meeting">${ICONS.meeting}${esc(t('kindMeeting'))}</button>
      <button class="kind-btn" type="button" data-kind="consult">${ICONS.consult}${esc(t('kindConsult'))}</button>
    </div>
    <section class="section">
      <div class="empty-jina">
        <div><h3>${esc(t('recordsEmpty'))}</h3><p>${esc(t('homeEmptyBody'))}</p></div>
        <img src="/jina/point.png" alt="${esc(t('jinaPointAlt'))}">
      </div>
    </section>`);
  bindCommon();
  // 파트 2에서 실제 녹음으로 바뀐다.
  app.querySelectorAll('[data-act="quick-record"], [data-kind]').forEach((b) =>
    b.addEventListener('click', () => toast(t('recordComingSoon')))
  );
}

// ── 기록 ─────────────────────────────────────────────────

function pageRecords() {
  app.innerHTML = shell('records', `
    <h2 class="page-title">${esc(t('recordsTitle'))}</h2>
    <div class="empty-jina">
      <div><h3>${esc(t('recordsEmpty'))}</h3><p>${esc(t('recordsEmptyBody'))}</p>
        <a class="btn btn-primary" href="#/">${esc(t('goRecord'))}</a></div>
      <img src="/jina/think.png" alt="${esc(t('jinaThinkAlt'))}">
    </div>`);
  bindCommon();
}

// ── 관리: 사용자 ──────────────────────────────────────────

function adminTabs(active) {
  return `<nav class="subtabs">
    <a href="#/admin/users" ${active === 'users' ? 'aria-current="page"' : ''}>${esc(t('adminUsers'))}</a>
    <a href="#/admin/settings" ${active === 'settings' ? 'aria-current="page"' : ''}>${esc(t('adminSettings'))}</a>
  </nav>`;
}

async function pageUsers() {
  app.innerHTML = shell('admin', `<h2 class="page-title">${esc(t('adminTitle'))}</h2>${adminTabs('users')}<p class="lead">${esc(t('loading'))}</p>`);
  bindCommon();
  let users;
  try { ({ users } = await api('/api/admin/users')); }
  catch (err) { return handleError(err); }

  const me = state.user.id;
  const item = (u) => {
    const off = !u.active;
    const meta = u.last_login_at ? t('lastLogin', { when: when(u.last_login_at) }) : t('neverLoggedIn');
    return `<li class="user-item ${off ? 'is-off' : ''}" data-id="${esc(u.id)}" data-email="${esc(u.email)}">
      ${avatar(u)}
      <div>
        <div class="user-name">${esc(u.name || u.email.split('@')[0])}
          ${u.role === 'admin' ? `<span class="badge">${esc(t('roleAdmin'))}</span>` : ''}
          ${off ? `<span class="badge off">${esc(t('inactive'))}</span>` : ''}
          ${u.id === me ? `<span class="badge me">${esc(t('you'))}</span>` : ''}
        </div>
        <div class="user-mail">${esc(u.email)}</div>
        <div class="user-meta">${meta}</div>
        ${u.id === me ? '' : `<div class="user-actions">
          <button class="btn btn-quiet btn-small" data-act="role" data-role="${u.role === 'admin' ? 'teacher' : 'admin'}">${esc(u.role === 'admin' ? t('makeTeacher') : t('makeAdmin'))}</button>
          <button class="btn btn-quiet btn-small" data-act="active" data-active="${off ? 1 : 0}">${esc(off ? t('turnOn') : t('turnOff'))}</button>
          <button class="btn btn-danger btn-small" data-act="remove">${esc(t('remove'))}</button>
        </div>`}
      </div>
    </li>`;
  };

  app.querySelector('main').innerHTML = `
    <div class="page-head">
      <div><h2 class="page-title">${esc(t('adminTitle'))}</h2><p class="lead">${esc(t('usersBody'))}</p></div>
      <img src="/jina/present.png" alt="${esc(t('jinaPresentAlt'))}">
    </div>
    ${adminTabs('users')}
    <form class="panel" id="add-user" novalidate>
      <h2>${esc(t('addUser'))}</h2>
      <label class="field"><span>${esc(t('email'))}</span><input name="email" type="email" inputmode="email" autocomplete="off" required placeholder="name@gmail.com"></label>
      <div class="row">
        <label class="field"><span>${esc(t('name'))}</span><input name="name" type="text"></label>
        <label class="field shrink" style="width:9.5em"><span>${esc(t('role'))}</span>
          <select name="role"><option value="teacher">${esc(t('roleTeacher'))}</option><option value="admin">${esc(t('roleAdmin'))}</option></select></label>
      </div>
      <div id="add-error"></div>
      <button class="btn btn-primary" type="submit">${esc(t('add'))}</button>
    </form>
    <section class="section"><div class="panel"><ul class="user-list">${users.map(item).join('')}</ul></div></section>`;

  const form = app.querySelector('#add-user');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    try {
      const { user } = await api('/api/admin/users', { method: 'POST', body: data });
      toast(plain(t('userAdded', { email: user.email })));
      pageUsers();
    } catch (err) {
      form.querySelector('#add-error').innerHTML = `<div class="notice error" role="alert">${esc(err.message)}</div>`;
    }
  });

  app.querySelectorAll('.user-item [data-act]').forEach((b) => b.addEventListener('click', async () => {
    const li = b.closest('.user-item');
    const id = li.dataset.id;
    try {
      if (b.dataset.act === 'role') {
        await api(`/api/admin/users/${id}`, { method: 'PATCH', body: { role: b.dataset.role } });
        toast(t('saved'));
      } else if (b.dataset.act === 'active') {
        await api(`/api/admin/users/${id}`, { method: 'PATCH', body: { active: b.dataset.active === '1' } });
        toast(t('saved'));
      } else if (b.dataset.act === 'remove') {
        if (!confirm(plain(t('confirmRemove', { email: li.dataset.email })))) return;
        const r = await api(`/api/admin/users/${id}`, { method: 'DELETE' });
        toast(r.deactivated ? t('userDeactivated') : t('userRemoved'));
      }
      pageUsers();
    } catch (err) { toast(err.message); }
  }));
}

// t() 결과에서 HTML 이스케이프를 되돌려 일반 글자로 (confirm/toast 용)
function plain(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d.textContent;
}

// ── 관리: 설정 ───────────────────────────────────────────

async function pageSettings() {
  app.innerHTML = shell('admin', `<h2 class="page-title">${esc(t('adminTitle'))}</h2>${adminTabs('settings')}<p class="lead">${esc(t('loading'))}</p>`);
  bindCommon();
  let data;
  try { data = await api('/api/admin/settings'); }
  catch (err) { return handleError(err); }
  const s = data.settings;

  const later = (title, desc, part) => `
    <div class="panel is-later"><h2>${esc(title)}<span class="later-chip">${t('comingInPart', { n: part })}</span></h2>
    <p class="desc">${esc(desc)}</p></div>`;

  app.querySelector('main').innerHTML = `
    <h2 class="page-title">${esc(t('adminTitle'))}</h2>
    ${adminTabs('settings')}
    <p class="lead">${esc(t('settingsBody'))}</p>

    <form class="panel" data-section="basic">
      <h2>${esc(t('secBasic'))}</h2>
      <label class="field"><span>${esc(t('setupAppName'))}</span>
        <input name="app.name" type="text" value="${esc(s['app.name'].value)}"></label>
      <button class="btn btn-primary" type="submit">${esc(t('save'))}</button>
    </form>

    <form class="panel" data-section="google">
      <h2>${esc(t('secGoogle'))}</h2>
      <span class="field"><span>${esc(t('redirectUri'))}</span></span>
      <div class="copy-box"><code>${esc(data.redirectUri)}</code>
        <button type="button" class="btn btn-quiet btn-small" data-copy="${esc(data.redirectUri)}">${esc(t('copy'))}</button></div>
      <label class="field"><span>${esc(t('clientId'))}</span>
        <input name="google.client_id" type="text" spellcheck="false" autocomplete="off" value="${esc(s['google.client_id'].value)}"></label>
      <label class="field"><span>${esc(t('clientSecret'))}</span>
        <input name="google.client_secret" type="password" autocomplete="off" placeholder="${esc(t('secretPlaceholder'))}">
        ${s['google.client_secret'].set ? `<small>${t('secretSet', { hint: s['google.client_secret'].hint })}</small>` : ''}</label>
      <div class="test-result"></div>
      <div class="row" style="flex-wrap:wrap">
        <button class="btn btn-primary shrink" type="submit">${esc(t('save'))}</button>
        <button class="btn btn-quiet shrink" type="button" data-act="test-google">${esc(t('testConnection'))}</button>
      </div>
    </form>

    ${later(t('secAI'), t('secAIDesc'), 6)}
    <form class="panel" data-section="email">
      <h2>${esc(t('secEmail'))}</h2>
      <p class="desc">${esc(t('secEmailDesc2'))}</p>
      <label class="field"><span>${esc(t('resendKey'))}</span>
        <input name="email.resend_key" type="password" autocomplete="off" spellcheck="false" placeholder="${esc(s['email.resend_key'].set ? t('secretPlaceholder') : 're_...')}">
        ${s['email.resend_key'].set ? `<small>${t('secretSet', { hint: s['email.resend_key'].hint })}</small>` : ''}</label>
      <label class="field"><span>${esc(t('mailFrom'))}</span>
        <input name="email.from" type="text" spellcheck="false" autocomplete="off" placeholder="지나기록기 &lt;noreply@도메인&gt;" value="${esc(s['email.from'].value)}">
        <small>${esc(t('mailFromHelp'))}</small></label>
      <div class="test-result"></div>
      <div class="row" style="flex-wrap:wrap">
        <button class="btn btn-primary shrink" type="submit">${esc(t('save'))}</button>
        <button class="btn btn-quiet shrink" type="button" data-act="test-mail">${esc(t('sendTestMail'))}</button>
      </div>
    </form>
    ${later(t('secDrive'), t('secDriveDesc'), 8)}`;

  app.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => copyText(b.dataset.copy, b)));

  app.querySelectorAll('form[data-section]').forEach((form) => form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    try {
      await api('/api/admin/settings', { method: 'PUT', body: { values } });
      if (values['app.name'] !== undefined) state.config.appName = values['app.name'] || t('appDefault');
      toast(t('saved'));
      pageSettings();
    } catch (err) { toast(err.message); }
  }));

  app.querySelector('[data-act="test-mail"]').addEventListener('click', async (e) => {
    const out = e.target.closest('form').querySelector('.test-result');
    e.target.disabled = true;
    try {
      const r = await api('/api/admin/settings/test-mail', { method: 'POST' });
      out.innerHTML = `<div class="notice ok" role="status">${t('testMailSent', { email: r.to })}</div>`;
    } catch (err) {
      out.innerHTML = `<div class="notice error">${esc(err.message)}</div>`;
    }
    e.target.disabled = false;
  });

  app.querySelector('[data-act="test-google"]').addEventListener('click', async (e) => {
    const out = e.target.closest('form').querySelector('.test-result');
    e.target.disabled = true;
    try {
      const r = await api('/api/admin/settings/test-google', { method: 'POST' });
      const msg = r.ok ? t('testOk')
        : (['missing', 'invalid_client', 'redirect_uri_mismatch', 'network'].includes(r.reason) ? t('test_' + r.reason) : t('testFailed', { reason: r.reason }));
      out.innerHTML = `<div class="notice ${r.ok ? 'ok' : 'error'}" role="status">${msg}</div>`;
    } catch (err) {
      out.innerHTML = `<div class="notice error">${esc(err.message)}</div>`;
    }
    e.target.disabled = false;
  });
}

// ── 내 정보 ──────────────────────────────────────────────

let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; });

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}
function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function pageMe() {
  const u = state.user;
  let install;
  if (isStandalone()) install = `<p class="desc">${esc(t('installDone'))}</p>`;
  else if (isIos()) install = `<p class="desc">${t('installIos')}</p>`;
  else install = `<button class="btn btn-quiet" data-act="install" type="button">${esc(t('installButton'))}</button>`;

  app.innerHTML = shell('me', `
    <div class="profile">${avatar(u)}<div>
      <div class="profile-name">${esc(u.name || u.email.split('@')[0])}</div>
      <div class="profile-mail">${esc(u.email)} · ${esc(u.role === 'admin' ? t('roleAdmin') : t('roleTeacher'))}</div>
    </div></div>
    <div class="panel">
      <h2>${esc(t('language'))}</h2>
      <div class="seg" role="group" aria-label="${esc(t('language'))}">
        <button type="button" data-lang="ko" aria-pressed="${getLang() === 'ko'}">한국어</button>
        <button type="button" data-lang="en" aria-pressed="${getLang() === 'en'}">English</button>
      </div>
    </div>
    <div class="panel">
      <h2>${esc(t('installTitle'))}</h2>
      <p class="desc">${esc(t('installBody'))}</p>
      ${install}
    </div>
    <div class="section"><button class="btn btn-quiet btn-block" data-act="logout" type="button">${esc(t('logout'))}</button></div>`);
  bindCommon();
  app.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => { setLang(b.dataset.lang); pageMe(); }));
  app.querySelector('[data-act="logout"]').addEventListener('click', async () => {
    try { await api('/api/logout', { method: 'POST' }); } catch {}
    state.user = null;
    location.hash = '';
    renderLogin();
  });
  const ib = app.querySelector('[data-act="install"]');
  if (ib) ib.addEventListener('click', async () => {
    if (installEvent) { installEvent.prompt(); installEvent = null; }
    else toast(t('installBody'));
  });
}

// ── 공통 ─────────────────────────────────────────────────

function bindCommon() {
  bindLang(app, render);
}

function handleError(err) {
  if (err.status === 401) { state.user = null; return renderLogin(); }
  toast(err.message);
}

function render() {
  if (!state.user) return renderLogin();
  const h = location.hash.replace(/^#/, '') || '/';
  const admin = state.user.role === 'admin';
  if (h === '/records') return pageRecords();
  if (h === '/me') return pageMe();
  if (h === '/admin/users' && admin) return pageUsers();
  if (h === '/admin/settings' && admin) return pageSettings();
  return pageRecord();
}

window.addEventListener('hashchange', () => { if (state.user) render(); });

async function boot() {
  try {
    state.config = await api('/api/config');
    const status = await api('/api/setup/status');
    state.redirectUri = status.redirectUri;
    if (status.needsSetup) return renderSetup(status);
    try {
      const { user } = await api('/api/me');
      state.user = user;
      if (location.search) history.replaceState(null, '', '/' + location.hash);
      render();
    } catch (err) {
      if (err.status === 401) renderLogin();
      else throw err;
    }
  } catch (err) {
    app.innerHTML = `<div class="login"><div class="login-body"><div class="notice error" role="alert">${esc(err.message)}</div>
      <button class="btn btn-quiet" id="retry">${esc(t('retry'))}</button></div></div>`;
    document.getElementById('retry').addEventListener('click', () => location.reload());
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

boot();
