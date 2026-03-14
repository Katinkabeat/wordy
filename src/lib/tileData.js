// ────────────────────────────────────────────────────────────
//  Scrabble tile data – letter values & counts (standard English)
// ────────────────────────────────────────────────────────────

export const TILE_VALUES = {
  A:1, B:3, C:3, D:2, E:1, F:4, G:2, H:4,
  I:1, J:8, K:5, L:1, M:3, N:1, O:1, P:3,
  Q:10,R:1, S:1, T:1, U:1, V:4, W:4, X:8,
  Y:4, Z:10,'?':0   // '?' = blank tile
}

const TILE_COUNTS = {
  A:9, B:2, C:2, D:4,  E:12, F:2, G:3, H:2,
  I:9, J:1, K:1, L:4,  M:2,  N:6, O:8, P:2,
  Q:1, R:6, S:4, T:6,  U:4,  V:2, W:2, X:1,
  Y:2, Z:1,'?':2
}

/** Build and return the full shuffled tile bag */
export function createTileBag() {
  const bag = []
  for (const [letter, count] of Object.entries(TILE_COUNTS)) {
    for (let i = 0; i < count; i++) bag.push(letter)
  }
  return shuffle(bag)
}

/** Draw `n` tiles from a bag (mutates the array). Returns drawn tiles. */
export function drawTiles(bag, n) {
  return bag.splice(0, n)
}

/** Refill a player's rack to 7 tiles */
export function refillRack(rack, bag) {
  const needed = 7 - rack.length
  if (needed <= 0 || bag.length === 0) return { rack, bag }
  const drawn = drawTiles(bag, Math.min(needed, bag.length))
  return { rack: [...rack, ...drawn], bag }
}

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
