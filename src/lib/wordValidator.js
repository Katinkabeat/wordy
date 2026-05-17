// ────────────────────────────────────────────────────────────
//  Word validation using the Official Scrabble Players Dictionary
//  (TWL – Tournament Word List, ~173k words; patched with 2018 additions)
//
//  The word list lives in /public/words.txt and is loaded once
//  on first use, then cached in a Set for O(1) lookups.
// ────────────────────────────────────────────────────────────

let wordSet = null          // Set<string> (uppercase) once loaded
let loadPromise = null      // in-flight fetch — prevents duplicate requests

async function loadWordList() {
  if (wordSet) return wordSet
  if (loadPromise) return loadPromise

  loadPromise = fetch(`${import.meta.env.BASE_URL}words.txt`)
    .then(res => {
      if (!res.ok) throw new Error(`Failed to load word list: ${res.status}`)
      return res.text()
    })
    .then(text => {
      wordSet = new Set(text.split('\n').map(w => w.trim()).filter(Boolean))
      return wordSet
    })

  return loadPromise
}

export async function isValidWord(word) {
  const w = word.toUpperCase().trim()

  // Single-letter words: only A and I are valid in Scrabble
  if (w.length === 1) return ['A', 'I'].includes(w)

  try {
    const set = await loadWordList()
    return set.has(w)
  } catch {
    // If the word list can't be loaded, allow the word
    // (don't punish connectivity issues)
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
