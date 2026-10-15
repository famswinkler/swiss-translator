// build.mjs – makes the static site in dist/ (upload dist/ to GitHub Pages, Netlify, any web host).
// Copies src/ and the transformers.js + ONNX Runtime files (so no CDN is needed at run time).
import fs from 'fs'; import path from 'path';
const root = path.dirname(new URL(import.meta.url).pathname), dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(path.join(root, 'src'), dist, { recursive: true });
fs.mkdirSync(path.join(dist, 'lib'));
const nm = path.join(root, 'node_modules');
const lib = [
  ['@huggingface/transformers/dist/transformers.min.js', 'transformers.min.js'],
  // ONNX Runtime WebAssembly engine (CPU + WebGPU). transformers.js looks for these in lib/.
  // plain build: used by browsers without WebGPU support (e.g. iOS < 26)
  ['onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.mjs'],
  ['onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.wasm'],
  // asyncify build: used with WebGPU (Chrome/Edge, Safari 26+) and on desktop
  ['onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.mjs'],
  ['onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm', 'ort-wasm-simd-threaded.asyncify.wasm'],
];
for (const [from, to] of lib) fs.copyFileSync(path.join(nm, from), path.join(dist, 'lib', to));
fs.writeFileSync(path.join(dist, '.nojekyll'), '');
console.log('Built dist/:', fs.readdirSync(dist).join(', '));
