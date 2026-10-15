/* =====================================================================
 * Sermon Translator – Swiss German -> English, running ON THE DEVICE.
 *
 * Nothing is sent to a server: the microphone audio is turned into text by an
 * AI model (OpenAI's open "Whisper", run by transformers.js) inside the browser.
 *
 * Flow:
 *   microphone -> audio-worklet.js (16 kHz) -> vad.js (cut at pauses)
 *     -> worker.js (Whisper: speech -> German text -> English)  -> big captions
 *                                                                 -> read aloud (optional)
 *
 * Sections in this file:
 *   1. Settings, device detection and page elements
 *   2. Captions (auto-scroll), status, level meter
 *   3. The AI worker: loading models with a progress bar, sending audio
 *   4. Microphone capture (getUserMedia + AudioWorklet), test with a file
 *   5. Optional fallback: browser Web Speech API (may be cloud-based!)
 *   6. Read aloud (speechSynthesis), keep screen awake (Wake Lock)
 *   7. Buttons, settings, start-up
 * ===================================================================== */
import { Segmenter } from './vad.js';
import { SPEECH_MODELS, TRANSLATOR_MODEL, defaultModelKey } from './models.js';

/* ---------------- 1. SETTINGS, DEVICE, ELEMENTS ---------------- */
const MAX_LINES = 400;          // sentences kept on screen (long sermons)
const MAX_QUEUE = 4;            // if the device falls behind, skip old audio beyond this
const qs = new URLSearchParams(location.search);
const $ = id => document.getElementById(id);
const ui = Object.fromEntries(['toggle','status','log','interimEn','interimDe','engine','mode','modeTitle','showDe','size',
  'clear','speak','jump','settingsBtn','settings','setup','modelPick','modelNote','deviceInfo','downloadBtn','progress',
  'barFill','progressText','modelSetting','task','testFile','reloadModel','engineInfo','meterFill'].map(id => [id, $(id)]));

const saved = (k, d) => localStorage.getItem('st-' + k) ?? d;
const save = (k, v) => localStorage.setItem('st-' + k, v);

const device = {
  isMobile: /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)),
  memoryGB: navigator.deviceMemory || null,
  hasWebGPU: false, f16: false
};

// Test hooks (used by the automated headless-Chrome test; harmless otherwise)
window.__results = [];

/* ---------------- 2. CAPTIONS AND STATUS ---------------- */
function status(msg, isError) { ui.status.textContent = msg; ui.status.classList.toggle('err', !!isError); }

let followLive = true;   // auto-scroll unless the user scrolled up to re-read
ui.log.addEventListener('scroll', () => {
  const nearBottom = ui.log.scrollHeight - ui.log.scrollTop - ui.log.clientHeight < 60;
  followLive = nearBottom; ui.jump.hidden = nearBottom;
});
function scrollToLive() { if (followLive) ui.log.scrollTop = ui.log.scrollHeight; }
ui.jump.onclick = () => { followLive = true; ui.jump.hidden = true; ui.log.scrollTop = ui.log.scrollHeight; };

function addCaption(english, german) {
  if (!english && !german) return;
  const div = document.createElement('div');
  div.className = 'entry';
  div.innerHTML = '<p class="en"></p><p class="de"></p>';
  div.querySelector('.en').textContent = english || '…';
  div.querySelector('.de').textContent = german || '';
  ui.log.appendChild(div);
  while (ui.log.children.length > MAX_LINES) ui.log.removeChild(ui.log.firstChild);
  scrollToLive();
  window.__results.push({ english, german });
  if (english) readAloud(english);
}
function hint(text) { ui.interimEn.textContent = text || ''; }

/* ---------------- 3. THE AI WORKER ---------------- */
let worker = null, workerReady = false, loadedKey = '';
let busy = false, nextId = 1, loading = null;
const queue = [];   // audio pieces waiting for the model

function currentConfig() {
  const engine = ui.engine.value, modelKey = ui.modelSetting.value;
  const m = SPEECH_MODELS[modelKey];
  const useGPU = device.hasWebGPU && !device.isMobile && qs.get('device') !== 'wasm';
  const variant = useGPU ? ((device.f16 && m.webgpuF16) || m.webgpu) : m.wasm;
  const task = m.canTranslateDirectly ? ui.task.value : 'mt';
  if (engine === 'webspeech') {   // fallback only needs the text translator
    return { key: 'webspeech', modelId: null, useTranslator: true, device: 'wasm', mb: TRANSLATOR_MODEL.mb };
  }
  return {
    key: [modelKey, task, useGPU ? 'webgpu' : 'wasm'].join('/'),
    modelId: m.id, dtype: variant.dtype, device: useGPU ? 'webgpu' : 'wasm', task,
    useTranslator: task === 'mt', mb: variant.mb + (task === 'mt' ? TRANSLATOR_MODEL.mb : 0)
  };
}

/** Start the worker and load the models. Shows a progress bar while downloading. */
function loadModels() {
  const cfg = currentConfig();
  if (worker && loadedKey === cfg.key && workerReady) return Promise.resolve();
  if (loading && loading.key === cfg.key) return loading.promise;      // already loading this one
  if (worker) worker.terminate();
  workerReady = false; ui.toggle.disabled = true;
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  const files = {};   // file name -> {loaded, total}
  ui.progress.hidden = false;
  status('Loading model' + (cfg.device === 'webgpu' ? ' (graphics chip)' : ' (CPU)') + '…');

  const promise = new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') {
        if (data.status === 'progress' && data.total) files[data.part + data.file] = { loaded: data.loaded, total: data.total };
        if (data.status === 'done' && files[data.part + data.file]) files[data.part + data.file].loaded = files[data.part + data.file].total;
        const vals = Object.values(files), loaded = vals.reduce((a, f) => a + f.loaded, 0), total = vals.reduce((a, f) => a + f.total, 0);
        const pct = total ? Math.round(100 * loaded / total) : 0;
        ui.barFill.style.width = pct + '%';
        ui.progressText.textContent = total
          ? `Downloading ${(loaded / 1e6).toFixed(0)} of ~${(total / 1e6).toFixed(0)} MB (${pct}%) – saved on this device for offline use`
          : 'Preparing…';
        if (data.status === 'ready') ui.progressText.textContent = 'Starting the AI engine (can take 10–60 s)…';
      } else if (data.type === 'ready') {
        workerReady = true; loadedKey = cfg.key; save('installed', cfg.key);
        ui.setup.hidden = true; ui.progress.hidden = true; ui.toggle.disabled = false;
        ui.engineInfo.textContent = `Engine: ${cfg.modelId || 'browser speech + ' + TRANSLATOR_MODEL.id} on ${data.device}` +
          (data.device === 'wasm' ? `, ${data.threads} CPU thread(s)` : '') + (cfg.task === 'translate' ? ', Whisper direct translation' : ', + local German→English translator');
        status('Ready. Tap the big button.');
        resolve();
      } else if (data.type === 'result') {
        onResult(data);
      } else if (data.type === 'error') {
        status('Model error: ' + data.message, true);
        if (!workerReady) { ui.setup.hidden = false; ui.toggle.disabled = true; reject(new Error(data.message)); }
        busy = false; pump();
      }
    };
    worker.onerror = e => { status('Worker failed: ' + (e.message || 'unknown') + ' – try the Fast model or another browser.', true); reject(e); };
    worker.postMessage({ type: 'load', ...cfg, translatorId: TRANSLATOR_MODEL.id, translatorDtype: TRANSLATOR_MODEL.dtype });
  });
  loading = { key: cfg.key, promise };
  promise.finally(() => { if (loading && loading.promise === promise) loading = null; }).catch(() => {});
  return promise;
}

/** Send audio pieces to the worker one at a time. */
function enqueueAudio(audio) {
  queue.push(audio);
  if (queue.length > MAX_QUEUE) { queue.splice(0, queue.length - MAX_QUEUE); status('This device is falling behind – some speech was skipped. Try the Fast model.', true); }
  pump();
}
function pump() {
  if (busy || !workerReady || !queue.length) { hint(busy ? '… translating' : ''); return; }
  busy = true; hint('… translating');
  const audio = queue.shift();
  worker.postMessage({ type: 'transcribe', id: nextId++, audio }, [audio.buffer]);
}
function onResult(r) {
  busy = false;
  addCaption(r.english, r.german);
  if (r.seconds && running) status(`Listening… (last piece: ${r.seconds.toFixed(1)} s of speech took ${(r.ms / 1000).toFixed(1)} s)`);
  pump();
}

/* ---------------- 4. MICROPHONE (and test with a file) ---------------- */
let running = false, audioCtx = null, micStream = null, segmenter = null, meterTimer = null;

async function startMic() {
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
  });
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  await audioCtx.audioWorklet.addModule(new URL('./audio-worklet.js', import.meta.url));
  const source = audioCtx.createMediaStreamSource(micStream);
  const node = new AudioWorkletNode(audioCtx, 'resampler-16k');
  const mute = audioCtx.createGain(); mute.gain.value = 0;      // keeps the graph running, silently
  source.connect(node).connect(mute).connect(audioCtx.destination);

  segmenter = new Segmenter(piece => enqueueAudio(piece));
  node.port.onmessage = e => segmenter.push(e.data);
  meterTimer = setInterval(() => { ui.meterFill.style.width = Math.min(100, segmenter.level * 1500) + '%'; }, 120);

  // Long sermons: phones may pause audio (calls, Siri, screen lock). Resume when possible.
  audioCtx.onstatechange = () => { if (running && audioCtx.state !== 'running') audioCtx.resume().catch(() => {}); };
  micStream.getAudioTracks()[0].onended = () => { if (running) { status('Microphone stopped – restarting…', true); restartMic(); } };
}
function stopMic() {
  clearInterval(meterTimer); ui.meterFill.style.width = '0';
  if (segmenter) segmenter.flush();
  if (micStream) micStream.getTracks().forEach(t => t.stop());
  if (audioCtx) audioCtx.close().catch(() => {});
  micStream = audioCtx = null;
}
async function restartMic() { stopMic(); try { await startMic(); } catch (e) { status('Could not restart microphone: ' + e.message, true); } }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && running && audioCtx && audioCtx.state !== 'running') audioCtx.resume().catch(() => {});
});

/** Feed an audio file through exactly the same pipeline (for testing without a microphone). */
async function testWithFile(file) {
  await loadModels();
  status('Decoding test file…');
  const raw = await file.arrayBuffer();
  const tmp = new (window.AudioContext || window.webkitAudioContext)();
  const decoded = await tmp.decodeAudioData(raw); tmp.close();
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
  const src = off.createBufferSource(); src.buffer = decoded; src.connect(off.destination); src.start();
  const pcm = (await off.startRendering()).getChannelData(0);
  const seg = new Segmenter(piece => { queue.push(piece); pump(); });   // no skipping in test mode
  for (let i = 0; i < pcm.length; i += 1600) seg.push(pcm.subarray(i, i + 1600));
  seg.flush();
  status(`Test file queued (${decoded.duration.toFixed(0)} s). Translations appear below.`);
}
window.__testWithUrl = async url => testWithFile(await (await fetch(url)).blob());

/* ---------------- 5. FALLBACK: BROWSER WEB SPEECH (may be cloud!) ---------------- */
// Chrome sends this audio to Google; Safari may use Apple servers. Only the
// German -> English step runs on the device here.
let rec = null;
function startWebSpeech() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) throw new Error('This browser has no built-in speech recognition. Use the on-device Whisper engine.');
  const langs = ['de-CH', 'de-DE']; let li = 0;
  const listen = () => {
    rec = new SR(); rec.lang = langs[li]; rec.continuous = true; rec.interimResults = true;
    rec.onresult = ev => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i], t = r[0].transcript.trim();
        if (r.isFinal && t) worker.postMessage({ type: 'translate', id: nextId++, text: t });
        else hint(t);
      }
    };
    rec.onerror = e => {
      if (e.error === 'language-not-supported' && li < langs.length - 1) li++;
      else if (e.error === 'not-allowed') { stopAll('Microphone blocked – allow it in the browser settings.', true); }
    };
    rec.onend = () => { if (running) setTimeout(() => running && listen(), 300); };   // auto-restart for long talks
    rec.start();
    status('Listening with browser speech (' + rec.lang + ', may be cloud-based)…');
  };
  listen();
}

/* ---------------- 6. READ ALOUD + KEEP SCREEN AWAKE ---------------- */
let voice = null;
function pickVoice() {
  const vs = speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang));
  // Prefer voices that run on the device (localService) – no cloud.
  voice = vs.find(v => v.localService && /en-(US|GB)/i.test(v.lang)) || vs.find(v => v.localService) || vs[0] || null;
}
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }

function readAloud(text) {
  if (!ui.speak.checked || !('speechSynthesis' in window)) return;
  if (speechSynthesis.pending) speechSynthesis.cancel();   // fell behind: skip to the newest sentence
  const u = new SpeechSynthesisUtterance(text);
  if (voice) u.voice = voice;
  u.lang = voice ? voice.lang : 'en-US'; u.rate = 1.05;
  speechSynthesis.speak(u);
}
ui.speak.onchange = () => {
  save('speak', ui.speak.checked ? '1' : '0');
  if (!('speechSynthesis' in window)) return;
  if (ui.speak.checked) speechSynthesis.speak(new SpeechSynthesisUtterance('Read aloud on')); // unlocks speech on iPhone
  else speechSynthesis.cancel();
};

let wakeLock = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator && running && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen'); }
  catch (e) { /* not supported: set Auto-Lock to Never */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });

/* ---------------- 7. BUTTONS, SETTINGS, START-UP ---------------- */
function setUI(on) {
  running = on;
  ui.toggle.textContent = on ? '■ Stop' : '▶ Start translating';
  ui.toggle.className = on ? 'stop' : 'start';
}
function stopAll(msg, isError) {
  setUI(false);
  if (rec) { try { rec.stop(); } catch (e) {} rec = null; }
  stopMic();
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  hint(''); status(msg || 'Stopped.', isError);
}
ui.toggle.onclick = async () => {
  if (running) return stopAll();
  setUI(true); keepAwake();
  try {
    await loadModels();
    if (ui.engine.value === 'webspeech') startWebSpeech();
    else { await startMic(); status('Listening… speak or let the sermon play. Captions appear after each pause.'); }
  } catch (e) {
    stopAll(e.name === 'NotAllowedError' ? 'Microphone blocked – allow it in the browser settings.' : (e.message || String(e)), true);
  }
};

ui.settingsBtn.onclick = () => { ui.settings.hidden = !ui.settings.hidden; ui.settingsBtn.setAttribute('aria-expanded', String(!ui.settings.hidden)); };
function applyMode(m) {
  document.body.classList.toggle('mode-sermon', m === 'sermon');
  ui.modeTitle.textContent = m === 'sermon' ? 'Sermon' : 'Conversation';
  ui.showDe.checked = m === 'conversation';
  document.body.classList.toggle('showDe', ui.showDe.checked);
}
ui.mode.onchange = () => { save('mode', ui.mode.value); applyMode(ui.mode.value); };
ui.showDe.onchange = () => document.body.classList.toggle('showDe', ui.showDe.checked);
const sizes = ['1.5rem', '2.1rem', '2.7rem', '3.4rem']; let si = +saved('size', 1);
const applySize = () => document.documentElement.style.setProperty('--fs', sizes[si]);
ui.size.onclick = () => { si = (si + 1) % sizes.length; save('size', si); applySize(); };
ui.clear.onclick = () => { ui.log.innerHTML = ''; hint(''); };
ui.testFile.onchange = () => ui.testFile.files[0] && testWithFile(ui.testFile.files[0]).catch(e => status(e.message, true));

function describeModel(key) {
  const m = SPEECH_MODELS[key], useGPU = device.hasWebGPU && !device.isMobile;
  const v = useGPU ? ((device.f16 && m.webgpuF16) || m.webgpu) : m.wasm;
  return `${m.note} Download ≈ ${v.mb + TRANSLATOR_MODEL.mb} MB (speech ${v.mb} MB + translator ${TRANSLATOR_MODEL.mb} MB).`;
}
function syncModel(key) {
  ui.modelPick.value = ui.modelSetting.value = key; save('model', key);
  ui.modelNote.textContent = describeModel(key);
  ui.task.disabled = !SPEECH_MODELS[key].canTranslateDirectly;
  if (ui.task.disabled) ui.task.value = 'mt';
}
ui.modelPick.onchange = () => syncModel(ui.modelPick.value);
ui.modelSetting.onchange = () => syncModel(ui.modelSetting.value);
ui.task.onchange = () => save('task', ui.task.value);
ui.engine.onchange = () => save('engine', ui.engine.value);
ui.reloadModel.onclick = () => { if (running) stopAll(); loadModels().catch(() => {}); };
ui.downloadBtn.onclick = () => {
  ui.downloadBtn.disabled = true;
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();   // ask the browser not to delete the model
  loadModels().catch(e => { ui.downloadBtn.disabled = false; status('Download failed: ' + e.message, true); });
};

async function init() {
  // Service worker: offline app + multi-core (cross-origin isolation). Reload once when it first takes control.
  if ('serviceWorker' in navigator && !qs.has('nosw')) {
    try {
      await navigator.serviceWorker.register('sw.js');
      if (!navigator.serviceWorker.controller && !sessionStorage.getItem('st-reloaded')) {
        sessionStorage.setItem('st-reloaded', '1');
        navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
      }
    } catch (e) { /* e.g. file:// – app still works, just no offline cache */ }
  }

  // Device check: does this browser have WebGPU (fast graphics-chip AI)?
  if (navigator.gpu) {
    try { const a = await navigator.gpu.requestAdapter(); if (a) { device.hasWebGPU = true; device.f16 = a.features.has('shader-f16'); } } catch (e) {}
  }
  ui.deviceInfo.textContent = `This device: ${device.isMobile ? 'phone/tablet' : 'computer'}, ` +
    (device.hasWebGPU && !device.isMobile ? 'WebGPU available (fast)' : 'CPU mode (WASM)') +
    (device.memoryGB ? `, ~${device.memoryGB} GB memory` : '') + (self.crossOriginIsolated ? ', multi-core on' : '');

  // Fill the model menus
  for (const sel of [ui.modelPick, ui.modelSetting])
    for (const [key, m] of Object.entries(SPEECH_MODELS)) sel.add(new Option(m.label, key));
  syncModel(qs.get('model') || saved('model', defaultModelKey(device)));
  ui.task.value = SPEECH_MODELS[ui.modelSetting.value].canTranslateDirectly ? saved('task', 'mt') : 'mt';
  ui.engine.value = saved('engine', 'whisper');
  ui.mode.value = qs.get('mode') || saved('mode', 'sermon'); applyMode(ui.mode.value);
  ui.speak.checked = saved('speak', '0') === '1';
  applySize();

  // Already downloaded before? Then skip the setup screen and load straight from the device.
  if (saved('installed', '') === currentConfig().key) { ui.setup.hidden = true; loadModels().catch(() => {}); }
  else status('Choose a model and tap Download (one time).');
}
init();
