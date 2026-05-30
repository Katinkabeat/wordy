// ────────────────────────────────────────────────────────────
//  Wordy move engine — shared by the React client and the
//  server-side bot-move edge function. Pure ESM, no DOM/fetch/fs.
//
//  buildDictionary(words) → Dictionary   (build once, reuse)
//  generateMoves(board, rack, dict, opts) → scored legal plays
//
//  Difficulty/selection logic does NOT live here — see card c161.
// ────────────────────────────────────────────────────────────

export { buildDictionary, Dictionary } from './dictionary.js'
export { generateMoves } from './generator.js'
