// Usage: node tests/node-pipeline-test.mjs <modelId> <transcribe|translate> <dtype|JSON> <mt|no> [16kHz mono wav]
// Example: npm run test:node   (defaults: whisper-base, transcribe, q8, mt, tests/audio/zurich16k.wav)
// Same pipeline as the web app: VAD segments -> Whisper -> (optional) capitals put back + opus-mt, with the app's limits.
import { pipeline, env } from '@huggingface/transformers';
import fs from 'fs'; import wf from 'wavefile'; import { Segmenter, cleanRepeats } from '../src/vad.js';
import { truecaserFromPipeline } from '../src/truecase.js';
env.cacheDir = process.env.MODEL_CACHE || './.model-cache';
const [model = 'onnx-community/whisper-base', task = 'transcribe', dtype = 'q8', mt = 'mt', file = new URL('./audio/zurich16k.wav', import.meta.url).pathname] = process.argv.slice(2);
const w = new wf.WaveFile(fs.readFileSync(file)); w.toBitDepth('32f');
let audio = w.getSamples(); if (Array.isArray(audio)) audio = audio[0]; audio = Float32Array.from(audio);
const segs = []; const s = new Segmenter(a => segs.push(a));
for (let i = 0; i < audio.length; i += 1600) s.push(audio.subarray(i, i + 1600)); s.flush();
console.log('segments (s):', segs.map(x => (x.length / 16000).toFixed(1)).join(' '));
const asr = await pipeline('automatic-speech-recognition', model, { dtype: dtype.startsWith('{') ? JSON.parse(dtype) : dtype });
const tr = mt === 'mt' ? await pipeline('translation', 'Xenova/opus-mt-de-en', { dtype: 'q8' }) : null;
const truecase = tr && truecaserFromPipeline(tr);
const t0 = Date.now();
for (const seg of segs) {
  const sec = seg.length / 16000;
  let r; try { r = await asr(seg, { task, language: 'german', max_new_tokens: Math.min(128, Math.ceil(sec * 4) + 6), no_repeat_ngram_size: 4, return_timestamps: true }); } catch (e) { console.log('ASR ERROR:', e.message); r = { text: '' }; }   // show real errors, like the app
  let text = cleanRepeats(r.text);
  let en = text;
  if (tr && text) {   // as in worker.js: capital first letter + full stop, capitals for nouns, then translate
    let input = text.charAt(0).toUpperCase() + text.slice(1) + (/[.!?]$/.test(text) ? '' : '.');
    if (truecase) input = truecase(input);
    en = cleanRepeats((await tr(input, { max_new_tokens: Math.ceil(text.split(' ').length * 2.5) + 10, no_repeat_ngram_size: 4 }))[0].translation_text);
  }
  console.log('·', tr ? `${text}  =>  ${en}` : en);
}
console.log(`inference ${((Date.now() - t0) / 1000).toFixed(1)} s for ${(audio.length / 16000).toFixed(1)} s audio`);
