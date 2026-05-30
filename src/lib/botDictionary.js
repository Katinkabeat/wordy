// ────────────────────────────────────────────────────────────
//  Client-side bot dictionary loader.
//
//  Builds the engine's move-generation Dictionary from the same
//  words.txt the validator loads, and caches it for the session
//  (the trie is ~one-time work, reused across solo games).
//
//  NOTE: the full 173k-word trie costs memory in the browser — the
//  DAWG-minimization follow-up (c160) would cut that. Built lazily,
//  only when a Solo game actually starts.
// ────────────────────────────────────────────────────────────

import { getWordSet } from './wordValidator.js'
import { buildDictionary } from './engine/index.js'

let cached = null

export function loadBotDictionary() {
  if (!cached) cached = getWordSet().then(set => buildDictionary(set))
  return cached
}
