// ────────────────────────────────────────────────────────────
//  Evaluator + difficulty profiles.
//
//  The generator (generator.js) finds EVERY legal play. This module
//  decides WHICH one a given character plays. One engine, dialed
//  down per character — not four separate AIs.
//
//  A profile is { tier, maxWordLength, allowBingo, rank, topK,
//  noise, useEquity, bingoSkip }:
//   • maxWordLength / allowBingo — the "vocabulary cap": weaker bots
//     simply don't reach for long/bingo plays (believable weakness =
//     short-word bias, NOT random nonsense).
//   • useEquity — only the expert weighs the rack LEAVE (what tiles
//     it keeps), via leaveValue() below. Others rank on raw score.
//   • rank / topK — where in the ranked list it picks (best / a
//     random top-K / mid-pack / lower-pack).
//   • noise — small chance of an off-pick, for unpredictability.
//   • bingoSkip — chance the bot "doesn't go for it" this turn and
//     leans on a shorter play (bingos dropped from the pool). A
//     believable difficulty dial for an otherwise-strong bot: caps
//     runaway multi-bingo games without random blunders (c177).
//
//  Selection takes an injectable rng so it's deterministic in tests.
//  Pure ESM — shared by client + bot-move edge function.
// ────────────────────────────────────────────────────────────

// Approximate single-tile leave values (heuristic, loosely after
// published tournament leaves; tune by playtest). A high value means
// "good to keep." Blank and S are the prizes; Q/V/W are baggage.
const TILE_LEAVE = {
  '?': 25, S: 8,
  E: 4, X: 3, Z: 3, A: 2, R: 2, H: 2, N: 1, D: 1, T: 1, I: 1, C: 1, M: 1,
  O: 0, L: 0, P: 0, K: 0, B: 0, G: 0, Y: 0,
  F: -1, U: -2, J: -2, W: -3, V: -4, Q: -6,
}

const VOWELS = new Set(['A', 'E', 'I', 'O', 'U'])

/**
 * Heuristic value of the tiles a play LEAVES on the rack. Higher = better
 * to keep. Rewards blanks/S, balances vowels vs consonants, penalizes
 * duplicates and a Q with no U.
 * @param {string[]} leave remaining rack tiles ('?' = blank)
 */
export function leaveValue(leave) {
  let v = 0
  const counts = {}
  for (const t of leave) {
    v += TILE_LEAVE[t] ?? 0
    counts[t] = (counts[t] || 0) + 1
  }
  // Duplicates are awkward to use up.
  for (const [t, n] of Object.entries(counts)) {
    if (t !== '?' && n > 1) v -= (n - 1) * 2
  }
  // Vowel/consonant balance only matters once you're holding a few tiles.
  if (leave.length >= 3) {
    const vowels = leave.filter(t => VOWELS.has(t)).length
    const cons = leave.filter(t => t !== '?' && !VOWELS.has(t)).length
    if (vowels === 0 || cons === 0) v -= 6
    else if (Math.abs(vowels - cons) >= 3) v -= 3
  }
  // Q with no way to follow it.
  if ((counts.Q || 0) > 0 && (counts.U || 0) === 0 && (counts['?'] || 0) === 0) v -= 4
  return v
}

// One profile per character. easy/medium/hard/expert.
export const PROFILES = {
  robin: { tier: 'easy', maxWordLength: 5, allowBingo: false, rank: 'low', noise: 0.25, useEquity: false },
  jay: { tier: 'medium', maxWordLength: 7, allowBingo: true, rank: 'mid', noise: 0.10, useEquity: false },
  merlin: { tier: 'hard', maxWordLength: 15, allowBingo: true, rank: 'topK', topK: 4, noise: 0.03, useEquity: false },
  // Expert, but no longer flawless (c177): she was scoring 500+ and winning
  // felt unattainable. Equity-aware short-word turns (bingoSkip) + a tight
  // top-3 pick keep her clearly the strongest bot while making a win reachable.
  claudette: { tier: 'expert', maxWordLength: 15, allowBingo: true, rank: 'topK', topK: 3, noise: 0.03, useEquity: true, bingoSkip: 0.30 },
}

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x))

/**
 * Choose one move from the generator's output per a difficulty profile.
 * @param {Array} moves output of generateMoves (each {score,leave,words,bingo,...})
 * @param {object} profile one of PROFILES
 * @param {{rng?:()=>number}} [opts] inject rng for deterministic tests
 * @returns the chosen move, or null if there are no plays (caller decides
 *          whether to exchange/pass — that policy lives in the edge fn, c162)
 */
export function chooseMove(moves, profile, { rng = Math.random } = {}) {
  if (!moves || moves.length === 0) return null

  // Vocabulary cap: weaker bots don't see long words or bingos. Fall back
  // to the full set if the cap leaves nothing, so the bot can always move.
  let pool = moves.filter(
    m => m.words.every(w => w.length <= profile.maxWordLength) && (profile.allowBingo || !m.bingo),
  )
  if (pool.length === 0) pool = moves.slice()

  // Bingo throttle: some turns a strong bot "doesn't go for it" and leans on
  // a shorter play. Drop bingos from the pool this turn (falling back if that
  // empties it). Believable difficulty without random blunders — see header.
  if (profile.bingoSkip && rng() < profile.bingoSkip) {
    const noBingo = pool.filter(m => !m.bingo)
    if (noBingo.length > 0) pool = noBingo
  }

  // Rank: expert weighs the leave (equity); everyone else ranks on raw score.
  const keyed = pool.map(m => ({
    m,
    key: profile.useEquity ? m.score + leaveValue(m.leave) : m.score,
  }))
  keyed.sort((a, b) => b.key - a.key)
  const n = keyed.length

  // Occasional off-pick for unpredictability.
  if (rng() < (profile.noise || 0)) {
    return keyed[Math.floor(rng() * n)].m
  }

  // Where in the ranking does this tier pick?
  let idx
  switch (profile.rank) {
    case 'best': idx = 0; break
    case 'topK': idx = Math.floor(rng() * Math.min(profile.topK || 3, n)); break
    case 'mid': idx = clamp(Math.floor(n * (0.35 + rng() * 0.3)), 0, n - 1); break
    case 'low': idx = clamp(Math.floor(n * (0.5 + rng() * 0.35)), 0, n - 1); break
    default: idx = 0
  }
  return keyed[idx].m
}

/** Convenience: choose a move for a named character (Robin/Jay/Merlin/Claudette). */
export function chooseMoveFor(moves, characterId, opts) {
  const profile = PROFILES[characterId]
  if (!profile) throw new Error(`Unknown character: ${characterId}`)
  return chooseMove(moves, profile, opts)
}
