// THE token symbol (ticker) rule – one module for the create form
// (lib/createValidate.ts, pages/Create.tsx), the REST quote/prepare validator
// and the MCP tools (backend/src/v1.js, backend/src/mcp.js), the SDK widget
// (sdk/element.ts), and every place that cuts a symbol short for a monogram or
// a label.
//
// The rule (owner decision 2026-09-23): any script – Latin, Cyrillic, CJK,
// Arabic, emoji, whatever – exactly like the token name; at least one
// character and at most TICKER_MAX = 11 of them, counted BOTH ways:
//   - at most 11 UTF-16 code units – what MetaMask counts, and the bound that
//     binds (see below);
//   - at most 11 user-perceived characters (grapheme clusters) – implied by the
//     first, since every character takes at least one unit, and stated anyway.
// The ends are trimmed and the symbol is upper-cased (a script without case is
// unchanged by that); only whitespace and control characters are refused
// inside it – with the invisible format characters and blank fillers counted
// among them (see TICKER_FORBIDDEN). No look-alike check of any kind.
//
// Why 11, and why in UTF-16 units: ERC-20 puts no limit on symbol(), the
// contracts impose none, and the one external limit that matters is MetaMask,
// which refuses a longer symbol when the token is added to the wallet:
//   - wallet_watchAsset – TokensController.watchAsset():
//     `if (asset.symbol.length > 11) throw … longer than 11 characters`
//     (MetaMask/core packages/assets-controllers/src/TokensController.ts);
//   - the "Import tokens" form – custom-token-import.tsx:
//     `next.length === 0 || next.length >= 12` -> "Symbol must be 11
//     characters or fewer." (MetaMask/metamask-extension).
// Both measure JavaScript .length, i.e. UTF-16 code units. The cap exists only
// because of MetaMask, so it is measured exactly as MetaMask measures it: a
// ticker that passes here is one MetaMask accepts. The two counts agree for
// Latin, Cyrillic, Greek, Arabic, Hebrew, CJK and Hangul (one unit per
// character); an emoji takes two units or more (🐱 2, a flag or a skin tone 4,
// the ZWJ family 11, the kiss with two skin tones 15), and a combining accent
// or an Indic vowel sign or virama is a unit of its own ("नमस्ते" is three
// characters, six units). Graphemes remain what every slice, monogram and the
// input filter cut by – never half an emoji, never a letter without its accent.
//
// Plain ESM with no dependencies (like networks.mjs and tokenArt.mjs) so the
// node backend and every bundler can import it. Nothing runs at module load:
// the Intl.Segmenter is created on first use, so a bundle that imports this
// file without calling it (the pinned SDK) tree-shakes it away entirely.

/** Most characters a ticker may have – MetaMask's limit – counted in UTF-16
 *  code units (JavaScript .length, as MetaMask counts) and in graphemes. */
export const TICKER_MAX = 11;

/** Refused inside a ticker:
 *  - whitespace and control characters (C0/C1) – the owner's rule;
 *  - format characters (Unicode Cf): the bidirectional controls (an unclosed
 *    override reorders the text around the symbol wherever it is printed),
 *    the zero-width space, word joiner, soft hyphen, U+180E, the interlinear
 *    annotation marks… – each prints as nothing, so a ticker made of them
 *    shows as a bare "$". Kept: the zero-width non-joiner and joiner (emoji
 *    sequences, Indic/Persian spelling) and the tag characters U+E0020–E007F
 *    (the Scotland, England and Wales flags are built from them);
 *  - the blank fillers U+115F, U+1160, U+3164, U+FFA0 (Hangul) and U+2800
 *    (braille blank), which print as an empty cell – whitespace in all but
 *    name;
 *  - lone surrogates (not a character at all – they cannot be encoded as
 *    UTF-8). */
export const TICKER_FORBIDDEN = /[\p{White_Space}\p{Cc}\p{Cs}\u115F\u1160\u3164\uFFA0\u2800]|(?![\u200C\u200D\u{E0020}-\u{E007F}])\p{Cf}/u;
const FORBIDDEN_ALL = /[\p{White_Space}\p{Cc}\p{Cs}\u115F\u1160\u3164\uFFA0\u2800]|(?![\u200C\u200D\u{E0020}-\u{E007F}])\p{Cf}/gu;
/** At least one code point that prints on its own: a joiner, a variation
 *  selector, a tag character or an accent with no letter to sit on is not a
 *  ticker. */
const VISIBLE = /[^\p{Default_Ignorable_Code_Point}\p{M}]/u;

let segmenter; // undefined = not tried yet, null = no Intl.Segmenter here

/** The grapheme clusters of `s` (Intl.Segmenter; code points where the
 *  runtime has no segmenter – a fallback that can only over-count). */
export function graphemes(s) {
  const str = String(s ?? '');
  if (segmenter === undefined) {
    segmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
      ? new Intl.Segmenter('en', { granularity: 'grapheme' })
      : null;
  }
  return segmenter ? Array.from(segmenter.segment(str), (x) => x.segment) : Array.from(str);
}

/** User-perceived length of `s`. */
export function graphemeCount(s) {
  return graphemes(s).length;
}

/** The first `n` user-perceived characters of `s` – never half an emoji,
 *  never a base letter without its accent. */
export function graphemeSlice(s, n) {
  return graphemes(s).slice(0, Math.max(0, n)).join('');
}

/** Whole graphemes from the start of `s` while the total stays within
 *  `maxUnits` UTF-16 code units – a unit cap that never splits a character:
 *  the first one that does not fit is dropped whole, and so is everything
 *  after it. */
export function graphemeClip(s, maxUnits) {
  let out = '';
  for (const g of graphemes(s)) {
    if (out.length + g.length > maxUnits) break;
    out += g;
  }
  return out;
}

/** The symbol as it is signed: ends trimmed, upper-cased. */
export function normalizeTicker(raw) {
  return String(raw ?? '').trim().toUpperCase();
}

/** True when `raw`, normalised, is a legal ticker: 1..TICKER_MAX UTF-16 code
 *  units (MetaMask's count) and 1..TICKER_MAX graphemes, at least one of them
 *  visible, no whitespace, control or format characters inside. */
export function tickerOk(raw) {
  if (raw == null || (typeof raw !== 'string' && typeof raw !== 'number')) return false;
  const t = normalizeTicker(raw);
  // MetaMask's count first – it is the one that binds, and a megabyte posted
  // to the API is refused on its length without being segmented.
  if (!t || t.length > TICKER_MAX) return false;
  if (TICKER_FORBIDDEN.test(t) || !VISIBLE.test(t)) return false;
  return graphemeCount(t) <= TICKER_MAX;
}

/** What the create form keeps of a keystroke or a paste: upper-cased, every
 *  refused character removed (so a space simply does not type), cut to
 *  TICKER_MAX UTF-16 code units on a grapheme boundary – the first character
 *  that does not fit is dropped whole (never half an emoji, never an emoji
 *  sequence cut into a different one), and a joiner left dangling at the end
 *  of what is kept goes with it – and empty when nothing visible is left.
 *  Everything else – any script, emoji – stays. Whatever it returns, tickerOk
 *  accepts (or it is empty). */
export function tickerInput(raw) {
  // The refused characters go before segmenting: two pieces they separated
  // may join into one cluster once they are gone.
  const s = String(raw ?? '').toUpperCase().replace(FORBIDDEN_ALL, '');
  let out = graphemeClip(s, TICKER_MAX);
  // "A\u200D" + "🐱" are two clusters: with the cat cut off, the joiner joins
  // nothing – and would glue the next character typed onto the kept text.
  // Only after a cut: a joiner typed last ("क्\u200Dष", one keystroke at a
  // time) waits for the letter that follows it.
  if (out.length < s.length) out = out.replace(/\u200D+$/, '');
  return VISIBLE.test(out) ? out : '';
}
