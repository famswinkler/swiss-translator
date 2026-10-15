/* vad.js – a tiny "voice activity detector" (VAD) and sentence chopper.
 *
 * Whisper works on pieces of audio, not on an endless stream. This file cuts the
 * microphone stream (16 kHz, mono, Float32 samples) into pieces at natural pauses:
 *   - every 30 ms frame gets a loudness value (RMS energy)
 *   - we track the background noise level and call a frame "speech" if it is clearly louder
 *   - a piece ends after a pause (default 0.6 s) or when it gets too long (default 12 s);
 *     long pieces are cut at the quietest moment of their last 3 seconds
 * No AI model is needed, so it is fast on any phone. (Silero VAD would be more accurate
 * but needs another model download.)
 *
 * Works in the browser and in Node (used by the test script).
 */
export class Segmenter {
  constructor(onSegment, opts = {}) {
    this.onSegment = onSegment;               // called with (Float32Array audio, {reason})
    this.rate = 16000;
    this.frame = 480;                         // 30 ms at 16 kHz
    this.pauseMs = opts.pauseMs ?? 600;       // silence that ends a sentence
    this.maxSec = opts.maxSec ?? 12;          // never send more than this to Whisper
    this.minSpeechMs = opts.minSpeechMs ?? 400;
    this.preRollMs = 300;                     // keep a bit of audio before speech starts
    this.noise = 0.003;                       // running estimate of background loudness
    this.reset();
  }
  reset() {
    this.frames = [];        // Float32Array frames of the current piece
    this.energies = [];
    this.inSpeech = false; this.silentFrames = 0; this.speechFrames = 0;
    this.pre = [];           // pre-roll frames while waiting for speech
    this.buf = new Float32Array(0);
    this.level = 0;          // last loudness, for the on-screen meter
  }
  /** Feed any number of 16 kHz samples. */
  push(samples) {
    const all = new Float32Array(this.buf.length + samples.length);
    all.set(this.buf); all.set(samples, this.buf.length);
    let i = 0;
    for (; i + this.frame <= all.length; i += this.frame) this._frame(all.slice(i, i + this.frame));
    this.buf = all.slice(i);
  }
  /** Send whatever is left (e.g. when the user presses Stop). */
  flush() { if (this.inSpeech) this._emit('flush'); this.reset(); }

  _frame(f) {
    let sum = 0; for (let k = 0; k < f.length; k++) sum += f[k] * f[k];
    const rms = Math.sqrt(sum / f.length); this.level = rms;
    // Noise floor: falls quickly, rises slowly (so speech does not count as noise).
    this.noise = rms < this.noise ? this.noise * 0.9 + rms * 0.1 : this.noise * 0.999 + rms * 0.001;
    const isSpeech = rms > Math.max(this.noise * 3, 0.006);
    const frameMs = 1000 * this.frame / this.rate;

    if (!this.inSpeech) {
      this.pre.push(f); if (this.pre.length > this.preRollMs / frameMs) this.pre.shift();
      if (isSpeech) { this.inSpeech = true; this.frames = [...this.pre]; this.energies = this.pre.map(() => 0); this.pre = []; this.silentFrames = 0; this.speechFrames = 0; }
      else return;
    }
    this.frames.push(f); this.energies.push(rms);
    if (isSpeech) { this.speechFrames++; this.silentFrames = 0; } else this.silentFrames++;

    if (this.silentFrames * frameMs >= this.pauseMs) return this._emit('pause');
    if (this.frames.length * frameMs >= this.maxSec * 1000) {
      // Too long: cut at the quietest frame in the last 3 s and keep the rest for the next piece.
      const look = Math.round(3000 / frameMs), start = this.frames.length - look;
      let best = start; for (let k = start; k < this.frames.length; k++) if (this.energies[k] < this.energies[best]) best = k;
      const rest = this.frames.splice(best), restE = this.energies.splice(best);
      this._emit('max', true);
      this.inSpeech = true; this.frames = rest; this.energies = restE; this.speechFrames = rest.length; this.silentFrames = 0;
    }
  }
  _emit(reason, keepState) {
    const frameMs = 1000 * this.frame / this.rate;
    if (this.speechFrames * frameMs >= this.minSpeechMs) {
      // drop most of the trailing silence (Whisper invents words in silence)
      let n = this.frames.length; if (reason === 'pause') n = Math.max(1, n - this.silentFrames + 6);
      const out = new Float32Array(n * this.frame);
      for (let k = 0; k < n; k++) out.set(this.frames[k], k * this.frame);
      this.onSegment(out, { reason });
    }
    if (!keepState) { this.inSpeech = false; this.frames = []; this.energies = []; this.silentFrames = 0; this.speechFrames = 0; }
  }
}

/** Remove Whisper "hallucination loops" like "die leute und die leute und die leute ...". */
export function cleanRepeats(text) {
  let words = text.trim().split(/\s+/);
  for (let n = 1; n <= 6; n++) {                 // phrase length to check
    const out = [];
    for (let i = 0; i < words.length; i++) {
      out.push(words[i]);
      // if the last n words equal the n words before them, drop the repeat
      if (out.length >= 2 * n) {
        const a = out.slice(-n).join(' ').toLowerCase(), b = out.slice(-2 * n, -n).join(' ').toLowerCase();
        if (a === b) out.splice(-n, n);
      }
    }
    words = out;
  }
  return words.join(' ');
}
