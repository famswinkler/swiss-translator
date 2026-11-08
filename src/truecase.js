/* truecase.js – puts the capital letters back into German text before it is translated.
 *
 * Why: German nouns are written with a capital letter (der Wanderer, der Mantel). The Swiss German
 * specialist model writes everything in lowercase, and the small German -> English translator then
 * misreads nouns: "der wanderer" came out as "the pixie", "the peach" or "the pall" in our test,
 * "der Wanderer" comes out as "the wanderer".
 *
 * How (no extra download): the translator already has a list of about 58,000 word pieces, each with a
 * number that says how common it is. If a word only appears with a capital letter ("Mantel" but not
 * "mantel"), it is a noun, so we capitalise it. If both spellings appear (leben / Leben), we only
 * capitalise after an article like "das", "ein" or "im" and only if the capital spelling is common.
 * Typical noun endings (-ung, -heit, -keit, ...) are capitalised too.
 *
 * Text that already has capitals inside it (Whisper base/small write normal German) is left as it is.
 * Works in the browser and in Node (used by tests/truecase-test.mjs).
 */

// Words after which a noun usually follows (articles, possessives, "im/zum/..." and similar).
const BEFORE_NOUN = new Set((
  'der die das den dem des ein eine einen einem einer eines kein keine keinen keinem keiner keines ' +
  'mein meine meinen meinem meiner meines dein deine deinen deinem deiner deines sein seine seinen seinem seiner seines ' +
  'ihr ihre ihren ihrem ihrer ihres unser unsere unseren unserem unserer unseres euer eure euren eurem eurer eures ' +
  'dieser diese diesen diesem dieses jeder jede jeden jedem jedes jener jene jenen jenem jenes ' +
  'welcher welche welchen welchem welches manche manchen alle allen viele vielen wenige wenigen ' +
  'im am zum zur beim vom ins ans aufs ums durchs fürs übers'
).split(' '));

// Endings that (almost) only nouns have.
const NOUN_ENDING = /(ung|ungen|heit|heiten|keit|keiten|schaft|schaften|tion|tionen|ität|itäten|nis|nisse|nissen|ling|linge|tum|tümer|ismus)$/;

// Never capitalise these, even after an article (pronouns, common verbs/adjectives that also exist as nouns).
const KEEP_LOWER = new Set('sie ihr er es wir ich du man sich mich dich uns euch ihm ihn ihnen'.split(' '));

const capitalise = w => w.charAt(0).toUpperCase() + w.slice(1);

/**
 * @param {(piece: string) => (number|undefined)} scoreOf  returns how common a word piece is
 *        (log-probability from the translator's vocabulary, e.g. -9.5), or undefined if unknown.
 *        Word pieces start with "▁" for "starts a word".
 * @returns {(text: string) => string}
 */
export function makeTruecaser(scoreOf) {
  return function truecase(text) {
    if (!text) return text;
    // Already normal German (capitals after the first letter)? Leave it alone.
    if (/\p{Lu}/u.test(text.slice(1))) return text;

    const parts = text.split(/(\s+)/);
    let prev = '';            // previous word (lowercase), for the "after an article" rule
    let sentenceStart = true;
    for (let i = 0; i < parts.length; i++) {
      const tok = parts[i];
      if (!tok || /^\s+$/.test(tok)) continue;
      const m = tok.match(/^([^\p{L}]*)(\p{L}[\p{L}'’-]*)(.*)$/u);
      if (!m) { if (/[.!?]$/.test(tok)) sentenceStart = true; continue; }
      const [, lead, word, trail] = m;
      const lower = word.toLowerCase();
      let out = word;

      if (sentenceStart) out = capitalise(word);
      else if (!KEEP_LOWER.has(lower)) {
        const lowScore = scoreOf('▁' + lower), capScore = scoreOf('▁' + capitalise(lower));
        if (capScore !== undefined && lowScore === undefined) out = capitalise(lower);        // only known as a noun
        else if (capScore !== undefined && lowScore !== undefined) {
          // Both exist: capitalise after an article if the noun spelling is at least fairly common.
          if (BEFORE_NOUN.has(prev) && capScore > lowScore - 1.5) out = capitalise(lower);
        } else if (lowScore === undefined && lower.length > 5 && NOUN_ENDING.test(lower)) out = capitalise(lower);
      }

      parts[i] = lead + out + trail;
      prev = lower;
      sentenceStart = /[.!?]["»”']?$/.test(trail);
    }
    return parts.join('');
  };
}

/** Build a truecaser from a transformers.js translation pipeline (opus-mt uses a "Unigram" word-piece list).
 *  Returns null if the vocabulary can't be read (then the text is simply translated as it is). */
export function truecaserFromPipeline(translator) {
  const model = translator && translator.tokenizer && translator.tokenizer._tokenizer && translator.tokenizer._tokenizer.model;
  if (!model || !model.tokens_to_ids || !model.scores) return null;
  return makeTruecaser(piece => {
    const id = model.tokens_to_ids.get(piece);
    return id === undefined ? undefined : model.scores[id];
  });
}
