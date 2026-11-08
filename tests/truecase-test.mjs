// Usage: npm run test:truecase
// Shows how putting back German capital letters changes the English from the small translator (opus-mt).
// Input: lowercase German exactly as the Swiss German model wrote it for tests/audio/zurich16k.wav (8-bit model).
import { pipeline, env } from '@huggingface/transformers';
import { truecaserFromPipeline } from '../src/truecase.js';
env.cacheDir = process.env.MODEL_CACHE || './.model-cache';
const tr = await pipeline('translation', 'Xenova/opus-mt-de-en', { dtype: 'q8' });
const truecase = truecaserFromPipeline(tr);
if (!truecase) throw new Error('Could not read the translator vocabulary (transformers.js internals changed?)');
const lines = [
  'die beise und die sonne',
  'einmal haben sich die biesen und die sonne gestritten wer von ihnen beiden der stärker sei',
  'da ist ein wanderer daherkommen der hat einen warmen mantel angehabt',
  'wo als erstes der wanderer dazu bringen würde',
  'dass er seinen mantel abziehen',
  'die beise hat angefangen blasen so fest sie hat können',
  'aber je mehr sie blasen hat',
  'desto enger hat der wanderer sich in mantel gehüllt',
  'schliesslich hat die beisen aufgegeben',
  'dann hat die sonne angefangen ganz warm zu scheinen',
  'und sofort hat der wanderer seinen mantel abgezogen',
  'da hat die weise müssen zugeben dass die sonne stärker sei als sie',
];
// The same steps as worker.js: capital first letter + full stop, then translate.
const prep = s => s.charAt(0).toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? '' : '.');
const en = async s => (await tr(s, { max_new_tokens: Math.ceil(s.split(/\s+/).length * 2.5) + 10, no_repeat_ngram_size: 4 }))[0].translation_text;
for (const de of lines) {
  const cased = truecase(prep(de));
  console.log(`DE   ${cased}\nold  ${await en(prep(de))}\nnew  ${await en(cased)}\n`);
}
// Normal German (from Whisper base/small) must not be changed.
const normal = 'Der Nordwind und die Sonne stritten sich, wer von ihnen beiden wohl der Stärkere wäre.';
console.log(truecase(normal) === normal ? 'OK: normal German text is left unchanged' : 'FAIL: normal German text was changed');
