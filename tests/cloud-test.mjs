// Usage: GEMINI_API_KEY=... npm run test:cloud [-- gemini-3.5-flash-lite] [file.wav]
// Sends tests/audio/zurich16k.wav through the SAME steps as the app's cloud engine:
// pause detection (vad.js) -> joining short pieces (Batcher) -> Gemini (cloud.js), with the last sentences as context.
// Prints German + English per piece, the time per request, and the tokens used (to estimate the cost).
import fs from 'fs'; import wf from 'wavefile';
import { Segmenter, Batcher } from '../src/vad.js';
import { geminiTranslate, DEFAULT_GEMINI_MODEL } from '../src/cloud.js';

const [model = DEFAULT_GEMINI_MODEL, file = new URL('./audio/zurich16k.wav', import.meta.url).pathname] = process.argv.slice(2);
// A key can also be added by a proxy that injects the x-goog-api-key header; then any placeholder works here.
const apiKey = process.env.GEMINI_API_KEY || 'injected-by-proxy';

const w = new wf.WaveFile(fs.readFileSync(file)); w.toBitDepth('32f');
let audio = w.getSamples(); if (Array.isArray(audio)) audio = audio[0]; audio = Float32Array.from(audio);

const pieces = [];
const batcher = new Batcher(p => pieces.push(p));
const seg = new Segmenter(p => batcher.push(p), { pauseMs: 700, maxSec: 15 });   // same settings as the app's cloud mode
for (let i = 0; i < audio.length; i += 1600) seg.push(audio.subarray(i, i + 1600));
seg.flush(); batcher.flush();
console.log(`model ${model}; ${pieces.length} requests for ${(audio.length / 16000).toFixed(1)} s of audio; piece lengths (s):`,
  pieces.map(p => (p.length / 16000).toFixed(1)).join(' '));

const context = []; let tokIn = 0, tokOut = 0;
for (const p of pieces) {
  const t0 = Date.now();
  const r = await geminiTranslate({ audio: p, apiKey, model, context });
  if (r.german) { context.push(r.german); if (context.length > 3) context.shift(); }
  const u = r.usage; tokIn += u.promptTokenCount || 0; tokOut += (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
  console.log(`\n[${(p.length / 16000).toFixed(1)} s audio, ${((Date.now() - t0) / 1000).toFixed(1)} s wait, tokens in ${u.promptTokenCount} / out ${u.candidatesTokenCount} / thinking ${u.thoughtsTokenCount || 0}]`);
  console.log('DE ', r.german); console.log('EN ', r.english);
}
const hours = audio.length / 16000 / 3600;
console.log(`\nTokens per hour of audio: input ${(tokIn / hours / 1e3).toFixed(0)}k, output incl. thinking ${(tokOut / hours / 1e3).toFixed(0)}k`);
