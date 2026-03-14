// ────────────────────────────────────────────────────────────
//  Word validation using the Free Dictionary API
//  (https://dictionaryapi.dev) — no API key needed!
// ────────────────────────────────────────────────────────────

const cache = new Map()

export async function isValidWord(word) {
  const w = word.toUpperCase()
  if (cache.has(w)) return cache.get(w)

  // Single-letter "words" aren't valid in Scrabble (except I / A)
  if (w.length === 1 && !['A','I'].includes(w)) {
    cache.set(w, false)
    return false
  }

  try {
    const res = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${w.toLowerCase()}`
    )
    const valid = res.ok
    cache.set(w, valid)
    return valid
  } catch {
    // If the API is unreachable, we allow the word (don't punish connectivity issues)
    cache.set(w, true)
    return true
  }
}

/** Validate every word in a list. Returns { allValid, invalidWords } */
export async function validateWords(words) {
  const results = await Promise.all(
    words.map(async (w) => ({ word: w, valid: await isValidWord(w) }))
  )
  const invalidWords = results.filter(r => !r.valid).map(r => r.word)
  return { allValid: invalidWords.length === 0, invalidWords }
}
