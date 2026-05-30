// ────────────────────────────────────────────────────────────
//  Lexicon as a prefix trie, for the move generator.
//
//  The generator needs to walk the word list letter-by-letter
//  (forward) and ask "is this a complete word?" at each step. A
//  trie gives both in O(1) per character.
//
//  Pure & environment-agnostic: build it from any iterable of
//  words (the client passes its loaded Set; the edge function
//  passes the lines of words.txt). No fetch / fs / import.meta here.
//
//  NOTE: a minimized DAWG would cut memory ~10× over this plain
//  trie for the full 173k-word list. Deferred as a perf follow-up
//  (card c160) — the generator's interface won't change.
// ────────────────────────────────────────────────────────────

function makeNode() {
  return { children: new Map(), terminal: false }
}

export class Dictionary {
  constructor(root) {
    this.root = root
  }

  /** Walk from the root following every char of `prefix`.
   *  Returns the reached node, or null if the path doesn't exist. */
  walk(prefix) {
    let node = this.root
    for (let i = 0; i < prefix.length; i++) {
      node = node.children.get(prefix[i])
      if (!node) return null
    }
    return node
  }

  /** Is `word` a complete entry in the lexicon? */
  has(word) {
    const node = this.walk(String(word).toUpperCase())
    return !!node && node.terminal
  }
}

/** Build a Dictionary from an iterable of words (case-insensitive). */
export function buildDictionary(words) {
  const root = makeNode()
  for (const raw of words) {
    const w = String(raw).trim().toUpperCase()
    if (!w) continue
    let node = root
    for (let i = 0; i < w.length; i++) {
      const ch = w[i]
      let next = node.children.get(ch)
      if (!next) {
        next = makeNode()
        node.children.set(ch, next)
      }
      node = next
    }
    node.terminal = true
  }
  return new Dictionary(root)
}
