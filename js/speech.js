// Mikrofonaufnahme + lokale Transkription über den Whisper-Worker.
// Bewusst NICHT die Web Speech API: die schickt das Audio in Safari/Chrome an Apple-/Google-Server.

const HALLUCINATIONS = /untertitel|amara\.org|vielen dank (fürs|für's|fuers) zuschauen|copyright|swr \d|zdf/i;

export class LocalSpeech {
  constructor({ onProgress, onState } = {}) {
    this.onProgress = onProgress;
    this.onState = onState;
    this.worker = null;
    this.model = 'Xenova/whisper-base';
    this.ready = false;
    this.pending = new Map();
    this.seq = 0;
  }

  get supported() {
    return !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder && window.Worker);
  }

  ensureWorker() {
    if (this.worker) return;
    this.worker = new Worker(new URL('./whisper-worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }) => {
      if (data.type === 'progress') this.onProgress?.(data.data);
      else if (data.type === 'ready') { this.ready = true; this.loadResolve?.(); }
      else if (data.type === 'result' || data.type === 'error') {
        const p = this.pending.get(data.id);
        if (!p) { if (data.type === 'error') this.loadReject?.(new Error(data.message)); return; }
        this.pending.delete(data.id);
        data.type === 'result' ? p.resolve(data.text) : p.reject(new Error(data.message));
      }
    };
  }

  load(model = this.model) {
    if (this.model !== model) { this.ready = false; this.loading = null; }
    this.model = model;
    this.ensureWorker();
    if (this.ready) return Promise.resolve();
    if (!this.loading) {
      this.loading = new Promise((res, rej) => { this.loadResolve = res; this.loadReject = rej; });
      this.worker.postMessage({ type: 'load', model });
      this.loading.catch(() => { this.loading = null; });
    }
    return this.loading;
  }

  /** Startet die Aufnahme. Muss direkt aus einem Tipp-Ereignis aufgerufen werden (iOS). */
  async start() {
    this.audioCtx = this.audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    this.audioCtx.resume();
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream);
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.stopped = new Promise((res) => (this.recorder.onstop = res));
    this.recorder.start();
    this.onState?.('recording');
    this.watchSilence();
  }

  /** Automatisch stoppen, wenn nach dem Sprechen ~1,6 s Stille herrscht. */
  watchSilence() {
    const src = this.audioCtx.createMediaStreamSource(this.stream);
    const an = this.audioCtx.createAnalyser();
    an.fftSize = 1024;
    src.connect(an);
    const buf = new Float32Array(an.fftSize);
    let spoke = false, quietSince = performance.now();
    const started = performance.now();
    const tick = () => {
      if (!this.recorder || this.recorder.state !== 'recording') { src.disconnect(); return; }
      an.getFloatTimeDomainData(buf);
      const rms = Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length);
      const now = performance.now();
      if (rms > 0.02) { spoke = true; quietSince = now; }
      if ((spoke && now - quietSince > 1600) || now - started > 30000) { this.onAutoStop?.(); return; }
      requestAnimationFrame(tick);
    };
    tick();
  }

  get recording() {
    return this.recorder?.state === 'recording';
  }

  /** Stoppt die Aufnahme und liefert den erkannten Text. */
  async stop() {
    if (!this.recorder) return '';
    if (this.recorder.state === 'recording') this.recorder.stop();
    await this.stopped;
    this.stream.getTracks().forEach((t) => t.stop());
    const blob = new Blob(this.chunks, { type: this.recorder.mimeType });
    this.recorder = null;
    this.onState?.('transcribing');
    const audio = await this.decode(blob);
    await this.load();
    const id = ++this.seq;
    const text = await new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: 'transcribe', audio, model: this.model, id }, [audio.buffer]);
    });
    this.onState?.('idle');
    return HALLUCINATIONS.test(text) ? '' : text.replace(/^[\s.…]+|[\s…]+$/g, '');
  }

  /** Audio dekodieren und auf 16 kHz mono umrechnen (Whisper-Format). */
  async decode(blob) {
    const decoded = await this.audioCtx.decodeAudioData(await blob.arrayBuffer());
    const len = Math.ceil(decoded.duration * 16000);
    const off = new OfflineAudioContext(1, Math.max(len, 1), 16000);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start();
    const res = await off.startRendering();
    return res.getChannelData(0).slice();
  }
}
