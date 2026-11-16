// 녹음 엔진: 마이크를 켜고 20초마다 잘라서 완성된 파일 조각을 넘겨준다.
// 조각마다 새 MediaRecorder 를 먼저 켜고 이전 것을 끄기 때문에 조각 사이에 끊김이 없다.
// 화면은 이 파일을 모른다. 화면은 onChunk / onLevel / onState 로 소식만 받는다.

const PREFERRED = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/ogg;codecs=opus'];

export function supported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
}

function pickMime() {
  for (const m of PREFERRED) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch {}
  }
  return '';
}

export class ChunkRecorder {
  constructor({ chunkMs = 20000, onChunk, onLevel, onState } = {}) {
    this.chunkMs = chunkMs;
    this.onChunk = onChunk || (() => {});
    this.onLevel = onLevel || (() => {});
    this.onState = onState || (() => {});
    this.seq = 0;
    this.state = 'idle';
    this.elapsedBefore = 0;   // 일시정지 전까지 쌓인 시간
    this.runStartedAt = 0;    // 지금 구간이 시작된 시각
    this.current = null;      // { rec, parts, startMs }
    this.pendingStops = [];
  }

  elapsedMs() {
    if (this.state === 'recording') return this.elapsedBefore + (performance.now() - this.runStartedAt);
    return this.elapsedBefore;
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    this.mime = pickMime();
    this._startMeter();
    this.state = 'recording';
    this.runStartedAt = performance.now();
    this._openSegment();
    this._timer = setInterval(() => this._tick(), 500);
    this.onState(this.state);
  }

  _openSegment() {
    const opts = { audioBitsPerSecond: 32000 };
    if (this.mime) opts.mimeType = this.mime;
    let rec;
    try { rec = new MediaRecorder(this.stream, opts); }
    catch { rec = new MediaRecorder(this.stream); }
    const seg = { rec, parts: [], seq: this.seq++, startMs: Math.round(this.elapsedMs()) };
    rec.ondataavailable = (e) => { if (e.data && e.data.size) seg.parts.push(e.data); };
    seg.done = new Promise((resolve) => {
      rec.onstop = () => {
        const type = (rec.mimeType || this.mime || 'audio/webm').split(';')[0];
        const blob = new Blob(seg.parts, { type });
        seg.endMs = seg.endMs ?? Math.round(this.elapsedMs());
        if (blob.size > 0) this.onChunk({ blob, seq: seg.seq, startMs: seg.startMs, endMs: seg.endMs, type });
        resolve();
      };
    });
    rec.start();
    seg.openedAt = this.elapsedMs();
    this.current = seg;
  }

  _rotate() {
    const old = this.current;
    old.endMs = Math.round(this.elapsedMs());
    this._openSegment();           // 새 조각 먼저 켜고
    try { old.rec.stop(); } catch {} // 이전 조각 끄기
    this.pendingStops.push(old.done);
  }

  _tick() {
    if (this.state !== 'recording' || !this.current) return;
    if (this.elapsedMs() - this.current.openedAt >= this.chunkMs) this._rotate();
  }

  pause() {
    if (this.state !== 'recording') return;
    this.elapsedBefore = this.elapsedMs();
    this.state = 'paused';
    try { this.current.rec.pause(); } catch {}
    this.onState(this.state);
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'recording';
    this.runStartedAt = performance.now();
    try { this.current.rec.resume(); } catch {}
    this.onState(this.state);
  }

  async stop() {
    if (this.state === 'idle' || this.state === 'stopped') return;
    if (this.state === 'recording') this.elapsedBefore = this.elapsedMs();
    this.state = 'stopped';
    clearInterval(this._timer);
    const last = this.current;
    if (last) {
      last.endMs = Math.round(this.elapsedBefore);
      try { if (last.rec.state === 'paused') last.rec.resume(); last.rec.stop(); } catch {}
      this.pendingStops.push(last.done);
    }
    await Promise.all(this.pendingStops);
    this._stopMeter();
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.onState(this.state);
  }

  // 소리 크기 (파형 표시용)
  _startMeter() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new Ctx();
      const src = this.audioCtx.createMediaStreamSource(this.stream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 512;
      src.connect(this.analyser);
      const data = new Uint8Array(this.analyser.fftSize);
      const loop = () => {
        if (!this.analyser) return;
        this.analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
        const level = this.state === 'recording' ? Math.min(1, Math.sqrt(sum / data.length) * 4) : 0;
        this.onLevel(level);
        this._raf = requestAnimationFrame(loop);
      };
      loop();
    } catch {}
  }

  _stopMeter() {
    cancelAnimationFrame(this._raf);
    this.analyser = null;
    try { this.audioCtx && this.audioCtx.close(); } catch {}
  }
}

// 올리기 줄: 조각을 차례로 올리고, 실패하면 잠시 뒤 다시 시도한다.
export class UploadQueue {
  constructor({ upload, onUpdate }) {
    this.upload = upload;           // async (item) => result
    this.onUpdate = onUpdate || (() => {});
    this.items = [];
    this.busy = false;
    window.addEventListener('online', () => this.kick());
  }

  get pending() { return this.items.filter((i) => !i.done).length; }

  add(item) {
    item.tries = 0;
    this.items.push(item);
    this.onUpdate(this);
    this.kick();
  }

  async kick() {
    if (this.busy) return;
    this.busy = true;
    try {
      for (;;) {
        const item = this.items.find((i) => !i.done && !(i.waitUntil > Date.now()));
        if (!item) break;
        try {
          item.result = await this.upload(item);
          item.done = true;
          item.error = null;
        } catch (err) {
          item.tries++;
          item.error = err;
          item.waitUntil = Date.now() + Math.min(30000, 1500 * 2 ** Math.min(item.tries, 5));
          setTimeout(() => this.kick(), item.waitUntil - Date.now() + 50);
          this.onUpdate(this, item);
          break;
        }
        this.onUpdate(this, item);
      }
    } finally {
      this.busy = false;
    }
  }

  // 남은 조각이 다 올라갈 때까지 기다린다 (최대 timeoutMs)
  async drain(timeoutMs = 60000) {
    const until = Date.now() + timeoutMs;
    while (this.pending && Date.now() < until) {
      this.items.forEach((i) => { if (!i.done) i.waitUntil = 0; });
      await this.kick();
      if (this.pending) await new Promise((r) => setTimeout(r, 1000));
    }
    return this.pending === 0;
  }
}
