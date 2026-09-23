/** Most characters a ticker may have – MetaMask's 11-character symbol limit
 *  (wallet_watchAsset and the import form) – counted in UTF-16 code units, as
 *  MetaMask counts (JavaScript .length), and in graphemes. */
export const TICKER_MAX: 11;
/** Whitespace, control and format characters (except ZWNJ, ZWJ and the flag
 *  tag characters), blank fillers and lone surrogates. */
export const TICKER_FORBIDDEN: RegExp;
/** Grapheme clusters of `s` (code points where Intl.Segmenter is missing). */
export function graphemes(s: unknown): string[];
/** User-perceived length of `s`. */
export function graphemeCount(s: unknown): number;
/** The first `n` graphemes of `s`. */
export function graphemeSlice(s: unknown, n: number): string;
/** Whole graphemes of `s` while the total stays within `maxUnits` UTF-16 units. */
export function graphemeClip(s: unknown, maxUnits: number): string;
/** Ends trimmed, upper-cased – the symbol as it is signed. */
export function normalizeTicker(raw: unknown): string;
/** Any script, 1..TICKER_MAX UTF-16 code units (an emoji takes two or more)
 *  and 1..TICKER_MAX graphemes, at least one visible, no whitespace, control
 *  or format characters. */
export function tickerOk(raw: unknown): boolean;
/** The create form's keystroke filter: upper-cased, refused characters removed,
 *  cut to TICKER_MAX UTF-16 units on a grapheme boundary (a character that does
 *  not fit is dropped whole, a dangling joiner with it), empty when nothing
 *  visible is left. */
export function tickerInput(raw: unknown): string;
