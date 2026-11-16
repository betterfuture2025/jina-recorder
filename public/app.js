// 지나기록기 — 화면 (로그인, 처음 설치, 녹음, 기록, 관리, 내 정보)
import { t, esc, getLang, setLang } from './i18n.js';
import { ChunkRecorder, supported as recSupported } from './recorder.js';
import { Syncer, putRec, patchRec, putChunk as saveChunk, deleteRec, listRecs, unstick, askPersist } from './offline.js';

const app = document.getElementById('app');
const state = { user: null, config: { appName: '지나기록기', googleReady: false }, redirectUri: '' };

setLang(getLang());

// ── 인터넷 없이 녹음 → 나중에 올리기 ───────────────────────
const syncer = new Syncer({
  autoSummary: () => state.config.autoSummary !== false,
  onChunk: (recId, seq, data) => {
    if (session && session.id === recId) {
      const l = session.lines.get(seq);
      session.lines.set(seq, { startMs: l ? l.startMs : 0, status: data.status, text: data.text });
      session.renderLines && session.renderLines();
    }
  },
  onSynced: (rec) => {
    if (!session || session.id !== rec.id) toast(t('syncedOne', { when: fmtStamp(rec.startedAt) }));
    const here = location.hash.replace(/^#/, '').split('?')[0] || '/';
    if (state.user && !session && (here === '/' || here === '/records')) render();
  },
  onChange: (st) => {
    syncStats = st;
    renderNetBar();
    renderPendingBox();
    if (session && session.renderUpload) session.renderUpload(st);
  },
});
let syncStats = { recs: 0, chunks: 0, online: navigator.onLine, list: [] };

function renderNetBar() {
  let bar = document.getElementById('net-bar');
  const off = !navigator.onLine;
  if (!off) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'net-bar';
    bar.setAttribute('role', 'status');
    document.body.appendChild(bar);
  }
  bar.textContent = t('offlineBar');
}
window.addEventListener('online', renderNetBar);
window.addEventListener('offline', renderNetBar);

// 홈·게시판 위: 휴대폰에만 있는(아직 안 올라간) 녹음
function renderPendingBox() {
  const box = document.getElementById('pending-box');
  if (!box) return;
  const list = (syncStats.list || []).filter((r) => !session || r.id !== session.id);
  if (!list.length) { box.innerHTML = ''; return; }
  const stuck = list.filter((r) => r.stuck);
  const offline = !navigator.onLine || syncStats.error === 'offline';
  box.innerHTML = `<div class="pending-card">
    <div class="pending-head">${ICONS.upload}<div>
      <b>${esc(t('pendingTitle', { n: list.length }))}</b>
      <small>${esc(syncStats.error === 'login' ? t('pendingLogin') : offline ? t('pendingOffline') : t('pendingUploading', { n: syncStats.chunks }))}</small></div>
      ${!offline && syncStats.error !== 'login' ? '' : `<button type="button" class="btn btn-quiet btn-small" data-act="sync-now">${esc(t('syncNow'))}</button>`}
    </div>
    <ul class="pending-list">${list.map((r) => `<li>
      <span>${esc(kindLabel(r.kind))} · ${esc(fmtStamp(r.startedAt))}${r.durationSec ? ' · ' + esc(fmtDur(r.durationSec)) : ''}${r.finished ? '' : ' · ' + esc(t('pendingNotFinished'))}</span>
      ${r.stuck ? `<span class="pending-err">${esc(r.error || t('pendingStuck'))}
        <button type="button" class="link-btn" data-retry="${esc(r.id)}">${esc(t('retry'))}</button>
        <button type="button" class="link-btn danger" data-drop="${esc(r.id)}">${esc(t('pendingDrop'))}</button></span>` : ''}
    </li>`).join('')}</ul>
    ${stuck.length ? '' : ''}</div>`;
  const now = box.querySelector('[data-act="sync-now"]');
  if (now) now.addEventListener('click', () => { if (syncStats.error === 'login') location.reload(); else syncer.kick(); });
  box.querySelectorAll('[data-retry]').forEach((b) => b.addEventListener('click', async () => { await unstick(b.dataset.retry); syncer.kick(); }));
  box.querySelectorAll('[data-drop]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(t('pendingDropConfirm'))) return;
    await deleteRec(b.dataset.drop); syncer.report();
  }));
}

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

// 2026.11.16 (월) 오후 3:10 — 기록에 쓰는 날짜 형식
function sqlDate(sqlTime) {
  return new Date(String(sqlTime).replace(' ', 'T') + (String(sqlTime).includes('Z') ? '' : 'Z'));
}
function fmtStamp(input, { time = true } = {}) {
  if (!input) return '';
  const d = input instanceof Date ? input : sqlDate(input);
  const ko = getLang() === 'ko';
  const p2 = (n) => String(n).padStart(2, '0');
  const days = ko ? ['일', '월', '화', '수', '목', '금', '토'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let s = `${d.getFullYear()}.${p2(d.getMonth() + 1)}.${p2(d.getDate())} (${days[d.getDay()]})`;
  if (time) {
    const h = d.getHours(), m = p2(d.getMinutes());
    s += ko ? ` ${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${m}` : ` ${h % 12 || 12}:${m} ${h < 12 ? 'am' : 'pm'}`;
  }
  return s;
}
function fmtClock(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p2 = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p2(m)}:${p2(sec)}` : `${p2(m)}:${p2(sec)}`;
}
function fmtDur(sec) {
  sec = Math.round(sec || 0);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (getLang() === 'ko') return h ? `${h}시간 ${m}분` : m ? `${m}분` : `${s}초`;
  return h ? `${h} h ${m} min` : m ? `${m} min` : `${s} s`;
}
// 사용자 정보 칸 (성·이름·영어 이름·영어 성·직책·전화번호)
function profileFields(v = {}, { required = false } = {}) {
  const f = (name, label, attrs = '') => `<label class="field"><span>${esc(t(label))}</span>
    <input name="${name}" type="text" value="${esc(v[name] || '')}" ${attrs}></label>`;
  return `
    <div class="row">${f('last_name', 'lastName', `autocomplete="family-name" ${required ? 'required' : ''}`)}${f('first_name', 'firstName', `autocomplete="given-name" ${required ? 'required' : ''}`)}</div>
    <div class="row">${f('first_name_en', 'firstNameEn', 'autocomplete="off" lang="en"')}${f('last_name_en', 'lastNameEn', 'autocomplete="off" lang="en"')}</div>
    ${f('position', 'position', `placeholder="${esc(t('positionPh'))}"`)}
    <label class="field"><span>${esc(t('phone'))}</span><input name="phone" type="tel" inputmode="tel" autocomplete="tel" value="${esc(v.phone || '')}" placeholder="04xx xxx xxx"></label>`;
}
function enName(u) { return `${u.first_name_en || ''} ${u.last_name_en || ''}`.trim(); }

function editUserSheet(u, onSaved) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `
    <form class="sheet" role="dialog" aria-modal="true" aria-labelledby="eu-title" novalidate>
      <h2 id="eu-title">${esc(t('editInfo'))}</h2>
      <p>${esc(u.email)}</p>
      ${profileFields(u)}
      <div class="sheet-sub">
        <label class="field"><span>${esc(t('setNewPassword'))}</span>
          <input name="password" type="password" autocomplete="new-password" minlength="8" placeholder="${esc(t('setNewPasswordPh'))}">
          <small>${esc(u.has_password ? t('hasPasswordNote') : t('noPasswordNote'))}</small></label>
      </div>
      <div id="eu-error"></div>
      <div class="row">
        <button type="button" class="btn btn-quiet" data-act="cancel">${esc(t('cancel'))}</button>
        <button type="submit" class="btn btn-primary">${esc(t('save'))}</button>
      </div>
    </form>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector('[data-act="cancel"]').addEventListener('click', close);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  const form = wrap.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form));
    const pw = d.password; delete d.password;
    try {
      await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: d });
      if (pw) await api(`/api/admin/users/${u.id}/password`, { method: 'PUT', body: { password: pw } });
      close(); toast(pw ? t('passwordSetFor', { name: u.name || u.email }) : t('saved')); onSaved();
    } catch (err) { wrap.querySelector('#eu-error').innerHTML = `<div class="notice error">${esc(err.message)}</div>`; }
  });
  form.querySelector('input').focus();
}

const KIND_KEYS = { memo: 'kindMemo', meeting: 'kindMeeting', consult: 'kindConsult', unassigned: 'unassigned' };
const kindLabel = (k) => t(KIND_KEYS[k] || 'unassigned');

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
  upload: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 8.5a4 4 0 0 1 0 8"/><path d="M12 12v8M9 15l3-3 3 3"/></svg>`,
  help: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.3 2.4c-.5.2-.8.7-.8 1.2v.4M12 16.8v.2"/></svg>`,
  search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>`,
  eye: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`,
  eyeOff: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 4.4-1.1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>`,
  mail: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5l8.5 6.5 8.5-6.5"/></svg>`,
  spark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>`,
  people: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c.6-3.4 3-5.5 6-5.5s5.4 2.1 6 5.5"/><circle cx="17" cy="9" r="2.4"/><path d="M16.5 14.6c2.4.2 4 1.9 4.5 4.6"/></svg>`,
  exit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h4"/><path d="M14 8l4 4-4 4M18 12H9"/></svg>`,
  shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/></svg>`,
  menu: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>`,
  gear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`,
  logout: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>`,
  pause: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>`,
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V4M8 8l4-4 4 4M6 12v7a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-7"/></svg>',
  play: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>`,
  stop: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="3"/></svg>`,
  back: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>`,
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
        <form id="pw-login" class="login-form" novalidate ${loginMode === 'code' ? 'hidden' : ''}>
          <label class="field"><span>${esc(t('emailLabel'))}</span>
            <input name="email" type="email" inputmode="email" autocomplete="username" required placeholder="name@example.com" value="${esc(loginEmail)}"></label>
          <label class="field"><span>${esc(t('password'))}</span>
            <span class="pw-wrap"><input name="password" type="password" autocomplete="current-password" required>
              <button type="button" class="pw-eye" data-act="eye" aria-label="${esc(t('showPassword'))}">${ICONS.eye}</button></span></label>
          <button class="btn btn-primary btn-block" type="submit">${esc(t('loginButton'))}</button>
          ${state.config.emailReady ? `<button type="button" class="link-btn mode-link" data-mode="code">${esc(t('useCodeInstead'))}</button>` : ''}
        </form>
        ${state.config.emailReady ? `
        <form id="email-start" class="login-form" novalidate ${loginMode === 'code' ? '' : 'hidden'}>
          <label class="field"><span>${esc(t('emailLabel'))}</span>
            <input name="email" type="email" inputmode="email" autocomplete="email" required placeholder="name@example.com" value="${esc(loginEmail)}"></label>
          <button class="btn btn-primary btn-block" type="submit">${esc(t('sendCode'))}</button>
          <button type="button" class="link-btn mode-link" data-mode="password">${esc(t('usePasswordInstead'))}</button>
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
        ${state.config.googleReady ? `<div class="or"><span>${esc(t('or'))}</span></div>
        <a class="btn btn-google btn-block" href="/auth/login">${GOOGLE_G}<span>${esc(t('loginGoogle'))}</span></a>` : ''}
        <p class="signup-cta">${esc(t('noAccount'))} <a href="#/signup">${esc(t('signupLink'))}</a></p>
        <p class="login-foot">${esc(t('loginOnlyAllowed'))} <a href="/guide.html">${esc(t('guide'))}</a> · <a href="/privacy.html">${esc(t('privacy'))}</a></p>
      </div>
    </div>`;
  bindLang(app, renderLogin);
  if (state.config.emailReady) bindEmailLogin();
  bindPasswordLogin();
}

let loginMode = 'password';

function bindPasswordLogin() {
  const form = app.querySelector('#pw-login');
  const msg = app.querySelector('#login-msg');
  app.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    loginMode = b.dataset.mode;
    const em = app.querySelector(loginMode === 'code' ? '#pw-login [name=email]' : '#email-start [name=email]');
    if (em && em.value) loginEmail = em.value.trim().toLowerCase();
    renderLogin();
  }));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    const data = Object.fromEntries(new FormData(form));
    loginEmail = (data.email || '').trim().toLowerCase();
    if (!loginEmail.includes('@') || !data.password) {
      msg.innerHTML = `<div class="notice error" role="alert">${esc(t('fillEmailPassword'))}</div>`;
      return;
    }
    btn.disabled = true;
    msg.innerHTML = '';
    try {
      await api('/api/login/password', { method: 'POST', body: { email: loginEmail, password: data.password } });
      const { user } = await api('/api/me');
      state.user = user;
      history.replaceState(null, '', '/');
      render();
    } catch (err) {
      msg.innerHTML = `<div class="notice error" role="alert">${esc(err.message)}</div>`;
      btn.disabled = false;
    }
  });
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

// ── 가입 신청 ─────────────────────────────────────────────

function renderSignup(done) {
  app.innerHTML = `
    <div class="login">
      <div class="login-top">
        <a class="brand" href="#/" style="text-decoration:none;color:inherit">${LOGO}<span>${esc(state.config.appName)}</span></a>
        ${langButton()}
      </div>
      <div class="login-body">
        ${done ? `
          <div class="jina-hero"><img src="/jina/thumbs.png" alt="${esc(t('jinaThumbsAlt'))}"></div>
          <h1>${esc(t('signupDoneTitle'))}</h1>
          <p>${esc(t('signupDoneBody'))}</p>
          <a class="btn btn-primary btn-block" href="#/">${esc(t('backToLogin'))}</a>` : `
          <h1>${esc(t('signupTitle'))}</h1>
          <p>${esc(t('signupBody'))}</p>
          <div id="signup-msg"></div>
          <form id="signup" novalidate>
            ${profileFields({}, { required: true })}
            <label class="field"><span>${esc(t('emailLabel'))}</span><input name="email" type="email" inputmode="email" autocomplete="email" required placeholder="name@example.com"></label>
            <label class="field"><span>${esc(t('passwordOptional'))}</span>
              <input name="password" type="password" autocomplete="new-password" minlength="8">
              <small>${esc(t('passwordSignupHelp'))}</small></label>
            <label class="field"><span>${esc(t('passwordConfirm'))}</span>
              <input name="password2" type="password" autocomplete="new-password"></label>
            <label class="field"><span>${esc(t('signupNote'))}</span><input name="note" type="text" placeholder="${esc(t('signupNotePh'))}"></label>
            <button class="btn btn-primary btn-block" type="submit">${esc(t('signupSubmit'))}</button>
          </form>
          <p class="signup-cta"><a href="#/">${esc(t('backToLogin'))}</a></p>`}
      </div>
    </div>`;
  bindLang(app, () => renderSignup(done));
  const form = app.querySelector('#signup');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    const body = Object.fromEntries(new FormData(form));
    if (body.password !== body.password2) {
      app.querySelector('#signup-msg').innerHTML = `<div class="notice error" role="alert">${esc(t('passwordMismatch'))}</div>`;
      return;
    }
    delete body.password2;
    if (!body.password) delete body.password;
    btn.disabled = true;
    try {
      await api('/api/signup', { method: 'POST', body });
      renderSignup(true);
    } catch (err) {
      app.querySelector('#signup-msg').innerHTML = `<div class="notice error" role="alert">${esc(err.message)}</div>`;
      btn.disabled = false;
    }
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
  loadDrivePanel();
  const dmsg = routeParams.get('drive');
  if (dmsg) toast(t('drive_' + dmsg) || dmsg);
  app.querySelectorAll('[data-act="test-ai"]').forEach((btn) => btn.addEventListener('click', async () => {
    const out = btn.closest('form').querySelector('.test-result');
    btn.disabled = true;
    out.innerHTML = `<div class="notice">${esc(t('aiTesting'))}</div>`;
    try {
      const r = await api('/api/admin/ai-test', { method: 'POST', body: { job: btn.dataset.job } });
      out.innerHTML = `<div class="notice ok" role="status">${esc(t('aiTestOk', { model: r.model, reply: r.reply }))}</div>`;
    } catch (err) { out.innerHTML = `<div class="notice error">${esc(err.message)}</div>`; }
    btn.disabled = false;
  }));

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

// 화면 틀: 사용자 화면과 관리자 화면은 메뉴가 완전히 따로다.
//  - 휴대폰: 위 막대 + 아래 탭 (사용자 탭 / 관리자 탭이 다름)
//  - PC(넓은 화면): 왼쪽 메뉴 막대 + 가운데 내용
function navItems(mode) {
  const admin = state.user.role === 'admin';
  if (mode === 'admin') {
    return {
      main: [
        { id: 'users', href: '#/admin/users', icon: ICONS.admin, label: t('adminUsers'), count: true },
        { id: 'insights', href: '#/admin/insights', icon: ICONS.spark, label: t('adminInsights') },
        { id: 'contacts', href: '#/admin/contacts', icon: ICONS.people, label: t('adminContacts') },
        { id: 'mail', href: '#/admin/mail', icon: ICONS.mail, label: t('adminMail') },
        { id: 'settings', href: '#/admin/settings', icon: ICONS.gear, label: t('adminSettings') },
      ],
      tabs: ['users', 'insights', 'mail', 'settings'],
      switchTo: { href: '#/', icon: ICONS.exit, label: t('toUserView') },
    };
  }
  return {
    main: [
      { id: 'record', href: '#/', icon: ICONS.record, label: t('tabRecord') },
      { id: 'records', href: '#/records', icon: ICONS.records, label: t('tabRecords') },
      { id: 'me', href: '#/me', icon: ICONS.me, label: t('myInfo') },
    ],
    tabs: ['records', 'record', 'me'],
    switchTo: admin ? { href: '#/admin/users', icon: ICONS.shield, label: t('adminPage') } : null,
  };
}

function shell(active, content) {
  const u = state.user;
  const mode = active === 'admin' || String(active).startsWith('admin:') ? 'admin' : 'user';
  const section = mode === 'admin'
    ? (String(active).split(':')[1] || ((location.hash.match(/^#\/admin\/(\w+)/) || [])[1]) || 'users')
    : active;
  const nav = navItems(mode);
  const link = (it, cls) => `<a href="${it.href}" class="${cls}" ${it.id === section ? 'aria-current="page"' : ''}>${it.icon}<span>${esc(it.label)}</span>${it.count ? '<span class="menu-count" data-signups hidden></span>' : ''}</a>`;
  const tabs = nav.tabs.map((id) => nav.main.find((x) => x.id === id));
  if (mode === 'admin') tabs.push({ id: '_exit', href: nav.switchTo.href, icon: nav.switchTo.icon, label: t('tabExit') });
  if (mode === 'admin') setTimeout(loadSignupCount, 0);
  return `
    <div class="layout layout-${mode}">
      <aside class="side" aria-label="${esc(t('menu'))}">
        <a href="${mode === 'admin' ? '#/admin/users' : '#/'}" class="side-brand">
          <img src="/icons/icon-192.png" alt="" width="32" height="32">
          <span>${esc(state.config.appName)}</span>
          ${mode === 'admin' ? `<em>${esc(t('adminBadge'))}</em>` : ''}
        </a>
        <nav class="side-nav">
          ${nav.main.map((it) => link(it, 'side-link')).join('')}
          ${mode === 'user' ? `<a href="/guide" class="side-link">${ICONS.help}<span>${esc(t('guide'))}</span></a>` : ''}
        </nav>
        <div class="side-foot">
          ${nav.switchTo ? `<a href="${nav.switchTo.href}" class="side-switch">${nav.switchTo.icon}<span>${esc(nav.switchTo.label)}</span></a>` : ''}
          <a href="#/me" class="side-user">${avatar(u)}<span><b>${esc(u.name || u.email.split('@')[0])}</b><small>${esc(u.role === 'admin' ? t('roleAdmin') : t('roleTeacher'))}</small></span></a>
        </div>
      </aside>
      <div class="shell">
        <header class="topbar">
          <button type="button" class="menu-btn" data-act="menu" aria-label="${esc(t('menu'))}" aria-expanded="false">${ICONS.menu}</button>
          <h1><a href="${mode === 'admin' ? '#/admin/users' : '#/'}" class="home-link">${esc(mode === 'admin' ? t('adminPage') : state.config.appName)}</a></h1>
          ${langButton()}
          ${mode === 'admin'
            ? `<a href="#/" class="exit-btn">${ICONS.exit}<span>${esc(t('toUserView'))}</span></a>`
            : `<a href="#/me" class="top-avatar" aria-label="${esc(t('tabMe'))}">${avatar(u)}</a>`}
        </header>
        <main>${content}</main>
      </div>
    </div>
    <div class="tabbar tabbar-${mode}"><nav aria-label="tabs">
      ${tabs.map((tb) => `<a href="${tb.href}" ${tb.id === section ? 'aria-current="page"' : ''}>${tb.icon}<span>${esc(tb.label)}</span>${tb.count ? '<span class="tab-count" data-signups hidden></span>' : ''}</a>`).join('')}
    </nav></div>`;
}

function loadSignupCount() {
  if (state.user?.role !== 'admin') return;
  api('/api/admin/signups').then(({ requests }) => {
    document.querySelectorAll('[data-signups]').forEach((el) => {
      if (requests.length) { el.textContent = requests.length; el.hidden = false; el.setAttribute('aria-label', t('signupRequests', { n: requests.length })); }
    });
  }).catch(() => {});
}

// ── 녹음 (홈) ─────────────────────────────────────────────

function pageRecord() {
  const u = state.user;
  const first = esc((u.name || u.email.split('@')[0]).trim());
  const today = fmtStamp(new Date(), { time: false });
  app.innerHTML = shell('record', `
    <div class="greet">
      <span class="face">${u.picture ? `<img src="${esc(u.picture)}" alt="" referrerpolicy="no-referrer">` : `<img src="/jina/portrait.png" alt="">`}</span>
      <div><div class="greet-date">${esc(today)}</div><div class="greet-name">${t('hello', { name: first })}</div></div>
    </div>
    <div id="pending-box"></div>
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
    ${u.role === 'admin' ? `<a class="admin-card" href="#/admin/users">
      <span class="admin-card-icon">${ICONS.admin}</span>
      <span class="admin-card-text"><b>${esc(t('adminPage'))}</b><small>${esc(t('adminCardBody'))}</small></span>
      <span class="menu-count" id="home-signups" hidden></span>
      <span class="admin-card-arrow" aria-hidden="true">›</span>
    </a>` : ''}
    <section class="section" id="recent">
      <div class="empty-jina">
        <div><h3>${esc(t('recordsEmpty'))}</h3><p>${esc(t('homeEmptyBody'))}</p></div>
        <img src="/jina/point.png" alt="${esc(t('jinaPointAlt'))}">
      </div>
    </section>`);
  bindCommon();
  renderPendingBox(); syncer.report();
  app.querySelector('[data-act="quick-record"]').addEventListener('click', () => beginRecording('unassigned'));
  app.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => beginRecording(b.dataset.kind)));
  loadRecent();
  if (u.role === 'admin') api('/api/admin/signups').then(({ requests }) => {
    const el = app.querySelector('#home-signups');
    if (el && requests.length) { el.textContent = t('newSignups', { n: requests.length }); el.hidden = false; }
  }).catch(() => {});
}

async function loadRecent() {
  let items;
  try { ({ items } = await api('/api/recordings?limit=3')); } catch { return; }
  const box = app.querySelector('#recent');
  if (!box || !items.length) return;
  box.innerHTML = `
    <div class="section-head"><h2>${esc(t('recentTitle'))}</h2><a href="#/records" class="link-btn">${esc(t('seeAll'))}</a></div>
    <ul class="rec-list">${items.map(recCard).join('')}</ul>`;
}

function recCard(r) {
  const title = r.title || (r.kind === 'unassigned' ? t('untitled') : kindLabel(r.kind));
  const live = r.status === 'recording';
  const text = r.summary_line || r.snippet;
  return `<li><a class="rec-card" href="#/r/${esc(r.id)}">
    <div class="rec-card-top">
      <span class="kind-badge kind-${esc(r.kind)}">${esc(kindLabel(r.kind))}</span>
      ${r.people && r.people.length ? `<span class="rec-card-people">${ICONS.people}${esc(r.people.join(', '))}</span>` : ''}
      <span class="rec-card-when">${esc(fmtStamp(r.started_at))}</span>
    </div>
    <div class="rec-card-title">${esc(title)}</div>
    ${text ? `<p class="rec-card-snippet ${r.summary_line ? 'is-summary' : ''}">${r.summary_line ? `<span class="ai-mark">${ICONS.spark}</span>` : ''}${esc(text)}</p>` : ''}
    <div class="rec-card-meta">${live ? `<span class="live-dot"></span>${esc(t('stillRecording'))}` : esc(fmtDur(r.duration_sec))}${state.user.role === 'admin' && r.owner_email !== state.user.email ? ` · ${esc(r.owner_name || r.owner_email)}` : ''}
      ${r.todo_open ? `<span class="todo-badge">${esc(t('todoOpen', { n: r.todo_open }))}</span>` : ''}
      ${(r.tags || []).slice(0, 4).map((x) => `<span class="tag-mini">#${esc(x)}</span>`).join('')}</div>
  </a></li>`;
}

// ── 기록 ─────────────────────────────────────────────────

let recordsFilter = '';
let recordsQuery = '';
let recordsTag = '';
let recordsContact = null; // { id, name }
async function pageRecords() {
  const filters = [['', 'all'], ['consult', 'kindConsult'], ['meeting', 'kindMeeting'], ['memo', 'kindMemo'], ['unassigned', 'unassigned']];
  app.innerHTML = shell('records', `
    <h2 class="page-title">${esc(t('recordsTitle'))}</h2>
    <div id="pending-box"></div>
    <form class="search" role="search" id="search">
      <label class="visually-hidden" for="q">${esc(t('searchPlaceholder'))}</label>
      ${ICONS.search}
      <input id="q" name="q" type="search" value="${esc(recordsQuery)}" placeholder="${esc(t('searchPlaceholder'))}" enterkeyhint="search">
      <button type="submit" class="btn btn-primary btn-small">${esc(t('searchButton'))}</button>
    </form>
    <div class="chips" role="group" aria-label="${esc(t('recordsTitle'))}">
      ${filters.map(([k, key]) => `<button type="button" class="chip" data-filter="${k}" aria-pressed="${recordsFilter === k}">${esc(t(key))}</button>`).join('')}
    </div>
    <div class="tag-row" id="tag-row"></div>
    ${recordsContact ? `<p class="filter-note">${ICONS.people}<span>${esc(t('filterPerson', { name: recordsContact.name }))}</span><button type="button" class="link-btn" data-act="clear-contact">${esc(t('clearFilter'))}</button></p>` : ''}
    <div id="list"><p class="lead">${esc(t('loading'))}</p></div>`);
  bindCommon();
  renderPendingBox(); syncer.report();
  app.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => { recordsFilter = b.dataset.filter; pageRecords(); }));
  app.querySelector('#search').addEventListener('submit', (e) => { e.preventDefault(); recordsQuery = app.querySelector('#q').value.trim(); pageRecords(); });
  const cc = app.querySelector('[data-act="clear-contact"]');
  if (cc) cc.addEventListener('click', () => { recordsContact = null; pageRecords(); });
  api('/api/tags').then(({ tags }) => {
    const row = app.querySelector('#tag-row');
    if (!row || !tags.length) return;
    row.innerHTML = tags.slice(0, 14).map((x) => `<button type="button" class="tag-chip" data-tag="${esc(x.name)}" aria-pressed="${recordsTag === x.name}">#${esc(x.name)}</button>`).join('');
    row.querySelectorAll('[data-tag]').forEach((b) => b.addEventListener('click', () => { recordsTag = recordsTag === b.dataset.tag ? '' : b.dataset.tag; pageRecords(); }));
  }).catch(() => {});
  let items;
  try {
    const q = new URLSearchParams({ limit: '100' });
    if (recordsFilter) q.set('kind', recordsFilter);
    if (recordsQuery) q.set('q', recordsQuery);
    if (recordsTag) q.set('tag', recordsTag);
    if (recordsContact) q.set('contact', recordsContact.id);
    if (state.user.role === 'admin') q.set('all', '1');
    ({ items } = await api('/api/recordings?' + q));
  } catch (err) { return handleError(err); }
  const list = app.querySelector('#list');
  if (!list) return;
  if (!items.length && recordsQuery) {
    list.innerHTML = `<p class="lead">${esc(t('searchResult', { q: recordsQuery, n: 0 }))} <button type="button" class="link-btn" data-act="clear-q">${esc(t('clearSearch'))}</button></p>`;
    list.querySelector('[data-act="clear-q"]').addEventListener('click', () => { recordsQuery = ''; pageRecords(); });
    return;
  }
  if (!items.length) {
    list.innerHTML = `<div class="empty-jina">
      <div><h3>${esc(t('recordsEmpty'))}</h3><p>${esc(t('recordsEmptyBody'))}</p>
        <a class="btn btn-primary" href="#/">${esc(t('goRecord'))}</a></div>
      <img src="/jina/think.png" alt="${esc(t('jinaThinkAlt'))}">
    </div>`;
    return;
  }
  // 날짜별로 묶어서 게시판처럼
  const groups = [];
  for (const r of items) {
    const day = fmtStamp(r.started_at, { time: false });
    if (!groups.length || groups[groups.length - 1].day !== day) groups.push({ day, items: [] });
    groups[groups.length - 1].items.push(r);
  }
  list.innerHTML = `
    ${recordsQuery ? `<p class="lead">${esc(t('searchResult', { q: recordsQuery, n: items.length }))} <button type="button" class="link-btn" data-act="clear-q">${esc(t('clearSearch'))}</button></p>` : ''}
    ${groups.map((g) => `<h3 class="day-head">${esc(g.day)}</h3><ul class="rec-list">${g.items.map(recCard).join('')}</ul>`).join('')}`;
  const cq = list.querySelector('[data-act="clear-q"]');
  if (cq) cq.addEventListener('click', () => { recordsQuery = ''; pageRecords(); });
  if (recordsQuery) highlight(list.querySelectorAll('.rec-card-snippet, .rec-card-title'), recordsQuery);
}

function highlight(nodes, q) {
  const needle = q.toLowerCase();
  nodes.forEach((el) => {
    const text = el.textContent;
    const i = text.toLowerCase().indexOf(needle);
    if (i < 0) return;
    el.innerHTML = esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
  });
}

// ── 기록 상세: 상대방 (원아·학부모) ──
function renderPeople(box, id, people) {
  if (!box) return;
  box.innerHTML = `
    <span class="people-label">${ICONS.people}${esc(t('peopleLabel'))}</span>
    ${people.map((p) => `<span class="person-chip">${esc(p.name)}${p.role === 'ai' ? `<em>${esc(t('aiGuess'))}</em>` : ''}</span>`).join('')}
    <button type="button" class="link-btn" data-act="pick-people">${esc(people.length ? t('change') : t('pickPeople'))}</button>`;
  box.querySelector('[data-act="pick-people"]').addEventListener('click', () => peopleSheet(id, people, (next) => renderPeople(box, id, next)));
}

async function peopleSheet(id, current, done) {
  let all = [];
  try { ({ contacts: all } = await api('/api/contacts')); } catch (err) { return toast(err.message); }
  const chosen = new Set(current.map((p) => p.id));
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  const kindName = (k) => t({ child: 'ckChild', parent: 'ckParent', staff: 'ckStaff', customer: 'ckCustomer', other: 'ckOther' }[k] || 'ckOther');
  const draw = (q = '') => {
    const list = all.filter((c) => !q || c.name.includes(q) || (c.child_name || '').includes(q));
    wrap.querySelector('.pick-list').innerHTML = list.length ? list.map((c) => `
      <label class="pick-item"><input type="checkbox" value="${esc(c.id)}" ${chosen.has(c.id) ? 'checked' : ''}>
        <span><b>${esc(c.name)}</b><small>${esc(kindName(c.kind))}${c.child_name ? ' · ' + esc(c.child_name) : ''}</small></span></label>`).join('')
      : `<p class="lead">${esc(t('noContacts'))}</p>`;
    wrap.querySelectorAll('.pick-item input').forEach((cb) => cb.addEventListener('change', () => { if (cb.checked) chosen.add(cb.value); else chosen.delete(cb.value); }));
  };
  wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(t('pickPeople'))}">
    <h2>${esc(t('pickPeople'))}</h2>
    <input type="search" class="pick-search" placeholder="${esc(t('searchName'))}">
    <div class="pick-list"></div>
    <form class="pick-add row">
      <select name="kind"><option value="child">${esc(t('ckChild'))}</option><option value="parent">${esc(t('ckParent'))}</option><option value="other">${esc(t('ckOther'))}</option></select>
      <input name="name" type="text" maxlength="60" placeholder="${esc(t('newPersonName'))}">
      <button class="btn btn-quiet shrink" type="submit">${esc(t('add'))}</button>
    </form>
    <div class="row" style="margin-top:14px">
      <button type="button" class="btn btn-quiet" data-act="cancel">${esc(t('cancel'))}</button>
      <button type="button" class="btn btn-primary" data-act="ok">${esc(t('save'))}</button>
    </div></div>`;
  document.body.appendChild(wrap);
  draw();
  const close = () => wrap.remove();
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  wrap.querySelector('[data-act="cancel"]').addEventListener('click', close);
  wrap.querySelector('.pick-search').addEventListener('input', (e) => draw(e.target.value.trim()));
  wrap.querySelector('.pick-add').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (!f.name.trim()) return;
    try { const { contact } = await api('/api/contacts', { method: 'POST', body: f }); all.unshift(contact); chosen.add(contact.id); e.target.reset(); draw(); }
    catch (err) { toast(err.message); }
  });
  wrap.querySelector('[data-act="ok"]').addEventListener('click', async () => {
    try { const { people } = await api(`/api/recordings/${id}/people`, { method: 'PUT', body: { contactIds: [...chosen] } }); close(); toast(t('saved')); done(people); }
    catch (err) { toast(err.message); }
  });
}

// ── 기록 상세: AI 요약 ──
const autoTried = new Set();
function renderSummary(box, id, data, { auto = false } = {}) {
  if (!box) return;
  const sm = data.summary;
  const hasText = data.chunks.some((c) => c.status === 'done' && c.text);
  const tags = data.tags || [];
  const status = sm ? sm.status : 'none';
  const head = (extra = '') => `<div class="section-head"><h2>${ICONS.spark}${esc(t('aiSummary'))}</h2>${extra}</div>`;

  if (!hasText) { box.innerHTML = ''; return; }
  if (data.recording.status === 'recording') { box.innerHTML = ''; return; }

  const runSummary = async (force) => {
    box.innerHTML = `${head()}<div class="sum-card sum-working"><img src="/jina/think.png" alt=""><div><b>${esc(t('summarizing'))}</b><p>${esc(t('summarizingBody'))}</p></div></div>`;
    try {
      const out = await api(`/api/recordings/${id}/summarize`, { method: 'POST', body: { force } });
      data.summary = out.summary; data.tags = out.tags;
      if (out.title && !data.recording.title) { data.recording.title = out.title; const te = app.querySelector('#rec-title'); if (te && !te.value) te.value = out.title; }
      if (out.mailed && out.mailed.sent && out.mailed.sent.length) toast(t('sumMailed', { n: out.mailed.sent.length }));
      try { const fresh = await api(`/api/recordings/${id}`); renderPeople(app.querySelector('#people-row'), id, fresh.people || []); } catch {}
    } catch (err) {
      data.summary = { status: 'failed', error: err.message };
    }
    renderSummary(box, id, data);
    if (state.config.driveAuto && data.summary && data.summary.status === 'done') backupToDrive(id, null, true);
  };

  if (status === 'none' || status === 'working' && auto) {
    if (auto && state.config.autoSummary && !autoTried.has(id)) { autoTried.add(id); return runSummary(false); }
    box.innerHTML = `${head()}<div class="sum-card sum-empty"><p>${esc(t('sumNone'))}</p>
      <button type="button" class="btn btn-primary" data-act="sum">${ICONS.spark}<span>${esc(t('sumMake'))}</span></button></div>`;
    box.querySelector('[data-act="sum"]').addEventListener('click', () => runSummary(false));
    return;
  }
  if (status === 'failed' || status === 'working') {
    box.innerHTML = `${head()}<div class="sum-card sum-empty"><p class="notice error">${esc(sm.error || t('sumFailed'))}</p>
      <button type="button" class="btn btn-primary" data-act="sum">${esc(t('retry'))}</button></div>`;
    box.querySelector('[data-act="sum"]').addEventListener('click', () => runSummary(true));
    return;
  }
  if (status === 'empty') { box.innerHTML = `${head()}<p class="lead">${esc(t('sumEmpty'))}</p>`; return; }

  const list = (title, items) => items.length ? `<h3>${esc(title)}</h3><ul class="sum-list">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
  box.innerHTML = `${head(`<button type="button" class="link-btn" data-act="resum">${esc(t('sumRedo'))}</button>`)}
    <div class="sum-card">
      ${list(t('sumSummary'), sm.summary)}
      ${list(t('sumDecisions'), sm.decisions)}
      ${sm.todos.length ? `<h3>${esc(t('sumTodos'))}</h3><div class="todo-list">${sm.todos.map((x, i) => `
        <label class="todo"><input type="checkbox" data-todo="${i}" ${x.done ? 'checked' : ''}><span>${esc(x.text)}</span></label>`).join('')}</div>` : ''}
      <div class="tag-edit" id="tag-edit"></div>
      <div class="sum-foot">${esc(sm.edited ? t('sumEdited') : t('sumBy', { model: sm.provider === 'anthropic' ? 'Claude' : sm.provider === 'openai' ? (sm.model || 'AI') : 'Cloudflare AI' }))}${sm.emailed_at ? ' · ' + esc(t('sumWasMailed')) : ''}</div>
    </div>
    <div class="sum-actions">
      <button type="button" class="btn btn-quiet" data-act="edit">${esc(t('sumEdit'))}</button>
      ${state.config.emailReady ? `<button type="button" class="btn btn-quiet" data-act="mail">${ICONS.mail}<span>${esc(t('sumMail'))}</span></button>` : ''}
      ${state.config.driveReady ? `<button type="button" class="btn btn-quiet" data-act="drive">${esc(t('driveBackupOne'))}</button>` : ''}
    </div>`;
  renderTagEdit(box.querySelector('#tag-edit'), id, data);
  box.querySelector('[data-act="resum"]').addEventListener('click', () => { if (confirm(t('sumRedoConfirm'))) runSummary(true); });
  box.querySelectorAll('[data-todo]').forEach((cb) => cb.addEventListener('change', async () => {
    const todos = sm.todos.map((x, i) => ({ ...x, done: i === Number(cb.dataset.todo) ? cb.checked : x.done }));
    try { const out = await api(`/api/recordings/${id}/summary`, { method: 'PUT', body: { todos } }); data.summary = out.summary; sm.todos = out.summary.todos; }
    catch (err) { toast(err.message); cb.checked = !cb.checked; }
  }));
  box.querySelector('[data-act="edit"]').addEventListener('click', () => summaryEditSheet(id, data, () => renderSummary(box, id, data)));
  const mb = box.querySelector('[data-act="mail"]');
  if (mb) mb.addEventListener('click', async () => {
    mb.disabled = true;
    try { const r = await api(`/api/recordings/${id}/mail`, { method: 'POST' }); toast(t('sumMailed', { n: (r.sent || []).length })); }
    catch (err) { toast(err.message); }
    mb.disabled = false;
  });
  const db = box.querySelector('[data-act="drive"]');
  if (db) db.addEventListener('click', () => backupToDrive(id, db));
}

function renderTagEdit(box, id, data) {
  const tags = (data.tags || []).map((x) => x.name);
  box.innerHTML = `${tags.map((x, i) => `<span class="tag-chip is-static">#${esc(x)}<button type="button" data-rm="${i}" aria-label="${esc(t('removeTag', { tag: x }))}">×</button></span>`).join('')}
    <form class="tag-add"><input type="text" maxlength="20" placeholder="${esc(t('addTag'))}" aria-label="${esc(t('addTag'))}"></form>`;
  const save = async (next) => {
    try { const out = await api(`/api/recordings/${id}/tags`, { method: 'PUT', body: { tags: next } }); data.tags = out.tags; renderTagEdit(box, id, data); }
    catch (err) { toast(err.message); }
  };
  box.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => save(tags.filter((_, i) => i !== Number(b.dataset.rm)))));
  box.querySelector('.tag-add').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = e.target.querySelector('input').value.trim().replace(/^#/, '');
    if (v) save([...tags, v]);
  });
}

function summaryEditSheet(id, data, done) {
  const sm = data.summary;
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  const area = (name, label, items) => `<label class="field"><span>${esc(label)}</span><textarea name="${name}" rows="4">${esc(items.join('\n'))}</textarea></label>`;
  wrap.innerHTML = `<form class="sheet" role="dialog" aria-modal="true" aria-label="${esc(t('sumEdit'))}">
    <h2>${esc(t('sumEdit'))}</h2><p class="lead" style="margin-bottom:12px">${esc(t('sumEditHelp'))}</p>
    ${area('summary', t('sumSummary'), sm.summary)}
    ${area('decisions', t('sumDecisions'), sm.decisions)}
    ${area('todos', t('sumTodos'), sm.todos.map((x) => x.text))}
    <div class="row"><button type="button" class="btn btn-quiet" data-act="cancel">${esc(t('cancel'))}</button>
      <button type="submit" class="btn btn-primary">${esc(t('save'))}</button></div></form>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector('[data-act="cancel"]').addEventListener('click', close);
  wrap.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const lines = (v) => String(v || '').split('\n').map((x) => x.replace(/^[-•*]\s*/, '').trim()).filter(Boolean);
    const oldDone = new Map(sm.todos.map((x) => [x.text, x.done]));
    try {
      const out = await api(`/api/recordings/${id}/summary`, { method: 'PUT', body: {
        summary: lines(f.summary), decisions: lines(f.decisions), todos: lines(f.todos).map((text) => ({ text, done: !!oldDone.get(text) })),
      } });
      data.summary = out.summary; close(); toast(t('saved')); done();
    } catch (err) { toast(err.message); }
  });
}

// ── 구글 드라이브 백업 (한 기록) ──
async function backupToDrive(id, btn, quiet = false) {
  const label = btn && btn.querySelector('span') ? btn.querySelector('span') : btn;
  const old = label ? label.textContent : '';
  if (btn) btn.disabled = true;
  try {
    let step = { from: 0 }, out;
    do {
      out = await api(`/api/recordings/${id}/drive`, { method: 'POST', body: { from: step.from, folderId: step.folderId } });
      step = { from: out.next, folderId: out.folderId };
      if (label) label.textContent = t('driveProgress', { n: out.next, total: out.total });
    } while (!out.done);
    if (!quiet) toast(t('driveDone'));
  } catch (err) { if (!quiet) toast(err.message); }
  if (btn) { btn.disabled = false; if (label) label.textContent = old; }
}

// ── 기록 상세 ─────────────────────────────────────────────

async function pageRecordDetail(id) {
  app.innerHTML = shell('records', `<p class="lead">${esc(t('loading'))}</p>`);
  bindCommon();
  let data;
  try { data = await api(`/api/recordings/${id}`); }
  catch (err) { if (err.status === 404) { toast(err.message); location.hash = '#/records'; return; } return handleError(err); }
  const r = data.recording;
  const chunks = data.chunks;
  const failed = chunks.filter((c) => c.status === 'failed' || c.status === 'pending').length;
  const kinds = ['consult', 'meeting', 'memo', 'unassigned'];
  const doneCount = chunks.filter((c) => c.status === 'done' && c.text).length;
  const text = chunks.map((c) => `
    <li class="line" data-seq="${c.seq}">
      <button type="button" class="line-time" data-play="${c.seq}" aria-label="${esc(t('playFrom', { time: fmtClock(c.start_ms || 0) }))}">${fmtClock(c.start_ms || 0)}</button>
      <p class="${c.status === 'done' ? '' : 'muted'}">${c.status === 'done' ? esc(c.text) : esc(t(c.status === 'empty' ? 'chunkEmpty' : c.status === 'failed' ? 'chunkFailed' : 'chunkPending'))}</p>
    </li>`).join('');

  app.querySelector('main').innerHTML = `
    <a href="#/records" class="back-link">${ICONS.back}${esc(t('recordsTitle'))}</a>
    <div class="detail-when">${esc(fmtStamp(r.started_at))}${r.duration_sec ? ` · ${esc(fmtDur(r.duration_sec))}` : ''}${r.owner_email !== state.user.email ? ` · ${esc(r.owner_name || r.owner_email)}` : ''}</div>
    <label class="visually-hidden" for="rec-title">${esc(t('titleLabel'))}</label>
    <input id="rec-title" class="title-input" type="text" maxlength="120" value="${esc(r.title || '')}" placeholder="${esc(t('titlePlaceholder'))}">
    <div class="chips" role="group" aria-label="${esc(t('kindLabel'))}">
      ${kinds.map((k) => `<button type="button" class="chip" data-kind="${k}" aria-pressed="${r.kind === k}">${esc(kindLabel(k))}</button>`).join('')}
    </div>
    ${r.kind === 'consult' ? `<label class="consent-row"><input type="checkbox" id="consent" ${r.consent ? 'checked' : ''}> <span>${esc(t('consentDone'))}</span></label>` : ''}
    ${r.status === 'recording' ? `<div class="notice warn">${esc(t('detailStillRecording'))}</div>` : ''}
    <div class="people-row" id="people-row"></div>

    <div class="player">
      <button type="button" class="btn btn-primary" data-act="play-all" ${chunks.length ? '' : 'disabled'}>${ICONS.play}<span>${esc(t('playAll'))}</span></button>
      <span class="player-status" aria-live="polite"></span>
      <audio id="player" preload="none"></audio>
    </div>

    <section class="section summary-sec" id="summary-box"></section>

    <section class="section">
      <div class="section-head"><h2>${esc(t('transcript'))}</h2>
        ${failed ? `<button type="button" class="link-btn" data-act="retry">${esc(t('retryStt', { n: failed }))}</button>` : ''}</div>
      ${doneCount ? `
      <div class="export-bar">
        <button type="button" class="btn" data-exp="copy">${ICONS.copy}<span>${esc(t('expCopy'))}</span></button>
        <button type="button" class="btn" data-exp="file">${ICONS.download}<span>${esc(t('expFile'))}</span></button>
        ${navigator.share ? `<button type="button" class="btn" data-exp="share">${ICONS.share}<span>${esc(t('expShare'))}</span></button>` : ''}
        <label class="exp-opt"><input type="checkbox" id="exp-times"> <span>${esc(t('expTimes'))}</span></label>
      </div>` : ''}
      ${chunks.length ? `<ol class="transcript">${text}</ol>` : `<p class="lead">${esc(t('noChunks'))}</p>`}
    </section>

    <div class="section"><button type="button" class="btn btn-danger btn-block" data-act="delete">${esc(t('deleteRecording'))}</button></div>`;

  const save = async (patch) => {
    try { await api(`/api/recordings/${id}`, { method: 'PATCH', body: patch }); toast(t('saved')); }
    catch (err) { toast(err.message); }
  };
  const titleEl = app.querySelector('#rec-title');
  titleEl.addEventListener('change', () => save({ title: titleEl.value }));
  app.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', async () => { await save({ kind: b.dataset.kind }); pageRecordDetail(id); }));
  const consentEl = app.querySelector('#consent');
  if (consentEl) consentEl.addEventListener('change', () => save({ consent: consentEl.checked }));

  // 다시 듣기: 조각을 차례로 이어서 재생
  const player = app.querySelector('#player');
  const status = app.querySelector('.player-status');
  const seqs = chunks.map((c) => c.seq);
  let idx = -1;
  const mark = (seq) => app.querySelectorAll('.line').forEach((li) => li.classList.toggle('playing', Number(li.dataset.seq) === seq));
  const playAt = (i) => {
    if (i < 0 || i >= seqs.length) { idx = -1; mark(-1); status.textContent = ''; return; }
    idx = i;
    player.src = `/api/recordings/${id}/chunks/${seqs[i]}`;
    player.play().catch(() => {});
    mark(seqs[i]);
    status.textContent = t('playingPart', { n: i + 1, total: seqs.length });
  };
  player.addEventListener('ended', () => playAt(idx + 1));
  app.querySelector('[data-act="play-all"]').addEventListener('click', () => {
    if (idx >= 0 && !player.paused) { player.pause(); status.textContent = t('paused'); return; }
    if (idx >= 0 && player.paused) { player.play(); status.textContent = t('playingPart', { n: idx + 1, total: seqs.length }); return; }
    playAt(0);
  });
  app.querySelectorAll('[data-play]').forEach((b) => b.addEventListener('click', () => playAt(seqs.indexOf(Number(b.dataset.play)))));

  // 내보내기: 복사 / 파일 / 공유
  const buildExport = () => {
    const withTimes = app.querySelector('#exp-times')?.checked;
    const title = titleEl.value.trim() || t('untitled');
    const head = [
      title,
      `${t('expWhen')}: ${fmtStamp(r.started_at)}${r.duration_sec ? ` · ${fmtDur(r.duration_sec)}` : ''}`,
      `${t('expKind')}: ${kindLabel(r.kind)}`,
      `${t('expBy')}: ${r.owner_name || r.owner_email || ''}`,
    ];
    const sm = data.summary && data.summary.status === 'done' ? data.summary : null;
    if (sm) {
      if (sm.summary.length) head.push('', `[${t('sumSummary')}]`, ...sm.summary.map((x) => '- ' + x));
      if (sm.decisions.length) head.push('', `[${t('sumDecisions')}]`, ...sm.decisions.map((x) => '- ' + x));
      if (sm.todos.length) head.push('', `[${t('sumTodos')}]`, ...sm.todos.map((x) => `${x.done ? '[x]' : '[ ]'} ${x.text}`));
      head.push('', `[${t('transcript')}]`);
    }
    const body = chunks.filter((c) => c.status === 'done' && c.text)
      .map((c) => (withTimes ? `[${fmtClock(c.start_ms || 0)}] ` : '') + c.text.trim());
    return { title, text: head.join('\n') + '\n\n' + body.join(withTimes ? '\n' : '\n\n') + '\n' };
  };
  const flash = (btn, msg) => {
    const span = btn.querySelector('span'); const old = span.textContent;
    span.textContent = msg; setTimeout(() => (span.textContent = old), 1600);
  };
  const expBtn = (k) => app.querySelector(`[data-exp="${k}"]`);
  if (expBtn('copy')) expBtn('copy').addEventListener('click', async () => {
    const { text } = buildExport();
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy'); ta.remove();
    }
    flash(expBtn('copy'), t('copied'));
  });
  if (expBtn('file')) expBtn('file').addEventListener('click', () => {
    const { title, text } = buildExport();
    const d = new Date((r.started_at || '').replace(' ', 'T') + 'Z');
    const ymd = isNaN(d) ? '' : `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_`;
    const name = (ymd + title).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) + '.txt';
    const blob = new Blob(['\ufeff' + text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  if (expBtn('share')) expBtn('share').addEventListener('click', async () => {
    const { title, text } = buildExport();
    try { await navigator.share({ title, text }); } catch {}
  });

  const retry = app.querySelector('[data-act="retry"]');
  if (retry) retry.addEventListener('click', async () => {
    retry.disabled = true; retry.textContent = t('retrying');
    try { const res = await api(`/api/recordings/${id}/retry-stt`, { method: 'POST' }); toast(t('retryDone', { n: res.fixed })); }
    catch (err) { toast(err.message); }
    pageRecordDetail(id);
  });
  renderPeople(app.querySelector('#people-row'), id, data.people || []);
  renderSummary(app.querySelector('#summary-box'), id, data, { auto: true });
  app.querySelector('[data-act="delete"]').addEventListener('click', async () => {
    if (!confirm(t('confirmDeleteRecording'))) return;
    try { await api(`/api/recordings/${id}`, { method: 'DELETE' }); toast(t('deleted')); location.hash = '#/records'; }
    catch (err) { toast(err.message); }
  });
}

// ── 녹음하기 ─────────────────────────────────────────────

function beginRecording(kind) {
  if (!recSupported()) return toast(t('recNotSupported'));
  if (kind === 'consult') return consentSheet(() => startRecording(kind, true));
  startRecording(kind, false);
}

function consentSheet(onOk) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <h2 id="sheet-title">${esc(t('consentTitle'))}</h2>
      <p>${esc(t('consentBody'))}</p>
      <label class="consent-row"><input type="checkbox" id="consent-ok"> <span>${esc(t('consentCheck'))}</span></label>
      <div class="row">
        <button type="button" class="btn btn-quiet" data-act="cancel">${esc(t('cancel'))}</button>
        <button type="button" class="btn btn-primary" data-act="ok" disabled>${esc(t('startRecording'))}</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const ok = wrap.querySelector('[data-act="ok"]');
  wrap.querySelector('#consent-ok').addEventListener('change', (e) => { ok.disabled = !e.target.checked; });
  const close = () => wrap.remove();
  wrap.querySelector('[data-act="cancel"]').addEventListener('click', close);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  ok.addEventListener('click', () => { close(); onOk(); });
  wrap.querySelector('#consent-ok').focus();
}

let session = null; // 지금 녹음 중인 것

async function startRecording(kind, consent) {
  const startedAt = new Date();
  // 녹음 번호는 휴대폰이 만든다 → 인터넷이 없어도 바로 시작
  const id = crypto.randomUUID ? crypto.randomUUID() : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
  await putRec({ id, kind, consent: !!consent, startedAt: startedAt.toISOString(), created: false, finished: false, offline: !navigator.onLine });
  askPersist();
  syncer.kick();

  const lines = new Map(); // seq → { startMs, status, text }
  const s = session = { id, kind, startedAt, lines, wakeLock: null, finished: false, saves: [] };

  const renderLines = () => {
    const box = app.querySelector('#live-lines');
    if (!box) return;
    const arr = [...lines.entries()].sort((a, b) => a[0] - b[0]);
    box.innerHTML = arr.length ? arr.map(([, l]) => `
      <li><span class="line-time-static">${fmtClock(l.startMs)}</span>
        <p class="${l.status === 'done' ? '' : 'muted'}">${l.status === 'done' ? esc(l.text) : esc(t(l.status === 'empty' ? 'chunkEmpty' : l.status === 'failed' ? 'chunkFailed' : l.status === 'offline' ? 'chunkOffline' : 'chunkPending'))}</p></li>`).join('')
      : `<li class="live-hint">${esc(t('liveHint'))}</li>`;
    const card = app.querySelector('.live-card');
    if (card) card.scrollTop = card.scrollHeight;
  };
  s.renderLines = renderLines;
  s.renderUpload = (st) => {
    const el = app.querySelector('#upload-state');
    if (!el) return;
    const mine = (st.list || []).find((r) => r.id === id);
    const offline = !navigator.onLine || st.error === 'offline';
    el.classList.toggle('is-offline', offline);
    el.textContent = offline ? t('offlineSaving') : (mine && st.chunks ? t('uploading', { n: st.chunks }) : '');
  };

  const rec = s.rec = new ChunkRecorder({
    chunkMs: 20000,
    onChunk: (c) => {
      lines.set(c.seq, { startMs: c.startMs, status: navigator.onLine ? 'pending' : 'offline', text: '' });
      renderLines();
      // 먼저 휴대폰에 저장 → 올리기는 싱크가 알아서
      const p = saveChunk({ recId: id, seq: c.seq, blob: c.blob, type: c.type, startMs: c.startMs, endMs: c.endMs })
        .then(() => { if (!navigator.onLine) patchRec(id, { offline: true }); syncer.kick(); })
        .catch(() => toast(t('saveFailed')));
      s.saves.push(p);
    },
    onLevel: (level) => {
      const bars = app.querySelectorAll('.meter i');
      bars.forEach((b, i) => {
        const shape = 0.35 + 0.65 * Math.abs(Math.sin((i + 1) * 1.7 + performance.now() / 260));
        b.style.transform = `scaleY(${Math.max(0.12, level * shape)})`;
      });
    },
    onState: (st) => {
      const pauseBtn = app.querySelector('[data-act="pause"]');
      if (pauseBtn) {
        pauseBtn.innerHTML = st === 'paused' ? ICONS.play : ICONS.pause;
        pauseBtn.setAttribute('aria-label', t(st === 'paused' ? 'resume' : 'pause'));
      }
      const label = app.querySelector('#rec-state');
      if (label) label.textContent = st === 'paused' ? t('pausedLabel') : t('recordingLabel', { kind: kind === 'unassigned' ? '' : kindLabel(kind) + ' ' });
      app.querySelector('.rec-screen')?.classList.toggle('is-paused', st === 'paused');
    },
  });

  app.innerHTML = `
    <div class="rec-screen">
      <div class="rec-top">
        <div class="rec-state"><span class="live-dot"></span><span id="rec-state">${esc(t('recordingLabel', { kind: kind === 'unassigned' ? '' : kindLabel(kind) + ' ' }))}</span></div>
        <span class="rec-keep">${esc(t('keepScreenOn'))}</span>
      </div>
      <div class="rec-center">
        <div class="rec-date">${esc(t('startedAt', { when: fmtStamp(startedAt) }))}</div>
        <div class="rec-clock" id="clock">00:00</div>
        <div class="kind-pill">${esc(kindLabel(kind))}</div>
        <div class="meter" aria-hidden="true">${'<i></i>'.repeat(15)}</div>
      </div>
      <div class="live-card">
        <div class="live-head"><span>${esc(t('liveTitle'))}</span><span id="upload-state"></span></div>
        <ol class="live-lines" id="live-lines"><li class="live-hint">${esc(t('liveHint'))}</li></ol>
      </div>
      <div class="rec-controls">
        <button type="button" class="round-btn" data-act="pause" aria-label="${esc(t('pause'))}">${ICONS.pause}</button>
        <button type="button" class="stop-btn" data-act="stop">${ICONS.stop}<span>${esc(t('stopAndSave'))}</span></button>
      </div>
    </div>`;

  try {
    await rec.start();
    s.renderUpload(syncStats);
  } catch (err) {
    session = null;
    await deleteRec(id).catch(() => {});
    api(`/api/recordings/${id}`, { method: 'DELETE' }).catch(() => {});
    toast(err && err.name === 'NotAllowedError' ? t('micDenied') : t('micError'));
    return render();
  }

  // 화면 꺼짐 방지
  const lock = async () => {
    try { if ('wakeLock' in navigator && document.visibilityState === 'visible') s.wakeLock = await navigator.wakeLock.request('screen'); } catch {}
  };
  lock();
  s.onVis = () => { if (document.visibilityState === 'visible' && !s.finished) lock(); };
  document.addEventListener('visibilitychange', s.onVis);
  s.onUnload = (e) => { if (!s.finished) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', s.onUnload);

  const clock = app.querySelector('#clock');
  s.clockTimer = setInterval(() => { clock.textContent = fmtClock(rec.elapsedMs()); }, 250);

  app.querySelector('[data-act="pause"]').addEventListener('click', () => (rec.state === 'paused' ? rec.resume() : rec.pause()));
  app.querySelector('[data-act="stop"]').addEventListener('click', (e) => finishRecording(e.currentTarget));
}

async function finishRecording(btn) {
  const s = session;
  if (!s || s.finished) return;
  btn.disabled = true;
  btn.querySelector('span').textContent = t('finishing');
  await s.rec.stop();
  clearInterval(s.clockTimer);
  await Promise.allSettled(s.saves);
  const durationSec = s.rec.elapsedMs() / 1000;
  await patchRec(s.id, { finished: true, durationSec });
  s.finished = true;
  try { s.wakeLock && s.wakeLock.release(); } catch {}
  document.removeEventListener('visibilitychange', s.onVis);
  window.removeEventListener('beforeunload', s.onUnload);
  // 인터넷이 되면 다 올라갈 때까지 잠깐 기다렸다가 기록으로, 안 되면 휴대폰에 두고 홈으로
  syncer.kick();
  const uploaded = navigator.onLine ? await syncer.waitFor(s.id, 90000) : false;
  session = null;
  if (uploaded) {
    location.hash = `#/r/${s.id}`;
  } else {
    await patchRec(s.id, { offline: true });
    toast(t('savedOnPhone'));
    location.hash = '#/';
  }
  render();
  syncer.report();
}


// ── 관리: 기록 분석 (파트 7) + 내보내기 (파트 8) ──────────────
let insightDays = 30;
async function pageInsights() {
  app.innerHTML = shell('admin:insights', `<h2 class="page-title">${esc(t('adminInsights'))}</h2><p class="lead">${esc(t('loading'))}</p>`);
  bindCommon();
  let d;
  try { d = await api(`/api/admin/insights?days=${insightDays}`); } catch (err) { return handleError(err); }
  const kinds = ['consult', 'meeting', 'memo', 'unassigned'];
  const maxT = Math.max(1, ...d.teachers.map((x) => x.count));
  app.querySelector('main').innerHTML = `
    <div class="page-head wide">
      <div><h2 class="page-title">${esc(t('adminInsights'))}</h2><p class="lead">${esc(t('insightsLead'))}</p></div>
      <div class="chips" role="group" aria-label="${esc(t('period'))}">
        ${[7, 30, 90].map((n) => `<button type="button" class="chip" data-days="${n}" aria-pressed="${insightDays === n}">${esc(t('lastDays', { n }))}</button>`).join('')}
      </div>
    </div>
    <div class="stat-row">
      <div class="stat"><b>${d.total}</b><span>${esc(t('statRecords'))}</span></div>
      <div class="stat"><b>${d.minutes}</b><span>${esc(t('statMinutes'))}</span></div>
      ${kinds.map((k) => `<div class="stat"><b>${d.byKind[k] || 0}</b><span>${esc(kindLabel(k))}</span></div>`).join('')}
    </div>
    <div class="grid-2">
      <section class="panel">
        <h2>${esc(t('byTeacher'))}</h2>
        ${d.teachers.length ? `<ul class="bars">${d.teachers.map((x) => `<li><span class="bar-name">${esc(x.name)}</span>
          <span class="bar"><i style="width:${Math.round((x.count / maxT) * 100)}%"></i></span><span class="bar-n">${x.count}${esc(t('countUnit'))} · ${x.minutes}${esc(t('minUnit'))}</span></li>`).join('')}</ul>` : `<p class="desc">${esc(t('noData'))}</p>`}
      </section>
      <section class="panel">
        <h2>${esc(t('topTags'))}</h2>
        ${d.tags.length ? `<div class="tag-row">${d.tags.map((x) => `<a class="tag-chip" href="#/records" data-goto-tag="${esc(x.name)}">#${esc(x.name)} <small>${x.n}</small></a>`).join('')}</div>` : `<p class="desc">${esc(t('noData'))}</p>`}
      </section>
    </div>
    <section class="panel">
      <h2>${esc(t('openTodos'))} <span class="count-chip">${d.openTodos.length}</span></h2>
      ${d.openTodos.length ? `<ul class="todo-admin">${d.openTodos.map((x) => `<li><a href="#/r/${esc(x.id)}"><span class="todo-text">${esc(x.text)}</span>
        <small>${esc(x.title)} · ${esc(x.owner)} · ${esc(fmtStamp(x.at, { time: false }))}</small></a></li>`).join('')}</ul>` : `<p class="desc">${esc(t('noOpenTodos'))}</p>`}
    </section>
    <section class="panel ai-panel">
      <div class="section-head"><h2>${ICONS.spark}${esc(t('aiAnalysis'))}</h2>
        ${d.latest ? `<small class="desc">${esc(t('analysisAt', { when: fmtStamp(d.latest.created_at), n: d.latest.record_count, days: d.latest.days }))}</small>` : ''}</div>
      ${d.unsummarized ? `<div class="notice warn">${esc(t('unsummarizedNote', { n: d.unsummarized }))}
        <button type="button" class="btn btn-quiet btn-small" data-act="sum-all">${esc(t('sumAll'))}</button><span class="sum-all-prog"></span></div>` : ''}
      <div id="analysis">${d.latest && d.latest.body ? analysisHtml(d.latest.body) : `<p class="desc">${esc(t('analysisNone'))}</p>`}</div>
      <button type="button" class="btn btn-primary" data-act="analyze">${ICONS.spark}<span>${esc(t('analysisRun', { n: insightDays }))}</span></button>
    </section>
    <section class="panel">
      <h2>${esc(t('exportTitle'))}</h2>
      <p class="desc">${esc(t('exportDesc'))}</p>
      <label class="check-row"><input type="checkbox" id="exp-text" checked> <span>${esc(t('exportWithText'))}</span></label>
      <label class="check-row"><input type="checkbox" id="exp-mark"> <span>${esc(t('exportMark'))}</span></label>
      <a class="btn btn-quiet" id="exp-link" href="#">${ICONS.download}<span>${esc(t('exportButton', { n: insightDays }))}</span></a>
    </section>`;
  app.querySelectorAll('[data-days]').forEach((b) => b.addEventListener('click', () => { insightDays = Number(b.dataset.days); pageInsights(); }));
  app.querySelectorAll('[data-goto-tag]').forEach((a) => a.addEventListener('click', () => { recordsTag = a.dataset.gotoTag; recordsFilter = ''; recordsQuery = ''; recordsContact = null; }));
  const expLink = app.querySelector('#exp-link');
  const syncExp = () => { expLink.href = `/api/admin/export.csv?days=${insightDays}&text=${app.querySelector('#exp-text').checked ? 1 : 0}&mark=${app.querySelector('#exp-mark').checked ? 1 : 0}`; };
  app.querySelectorAll('#exp-text, #exp-mark').forEach((x) => x.addEventListener('change', syncExp)); syncExp();
  const sumAll = app.querySelector('[data-act="sum-all"]');
  if (sumAll) sumAll.addEventListener('click', async () => {
    sumAll.disabled = true;
    const prog = app.querySelector('.sum-all-prog');
    try {
      const { ids } = await api(`/api/admin/unsummarized?days=${insightDays}`);
      for (let i = 0; i < ids.length; i++) {
        prog.textContent = ' ' + t('progress', { n: i + 1, total: ids.length });
        try { await api(`/api/recordings/${ids[i]}/summarize`, { method: 'POST', body: {} }); } catch {}
      }
    } catch (err) { toast(err.message); }
    pageInsights();
  });
  app.querySelector('[data-act="analyze"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    const box = app.querySelector('#analysis');
    box.innerHTML = `<div class="sum-card sum-working"><img src="/jina/think.png" alt=""><div><b>${esc(t('analyzing'))}</b><p>${esc(t('analyzingBody'))}</p></div></div>`;
    try { const { insight } = await api('/api/admin/insights', { method: 'POST', body: { days: insightDays } }); box.innerHTML = analysisHtml(insight.body); }
    catch (err) { box.innerHTML = `<div class="notice error">${esc(err.message)}</div>`; }
    btn.disabled = false;
  });
}

function analysisHtml(b) {
  const sec = (title, inner) => inner ? `<h3>${esc(title)}</h3>${inner}` : '';
  const ul = (arr, fn) => arr && arr.length ? `<ul class="sum-list">${arr.map(fn).join('')}</ul>` : '';
  return `<div class="analysis">
    ${b.overview ? `<p class="overview">${esc(b.overview)}</p>` : ''}
    ${sec(t('anThemes'), ul(b.themes, (x) => `<li><b>${esc(x.title)}</b> — ${esc(x.detail)}</li>`))}
    ${sec(t('anWatch'), ul(b.watch, (x) => `<li><b>${esc(x.who)}</b> — ${esc(x.detail)}</li>`))}
    ${sec(t('anFollowups'), ul(b.followups, (x) => `<li>${esc(x)}</li>`))}
    ${sec(t('anStaff'), ul(b.staff, (x) => `<li><b>${esc(x.name)}</b> — ${esc(x.note)}</li>`))}
    ${sec(t('anSuggestions'), ul(b.suggestions, (x) => `<li>${esc(x)}</li>`))}
    <p class="sum-foot">${esc(t('anNote'))}</p></div>`;
}

// ── 관리: 원아·학부모 (파트 3) ───────────────────────────────
let contactsQuery = '';
async function pageContacts() {
  app.innerHTML = shell('admin:contacts', `<h2 class="page-title">${esc(t('adminContacts'))}</h2><p class="lead">${esc(t('loading'))}</p>`);
  bindCommon();
  let contacts;
  try { ({ contacts } = await api('/api/contacts' + (contactsQuery ? '?q=' + encodeURIComponent(contactsQuery) : ''))); } catch (err) { return handleError(err); }
  const kindName = (k) => t({ child: 'ckChild', parent: 'ckParent', staff: 'ckStaff', customer: 'ckCustomer', other: 'ckOther' }[k] || 'ckOther');
  const children = contacts.filter((c) => c.kind === 'child');
  const childOpts = (sel) => `<option value="">${esc(t('noChildLink'))}</option>` + children.map((c) => `<option value="${esc(c.id)}" ${sel === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  app.querySelector('main').innerHTML = `
    <h2 class="page-title">${esc(t('adminContacts'))}</h2>
    <p class="lead">${esc(t('contactsLead'))}</p>
    <form class="search" id="c-search" role="search">${ICONS.search}
      <input type="search" name="q" value="${esc(contactsQuery)}" placeholder="${esc(t('searchName'))}">
      <button type="submit" class="btn btn-primary btn-small">${esc(t('searchButton'))}</button></form>
    ${contacts.length ? `<ul class="contact-list">${contacts.map((c) => `
      <li class="contact-item">
        <span class="avatar" aria-hidden="true">${esc(c.name.charAt(0))}</span>
        <div class="contact-main"><b>${esc(c.name)}</b> <span class="kind-mini">${esc(kindName(c.kind))}${c.relation ? ' · ' + esc(c.relation) : ''}</span>
          <small>${[c.child_name ? t('childOf', { name: c.child_name }) : '', c.phone, c.email].filter(Boolean).map(esc).join(' · ')}</small>
          ${c.note ? `<small class="muted">${esc(c.note)}</small>` : ''}</div>
        <div class="contact-actions">
          ${c.record_count ? `<button type="button" class="btn btn-quiet btn-small" data-records="${esc(c.id)}" data-name="${esc(c.name)}">${esc(t('recordsN', { n: c.record_count }))}</button>` : ''}
          <button type="button" class="btn btn-quiet btn-small" data-edit="${esc(c.id)}">${esc(t('editInfo'))}</button>
        </div>
      </li>`).join('')}</ul>` : `<p class="desc">${esc(t('noContacts'))}</p>`}
    <form class="panel" id="c-add">
      <h2>${esc(t('addContact'))}</h2>
      <div class="row">
        <label class="field shrink"><span>${esc(t('ckKind'))}</span><select name="kind">
          ${['child', 'parent', 'staff', 'customer', 'other'].map((k) => `<option value="${k}">${esc(kindName(k))}</option>`).join('')}</select></label>
        <label class="field"><span>${esc(t('ckName'))}</span><input name="name" type="text" maxlength="60" required></label>
      </div>
      <div class="row">
        <label class="field"><span>${esc(t('ckRelation'))}</span><input name="relation" type="text" maxlength="30" placeholder="${esc(t('ckRelationPh'))}"></label>
        <label class="field"><span>${esc(t('ckChildLink'))}</span><select name="related_child_id">${childOpts('')}</select></label>
      </div>
      <div class="row">
        <label class="field"><span>${esc(t('phone'))}</span><input name="phone" type="tel" maxlength="30"></label>
        <label class="field"><span>${esc(t('emailLabel'))}</span><input name="email" type="email" maxlength="120"></label>
      </div>
      <label class="field"><span>${esc(t('ckNote'))}</span><input name="note" type="text" maxlength="500" placeholder="${esc(t('ckNotePh'))}"></label>
      <button class="btn btn-primary" type="submit">${esc(t('add'))}</button>
    </form>`;
  app.querySelector('#c-search').addEventListener('submit', (e) => { e.preventDefault(); contactsQuery = e.target.q.value.trim(); pageContacts(); });
  app.querySelector('#c-add').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/api/contacts', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast(t('saved')); pageContacts(); }
    catch (err) { toast(err.message); }
  });
  app.querySelectorAll('[data-records]').forEach((b) => b.addEventListener('click', () => {
    recordsContact = { id: b.dataset.records, name: b.dataset.name }; recordsFilter = ''; recordsQuery = ''; recordsTag = '';
    location.hash = '#/records';
  }));
  app.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
    const c = contacts.find((x) => x.id === b.dataset.edit);
    const wrap = document.createElement('div');
    wrap.className = 'sheet-wrap';
    wrap.innerHTML = `<form class="sheet" role="dialog" aria-modal="true" aria-label="${esc(c.name)}">
      <h2>${esc(c.name)}</h2>
      <div class="row"><label class="field shrink"><span>${esc(t('ckKind'))}</span><select name="kind">
        ${['child', 'parent', 'staff', 'customer', 'other'].map((k) => `<option value="${k}" ${c.kind === k ? 'selected' : ''}>${esc(kindName(k))}</option>`).join('')}</select></label>
        <label class="field"><span>${esc(t('ckName'))}</span><input name="name" type="text" value="${esc(c.name)}" required></label></div>
      <div class="row"><label class="field"><span>${esc(t('ckRelation'))}</span><input name="relation" type="text" value="${esc(c.relation || '')}"></label>
        <label class="field"><span>${esc(t('ckChildLink'))}</span><select name="related_child_id">${childOpts(c.related_child_id)}</select></label></div>
      <div class="row"><label class="field"><span>${esc(t('phone'))}</span><input name="phone" type="tel" value="${esc(c.phone || '')}"></label>
        <label class="field"><span>${esc(t('emailLabel'))}</span><input name="email" type="email" value="${esc(c.email || '')}"></label></div>
      <label class="field"><span>${esc(t('ckNote'))}</span><input name="note" type="text" value="${esc(c.note || '')}"></label>
      <div class="row"><button type="button" class="btn btn-danger shrink" data-act="del">${esc(t('delete'))}</button>
        <button type="button" class="btn btn-quiet" data-act="cancel">${esc(t('cancel'))}</button>
        <button type="submit" class="btn btn-primary">${esc(t('save'))}</button></div></form>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.querySelector('[data-act="cancel"]').addEventListener('click', close);
    wrap.querySelector('[data-act="del"]').addEventListener('click', async () => {
      if (!confirm(t('confirmDeleteContact', { name: c.name }))) return;
      try { await api(`/api/contacts/${c.id}`, { method: 'DELETE' }); close(); pageContacts(); } catch (err) { toast(err.message); }
    });
    wrap.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api(`/api/contacts/${c.id}`, { method: 'PATCH', body: Object.fromEntries(new FormData(e.target)) }); close(); toast(t('saved')); pageContacts(); }
      catch (err) { toast(err.message); }
    });
  }));
}

// ── 관리: 메일 템플릿 ─────────────────────────────────────

async function pageMailTemplates() {
  app.innerHTML = shell('admin:mail', `<h2 class="page-title">${esc(t('adminMail'))}</h2><p class="lead">${esc(t('loading'))}</p>`);
  bindCommon();
  let data;
  try { data = await api('/api/admin/mail-templates'); } catch (err) { return handleError(err); }
  app.querySelector('main').innerHTML = `
    <h2 class="page-title">${esc(t('adminMail'))}</h2>
    <p class="lead">${esc(t('mailTplLead'))}</p>
    <ul class="tpl-list">
      ${data.templates.map((tp) => `
        <li><a class="tpl-item" href="#/admin/mail/${tp.key}">
          <span class="tpl-icon">${ICONS.mail}</span>
          <span class="tpl-text"><b>${esc(tp.label)}</b><small>${esc(tp.about)}</small>
            <em>${esc(tp.fields.subject)}</em></span>
          ${tp.customized ? `<span class="tpl-badge">${esc(t('mailTplCustom'))}</span>` : ''}
        </a></li>`).join('')}
    </ul>
    <p class="lead" style="margin-top:16px;font-size:14px">${esc(t('mailTplLater'))}</p>`;
}

async function pageMailEdit(key) {
  app.innerHTML = shell('admin:mail', `<p class="lead">${esc(t('loading'))}</p>`);
  bindCommon();
  let data;
  try { data = await api('/api/admin/mail-templates'); } catch (err) { return handleError(err); }
  const tp = data.templates.find((x) => x.key === key);
  if (!tp) { location.hash = '#/admin/mail'; return; }
  const f = tp.fields;
  const field = (name, label, val, opts = {}) => `
    <label class="field"><span>${esc(label)}</span>
      ${opts.area
        ? `<textarea name="${name}" rows="${opts.rows || 5}" maxlength="2000">${esc(val)}</textarea>`
        : `<input type="text" name="${name}" value="${esc(val)}" maxlength="200" placeholder="${esc(opts.ph || '')}">`}
      ${opts.help ? `<small>${esc(opts.help)}</small>` : ''}</label>`;

  app.querySelector('main').innerHTML = `
    <a href="#/admin/mail" class="back-link">${ICONS.back}${esc(t('adminMail'))}</a>
    <h2 class="page-title">${esc(tp.label)}</h2>
    <p class="lead">${esc(tp.about)}</p>
    <div class="tpl-edit wide">
      <form class="panel tpl-form" id="tpl-form" novalidate>
        <div class="tpl-vars">
          <span>${esc(t('mailTplVars'))}</span>
          ${tp.vars.map((v) => `<button type="button" class="chip" data-var="${esc(v)}">{{${esc(v)}}}</button>`).join('')}
        </div>
        ${field('subject', t('mailTplSubject'), f.subject)}
        ${field('heading', t('mailTplHeading'), f.heading)}
        ${field('body', t('mailTplBody'), f.body, { area: true, rows: 6, help: t('mailTplBodyHelp') })}
        ${tp.hasButton ? field('button', t('mailTplButton'), f.button, { help: t('mailTplButtonHelp') }) : ''}
        ${field('footer', t('mailTplFooter'), f.footer, { area: true, rows: 2 })}
        <div class="tpl-actions">
          <button type="submit" class="btn btn-primary">${esc(t('save'))}</button>
          <button type="button" class="btn btn-quiet" data-act="test">${esc(t('mailTplTest'))}</button>
          ${tp.customized ? `<button type="button" class="link-btn" data-act="reset">${esc(t('mailTplReset'))}</button>` : ''}
        </div>
      </form>
      <section class="tpl-preview" aria-label="${esc(t('mailTplPreview'))}">
        <div class="tpl-preview-head"><span>${esc(t('mailTplPreview'))}</span><b data-subject></b></div>
        <iframe title="${esc(t('mailTplPreview'))}" sandbox="allow-same-origin" data-frame></iframe>
      </section>
    </div>`;

  const form = app.querySelector('#tpl-form');
  const frame = app.querySelector('[data-frame]');
  const subjEl = app.querySelector('[data-subject]');
  const values = () => Object.fromEntries(new FormData(form));
  let lastFocus = form.querySelector('[name="body"]');
  form.querySelectorAll('input, textarea').forEach((el) => el.addEventListener('focus', () => (lastFocus = el)));

  let timer = null; let seq = 0;
  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const my = ++seq;
      try {
        const out = await api(`/api/admin/mail-templates/${key}/preview`, { method: 'POST', body: values() });
        if (my !== seq) return;
        frame.srcdoc = out.html;
        subjEl.textContent = out.subject;
      } catch (err) { toast(err.message); }
    }, 350);
  };
  frame.addEventListener('load', () => {
    try { frame.style.height = Math.max(420, frame.contentDocument.body.scrollHeight + 8) + 'px'; } catch {}
  });
  form.addEventListener('input', refresh);
  refresh();

  app.querySelectorAll('[data-var]').forEach((b) => b.addEventListener('click', () => {
    const el = lastFocus; const ins = `{{${b.dataset.var}}}`;
    const a = el.selectionStart ?? el.value.length; const z = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, a) + ins + el.value.slice(z);
    el.focus(); el.setSelectionRange(a + ins.length, a + ins.length);
    refresh();
  }));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]'); btn.disabled = true;
    try { await api(`/api/admin/mail-templates/${key}`, { method: 'PUT', body: values() }); toast(t('saved')); pageMailEdit(key); }
    catch (err) { toast(err.message); btn.disabled = false; }
  });
  app.querySelector('[data-act="test"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try { const r = await api(`/api/admin/mail-templates/${key}/test`, { method: 'POST', body: values() }); toast(t('mailTplSent', { to: r.to })); }
    catch (err) { toast(err.message); }
    btn.disabled = false;
  });
  const reset = app.querySelector('[data-act="reset"]');
  if (reset) reset.addEventListener('click', async () => {
    if (!confirm(t('mailTplResetConfirm'))) return;
    try { await api(`/api/admin/mail-templates/${key}`, { method: 'DELETE' }); toast(t('mailTplResetDone')); pageMailEdit(key); }
    catch (err) { toast(err.message); }
  });
}

// ── 관리: 사용자 ──────────────────────────────────────────

function adminTabs(active) {
  return `<nav class="subtabs">
    <a href="#/admin/users" ${active === 'users' ? 'aria-current="page"' : ''}>${esc(t('adminUsers'))}</a>
    <a href="#/admin/mail" ${active === 'mail' ? 'aria-current="page"' : ''}>${esc(t('adminMail'))}</a>
    <a href="#/admin/settings" ${active === 'settings' ? 'aria-current="page"' : ''}>${esc(t('adminSettings'))}</a>
  </nav>`;
}

async function pageUsers() {
  app.innerHTML = shell('admin:users', `<h2 class="page-title">${esc(t('adminUsers'))}</h2><p class="lead">${esc(t('loading'))}</p>`);
  bindCommon();
  let users, requests = [];
  try {
    [{ users }, { requests }] = await Promise.all([api('/api/admin/users'), api('/api/admin/signups')]);
  } catch (err) { return handleError(err); }

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
        ${enName(u) ? `<div class="user-en">${esc(enName(u))}</div>` : ''}
        ${u.position || u.phone ? `<div class="user-meta">${[u.position, u.phone].filter(Boolean).map(esc).join(' · ')}</div>` : ''}
        <div class="user-mail">${esc(u.email)}</div>
        <div class="user-meta">${meta}</div>
        ${u.id === me ? `<div class="user-actions"><button class="btn btn-quiet btn-small" data-act="edit">${esc(t('editInfo'))}</button></div>` : `<div class="user-actions">
          <button class="btn btn-quiet btn-small" data-act="edit">${esc(t('editInfo'))}</button>
          <button class="btn btn-quiet btn-small" data-act="role" data-role="${u.role === 'admin' ? 'teacher' : 'admin'}">${esc(u.role === 'admin' ? t('makeTeacher') : t('makeAdmin'))}</button>
          <button class="btn btn-quiet btn-small" data-act="active" data-active="${off ? 1 : 0}">${esc(off ? t('turnOn') : t('turnOff'))}</button>
          <button class="btn btn-danger btn-small" data-act="remove">${esc(t('remove'))}</button>
        </div>`}
      </div>
    </li>`;
  };

  app.querySelector('main').innerHTML = `
    <div class="page-head">
      <div><h2 class="page-title">${esc(t('adminUsers'))}</h2><p class="lead">${esc(t('usersBody'))}</p></div>
      <img src="/jina/present.png" alt="${esc(t('jinaPresentAlt'))}">
    </div>
    ${requests.length ? `<section class="panel signup-panel">
      <h2>${esc(t('signupRequests', { n: requests.length }))}</h2>
      <ul class="user-list">${requests.map((q) => `<li class="user-item" data-req="${esc(q.id)}">
        <span class="avatar" aria-hidden="true">${esc((q.name || '?').charAt(0))}</span>
        <div><div class="user-name">${esc(q.name)}</div>${enName(q) ? `<div class="user-en">${esc(enName(q))}</div>` : ''}
          ${q.position || q.phone ? `<div class="user-meta">${[q.position, q.phone].filter(Boolean).map(esc).join(' · ')}</div>` : ''}
          <div class="user-mail">${esc(q.email)}</div>
          <div class="user-meta">${esc(fmtStamp(q.created_at))}${q.note ? ` · ${esc(q.note)}` : ''}</div>
          <div class="user-actions">
            <button class="btn btn-primary btn-small" data-decide="1">${esc(t('approve'))}</button>
            <button class="btn btn-quiet btn-small" data-decide="0">${esc(t('reject'))}</button>
          </div></div></li>`).join('')}</ul>
    </section>` : ''}

    <section class="section"><div class="panel"><ul class="user-list">${users.map(item).join('')}</ul></div></section>
    <section class="section">
    <form class="panel" id="add-user" novalidate>
      <h2>${esc(t('addUser'))}</h2>
      ${profileFields()}
      <div class="row">
        <label class="field"><span>${esc(t('email'))}</span><input name="email" type="email" inputmode="email" autocomplete="off" required placeholder="name@example.com"></label>
        <label class="field shrink" style="width:8.5em"><span>${esc(t('role'))}</span>
          <select name="role"><option value="teacher">${esc(t('roleTeacher'))}</option><option value="admin">${esc(t('roleAdmin'))}</option></select></label>
      </div>
      <label class="field"><span>${esc(t('passwordOptional'))}</span>
        <input name="password" type="password" autocomplete="new-password" minlength="8" placeholder="${esc(t('setNewPasswordPh'))}">
        <small>${esc(t('addUserPasswordHelp'))}</small></label>
      <div id="add-error"></div>
      <button class="btn btn-primary" type="submit">${esc(t('add'))}</button>
    </form>
    </section>`;

  app.querySelectorAll('[data-decide]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.closest('[data-req]').dataset.req;
    try {
      const r = await api(`/api/admin/signups/${id}`, { method: 'POST', body: { approve: b.dataset.decide === '1' } });
      toast(r.approved ? t('approved') : t('rejected'));
      pageUsers();
    } catch (err) { toast(err.message); }
  }));

  const form = app.querySelector('#add-user');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    if (!data.password) delete data.password;
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
      if (b.dataset.act === 'edit') {
        return editUserSheet(users.find((x) => x.id === id), () => pageUsers());
      } else if (b.dataset.act === 'role') {
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
  app.innerHTML = shell('admin:settings', `<h2 class="page-title">${esc(t('adminSettings'))}</h2><p class="lead">${esc(t('loading'))}</p>`);
  bindCommon();
  let data;
  try { data = await api('/api/admin/settings'); }
  catch (err) { return handleError(err); }
  const s = data.settings;

  const provSelect = (name) => `<select name="${name}">${[['cf', 'Cloudflare AI'], ['anthropic', 'Claude'], ['openai', t('aiOther')]]
    .map(([v, l]) => `<option value="${v}" ${(s[name].value || 'cf') === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const later = (title, desc, part) => `
    <div class="panel is-later"><h2>${esc(title)}<span class="later-chip">${t('comingInPart', { n: part })}</span></h2>
    <p class="desc">${esc(desc)}</p></div>`;

  app.querySelector('main').innerHTML = `
    <h2 class="page-title">${esc(t('adminSettings'))}</h2>
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


    <form class="panel" data-section="ai">
      <h2>${ICONS.spark}${esc(t('secAI'))}</h2>
      <p class="desc">${esc(t('aiDesc'))}</p>
      <div class="row ai-pick">
        <label class="field"><span>${esc(t('aiForSummary'))}</span>${provSelect('ai.summary_provider')}</label>
        <label class="field"><span>${esc(t('aiForAnalysis'))}</span>${provSelect('ai.analysis_provider')}</label>
      </div>
      <label class="check-row"><input type="hidden" name="ai.auto_summary" value="0"><input type="checkbox" name="ai.auto_summary" value="1" ${s['ai.auto_summary'].value !== '0' ? 'checked' : ''}> <span>${esc(t('aiAuto'))}</span></label>

      <details class="ai-box" ${['ai.summary_provider', 'ai.analysis_provider'].some((k) => (s[k].value || 'cf') === 'cf') ? 'open' : ''}>
        <summary><b>Cloudflare AI</b> · ${esc(t('aiCfShort'))}</summary>
        <label class="field"><span>${esc(t('aiModel'))}</span>
          <input name="ai.cf_model" type="text" list="cf-models" spellcheck="false" placeholder="@cf/meta/llama-3.3-70b-instruct-fp8-fast" value="${esc(s['ai.cf_model'].value)}">
          <small>${esc(t('aiCfHelp'))}</small></label>
        <datalist id="cf-models">
          <option value="@cf/meta/llama-3.3-70b-instruct-fp8-fast"><option value="@cf/qwen/qwen3-30b-a3b-fp8">
          <option value="@cf/meta/llama-4-scout-17b-16e-instruct"><option value="@cf/mistralai/mistral-small-3.1-24b-instruct">
        </datalist>
      </details>
      <details class="ai-box" ${['ai.summary_provider', 'ai.analysis_provider'].some((k) => s[k].value === 'anthropic') ? 'open' : ''}>
        <summary><b>Claude</b> · ${esc(t('aiClaudeShort'))}</summary>
        <ol class="steps">${t('aiClaudeSteps').map((x) => `<li>${x}</li>`).join('')}</ol>
        <label class="field"><span>${esc(t('aiKey'))}</span>
          <input name="ai.anthropic_key" type="password" autocomplete="off" spellcheck="false" placeholder="${esc(s['ai.anthropic_key'].set ? t('secretPlaceholder') : 'sk-ant-...')}">
          ${s['ai.anthropic_key'].set ? `<small>${t('secretSet', { hint: s['ai.anthropic_key'].hint })}</small>` : ''}</label>
        <label class="field"><span>${esc(t('aiModel'))}</span>
          <select name="ai.anthropic_model">
            ${[['claude-haiku-5-5', t('aiHaiku')], ['claude-sonnet-5-5', t('aiSonnet')], ['claude-opus-5-5', t('aiOpus')]].map(([v, l]) => `<option value="${v}" ${(s['ai.anthropic_model'].value || 'claude-haiku-5-5') === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}
          </select></label>
      </details>
      <details class="ai-box" ${['ai.summary_provider', 'ai.analysis_provider'].some((k) => s[k].value === 'openai') ? 'open' : ''}>
        <summary><b>${esc(t('aiOther'))}</b> · Qwen · OpenAI · DeepSeek</summary>
        <p class="desc">${t('aiOtherHelp')}</p>
        <label class="field"><span>${esc(t('aiBase'))}</span>
          <input name="ai.openai_base" type="url" spellcheck="false" placeholder="https://dashscope-intl.aliyuncs.com/compatible-mode/v1" value="${esc(s['ai.openai_base'].value)}"></label>
        <label class="field"><span>${esc(t('aiKey'))}</span>
          <input name="ai.openai_key" type="password" autocomplete="off" spellcheck="false" placeholder="${esc(s['ai.openai_key'].set ? t('secretPlaceholder') : 'sk-...')}">
          ${s['ai.openai_key'].set ? `<small>${t('secretSet', { hint: s['ai.openai_key'].hint })}</small>` : ''}</label>
        <label class="field"><span>${esc(t('aiModel'))}</span>
          <input name="ai.openai_model" type="text" spellcheck="false" placeholder="qwen-plus" value="${esc(s['ai.openai_model'].value)}"></label>
      </details>
      <div class="test-result"></div>
      <div class="row" style="flex-wrap:wrap">
        <button class="btn btn-primary shrink" type="submit">${esc(t('save'))}</button>
        <button class="btn btn-quiet shrink" type="button" data-act="test-ai" data-job="summary">${esc(t('aiTestSummary'))}</button>
        <button class="btn btn-quiet shrink" type="button" data-act="test-ai" data-job="analysis">${esc(t('aiTestAnalysis'))}</button>
      </div>
    </form>
    <form class="panel" data-section="email">
      <h2>${esc(t('secEmail'))}</h2>
      <p class="desc">${esc(t('secEmailDesc2'))}</p>
      <fieldset class="seg-field">
        <legend>${esc(t('mailProvider'))}</legend>
        <label class="radio"><input type="radio" name="email.provider" value="gmail" ${(s['email.provider'].value || 'gmail') === 'gmail' ? 'checked' : ''}> <span><b>Gmail</b> · ${esc(t('mailGmailShort'))}</span></label>
        <label class="radio"><input type="radio" name="email.provider" value="resend" ${s['email.provider'].value === 'resend' ? 'checked' : ''}> <span><b>Resend</b> · ${esc(t('mailResendShort'))}</span></label>
      </fieldset>
      <div class="provider-box" data-for="gmail">
        <ol class="steps">${t('gmailSteps').map((x) => `<li>${x}</li>`).join('')}</ol>
        <p><a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">${esc(t('openAppPasswords'))}</a></p>
        <label class="field"><span>${esc(t('gmailUser'))}</span>
          <input name="email.gmail_user" type="email" spellcheck="false" autocomplete="off" placeholder="center@gmail.com" value="${esc(s['email.gmail_user'].value)}"></label>
        <label class="field"><span>${esc(t('gmailPass'))}</span>
          <input name="email.gmail_pass" type="password" autocomplete="off" spellcheck="false" placeholder="${esc(s['email.gmail_pass'].set ? t('secretPlaceholder') : 'abcd efgh ijkl mnop')}">
          ${s['email.gmail_pass'].set ? `<small>${t('secretSet', { hint: s['email.gmail_pass'].hint })}</small>` : ''}</label>
      </div>
      <div class="provider-box" data-for="resend">
      <label class="field"><span>${esc(t('resendKey'))}</span>
        <input name="email.resend_key" type="password" autocomplete="off" spellcheck="false" placeholder="${esc(s['email.resend_key'].set ? t('secretPlaceholder') : 're_...')}">
        ${s['email.resend_key'].set ? `<small>${t('secretSet', { hint: s['email.resend_key'].hint })}</small>` : ''}</label>
      <label class="field"><span>${esc(t('mailFrom'))}</span>
        <input name="email.from" type="text" spellcheck="false" autocomplete="off" placeholder="지나기록기 &lt;noreply@도메인&gt;" value="${esc(s['email.from'].value)}">
        <small>${esc(t('mailFromHelp'))}</small></label>
      </div>
      <div class="sub-block">
        <h3>${esc(t('sumMailTitle'))}</h3>
        <label class="check-row"><input type="hidden" name="mail.summary_auto" value="0"><input type="checkbox" name="mail.summary_auto" value="1" ${s['mail.summary_auto'].value !== '0' ? 'checked' : ''}> <span>${esc(t('sumMailAuto'))}</span></label>
        <label class="field"><span>${esc(t('sumMailCc'))}</span>
          <input name="mail.summary_cc" type="text" spellcheck="false" placeholder="director@example.com, ..." value="${esc(s['mail.summary_cc'].value)}">
          <small>${esc(t('sumMailCcHelp'))}</small></label>
        <p class="desc"><a href="#/admin/mail/summary">${esc(t('sumMailTemplateLink'))}</a></p>
      </div>
      <div class="test-result"></div>
      <div class="row" style="flex-wrap:wrap">
        <button class="btn btn-primary shrink" type="submit">${esc(t('save'))}</button>
        <button class="btn btn-quiet shrink" type="button" data-act="test-mail">${esc(t('sendTestMail'))}</button>
      </div>
    </form>

    <form class="panel" data-section="drive" id="drive-panel">
      <h2>${esc(t('secDrive'))}</h2>
      <p class="desc">${esc(t('driveDesc'))}</p>
      <div data-drive-status><p class="lead">${esc(t('loading'))}</p></div>
    </form>`;

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

  const syncProvider = () => {
    const v = (app.querySelector('[name="email.provider"]:checked') || {}).value || 'gmail';
    app.querySelectorAll('.provider-box').forEach((b) => { b.hidden = b.dataset.for !== v; });
  };
  app.querySelectorAll('[name="email.provider"]').forEach((r) => r.addEventListener('change', syncProvider));
  syncProvider();

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

async function loadDrivePanel() {
  const box = app.querySelector('[data-drive-status]');
  if (!box) return;
  let d;
  try { d = await api('/api/admin/drive'); } catch (err) { box.innerHTML = `<div class="notice error">${esc(err.message)}</div>`; return; }
  if (!d.connected) {
    box.innerHTML = `
      <ol class="steps">${t('driveSteps').map((x) => `<li>${x}</li>`).join('')}</ol>
      <a class="btn btn-primary" href="/auth/drive">${esc(t('driveConnect'))}</a>`;
    return;
  }
  const left = d.total - d.backedUp;
  box.innerHTML = `
    <div class="notice ok">${esc(t('driveConnected', { account: d.account || '' }))}</div>
    <label class="check-row"><input type="hidden" name="drive.auto" value="0"><input type="checkbox" name="drive.auto" value="1" ${d.auto ? 'checked' : ''}> <span>${esc(t('driveAuto'))}</span></label>
    <p class="desc">${esc(t('driveCount', { done: d.backedUp, total: d.total }))}</p>
    <div class="row" style="flex-wrap:wrap">
      <button class="btn btn-primary shrink" type="submit">${esc(t('save'))}</button>
      ${left ? `<button class="btn btn-quiet shrink" type="button" data-act="drive-all">${esc(t('driveAll', { n: left }))}</button>` : ''}
      <button class="btn btn-quiet shrink" type="button" data-act="drive-off">${esc(t('driveDisconnect'))}</button>
    </div>
    <p class="desc drive-progress" aria-live="polite"></p>`;
  const all = box.querySelector('[data-act="drive-all"]');
  if (all) all.addEventListener('click', async () => {
    all.disabled = true;
    const prog = box.querySelector('.drive-progress');
    try {
      const { items } = await api('/api/admin/drive/pending');
      for (let i = 0; i < items.length; i++) {
        prog.textContent = t('driveAllProgress', { n: i + 1, total: items.length });
        await backupToDrive(items[i].id, null, true);
      }
      toast(t('driveDone'));
    } catch (err) { toast(err.message); }
    loadDrivePanel();
  });
  box.querySelector('[data-act="drive-off"]').addEventListener('click', async () => {
    if (!confirm(t('driveDisconnectConfirm'))) return;
    try { await api('/api/admin/drive', { method: 'DELETE' }); toast(t('saved')); state.config.driveReady = false; loadDrivePanel(); } catch (err) { toast(err.message); }
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
    <form class="panel" id="my-info" novalidate>
      <h2>${esc(t('myInfo'))}</h2>
      ${profileFields(u)}
      <div id="me-error"></div>
      <button class="btn btn-primary" type="submit">${esc(t('save'))}</button>
    </form>
    <form class="panel" id="my-pw" novalidate>
      <h2>${esc(u.has_password ? t('changePassword') : t('makePassword'))}</h2>
      <p class="desc">${esc(u.has_password ? t('changePasswordDesc') : t('makePasswordDesc'))}</p>
      ${u.has_password ? `<label class="field"><span>${esc(t('currentPassword'))}</span><input name="currentPassword" type="password" autocomplete="current-password"></label>` : ''}
      <label class="field"><span>${esc(t('newPassword'))}</span><input name="newPassword" type="password" autocomplete="new-password" minlength="8"></label>
      <label class="field"><span>${esc(t('passwordConfirm'))}</span><input name="newPassword2" type="password" autocomplete="new-password"></label>
      <div id="pw-error"></div>
      <button class="btn btn-primary" type="submit">${esc(t('save'))}</button>
    </form>
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
    <a class="admin-card" href="/guide.html" style="margin-top:14px">
      <span class="admin-card-icon">${ICONS.help}</span>
      <span class="admin-card-text"><b>${esc(t('guide'))}</b><small>${esc(t('guideBody'))}</small></span>
      <span class="admin-card-arrow" aria-hidden="true">›</span>
    </a>
    <div class="section"><button class="btn btn-quiet btn-block" data-act="logout" type="button">${esc(t('logout'))}</button></div>`);
  bindCommon();
  app.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => { setLang(b.dataset.lang); pageMe(); }));
  const myPw = app.querySelector('#my-pw');
  myPw.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(myPw));
    const box = app.querySelector('#pw-error');
    if (d.newPassword !== d.newPassword2) { box.innerHTML = `<div class="notice error">${esc(t('passwordMismatch'))}</div>`; return; }
    try {
      await api('/api/me/password', { method: 'PUT', body: { currentPassword: d.currentPassword, newPassword: d.newPassword } });
      state.user.has_password = 1;
      toast(t('passwordSaved')); pageMe();
    } catch (err) { box.innerHTML = `<div class="notice error">${esc(err.message)}</div>`; }
  });
  const myInfo = app.querySelector('#my-info');
  myInfo.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const { user } = await api('/api/me', { method: 'PATCH', body: Object.fromEntries(new FormData(myInfo)) });
      state.user = { ...state.user, ...user };
      toast(t('saved')); pageMe();
    } catch (err) { app.querySelector('#me-error').innerHTML = `<div class="notice error">${esc(err.message)}</div>`; }
  });
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

// 모든 비밀번호 칸에 눈 모양 버튼 (보기 / 숨기기)
function addEyes(root = document) {
  root.querySelectorAll('input[type="password"]').forEach((input) => {
    if (input.closest('.pw-wrap')) return;
    const wrap = document.createElement('span');
    wrap.className = 'pw-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'pw-eye';
    b.setAttribute('aria-label', t('showPassword'));
    b.innerHTML = ICONS.eye;
    wrap.appendChild(b);
  });
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('.pw-eye');
  if (!b) return;
  e.preventDefault();
  const input = b.parentElement.querySelector('input');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  b.innerHTML = show ? ICONS.eyeOff : ICONS.eye;
  b.setAttribute('aria-label', t(show ? 'hidePassword' : 'showPassword'));
  b.setAttribute('aria-pressed', String(show));
});
new MutationObserver(() => addEyes()).observe(document.body, { childList: true, subtree: true });
addEyes();

function bindCommon() {
  bindLang(app, render);
  const mb = app.querySelector('[data-act="menu"]');
  if (mb) mb.addEventListener('click', () => openMenu(mb));
}

// 왼쪽에서 나오는 메뉴: 모든 화면과 관리자 페이지로 바로 가기
function openMenu(btn) {
  const u = state.user;
  const admin = u.role === 'admin';
  const mode = location.hash.startsWith('#/admin') ? 'admin' : 'user';
  const nav = navItems(mode);
  const here = location.hash || '#/';
  const link = (it) =>
    `<a href="${it.href}" class="menu-link" ${here === it.href ? 'aria-current="page"' : ''}>${it.icon}<span>${esc(it.label)}</span>${it.count ? '<span class="menu-count" data-signups hidden></span>' : ''}</a>`;
  const wrap = document.createElement('div');
  wrap.className = `drawer-wrap drawer-${mode}`;
  wrap.innerHTML = `
    <nav class="drawer" aria-label="${esc(t('menu'))}">
      <div class="drawer-head">
        <span class="face"><img src="${u.picture ? esc(u.picture) : '/jina/portrait.png'}" alt="" referrerpolicy="no-referrer"></span>
        <div><div class="drawer-name">${esc(u.name || u.email.split('@')[0])}</div>
          <div class="drawer-role">${esc(admin ? t('roleAdmin') : t('roleTeacher'))}${u.position ? ' · ' + esc(u.position) : ''}</div></div>
      </div>
      ${mode === 'admin' ? `<div class="menu-group">${esc(t('adminPage'))}</div>` : ''}
      ${nav.main.map(link).join('')}
      ${mode === 'user' ? `<a href="/guide" class="menu-link">${ICONS.help}<span>${esc(t('guide'))}</span></a>` : ''}
      ${nav.switchTo ? `<div class="menu-sep"></div>${link(nav.switchTo)}` : ''}
      <button type="button" class="menu-link" data-act="menu-logout">${ICONS.logout}<span>${esc(t('logout'))}</span></button>
    </nav>`;
  document.body.appendChild(wrap);
  btn.setAttribute('aria-expanded', 'true');
  const close = () => { wrap.remove(); btn.setAttribute('aria-expanded', 'false'); btn.focus(); };
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('a')) close(); });
  wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  wrap.querySelector('[data-act="menu-logout"]').addEventListener('click', async () => {
    try { await api('/api/logout', { method: 'POST' }); } catch {}
    wrap.remove(); state.user = null; location.hash = ''; renderLogin();
  });
  wrap.querySelector('.menu-link').focus();
  if (admin) loadSignupCount();
}

function handleError(err) {
  if (err.status === 401) { state.user = null; return renderLogin(); }
  toast(err.message);
}

let routeParams = new URLSearchParams();
function render() {
  if (!state.user) return location.hash === '#/signup' ? renderSignup() : renderLogin();
  if (session && !session.finished) return; // 녹음 중에는 녹음 화면 유지
  const full = location.hash.replace(/^#/, '') || '/';
  const h = full.split('?')[0];
  routeParams = new URLSearchParams(full.split('?')[1] || '');
  const detail = h.match(/^\/r\/([\w-]{36})$/);
  if (detail) return pageRecordDetail(detail[1]);
  const admin = state.user.role === 'admin';
  if (h === '/records') return pageRecords();
  if (h === '/me') return pageMe();
  if (h === '/admin/users' && admin) return pageUsers();
  if (h === '/admin/settings' && admin) return pageSettings();
  if (h === '/admin/mail' && admin) return pageMailTemplates();
  if (h === '/admin/insights' && admin) return pageInsights();
  if (h === '/admin/contacts' && admin) return pageContacts();
  { const mk = h.match(/^\/admin\/mail\/([a-z_]+)$/); if (mk && admin) return pageMailEdit(mk[1]); }
  return pageRecord();
}

window.addEventListener('hashchange', () => {
  if (state.user) render();
  else if (location.hash === '#/signup') renderSignup();
  else renderLogin();
});

const CACHE_KEY = 'vn_offline_cache';
function readCache() { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch { return null; } }
function writeCache() { try { localStorage.setItem(CACHE_KEY, JSON.stringify({ user: state.user, config: state.config })); } catch {} }

async function boot() {
  renderNetBar();
  try {
    state.config = await api('/api/config');
    const status = await api('/api/setup/status');
    state.redirectUri = status.redirectUri;
    if (status.needsSetup) return renderSetup(status);
    try {
      const { user } = await api('/api/me');
      state.user = user;
      writeCache();
      if (location.search) history.replaceState(null, '', '/' + location.hash);
      render();
      syncer.kick();
    } catch (err) {
      if (err.status === 401) { try { localStorage.removeItem(CACHE_KEY); } catch {} renderLogin(); }
      else throw err;
    }
  } catch (err) {
    // 인터넷이 없을 때: 지난번 로그인 정보로 열어서 녹음은 할 수 있게
    const cached = readCache();
    if (err.code === 'network' && cached && cached.user) {
      state.user = cached.user;
      state.config = { ...state.config, ...cached.config };
      state.offlineBoot = true;
      render();
      syncer.report();
      return;
    }
    app.innerHTML = `<div class="login"><div class="login-body"><div class="notice error" role="alert">${esc(err.message)}</div>
      <button class="btn btn-quiet" id="retry">${esc(t('retry'))}</button></div></div>`;
    document.getElementById('retry').addEventListener('click', () => location.reload());
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

boot();
