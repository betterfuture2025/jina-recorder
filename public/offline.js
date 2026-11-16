// 인터넷이 없어도 녹음이 되게: 녹음 조각을 먼저 휴대폰(IndexedDB)에 저장하고,
// 인터넷이 되면 순서대로 서버에 올린다(싱크). 다 올라간 조각은 휴대폰에서 지운다.
//  - recs   : 녹음 한 건의 정보 { id, kind, consent, startedAt, created, finished, durationSec, ... }
//  - chunks : 녹음 조각 { recId, seq, blob, type, startMs, endMs }
// IndexedDB 를 못 쓰는 경우(일부 사생활 보호 모드)에는 메모리에만 보관한다 (앱을 닫으면 사라짐).

const DB_NAME = 'jina-offline';
let dbp = null;
const mem = { recs: new Map(), chunks: new Map() };
let useMem = false;

function openDb() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(DB_NAME, 1); } catch { useMem = true; return resolve(null); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('recs')) db.createObjectStore('recs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('chunks')) {
        const s = db.createObjectStore('chunks', { keyPath: ['recId', 'seq'] });
        s.createIndex('byRec', 'recId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { useMem = true; resolve(null); };
    req.onblocked = () => { useMem = true; resolve(null); };
  });
  return dbp;
}

function tx(db, stores, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let out;
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
    out = fn(t);
  });
}
const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function putRec(rec) {
  const db = await openDb();
  if (!db) { mem.recs.set(rec.id, { ...rec }); return; }
  await tx(db, ['recs'], 'readwrite', (t) => { t.objectStore('recs').put(rec); });
}

export async function getRec(id) {
  const db = await openDb();
  if (!db) return mem.recs.get(id) || null;
  return tx(db, ['recs'], 'readonly', (t) => reqP(t.objectStore('recs').get(id))).then(async (p) => (await p) || null);
}

export async function patchRec(id, patch) {
  const cur = await getRec(id);
  if (!cur) return null;
  const next = { ...cur, ...patch };
  await putRec(next);
  return next;
}

export async function listRecs() {
  const db = await openDb();
  const all = !db ? [...mem.recs.values()] : await tx(db, ['recs'], 'readonly', (t) => reqP(t.objectStore('recs').getAll())).then((p) => p);
  return (await all).sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
}

export async function putChunk(c) {
  const db = await openDb();
  if (!db) { mem.chunks.set(`${c.recId}:${c.seq}`, { ...c }); return; }
  // 일부 브라우저는 Blob 저장이 안 돼서 ArrayBuffer 로 바꿔 저장
  const buf = await c.blob.arrayBuffer();
  await tx(db, ['chunks'], 'readwrite', (t) => { t.objectStore('chunks').put({ ...c, blob: undefined, buf }); });
}

export async function listChunks(recId) {
  const db = await openDb();
  if (!db) return [...mem.chunks.values()].filter((c) => c.recId === recId).sort((a, b) => a.seq - b.seq);
  const rows = await tx(db, ['chunks'], 'readonly', (t) => reqP(t.objectStore('chunks').index('byRec').getAll(recId))).then((p) => p);
  return (await rows).map((c) => ({ ...c, blob: c.blob || new Blob([c.buf], { type: c.type }) })).sort((a, b) => a.seq - b.seq);
}

export async function countChunks(recId) {
  return (await listChunks(recId)).length;
}

export async function deleteChunk(recId, seq) {
  const db = await openDb();
  if (!db) { mem.chunks.delete(`${recId}:${seq}`); return; }
  await tx(db, ['chunks'], 'readwrite', (t) => { t.objectStore('chunks').delete([recId, seq]); });
}

export async function deleteRec(id) {
  const db = await openDb();
  if (!db) {
    mem.recs.delete(id);
    for (const k of [...mem.chunks.keys()]) if (k.startsWith(id + ':')) mem.chunks.delete(k);
    return;
  }
  const keys = await tx(db, ['chunks'], 'readonly', (t) => reqP(t.objectStore('chunks').index('byRec').getAllKeys(id))).then((p) => p);
  await tx(db, ['recs', 'chunks'], 'readwrite', (t) => {
    t.objectStore('recs').delete(id);
    for (const k of keys) t.objectStore('chunks').delete(k);
  });
}

export const storageIsMemoryOnly = () => useMem;

// 멈춘 녹음을 다시 시도하게 풀기
export async function unstick(id) { return patchRec(id, { stuck: false, error: null }); }

// 휴대폰이 공간이 부족할 때 마음대로 지우지 않도록 요청
export async function askPersist() {
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch {}
}

// ── 싱크: 휴대폰에 쌓인 녹음을 서버로 ──
// hooks: onChunk(recId, seq, result) 조각이 올라가 받아쓰기 결과가 왔을 때
//        onSynced(rec) 한 건이 끝까지 다 올라갔을 때
//        onChange(stats) 남은 양이 바뀔 때 { recs, chunks, online, error }
export class Syncer {
  constructor({ onChunk, onSynced, onChange, autoSummary } = {}) {
    this.onChunk = onChunk || (() => {});
    this.onSynced = onSynced || (() => {});
    this.onChange = onChange || (() => {});
    this.autoSummary = autoSummary || (() => false);
    this.running = false;
    this.again = false;
    this.backoff = 0;
    this.timer = null;
    this.lastError = null;
    window.addEventListener('online', () => { this.backoff = 0; this.kick(); });
    window.addEventListener('offline', () => this.report());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.kick(); });
    setInterval(() => this.kick(), 30000);
  }

  async stats() {
    const recs = await listRecs();
    let chunks = 0;
    for (const r of recs) chunks += await countChunks(r.id);
    return { recs: recs.length, chunks, online: navigator.onLine, error: this.lastError, list: recs };
  }

  async report() { try { this.onChange(await this.stats()); } catch {} }

  kick() {
    if (this.running) { this.again = true; return; }
    this.run();
  }

  async req(path, init) {
    let res;
    try {
      res = await fetch(path, { credentials: 'same-origin', ...init, headers: { 'x-requested-with': 'fetch', ...(init && init.headers) } });
    } catch {
      throw Object.assign(new Error('offline'), { offline: true });
    }
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) throw Object.assign(new Error(data.message || `HTTP ${res.status}`), { status: res.status, code: data.error });
    return data;
  }

  async syncOne(rec) {
    if (!rec.created) {
      await this.req('/api/recordings', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: rec.id, kind: rec.kind, consent: rec.consent, startedAt: rec.startedAt, title: rec.title || '' }),
      });
      rec = await patchRec(rec.id, { created: true });
    }
    const chunks = await listChunks(rec.id);
    for (const c of chunks) {
      const data = await this.req(`/api/recordings/${rec.id}/chunks/${c.seq}`, {
        method: 'PUT',
        headers: { 'content-type': c.type, 'x-start-ms': String(c.startMs), 'x-end-ms': String(c.endMs) },
        body: c.blob,
      });
      await deleteChunk(rec.id, c.seq);
      this.onChunk(rec.id, c.seq, data);
      this.report();
    }
    rec = await getRec(rec.id);
    if (rec && rec.finished && !(await countChunks(rec.id))) {
      await this.req(`/api/recordings/${rec.id}/finish`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ durationSec: rec.durationSec || 0 }),
      });
      await deleteRec(rec.id);
      if (rec.offline && this.autoSummary()) {
        // 인터넷 없이 녹음했던 기록은 올라간 뒤 요약도 바로 시작해 둔다
        this.req(`/api/recordings/${rec.id}/summarize`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => {});
      }
      this.onSynced(rec);
    }
  }

  async run() {
    this.running = true;
    clearTimeout(this.timer);
    try {
      do {
        this.again = false;
        const recs = await listRecs();
        for (const rec of recs) {
          if (rec.stuck) continue;
          try { await this.syncOne(rec); }
          catch (err) {
            // 다시 해도 안 되는 오류(지워진 기록, 권한 없음, 형식 오류)는 그 녹음만 멈춰 두고 다음으로
            if (err.status && err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 408 && err.status !== 429) {
              await patchRec(rec.id, { stuck: true, error: err.message });
              continue;
            }
            throw err;
          }
        }
      } while (this.again);
      this.backoff = 0;
      this.lastError = null;
    } catch (err) {
      this.lastError = err.offline ? 'offline' : err.status === 401 ? 'login' : (err.message || 'error');
      if (err.status !== 401) {
        this.backoff = Math.min(60000, (this.backoff || 2500) * 2);
        this.timer = setTimeout(() => this.kick(), this.backoff);
      }
    } finally {
      this.running = false;
      this.report();
    }
  }

  // 특정 녹음이 다 올라갈 때까지 기다리기 (최대 ms). 다 올라가면 true
  async waitFor(id, ms) {
    const until = Date.now() + ms;
    for (;;) {
      if (!(await getRec(id))) return true;
      if (Date.now() > until) return false;
      if ((!navigator.onLine && this.lastError === 'offline') || this.lastError === 'login') return false;
      const r = await getRec(id); if (r && r.stuck) return false;
      this.kick();
      await new Promise((r) => setTimeout(r, 800));
    }
  }
}
