/* models.js – the list of AI models the app can use (all run ON the device).
 *
 * Sizes are the one-time download in MB (measured on Hugging Face, 2026-10-13).
 * "dtype" says which compressed version of the model to download:
 *    q8 / q4   = 8-bit / 4-bit compressed (smaller, a little less accurate)
 *    fp16/fp32 = full precision (bigger)
 * WebGPU (graphics chip) and WASM (normal CPU) need different versions.
 */
export const SPEECH_MODELS = {
  base: {
    label: 'Fast – Whisper base (phones)',
    id: 'onnx-community/whisper-base',
    wasm:   { dtype: 'q8', mb: 77 },
    webgpu: { dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, mb: 206 },
    canTranslateDirectly: true,
    note: 'Small and quick. Weak on Swiss dialect, OK on Standard German.'
  },
  small: {
    label: 'Better – Whisper small',
    id: 'onnx-community/whisper-small',
    wasm:   { dtype: 'q8', mb: 249 },
    webgpu: { dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, mb: 586 },
    webgpuF16: { dtype: { encoder_model: 'fp16', decoder_model_merged: 'q4' }, mb: 410 },
    canTranslateDirectly: true,
    note: 'Good on Standard German. Needs about 1 GB of free memory.'
  },
  swiss: {
    label: 'Swiss German specialist – Whisper turbo (laptops)',
    id: 'onnx-community/whisper-large-v3-turbo-swiss-german-ONNX',
    // 8-bit, not 4-bit: in our test (tests/audio/zurich16k.wav) 4-bit made more word errors
    // ("geholt" for "gehüllt", "schliesslein", "sein mantel abzogen") at the same speed.
    wasm:   { dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' }, mb: 1083 },
    webgpu: { dtype: { encoder_model: 'q4', decoder_model_merged: 'q4' }, mb: 759 },          // GPUs without 16-bit support (rare)
    webgpuF16: { dtype: { encoder_model: 'fp16', decoder_model_merged: 'fp16' }, mb: 1618 },  // full quality on the graphics chip
    canTranslateDirectly: false,   // fine-tuned to write German only, so we always use the translator model
    note: 'Trained on Swiss German (Flurin17, licence CC BY-NC 4.0 = non-commercial). Better with dialect than Fast/Better, but still makes mistakes (for dialect also try the cloud engine in ⚙︎). Big download. Needs a laptop WITH WebGPU: on CPU only it is far slower than real time.'
  }
};

// Small German -> English text translator, used after Whisper writes German.
export const TRANSLATOR_MODEL = { id: 'Xenova/opus-mt-de-en', dtype: 'q8', mb: 106 };

/** Pick a sensible default for this device. */
export function defaultModelKey({ isMobile, hasWebGPU, memoryGB }) {
  if (isMobile || (memoryGB && memoryGB <= 4)) return 'base';
  if (hasWebGPU) return 'swiss';
  return 'small';
}
