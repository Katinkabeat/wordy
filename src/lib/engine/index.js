// ────────────────────────────────────────────────────────────
//  Wordy move engine — shared by the React client and the
//  server-side bot-move edge function. Pure ESM, no DOM/fetch/fs.
//
//  buildDictionary(words) → Dictionary   (build once, reuse)
//  generateMoves(board, rack, dict, opts) → scored legal plays
//  chooseMove(moves, profile) / chooseMoveFor(moves, characterId)
//    → the play a given difficulty/character makes
//  PROFILES — per-character difficulty config; leaveValue — leave heuristic
// ────────────────────────────────────────────────────────────

export { buildDictionary, Dictionary } from './dictionary.js'
export { generateMoves } from './generator.js'
export { chooseMove, chooseMoveFor, PROFILES, leaveValue } from './evaluator.js'
