/* audio-worklet.js – runs on the browser's audio thread.
 * It receives microphone audio at the device's rate (often 44.1 or 48 kHz),
 * converts it to 16 kHz mono (what Whisper expects) and sends ~100 ms blocks
 * to the main page. */
class Resampler16k extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;   // e.g. 48000 / 16000 = 3 input samples per output sample
    this.pos = 0;                      // fractional read position (for rates like 44.1 kHz)
    this.out = new Float32Array(1600); // 100 ms at 16 kHz
    this.n = 0;
    this.prev = 0;                     // last sample of the previous block (for interpolation)
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    // Linear interpolation between neighbouring samples (good enough for speech).
    while (this.pos < ch.length) {
      const i = Math.floor(this.pos), frac = this.pos - i;
      const a = i === 0 ? this.prev : ch[i - 1], b = ch[i];
      this.out[this.n++] = a + (b - a) * frac;
      if (this.n === this.out.length) { this.port.postMessage(this.out.slice()); this.n = 0; }
      this.pos += this.ratio;
    }
    this.pos -= ch.length;
    this.prev = ch[ch.length - 1];
    return true; // keep running
  }
}
registerProcessor('resampler-16k', Resampler16k);
