# Sermon Translator: Swiss German → English

Live English captions for a sermon or prayer meeting held in Swiss German. Two ways to run it:
- **On the device (default):** no server, no account, no cost; works offline after a one-time download.
- **Cloud (optional, for dialect):** Google Gemini, a much larger model. Needs internet and your own free
  Gemini API key, and **the audio is sent to Google**.

> **Please note: on-device captions are rough.** On a phone, Standard German (readings, many sermons, songs) comes out well, but **Swiss dialect is often wrong**. Treat them as a helpful gist, not an exact translation. For dialect, use a laptop with the "Swiss German specialist" model, or the cloud engine.

## Quick start (for the listener)
1. At home on Wi-Fi, open the app link on your phone.
2. Tap **Download & prepare** and wait until it says **Ready** (about 180 MB, once).
3. Tap Share, then **Add to Home Screen**.
4. At the meeting, open it from the Home Screen and press the **big button**. The English captions scroll by themselves.
5. For read-aloud, use earphones (otherwise the mic hears the voice). Plug in the phone for long services.

If you used an earlier test version, clear the site's data once so old model files don't take up extra space.

### Cloud engine (better for Swiss dialect)
1. Get a free key: open **aistudio.google.com/apikey**, sign in with a Google account, tap **Create API key**, copy it.
2. In the app tap **☁ Use the cloud engine instead** (or ⚙︎ → Listening engine → *Cloud: Google Gemini*) and paste the key.
3. Press the big button. Captions come every ~6–15 s (pieces are joined to at least 6 s to stay within Google's limits).

Things to know:
- The key is stored only on that device (browser storage) and sent only to Google. Don't share it; anyone with it can use your quota.
- **Free tier:** Google may use the audio to improve its products, and there are per-minute/per-day limits
  (see aistudio.google.com/rate-limit). A full service may hit the daily limit; the app then says so.
- **With billing switched on (Tier 1):** the audio is not used to improve Google's products. Estimated cost
  (Google price list, 8 Nov 2026; not yet measured): Gemini 3.5 Flash-Lite ≈ US$0.20 per hour of speech,
  Gemini 3.8 Flash ≈ US$0.40–0.80 per hour (3.8 Flash prices double on 1 Jan 2027). `npm run test:cloud` prints the real token use.
- Needs internet the whole time. Without it, switch back to an on-device model in ⚙︎.

## Licence of the Swiss model
The Swiss German specialist (`Flurin17/whisper-large-v3-turbo-swiss-german`, via `onnx-community/whisper-large-v3-turbo-swiss-german-ONNX`) is licensed **CC BY-NC 4.0**: free for non-commercial use such as church meetings.

---
# Technical details

## How it works
```
microphone ─► audio-worklet.js ─► vad.js ─────────────► worker.js (Web Worker) ──────────► big captions
(getUserMedia)  resample to 16 kHz   cut at pauses        Whisper: speech → German text         + read aloud
                                     (0.6 s pause / max 12 s)  opus-mt: German → English     (speechSynthesis)
```
- **Speech recognition:** OpenAI Whisper (open weights) run by [transformers.js](https://huggingface.co/docs/transformers.js)
  4.3.1 / ONNX Runtime Web. It uses **WebGPU** when available on a computer and **WASM** on the CPU otherwise (multi-threaded
  thanks to `sw.js`).
- **Translation, two methods:**
  1. *Recommended:* Whisper writes German, then **Xenova/opus-mt-de-en** (106 MB) translates it to English on the device.
     The Swiss specialist writes everything in lowercase, and opus-mt then misreads German nouns ("der wanderer" →
     "the pixie"). `truecase.js` first puts the capitals back ("der Wanderer" → "the wanderer"), using opus-mt's own
     word list (no extra download). Text that already has capitals (Whisper base/small) is not changed.
  2. *Optional:* Whisper `task: 'translate'` gives English directly, with no extra model. In our tests this was worse.
- **Voice detection:** a simple energy-based VAD (no extra download). Captions appear after each pause, usually
  2–8 s after the words are spoken.
- **Anti-hallucination:** limits on tokens per second of audio, `no_repeat_ngram_size`, `return_timestamps` (this fixed
  invented trailing text in tests) and a repeat cleaner.
- **Offline:** models are stored in the browser's Cache API (`transformers-cache`). App files and the ONNX runtime are
  cached by `sw.js`. Tested: with the network switched off, the app reloads and the model becomes ready.
- **Cloud engine (off by default, `cloud.js`):** each piece of speech (joined to ≥ 6 s, `Batcher` in `vad.js`) is sent
  as a WAV file to Google Gemini (`models/{model}:generateContent`, called directly from the browser with the user's key).
  Gemini returns Standard German + English in one step, with the last 3 sentences as context. Default model
  `gemini-3.8-flash`; `gemini-3.5-flash-lite` is faster and cheaper. A wrong key stops the app with a clear message;
  "too many requests" waits and retries twice. Google's dedicated `gemini-3.5-transcribe` was not used: its language
  list (8 Nov 2026) has no Swiss German, and it only transcribes (no translation).
- **Fallback (off by default):** the browser's Web Speech API, **clearly labelled "may send audio to Apple/Google
  servers"**. Only its German → English step runs locally.
- All Azure, DeepL, MyMemory and backend code was removed. The earlier cloud version is kept separately as `swiss-translator-v1-cloud.zip`.

## Models (download once; sizes measured on Hugging Face, 13 Oct 2026)
| Choice in the app | Model | CPU/WASM download | WebGPU download | Default for |
|---|---|---|---|---|
| Fast | `onnx-community/whisper-base` | 77 MB (q8) | 206 MB | phones/tablets, ≤4 GB RAM |
| Better | `onnx-community/whisper-small` | 249 MB (q8) | 410 MB (fp16 enc) / 586 MB | computers without WebGPU |
| Swiss German specialist | `onnx-community/whisper-large-v3-turbo-swiss-german-ONNX` | 1083 MB (q8) | 1618 MB (fp16) / 759 MB (q4, GPUs without f16) | computers with WebGPU |
| + translator (method 1) | `Xenova/opus-mt-de-en` | 106 MB (q8) | (always WASM) | |

The **first-load download** is the app (~42 MB, mostly the ONNX runtime) plus the model. For example: phone default
**≈ 77 + 106 = 183 MB**; Swiss specialist **≈ 1.2–1.7 GB** (8-bit on CPU, 16-bit on WebGPU; until 8 Nov 2026 it was
4-bit, ≈ 875 MB, which made more word errors, see below). Defaults can be overridden in ⚙︎ or with `?model=base|small|swiss`.
`?device=wasm` forces CPU mode.

**Swiss-German-tuned ONNX model:** `onnx-community/whisper-large-v3-turbo-swiss-german-ONNX` exists and works with
transformers.js (tested here). It is an automatic ONNX conversion of `Flurin17/whisper-large-v3-turbo-swiss-german`
(converted Aug 2025, so probably an *earlier* checkpoint than the March 2026 one on the Flurin17 page). The original
model's licence is **CC BY-NC 4.0 (non-commercial)**. It writes Standard German, so the opus-mt translator is always
used with it. Others found on Hugging Face are ONNX but *not* transformers.js-ready (`yannikschrade/...-onnx`, no
config/tokenizer tags; `pantinor/...-sherpa` is for sherpa-onnx), or are CTranslate2, GGML, MLX or CoreML formats.

## Test results (13 Oct 2026, honest)
Samples (Wikimedia Commons, CC BY-SA 4.0, see `tests/audio/SOURCES.md`): "The North Wind and the Sun" read in
**Zürich German** (53 s) and in **Standard German** (45 s). Run on this box's 8-core CPU (no GPU), same
pipeline as the app (`tests/node-pipeline-test.mjs`) and in the real web app in headless Chrome with a fake microphone
playing the file (`tests/browser-test.mjs`).

| Setup | Zürich German → English | Standard German → English | Speed (CPU) |
|---|---|---|---|
| whisper-base, direct translate | Mostly wrong ("There is a different river that has a warm mountain lake") | Rough, mixed | ~7× faster than real time |
| whisper-base + opus-mt (**phone default**; also run in the browser) | Gist only in places ("After all, Bise gave up." / "And immediately the wanderer took off in his coat."); many wrong sentences | **Good** ("The north wind had to admit that the sun was stronger than it was.") | Browser WASM, 4 threads: 3.9 s of speech in 1.0 s (~4× faster than real time); 12/12 sentences captioned |
| whisper-small, direct translate | Partial gist | Unstable, some loops | ~3.5× faster than real time |
| whisper-small + opus-mt | Partial gist | **Good** ("Now the sun began to shine, and it became warm, so that the wanderer immediately took off his coat.") | ~2.5× faster than real time |
| **Swiss turbo + opus-mt** | **Best**: German transcript is close to correct; the English is understandable but with odd words ("But the more they blow, the closer the wanderer has wrapped himself in the coat.", "And immediately the ll-o took off his coat.") | not tested | Node: 0.8× real time. **In the browser on CPU/WASM: ~6× SLOWER than real time** (3.9 s of speech took 22.9 s), so the app skipped about half the sentences. Needs WebGPU, which was not available to test here |

### Update 8 Nov 2026: why Swiss dialect was so far off, and what changed
Same Zürich sample, Swiss specialist, Node CPU (`npm run test:node` / `npm run test:truecase`):

| Change | German (examples) | English (examples) |
|---|---|---|
| Before: 4-bit model, lowercase into opus-mt | "desto enger hat der wanderer sich in mantel **geholt**", "**schliesslein**", "sein mantel **abzogen**" | "the tighter the **peach** has taken in coat", "immediately the **pixie** took off his coat", "the more she has **bubble**" |
| 8-bit model (`q8`) | "sich in mantel **gehüllt**", "**schliesslich**", "seinen mantel **abgezogen**" | (same translator problem) |
| 8-bit + capitals put back (`truecase.js`) | "Desto enger hat der Wanderer sich in Mantel gehüllt." | "The **wanderer** has wrapped himself in a coat.", "And immediately the **wanderer took off his coat**." |

Still wrong: dialect words the model mishears ("Bise" → "beise/weise"), so some sentences stay odd ("The way has to admit
that the sun is stronger"). Speed on this CPU: 79 s for 53 s of audio (in the browser on WASM it is much slower; use WebGPU).
**Cloud engine:** built and checked in the browser (key handling, errors, CORS), but its translation quality on this
sample is **not measured yet** (no API key was available here). Run `GEMINI_API_KEY=... npm run test:cloud` to measure it.

Other Swiss German models checked on Hugging Face (8 Nov 2026), none ready for transformers.js yet: the model card of
`Flurin17/nemotron-3.5-transcribe-swiss-german` lists ASGDTS WER (lower is better): Nemotron fine-tune 17.4 % (30B, data-center GPU),
`matildecs/whisper-large-stt4sg` 20.1 %, Cohere fine-tune 20.8 %, Parakeet fine-tune 22.0 %, `Flix-AI/flix-swissgerman-full` 22.0 %
(Apache 2.0), `openai/whisper-large-v3-turbo` 26.4 %. The specialist used here claims 21.9 % (may be optimistic). Converting
another one to ONNX would bring only a few points and needs hosting the files.

In short: for real **Swiss dialect**, only the Swiss-tuned model gives a usable gist, and that needs a laptop with WebGPU (its live speed on WebGPU is untested here). On a
phone (whisper-base) expect **useful captions for Standard German** (many sermons, readings and songs) but **unreliable
captions for dialect**. The English from opus-mt is literal and sometimes odd, especially for lowercase dialect output ("Wanderer" →
"pall/pixie"). Treat the captions as a helpful gist, not a faithful translation.

## Run locally
```bash
npm ci               # first time only
npm run build        # after every change in src/ (dist/ is not committed)
npm run serve        # then open http://localhost:8080
```
The microphone only works on `localhost` or HTTPS, so to try it on a phone, use the GitHub Pages link.

Tests (copy and run as they are):
```bash
npm run test:node      # speech + translation on tests/audio/zurich16k.wav
npm run test:browser   # the real app in headless Chrome (start npm run serve first)
npm run test:offline   # checks the app gets to "Ready" with no network
npm run test:truecase  # lowercase Swiss output vs. with capitals put back, through opus-mt
GEMINI_API_KEY=... npm run test:cloud   # the cloud engine on the Zürich sample (sends it to Google; prints tokens)
```

## Published on GitHub Pages
Live at **https://famswinkler.github.io/swiss-translator/** (repo `famswinkler/swiss-translator`).
`.github/workflows/pages.yml` runs `npm ci && npm run build` on every push to `main` and publishes `dist/`
(`dist/` is not committed). The app uses only relative paths, so it works under the `/swiss-translator/` subpath.
In the repo, Settings, Pages, Source must be **GitHub Actions**. `embed-snippet.html`, `tests/` and this README are not deployed.

## Embedding
Use `embed-snippet.html` (iframe with `allow="microphone; screen-wake-lock; cross-origin-isolated"`). Inside an
iframe the AI usually runs single-threaded (slower), so a direct link or a full-screen button is better on phones.
The old single-file version was dropped: the Web Worker, AudioWorklet and service worker need separate files.

## Phone limits
- **iPhone/iPad:** WebGPU is on by default only from Safari/iOS 26 (transformers.js uses it there since mid-2026). Safari
  allows about 1.5 GB per tab, so use the **Fast** model on iPhone; *Better* may work on recent iPhones; *Swiss
  specialist* (≈1–2 GB in memory) will very likely crash the tab. The app uses CPU (WASM) on phones by default for
  reliability. Older iOS uses the plain ONNX runtime build (included).
- **Android Chrome:** works; mid-range phones handle *Fast* in real time, *Better* on flagship phones.
- **Battery/heat:** continuous AI uses a lot of power. Plug in for long services.
- **Background:** if the screen locks or you switch apps, the mic stops on iOS. The Wake Lock API keeps the screen on
  (iOS 16.4+; otherwise set Auto-Lock to Never). The app resumes audio when you come back.
- **Storage:** browsers may delete cached models when storage is low. The app asks for persistent storage, and if
  the model is deleted it simply downloads again.
- **Falling behind:** if a device is slower than real time, the app skips old audio and says so. Pick a smaller model.
- **Read aloud:** uses the device's own voices (local voices preferred) and needs earphones, otherwise the mic hears it.

## Files
`src/` (edit here) → `dist/` (built site):
`index.html`, `styles.css`, `app.js` (UI, mic, queue, read aloud, wake lock), `worker.js` (Whisper + translator),
`truecase.js` (German capitals before translating), `cloud.js` (optional Gemini engine),
`audio-worklet.js` (16 kHz resampler), `vad.js` (pause detection, joining pieces for the cloud, repeat cleaner), `models.js` (model list and sizes),
`sw.js` (offline + cross-origin isolation), `manifest.webmanifest`, `icons/`; `dist/lib/` (transformers.js + ONNX Runtime).
Also `build.mjs`, `serve.mjs`, `package.json`, `embed-snippet.html`, `.github/workflows/pages.yml`, `tests/`.
