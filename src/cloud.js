/* cloud.js – optional CLOUD engine: Google Gemini listens to each piece of speech and returns
 * Standard German + English in one step.
 *
 * Why: the on-device models are small; Swiss dialect needs a big model. Gemini hears the dialect and
 * translates the meaning, so there is no lowercase/odd-word problem from a second small translator.
 * Cost: needs internet and the user's own Gemini API key (aistudio.google.com/apikey). The audio of
 * each piece is SENT TO GOOGLE. The key is stored only on this device (localStorage) and sent only
 * to generativelanguage.googleapis.com.
 *
 * Uses the documented REST endpoint models/{model}:generateContent (browser CORS allows the headers
 * content-type and x-goog-api-key, checked 2026-11-08). Works in the browser and in Node 18+.
 */

export const GEMINI_MODELS = {
  'gemini-3.8-flash':      { label: 'Gemini 3.8 Flash (most accurate)',        thinkingLevel: 'low' },     // 'minimal' is not allowed on 3.8 Flash
  'gemini-3.5-flash-lite': { label: 'Gemini 3.5 Flash-Lite (faster, cheaper)', thinkingLevel: 'minimal' },
};
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/';

const INSTRUCTIONS = `You are the live interpreter for a church service in Switzerland.
You get one short piece of audio, cut at a pause, so it may start or end in the middle of a sentence.
The speaker mostly speaks Swiss German dialect (any canton), sometimes Standard German, sometimes English.

Return JSON with two fields:
- "german": exactly what was said, written as correct Standard German (Hochdeutsch) with normal
  capitalisation and punctuation, Swiss spelling ("ss", never "ß"). Do not summarise, shorten or add anything.
- "english": a faithful, natural English translation of the same words.

Rules:
- Bible quotes, Bible book names, names of people and places, and church words: use the usual
  English Bible wording.
- If a word is unclear, choose the most likely meaning from the context; never invent sentences.
- If there is no clear speech (silence, noise, coughing, music without words), return "" for both fields.`;

/** Turn 16 kHz mono Float32 samples into a base64 WAV file (16-bit PCM). */
export function wavBase64(samples, rate = 16000) {
  const n = samples.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, samples[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  const bytes = new Uint8Array(buf);
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');   // Node
  let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Error with a plain-language message for the status line, plus the HTTP status and retry hint. */
class CloudError extends Error {
  constructor(message, status, retryAfterSec, fatal) { super(message); Object.assign(this, { status, retryAfterSec, fatal: !!fatal }); }
}

function explain(status, body) {
  let msg = '', retry = 0;
  try { const e = JSON.parse(body); const err = Array.isArray(e) ? e[0].error : e.error; msg = err.message || '';
    const r = (err.details || []).find(d => d.retryDelay); if (r) retry = parseFloat(r.retryDelay) || 0; } catch (_) { msg = body.slice(0, 200); }
  // "fatal" = every next piece would fail the same way, so the app stops and shows the message.
  if (status === 400 && /API key/i.test(msg)) return new CloudError('The Gemini API key is not valid. Check it in ⚙︎ Settings.', status, 0, true);
  if (status === 403) return new CloudError('Gemini refused the key (' + msg + '). In AI Studio, restrict the key to the Gemini API or create a new one.', status, 0, true);
  if (status === 429) return new CloudError('Gemini usage limit reached (free tier limits are per minute and per day). Waiting…', status, retry || 20);
  if (status >= 500) return new CloudError('Gemini is busy or down (' + status + '). Trying again…', status, 3);
  return new CloudError('Gemini error ' + status + ': ' + msg, status);
}

/**
 * Send one piece of speech to Gemini.
 * @param {object} o
 * @param {Float32Array} o.audio   16 kHz mono samples
 * @param {string} o.apiKey        the user's Gemini API key
 * @param {string} [o.model]       a key of GEMINI_MODELS
 * @param {string[]} [o.context]   the last few German sentences (helps with names and half sentences)
 * @param {AbortSignal} [o.signal]
 * @returns {Promise<{german: string, english: string, usage: object}>}
 */
export async function geminiTranslate({ audio, apiKey, model = DEFAULT_GEMINI_MODEL, context = [], signal }) {
  if (!apiKey) throw new CloudError('Enter your Gemini API key in ⚙︎ Settings first.', 0, 0, true);
  const m = GEMINI_MODELS[model] || GEMINI_MODELS[DEFAULT_GEMINI_MODEL];
  const ctx = context.filter(Boolean).slice(-3).join(' ');
  const body = {
    systemInstruction: { parts: [{ text: INSTRUCTIONS }] },
    contents: [{ role: 'user', parts: [
      { text: ctx ? `Said just before (context only, do not repeat): "${ctx}"\n\nInterpret this piece:` : 'Interpret this piece:' },
      { inlineData: { mimeType: 'audio/wav', data: wavBase64(audio) } },
    ] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: { type: 'object', properties: { german: { type: 'string' }, english: { type: 'string' } }, required: ['german', 'english'] },
      thinkingConfig: { thinkingLevel: m.thinkingLevel },
      maxOutputTokens: 2048,
    },
  };
  let res;
  try {
    res = await fetch(ENDPOINT + encodeURIComponent(model) + ':generateContent', {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
    });
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    throw new CloudError('No internet connection to Gemini. Check the network, or switch to an on-device model in ⚙︎.', 0, 5);
  }
  const text = await res.text();
  if (!res.ok) throw explain(res.status, text);
  const data = JSON.parse(text);
  const cand = data.candidates && data.candidates[0];
  if (!cand) throw new CloudError('Gemini returned no answer' + (data.promptFeedback && data.promptFeedback.blockReason ? ' (' + data.promptFeedback.blockReason + ')' : '') + '.', 200);
  const out = ((cand.content && cand.content.parts) || []).filter(p => !p.thought && p.text).map(p => p.text).join('');
  let parsed;
  try { parsed = JSON.parse(out.replace(/^```(?:json)?\s*|\s*```$/g, '')); }
  catch (_) { throw new CloudError('Gemini answer could not be read' + (cand.finishReason ? ' (' + cand.finishReason + ')' : '') + '.', 200); }
  return { german: String(parsed.german || '').trim(), english: String(parsed.english || '').trim(), usage: data.usageMetadata || {} };
}
