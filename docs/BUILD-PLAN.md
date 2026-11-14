# Sermon Translator v2: build plan and hand-off prompts

Swiss German → English for sermons and prayer meetings, on an iPhone 17 Pro Max with AirPods.
Two outputs: **live English audio** in the AirPods and **live captions / transcript** on screen.

Written 14 Nov 2026 as a hand-off for another AI (Opus 5.5 or similar). Sections 6 and 7 are copy-paste prompts.

> **Read this first (for the building AI).** Facts marked **[verify]** come from web search summaries or vendor
> marketing. The primary docs (ai.google.dev, huggingface.co, arxiv.org) were not reachable when this was written.
> Open the primary doc before you code against any model id, price, language list or session limit below.
> Nobody has published an independent Swiss German comparison of the 2026 cloud engines, so **Phase 0 (the bake-off)
> decides the engine. Do not skip it.**

## 0. Decisions by the owner (14 Nov 2026)

| Topic | Decision | Effect on the plan |
|---|---|---|
| Budget | Not a limit, as long as quality is OK | Rank engines by quality first, delay second, cost last. Use the strongest models |
| Cloud | OK, also for prayer meetings | Cloud is the main path. On-device is only an offline fallback |
| Mac | Available | **Build a native iPhone app** (lock screen + reliable AirPods). The PWA stays as it is |
| Users | One listener (the owner's wife) now. Broadcast to more listeners later, if it works well | Personal API keys in the app first. Relay and web listener page are Phase 3 |
| Google Translate | Already tried: not good with Swiss German | Gemini Live Translate is probably the same engine family, so do not assume it wins. It stays in the bake-off as one candidate |
| Test sermon | https://youtu.be/37_2RC14xjM | Phase 0 reference audio. Private testing only, never committed |

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
| **Gemini Live Translate** (`gemini-3.5-live-translate-preview` **[verify]**) | Google docs: real-time speech-to-speech translation, 70+ languages, audio input only. German listed as `de`; Swiss German **not listed** | The owner found the Google Translate app (same family) weak on Swiss German, so expect the same here until the bake-off shows otherwise. Session length limit and resumption. Text transcripts alongside audio |
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

| **Large multimodal model on short audio chunks** (Gemini Pro / Flash audio in → English text out) **[verify]** | Skips the German transcript: the model hears the dialect itself and translates with full context | Not streaming: 5–10 s chunks, so more delay. May be the best quality. Must be in the bake-off |

Translator for 2b: **Claude** or **Gemini**, streaming, with the system prompt in section 7.1. Budget is not a limit,
so test the strong models too (Claude Sonnet 5.5 and Opus 5.5, Gemini Pro) next to the fast ones (Haiku 5.5, Gemini
Flash) and pick by quality at an acceptable delay. This step is where church vocabulary and context get fixed.

Best-quality idea to test: **two passes**. A fast pass gives the live caption and voice. A slower, stronger pass
re-translates each finished paragraph for the saved transcript.

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
- **Baseline already known:** the Google Translate app (Live Translate, Gemini-based) does not handle Swiss German well, per the owner. So the favourite before testing is a **Swiss-capable speech-to-text engine plus a strong LLM translator**, or a large multimodal model that hears the audio directly.
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
Shown in JS for brevity; the Swift app uses the same shape as a protocol with async streams.

```js
// engines/<name>
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
- Personal use: the user pastes their own key in Settings. Stored in the iOS Keychain on that phone only. Never committed, never sent anywhere except the provider.
- Broadcast later (Phase 3): a small relay holds the keys and listeners need none.

**PWA or native? Decided: native.** A Mac is available, and lock-screen use and clean AirPods routing matter for a
90-minute service. The PWA stays as it is (free, offline, no install) and later becomes the web listener page for
the broadcast.

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
| **0 Bake-off** (on the Mac) | Pick the engines with evidence | A side-by-side report on the test sermon, scored by the owner, with a named winner for text and for audio |
| **1 Native app: captions** | SwiftUI app, winning text engine, streaming captions, glossary, transcript | Live captions on the iPhone 17 Pro Max, under ~3 s behind the speaker, for a full sermon |
| **2 Native app: audio** | English voice in AirPods, lock-screen use | 90 minutes with the screen locked, AirPods in, no echo, no drift, survives a call and a network drop |
| **3 Broadcast** | One phone (or the sound desk) sends, many listen | A second person follows on their own phone through a link, with no API key |

**Test audio for Phase 0:** the sermon at https://youtu.be/37_2RC14xjM. Download the audio on the Mac for private
testing (for example with `yt-dlp -x`), convert to 16 kHz mono WAV, and keep it in `tests/bakeoff/audio/`
(git-ignored). Do not commit or publish it. Use three 5-minute cuts: start, middle, and the closing prayer if there
is one. If possible also record 5 minutes in the real room from a normal seat: room echo changes the result a lot.
The Zürich fixture in `tests/audio/` stays as a regression test.

**Device checklist (iPhone 17 Pro Max, current iOS, AirPods in)**
1. Which microphone is active (iPhone or AirPods)? Can the app select the iPhone mic?
2. Does the AirPods sound stay high quality while the mic is on, or drop to phone-call quality?
3. Does the translated voice leak back into the mic (echo loop)?
4. Does it survive: an incoming call, Siri, taking one AirPod out, 60 minutes on battery, a network drop?
5. Screen locked, phone in the pocket or on the seat: does it keep running for 90 minutes?
6. Better input: a USB-C audio interface or cable from the sound desk. Does the app see it as a mic?

---

## 5. Privacy and consent

- Cloud is approved by the owner, also for prayer meetings. Cloud engines still send the room's audio to a third party, so tell the group when the app is used in a prayer meeting.
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
   Suisse Speech API, Gemini transcribe, ElevenLabs Scribe realtime, Azure de-CH,
   a large multimodal model fed 5–10 s audio chunks (audio in, English text out),
   the Swiss-tuned Whisper turbo run locally on the Mac (stand-in for WhisperKit on the phone),
   and Grok voice if its API accepts the task.
   For every STT engine, also run its German text through the translator prompt in section 7.1 with
   Claude Haiku 5.5, Sonnet 5.5 and Opus 5.5, and Gemini Flash and Pro. Budget is not a limit: rank by quality.
3. API keys come from environment variables only. Skip an engine cleanly when its key is missing.
   Never print or commit a key.
4. Test audio: the sermon named in section 4 of the plan. Tell the user the exact commands to download and cut it
   on their Mac into tests/bakeoff/audio/ (git-ignored). Never commit it.
   tests/bakeoff/run.mjs runs all available engines on every file there (use tests/audio/zurich16k.wav when it
   is empty) and writes report.html: one row per ~10 s of audio,
   one column per engine, plus per engine: median and p95 delay behind the speaker, cost per hour,
   dropped or invented sentences, reconnects.
5. Add a simple human scoring sheet (0 = wrong, 1 = gist, 2 = correct, per row) saved to JSON, and a summary table.
   Do not invent an automatic quality score: we have no reference translation.
6. Finish with a short RESULTS.md: what was run, what was skipped and why, the numbers, and a recommendation
   for (A) speech-to-speech and (B) text, and whether the two-pass idea in section 2b is worth it.
   State plainly where the evidence is thin.

Do not change src/ in this task. Commit on the working branch and open a draft PR.
```

### 6.1 Phase 1: native app, captions

```text
Read docs/BUILD-PLAN.md and tests/bakeoff/RESULTS.md.

Task: create a SwiftUI app in ios/ (iOS 26+, iPhone only, tuned for iPhone 17 Pro Max) for one listener.

1. Audio capture with AVAudioEngine at 16 kHz mono. Input picker (built-in mic, AirPods, USB-C interface),
   live level meter, the active input shown by name.
2. An Engine protocol matching section 3 (async streams for partial lines, final lines, translated audio, status).
   Implement the winning text engine from the bake-off: streaming speech-to-text over URLSessionWebSocketTask,
   then streaming LLM translation with the prompt in section 7.1, a rolling context of the last ~6 final lines,
   the glossary and the context line. If the bake-off recommends the two-pass idea, re-translate each finished
   paragraph with the stronger model for the saved transcript.
3. Captions screen: one big Start button, large text with adjustable size, partial text that updates in place,
   lines that lock when final, auto-scroll with a "jump to live" button, optional German underneath.
4. Settings: engine picker, API keys in the Keychain (masked, with a "Test key" button), glossary editor
   preloaded from section 7.3, context line (speaker, church, topic, Bible passage if known).
5. Transcript: saved on the device per meeting, with Share / Copy / export (.txt and .md with timestamps)
   and Delete. Audio is never stored.
6. Robustness: auto-reconnect with backoff, session resumption where the API has it, fallback to the next
   engine after three failures with a one-line notice. Keep the screen awake while running.
7. Unit tests with a mock engine (partial then final, forced disconnect, fallback) and a file-input mode that
   plays a WAV through the same pipeline, so the test sermon can be replayed on the simulator.
8. README section: how to build and install from Xcode on the owner's Mac, step by step, for a non-developer.

State what you could not test without a real device and hand the user a short checklist.
```

### 6.2 Phase 2: native app, AirPods audio and lock screen

```text
Read docs/BUILD-PLAN.md (sections 3 and 4), tests/bakeoff/RESULTS.md and the ios/ app.

Task: add live English audio for AirPods and make the app run with the screen locked.

1. AVAudioSession .playAndRecord with A2DP output to the AirPods and the built-in mic as preferred input.
   Log currentRoute on every route change and show it on a diagnostics screen. Developers report that this
   routing is unreliable (see the Apple forum links in section 9), so detect and warn when iOS falls back to
   the AirPods mic or to phone-call audio quality, and offer a manual input picker.
2. Add the winning speech-to-speech engine (system instruction in section 7.2) if the bake-off found one that
   is good enough. Otherwise speak the final lines of the text engine with the best streaming TTS voice
   (provider TTS first, AVSpeechSynthesizer as offline fallback). Captions keep running in both cases.
3. Playback queue: gapless, with volume, pause, and a "catch up" rule (if more than ~8 s behind, speed up
   slightly or skip to the newest sentence boundary; never cut mid-word, never drop a sentence silently).
4. Background audio mode so it keeps running with the screen locked. Handle interruptions (calls, Siri,
   one AirPod removed) and resume by itself. Handle the provider's session time limit with resumption so a
   90-minute service runs unattended.
5. Lock-screen caption line as a Live Activity, and play/pause from the AirPods stem, if time allows.
6. Offline fallback (optional): WhisperKit with a Core ML conversion of the Swiss-tuned Whisper turbo
   (document the conversion; licence CC BY-NC 4.0) plus Apple's Translation framework for German to English.
7. Diagnostics screen with a "Copy report" button covering the device checklist in section 4.

You cannot test AirPods routing yourself: say so, and hand the user the checklist and TestFlight steps.
```

### 6.3 Phase 3: broadcast to several listeners

```text
Read docs/BUILD-PLAN.md and the ios/ app.

Task: let one sender share the live translation with other listeners who have no app and no API key.

1. A small relay (for example a Cloudflare Worker with a Durable Object): the sender's app posts caption
   lines (and, if cheap enough, the translated audio stream); listeners subscribe over WebSocket or SSE.
   A room is opened with a short code or QR link and closes when the sender stops. Nothing is stored.
2. Sender mode in the iOS app: a "Share" button that shows the QR code and the listener count.
3. Listener page: reuse the existing PWA (src/) as a light web page with big captions, optional read-aloud
   and an optional second target language translated on the relay. No account, no key.
4. Protect the relay: the sender authenticates with a secret, rooms are rate-limited, provider keys live only
   in the relay's secret store and never reach listeners.
5. Document costs per listener-hour and what the church must tell people about cloud processing.
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

## 8. Still open

1. **Audio source:** phone at the seat, or a feed from the sound desk? Decide after the first room test.
2. **Apple Developer account** (CHF 99/yr): without it, the app installed from Xcode must be re-installed every 7 days. Needed for TestFlight.
3. **API accounts:** keys for the bake-off candidates (Google AI Studio, Anthropic, OpenAI, Soniox, Suisse Speech, ElevenLabs, Azure, xAI). Missing keys only mean that engine is skipped.

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
