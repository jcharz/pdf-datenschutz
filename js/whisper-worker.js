// Spracherkennung mit Whisper – läuft vollständig im Browser (WebAssembly).
// Das Audio verlässt das Gerät nie. Nur die Modelldateien werden beim ersten Mal geladen
// und danach im Browser-Cache gehalten (offline nutzbar).

import { pipeline, env } from '../vendor/transformers/transformers.min.js';

env.allowLocalModels = true;
env.localModelPath = new URL('../models/', import.meta.url).href; // optional selbst gehostete Modelle
env.useBrowserCache = true;
env.backends.onnx.wasm.wasmPaths = new URL('../vendor/transformers/', import.meta.url).href;
env.backends.onnx.wasm.proxy = false;

let asr = null;
let loadedModel = null;

async function load(model) {
  if (asr && loadedModel === model) return;
  asr = null;
  asr = await pipeline('automatic-speech-recognition', model, {
    dtype: 'q8',
    device: 'wasm',
    progress_callback: (p) => self.postMessage({ type: 'progress', data: p }),
  });
  loadedModel = model;
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') {
      await load(data.model);
      self.postMessage({ type: 'ready' });
    } else if (data.type === 'transcribe') {
      await load(data.model);
      const out = await asr(data.audio, { language: 'german', task: 'transcribe', chunk_length_s: 30 });
      self.postMessage({ type: 'result', text: (out.text || '').trim(), id: data.id });
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err?.message || err), id: data.id });
  }
};
