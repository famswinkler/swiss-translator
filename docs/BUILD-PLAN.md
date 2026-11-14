# Sermon Translator v2: build plan and hand-off prompts

Swiss German → English for sermons and prayer meetings, on an iPhone 17 Pro Max with AirPods.
Two outputs: **live English audio** in the AirPods and **live captions / transcript** on screen.

Written 14 Nov 2026 as a hand-off for another AI (Opus 5.5 or similar). Sections 6 and 7 are copy-paste prompts.

> **Read this first (for the building AI).** Facts marked **[verify]** come from web search summaries or vendor
> marketing. The primary docs (ai.google.dev, huggingface.co, arxiv.org) were not reachable when this was written.
> Open the primary doc before you code against any model id, price, language list or session limit below.
> Nobody has published an independent Swiss German comparison of the 2026 cloud engines, so **Phase 0 (the bake-off)
> decides the engine. Do not skip it.**

---

## 1. What we have today (v1, this repo)

A static PWA on GitHub Pages. Everything runs in the browser, offline after one download.

```
mic → audio-worklet.js (16 kHz) → vad.js (cut at pauses) → worker.js (Whisper → opus-mt de→en) → captions (+ speechSynthesis)
```

**Keep**
- Clean module split (`app.js` UI, `worker.js` models, `vad.js`, `audio-worklet.js`, `sw.js`).
- Offline mode, pinned model revisions, wake lock, auto-resume of the mic.
- Test rig: Zürich German and Standard German fixtures, node + headless-browser + offline tests.
- An honest README with measured results.

**Problems (measured in the README, or visible in the code)**

| # | Problem | Where |
|---|---|---|
| 1 | Phone default is `whisper-base`: Swiss dialect comes out mostly wrong | `src/models.js` `defaultModelKey` |
| 2 | The only model that understands dialect (Swiss turbo) is ~6× slower than real time on CPU/WASM | README test table |
| 3 | WebGPU is switched off on every phone, so the iPhone 17 Pro Max never uses its GPU. `?device=` can only force WASM | `src/app.js` `canUseGPU()` |
| 4 | `opus-mt-de-en` translates one fragment at a time, literally, with no context and no church vocabulary | `src/worker.js` `translateGerman` |
| 5 | Captions appear only after a pause (2–8 s, up to 12 s for a preacher who does not pause). No streaming partial text | `src/vad.js`, `MAX_QUEUE` |
| 6 | Read-aloud drops sentences when it falls behind (`speechSynthesis.cancel()`), and uses robotic system voices | `src/app.js` `readAloud` |
| 7 | AirPods are not handled: no mic choice, no check of which mic iOS picked, no audio output path besides `speechSynthesis` | `src/app.js` `startMic` |
| 8 | Stops when the screen locks or the app goes to the background (PWA limit on iOS) | README "Phone limits" |
| 9 | No transcript export, no glossary, no speaker/context hints | — |

**Conclusion:** the on-device browser path cannot give good dialect quality on a phone today. It stays as the
**offline / private fallback**. The main path becomes a cloud engine chosen by a bake-off.

---

## 2. Engine candidates

"Swiss German" is the hard part. Standard German is easy for every engine. All quality claims below are unproven for
dialect until Phase 0.

### 2a. Speech → English audio directly (one model, lowest delay)

| Engine | What the sources say | Open questions |
|---|---|---|
| **Gemini Live Translate** (`gemini-3.5-live-translate-preview` **[verify]**) | Google docs: real-time speech-to-speech translation, 70+ languages, audio input only. German listed as `de`; Swiss German **not listed** | Dialect quality. Session length limit and resumption. Text transcripts alongside audio. Price. Whether a free tier covers it |
| **OpenAI `gpt-realtime-translate`** **[verify]** | Released May 2026. 70+ input languages, 13 output languages. Own endpoint `/v1/realtime/translations`. About $0.034/min per a third-party aggregator | Dialect quality. Confirm price on OpenAI's page |
| **Grok Voice Agent API** | Realtime voice, 25+ languages. No dedicated translation mode found. Language list not published | Whether Swiss German is understood at all. Would need an "interpreter" system prompt |

### 2b. Speech → text (streaming), then a text model translates

| Engine | What the sources say | Open questions |
|---|---|---|
| **Soniox** | Vendor claims one German model that handles Bavarian, Swabian and Swiss German. Real-time WebSocket, built-in real-time translation, about $0.12/h **[verify]** | Vendor claim only |
| **Suisse Speech API** (suisse-speech.ch) | Swiss vendor, hosted in Zürich. Swiss German in → Standard German text out, real-time WebSocket, CHF 2.20/h **[verify]** | Vendor claim only. Data stays in Switzerland, which matters for prayer meetings |
| **Gemini 3.5 Transcribe / Flash audio** **[verify]** | 85+ languages, "handles regional accents and dialects". Lists `de-DE` only | Is it streaming or chunked? Dialect quality |
| **ElevenLabs Scribe v2 Realtime** | <150 ms, 90+ languages. Swiss German not named | Dialect quality |
| **Azure Speech `de-CH`** | Long-standing Swiss German locale | No 2026 numbers found |

Translator for 2b: **Claude** (Haiku 5.5 for speed, Sonnet 5.5 for quality) or **Gemini Flash**, streaming, with the
system prompt in section 7.1. This is where church vocabulary and context get fixed.

### 2c. On-device (offline, private)

| Engine | Where it runs | Notes |
|---|---|---|
| Swiss-tuned Whisper turbo (`Flurin17/whisper-large-v3-turbo-swiss-german`, **CC BY-NC 4.0**) via **WebGPU in Safari** | PWA | Never tried on an iPhone: v1 blocks WebGPU on phones. Safari's per-tab memory limit may kill it. Cheap to test (Phase 1, step 1) |
| Same model via **WhisperKit / Core ML** | Native app only | Argmax reports real-time large-v3-turbo on recent iPhones. No iPhone 17 Pro number found. Needs a Core ML conversion of the fine-tune |
| Apple Translation framework (de→en, on-device) | Native app only | Text translation offline |
| `whisper-base` + `opus-mt` (today's default) | PWA | Keep as last resort |

Research note: a June 2026 arXiv paper (2606.07608) reports ~25.6 % WER for a fine-tuned Whisper on the All Swiss
German Dialects Test Set (28.6 % for plain large-v3) and warns that published 17 % results are inflated by benchmark
contamination. So expect roughly one word in four to differ from the reference, even with the best open model. Much of
that is harmless wording variation, but it is why the translator step needs context and a glossary.

### 2d. What your current AI subscriptions can and cannot do

- **Gemini:** best fit. It is the only one of the three with a documented real-time speech translation model. Runs through the **Gemini API** (key from Google AI Studio).
- **Claude:** no audio input or realtime voice endpoint found in the API **[verify]**. Use it for the **text translation** step and to **build the app**.
- **Grok:** realtime voice API exists. Unproven for Swiss German and no translation mode. Bake-off candidate only.
- **Important:** the Gemini / Claude / Grok *app subscriptions* do not include API usage. The app needs **API keys**, billed per use (a 90-minute service should cost cents to a few francs, depending on engine).
- **Zero-build baseline, try this Sunday:** the **Google Translate app → Live Translate** works on iOS with any headphones (German → English, 70+ languages, Gemini-based). Swiss German is not listed. If it already copes with your preacher, that tells us Gemini Live Translate is the engine to build on.
- Apple's own AirPods Live Translation supports German (Germany) only, and needs AirPods Pro 2 / AirPods 4 ANC or newer.

---

## 3. Target architecture

One app, pluggable engines, two output channels.

```
                         ┌──────────────── Engine (chosen in Settings) ────────────────┐
mic ─► capture ─► 16 kHz │ A  s2s-cloud   : audio ─► Live Translate ─► EN audio + text │─► AirPods (audio queue)
(built-in mic,    PCM    │ B  text-cloud  : audio ─► streaming STT ─► LLM translate    │─► captions (partial + final)
 or line-in)             │ C  on-device   : audio ─► Whisper ─► local translate        │─► transcript (save / share)
                         └─────────────────────────────────────────────────────────────┘
```

**Modes the user sees**
- **Listen** (AirPods): English voice, small captions. Engine A, or B + TTS.
- **Read**: big captions only, no audio. Engine B (best text quality) or C.
- **Private / offline**: engine C. Default suggestion for prayer meetings (see section 5).

**Engine interface (JS, PWA)**
```js
// src/engines/<name>.js
export default {
  id, label, needsKey, sendsAudioToCloud,
  async start({ onPartial, onFinal, onAudio, onStatus, glossary, context }) {},
  pushAudio(float32_16k) {},        // called by the capture pipeline
  async stop() {}
};
// onPartial({de, en})  live, may change      onFinal({de, en, t0, t1})  fixed line
// onAudio(Int16Array, sampleRate)  translated speech for the playback queue
```

**Rules for every engine**
- Streaming: show partial text within about 1 s, lock a line when the sentence is final.
- Auto-reconnect with backoff. Use session resumption where the API has it. Never lose the transcript on reconnect.
- If the engine fails three times, fall back to the next engine and tell the user in one line.
- Send the glossary and a short context line ("Sermon, Swiss German, Reformed/evangelical church, speaker: …").
- Never store audio. Transcript stays on the device unless the user taps Share.

**API keys**
- Personal use: the user pastes their own key in Settings. Stored in `localStorage` on that phone only. Never committed, never sent anywhere except the provider.
- Sharing the app with others later: add a small relay (for example a Cloudflare Worker) that hands out short-lived tokens. Out of scope until needed.

**PWA or native?** Start as a PWA (no Mac, no App Store, reuses v1). Go native only if the device tests in Phase 2 fail.

| Need | PWA (Safari, Home Screen) | Native (SwiftUI) |
|---|---|---|
| Cloud engines, captions | Yes | Yes |
| English audio in AirPods | Yes via Web Audio **[device test]** | Yes |
| iPhone mic in + AirPods out at high quality | Uncertain. iOS may switch to the AirPods mic and phone-call audio quality | Possible but tricky (`AVAudioSession` `.playAndRecord` + `.allowBluetoothA2DP` + preferred input). Developers report mixed results **[device test]** |
| Works with the screen locked / in the pocket | **No** | Yes (background audio mode) |
| Strong on-device Swiss model | Maybe (WebGPU spike) | Yes (WhisperKit) |
| What you need | Nothing new | A Mac with Xcode, and an Apple Developer account (CHF 99/yr) for TestFlight |

---

## 4. Phases

| Phase | Goal | Done when |
|---|---|---|
| **0 Bake-off** | Pick the engine with evidence | A side-by-side report on real sermon audio, and a named winner for audio (A) and for text (B) |
| **1 PWA v2 captions** | Engine plug-ins, streaming captions, glossary, transcript export, WebGPU spike | Winner B runs live on the iPhone with partial captions under ~2 s behind the speaker |
| **2 PWA v2 audio** | English voice in AirPods, mic picker, route checks | 30 minutes continuous listening on the iPhone 17 Pro Max with AirPods, no feedback, no drift |
| **3 Native (only if needed)** | Lock-screen use, reliable AirPods routing, WhisperKit offline | Phase 2 device checklist had a hard fail that matters to you |
| **Later** | One phone at the sound desk broadcasts to many listeners | Several people ask for it |

**Test audio for Phase 0 (you provide):** 10–15 minutes from a real sermon and 5 minutes of a prayer meeting from
your own church (with permission), recorded on the iPhone from a normal seat. Add the names of the speakers' dialects
if you know them. The Zürich fixture in `tests/audio/` stays as a regression test.

**Phase 2 device checklist (iPhone 17 Pro Max, current iOS, AirPods in)**
1. Which microphone is active (iPhone or AirPods)? Can the app select the iPhone mic?
2. Does the AirPods sound stay high quality while the mic is on, or drop to phone-call quality?
3. Does the translated voice leak back into the mic (echo loop)?
4. Does it survive: an incoming call, Siri, taking one AirPod out, 60 minutes on battery, a network drop?
5. Screen locked: does it stop? (Expected yes for the PWA. Workaround: wake lock + low brightness.)
6. Better input: a USB-C audio interface or cable from the sound desk. Does Safari offer it as a mic?

---

## 5. Privacy and consent

- Cloud engines send the room's audio to a third party. For a **sermon** that is usually fine. For a **prayer meeting**, people share personal things: ask the group first, or use the on-device engine or a Swiss-hosted one.
- Show a clear badge on screen: "Cloud (Google)" / "On this device".
- No audio is stored. Transcripts stay local, with one "Delete transcript" button.
- Model licence: the Swiss-tuned Whisper is CC BY-NC 4.0 (non-commercial only).

---

## 6. Build prompts for Opus 5.5

Give each prompt as its own session in this repo, in order. Each one assumes the AI has read this file.

### 6.0 Phase 0: bake-off

```text
Read docs/BUILD-PLAN.md fully, then README.md and tests/.

Task: build an engine bake-off under tests/bakeoff/ so we can choose the speech engine with evidence.

1. First open the primary docs for every candidate in section 2 of the plan and correct any model id, endpoint,
   price, language list or session limit that is wrong or marked [verify]. Record what you verified, with links and
   dates, in tests/bakeoff/SOURCES.md. If a doc host is blocked, say so and stop guessing.
2. Write one Node script per engine (tests/bakeoff/engines/<name>.mjs) with the same interface:
   input = a 16 kHz mono WAV, streamed in real time (20–100 ms chunks, not uploaded as one file);
   output = JSON lines {t_audio, t_wall, kind: partial|final, de, en}. For speech-to-speech engines also save the
   returned audio as WAV.
   Candidates: Gemini Live Translate, OpenAI realtime translate, Soniox (STT + its translation),
   Suisse Speech API, Gemini transcribe, the repo's current on-device pipeline (baseline),
   and Grok voice if its API accepts the task.
   For every STT engine, also run its German text through the translator prompt in section 7.1 with
   Claude Haiku 5.5, Claude Sonnet 5.5 and Gemini Flash.
3. API keys come from environment variables only. Skip an engine cleanly when its key is missing.
   Never print or commit a key.
4. tests/bakeoff/run.mjs runs all available engines on every file in tests/bakeoff/audio/ (git-ignored;
   use tests/audio/zurich16k.wav when it is empty) and writes report.html: one row per ~10 s of audio,
   one column per engine, plus per engine: median and p95 delay behind the speaker, cost per hour,
   dropped or invented sentences, reconnects.
5. Add a simple human scoring sheet (0 = wrong, 1 = gist, 2 = correct, per row) saved to JSON, and a summary table.
   Do not invent an automatic quality score: we have no reference translation.
6. Finish with a short RESULTS.md: what was run, what was skipped and why, the numbers, and a recommendation
   for (A) speech-to-speech and (B) text. State plainly where the evidence is thin.

Do not change src/ in this task. Commit on the working branch and open a draft PR.
```

### 6.1 Phase 1: PWA v2, captions

```text
Read docs/BUILD-PLAN.md and tests/bakeoff/RESULTS.md.

Task: turn the app into engine plug-ins and add the winning cloud text engine, keeping everything that works.

1. Refactor without changing behaviour: move the current Whisper + opus-mt path behind the engine interface
   in section 3 (src/engines/on-device.js). All three existing tests must still pass.
2. Add src/engines/<winner-B>.js: streaming STT plus streaming LLM translation with the prompt from section 7.1.
   Partial captions update in place; a line is locked when final. Keep a rolling context of the last ~6 final
   lines for the translator. Auto-reconnect and fallback as in "Rules for every engine".
3. Settings: engine picker with a visible badge (cloud provider name, or "On this device"), API key fields
   (localStorage only, masked, with a "Test key" button), glossary editor preloaded from section 7.3,
   context line (speaker, church, topic, Bible passage if known).
4. Transcript: keep the full session in memory and IndexedDB, with Share / Copy / Download (.txt and .md with
   timestamps, English with German underneath) and a Delete button. No audio is ever stored.
5. WebGPU spike for the offline engine: let ?device=webgpu force WebGPU on phones (today canUseGPU() blocks it),
   and add a hidden "Try Swiss model on this phone" button that loads the q4f16 Swiss turbo and reports
   speed versus real time and whether the tab survived. Do not make it a default.
6. Update the service worker so cloud calls are never cached and the app shell still works offline.
7. Tests: a mock engine for the headless browser test (partial then final lines, a forced disconnect,
   a fallback). Keep the offline test. Update README honestly, including measured delay on a real run.

Constraints: plain JS, no framework, no new build step beyond build.mjs. Keys never leave the device except to
the provider. Keep the big-button simplicity: a listener must be able to start with one tap.
```

### 6.2 Phase 2: audio in AirPods

```text
Read docs/BUILD-PLAN.md (sections 3 and 4) and the current src/.

Task: add live English audio for AirPods.

1. Add src/engines/<winner-A>.js (speech-to-speech). Stream mic PCM up, receive translated audio and, if the API
   offers them, input and output transcripts for the captions. Use the system instruction in section 7.2.
   Handle the provider's session time limit with resumption so a 90-minute service runs unattended.
2. Playback: a jitter-buffered Web Audio queue (AudioWorklet), gapless, with volume, a "catch up" rule
   (if more than ~8 s behind, speed up slightly or skip to the newest sentence boundary, never cut mid-word),
   and a pause button. Remove the speechSynthesis.cancel() behaviour that drops sentences.
3. For the text engine, add optional TTS of final lines through the same queue (provider TTS first,
   speechSynthesis as fallback).
4. Microphone: list inputs with enumerateDevices, default to the iPhone's built-in mic when AirPods are
   connected, show the active mic name and a live level meter, and warn when the AirPods mic is in use.
   Turn echoCancellation on while audio is playing.
5. Add a diagnostics page (?diag) that records, for the Phase 2 device checklist in section 4: active input
   and output, sample rates, AudioContext state changes, reconnects, delay, and dropouts. One button copies
   the report as text so the user can paste it back to us.
6. Document in the README exactly what was tested on a real iPhone and what was only tested in headless Chrome.
   You cannot test AirPods routing yourself: say so, and hand the user the checklist.
```

### 6.3 Phase 3: native app (only if Phase 2 fails the checklist)

```text
Read docs/BUILD-PLAN.md and the diagnostics report the user pasted from Phase 2.

Task: create a SwiftUI app in ios/ (iOS 26+, iPhone only) that reuses the same engine design.

- AVAudioSession .playAndRecord with A2DP output to AirPods and the built-in mic as preferred input; log
  currentRoute on every route change and show it in a diagnostics screen. Background audio mode so it keeps
  running with the screen locked. Handle interruptions (calls, Siri) and resume.
- Engines: the cloud winners over URLSessionWebSocketTask; offline engine with WhisperKit running a Core ML
  conversion of the Swiss-tuned Whisper turbo (document the conversion; licence CC BY-NC 4.0) plus Apple's
  Translation framework for German to English.
- Keys in the Keychain. Same glossary, context line, transcript export and privacy badge as the PWA.
- Live Activity / lock-screen caption line if time allows.
- State what you could not test without a device, and give the user a TestFlight checklist.
```

---

## 7. Runtime prompts (used inside the app)

### 7.1 Translator system prompt (text engine: Claude or Gemini)

```text
You are a live interpreter for a Christian church service. You receive a running German transcript of a sermon
or prayer spoken in Swiss German. It comes from automatic speech recognition, so it contains errors:
misheard words, missing punctuation, dialect words written phonetically, sentences cut in the middle.

Translate into clear, natural English for a listener who follows along in real time.

Rules
1. Output only the English translation of the NEW segment. No notes, no brackets, no explanations.
2. Be faithful. Do not add, soften, embellish or summarise. If the speaker repeats himself, keep it short but
   keep the meaning.
3. Use the previous lines only as context for pronouns, topic and unfinished sentences. Never re-translate them.
4. If a word is clearly a recognition error, translate what the speaker most likely said, guided by the
   context and the glossary. If a passage is unintelligible, write "[unclear]" and do not guess.
5. If the segment ends mid-sentence, translate what is there and stop. Do not complete the thought yourself.
6. Scripture: when the speaker quotes or reads the Bible, translate it accurately in a formal, literal style
   and keep the reference as spoken (for example "Romans 8, verse 28"). Do not insert verse text he did not say.
7. Reverence: write names of GOD in capitals (GOD, LORD, YAHWEH), and capitalise His titles (Father, Son,
   Holy Spirit, Saviour, King, Judge, Shepherd) and pronouns (He, Him, His, You, Your).
8. Prayers: keep direct address and a reverent tone ("LORD, we thank You ...").
9. Keep Swiss place names and personal names as spoken. Swiss numbers, dates and money stay as said.
10. Plain words, short sentences. This may be read aloud by a voice.

Context for this meeting: {{context_line}}
Glossary (German or dialect → English). Always prefer these: {{glossary}}
Previous lines (context only): {{last_lines}}
New segment to translate: {{segment}}
```

### 7.2 System instruction (speech-to-speech engine)

```text
You are a simultaneous interpreter in a Christian church service. The speaker talks in Swiss German dialect,
sometimes Standard German. Interpret everything into natural spoken English, continuously, in a calm and clear
voice, staying as close behind the speaker as you can.

- Interpret only. Never answer questions, never comment, never speak for yourself.
- Be faithful: do not add, omit, soften or summarise.
- Bible readings: formal, accurate wording; keep references as spoken.
- Prayers: keep the direct, reverent address to GOD.
- If you did not understand a passage, stay silent for it rather than inventing something.
- Ignore singing, music, coughing and background talk.
- Vocabulary to prefer: {{glossary}}
- Context: {{context_line}}
```

### 7.3 Starter glossary (edit in the app)

| German / dialect | English |
|---|---|
| Gmeind, Gemeinde | church, congregation |
| Predigt, Predig | sermon |
| bätte, beten / Gebät, Gebet | to pray / prayer |
| Fürbitte | intercession |
| Lobpreis, Aabätig (Anbetung) | praise, worship |
| Gnad, Gnade | grace |
| Busse, Umkehr | repentance |
| Bekehrung | conversion |
| Wiedergeburt | new birth, being born again |
| Erlösig, Erlösung | redemption, salvation |
| Rechtfertigung | justification |
| Heiligung | sanctification |
| Vergäbig, Vergebung | forgiveness |
| Sünd, Sünde | sin |
| Heiland, Erlöser | Saviour, Redeemer |
| Herr, Herrgott | LORD |
| Heilige Geischt, Heiliger Geist | Holy Spirit |
| Geistesgaben | gifts of the Spirit |
| Zungenrede, Sprachengebet | speaking in tongues |
| Weissagung, Prophetie | prophecy |
| Abendmahl | the Lord's Supper, communion |
| Taufe, Tauf | baptism |
| Säge, Segen | blessing |
| Jünger, Jüngerschaft | disciple, discipleship |
| Älteste | elders |
| Hauskreis, Kleingruppe | small group, home group |
| Stille Zeit | quiet time |
| Zeugnis | testimony |
| Opfer, Kollekte | offering |
| Rych Gottes, Reich Gottes | Kingdom of GOD |
| Herrlichkeit | glory |
| Uferstehig, Auferstehung | resurrection |
| Evangelium | gospel |
| Bund | covenant |
| Glaube, Glaube(n) | faith |

---

## 8. Open decisions for the owner

1. **Budget:** is a few francs per service for a cloud engine acceptable?
2. **Prayer meetings:** cloud allowed with consent, or on-device / Swiss-hosted only?
3. **Native app:** do you have a Mac, and would you pay for an Apple Developer account, if the PWA cannot do lock-screen or clean AirPods routing?
4. **Audio source:** phone at your seat, or can you get a feed from the sound desk?
5. **Who uses it:** only you, or several listeners (needs the relay / broadcast later)?

## 9. Sources (searched 14 Nov 2026)

- Gemini Live Translate docs: https://ai.google.dev/gemini-api/docs/live-api/live-translate
- Gemini 3.5 Transcribe docs: https://ai.google.dev/gemini-api/docs/models/gemini-3.5-transcribe
- Google Translate Live Translate on iOS: https://blog.google/products-and-platforms/products/translate/google-translate-ios-android-upgrades/
- OpenAI realtime translation guide: https://developers.openai.com/api/docs/guides/realtime-translation
- xAI voice docs: https://docs.x.ai/docs/guides/voice
- Soniox German: https://soniox.com/speech-to-text/german and https://soniox.com/speech-translation
- Suisse Speech API: https://suisse-speech.ch/
- ElevenLabs Scribe v2 Realtime: https://elevenlabs.io/blog/introducing-scribe-v2-realtime
- Swiss German Whisper fine-tuning paper: https://arxiv.org/abs/2606.07608
- "Does Whisper understand Swiss German?" (UZH): https://arxiv.org/pdf/2404.19310
- WhisperKit paper: https://arxiv.org/abs/2507.10860
- Apple forum threads on built-in mic + Bluetooth output: https://developer.apple.com/forums/thread/784318 and https://developer.apple.com/forums/thread/741513
- AirPods Live Translation languages: https://www.macrumors.com/2025/09/22/ios-26-1-apple-intelligence-languages/
