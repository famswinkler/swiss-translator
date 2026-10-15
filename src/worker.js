/* worker.js – the "AI brain", running in a background thread (Web Worker)
 * so the page stays smooth while the model thinks.
 *
 * Messages it understands (from app.js):
 *   {type:'load', modelId, dtype, device, useTranslator, translatorId, translatorDtype}
 *   {type:'transcribe', id, audio}   -> Whisper on a 16 kHz Float32Array
 *   {type:'translate', id, text}     -> German text -> English (used by the Web Speech fallback)
 * Messages it sends back:
 *   {type:'progress', ...}  download progress per file
 *   {type:'ready', device}  / {type:'error', message}
 *   {type:'result', id, german, english, ms}
 */
import { pipeline, env } from './lib/transformers.min.js';

// Models come from huggingface.co once, then from the browser's Cache API ("transformers-cache").
env.allowLocalModels = false;
env.useBrowserCache = true;
// The ONNX runtime .wasm files are shipped with the app (lib/), so no other CDN is needed.
env.backends.onnx.wasm.wasmPaths = new URL('./lib/', self.location.href).href;
// Use several CPU cores when the page is "cross-origin isolated" (sw.js arranges that).
env.backends.onnx.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;

let asr = null, translator = null, settings = null;

const report = (data) => self.postMessage({ type: 'progress', ...data });

/** Remove Whisper "loops" like "die leute und die leute und die leute". */
function cleanRepeats(text) {
  let words = text.trim().split(/\s+/).filter(Boolean);
  for (let n = 1; n <= 6; n++) {
    const out = [];
    for (const w of words) {
      out.push(w);
      if (out.length >= 2 * n && out.slice(-n).join(' ').toLowerCase() === out.slice(-2 * n, -n).join(' ').toLowerCase()) out.splice(-n, n);
    }
    words = out;
  }
  return words.join(' ');
}
const sentenceCase = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

async function translateGerman(german) {
  if (!german) return '';
  const words = german.split(/\s+/).length;
  // Capital first letter + full stop helps the small translator model a bit.
  const input = sentenceCase(german) + (/[.!?]$/.test(german) ? '' : '.');
  const out = await translator(input, { max_new_tokens: Math.ceil(words * 2.5) + 10, no_repeat_ngram_size: 4 });
  return cleanRepeats(out[0].translation_text);
}

// Pinned model versions (Hugging Face commit ids), so an upstream model update can't silently change the app.
const REVISIONS = {
  'onnx-community/whisper-base': '1846881b6b3a3024392c1eea3ad983695bc23925',
  'onnx-community/whisper-small': '36050c46d777d46dc4b5f43f6d90574fc38f8732',
  'onnx-community/whisper-large-v3-turbo-swiss-german-ONNX': '9814a21b327fd85d4088e0db9ff2b9fad58d86d4',
  'Xenova/opus-mt-de-en': '399dfd68706739fffd503f876093e455ae268a06',
};

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') {
      settings = data;
      if (data.modelId) {
        asr = await pipeline('automatic-speech-recognition', data.modelId, {
          revision: REVISIONS[data.modelId], dtype: data.dtype, device: data.device, progress_callback: p => report({ ...p, part: 'speech' })
        });
      }
      if (data.useTranslator) {
        translator = await pipeline('translation', data.translatorId, {
          revision: REVISIONS[data.translatorId], dtype: data.translatorDtype, device: 'wasm', progress_callback: p => report({ ...p, part: 'translator' })
        });
      }
      // Warm-up run (first run compiles shaders / allocates memory) so the first real sentence is quicker.
      if (asr) await asr(new Float32Array(16000), { language: 'german', task: 'transcribe', max_new_tokens: 4 }).catch(() => {});
      self.postMessage({ type: 'ready', device: data.device, threads: env.backends.onnx.wasm.numThreads });
    }

    else if (data.type === 'transcribe') {
      const t0 = performance.now();
      const seconds = data.audio.length / 16000;
      const direct = settings.task === 'translate';
      let text = '';
      try {
        const r = await asr(data.audio, {
          language: 'german',
          task: direct ? 'translate' : 'transcribe',
          // Limits that stop Whisper from "inventing" long text (hallucinations):
          max_new_tokens: Math.min(128, Math.ceil(seconds * 4) + 6),
          no_repeat_ngram_size: 4,
          return_timestamps: true          // in our tests this cut off invented trailing text
        });
        text = cleanRepeats(r.text || '');
      } catch (e) { text = ''; }           // the library throws on empty output – treat as silence
      // Whisper's typical "silence" phrases – ignore them.
      if (/^(untertitel|vielen dank|thank you|thanks for watching|\.|…|\[.*\]|\(.*\))\W*$/i.test(text)) text = '';
      const german = direct ? '' : text;
      const english = direct ? text : await translateGerman(text);
      self.postMessage({ type: 'result', id: data.id, german, english, ms: Math.round(performance.now() - t0), seconds });
    }

    else if (data.type === 'translate') {
      const english = await translateGerman(data.text);
      self.postMessage({ type: 'result', id: data.id, german: data.text, english, ms: 0 });
    }
  } catch (e) {
    self.postMessage({ type: 'error', message: e && e.message ? e.message : String(e) });
  }
};
