// ────────────────────────────────────────────────────────────
//  Core game logic: move validation, word extraction, scoring
// ────────────────────────────────────────────────────────────

import { TILE_VALUES } from './tileData.js'
import { getBonusType }  from './boardData.js'

// ── Placed-tile helpers ───────────────────────────────────────

/** placements = [{row, col, letter, isBlank}] */
export function validatePlacement(board, placements, isFirstMove) {
  if (placements.length === 0) return { valid: false, error: 'No tiles placed.' }

  const rows = placements.map(p => p.row)
  const cols = placements.map(p => p.col)
  const minR = Math.min(...rows), maxR = Math.max(...rows)
  const minC = Math.min(...cols), maxC = Math.max(...cols)

  // All in same row OR same column
  const sameRow = minR === maxR
  const sameCol = minC === maxC
  if (!sameRow && !sameCol) return { valid: false, error: 'Tiles must be in a straight line.' }

  // Build a set of newly placed cells so we can distinguish them
  // from tiles that were already on the board before this turn.
  const newCells = new Set(placements.map(p => `${p.row},${p.col}`))

  // Check continuity (no gaps not filled by existing tiles)
  if (sameRow) {
    for (let c = minC; c <= maxC; c++) {
      const hasNew = placements.some(p => p.row === minR && p.col === c)
      const hasOld = board[minR][c] !== null && !newCells.has(`${minR},${c}`)
      if (!hasNew && !hasOld) return { valid: false, error: 'Tiles must be continuous (no gaps).' }
    }
  } else {
    for (let r = minR; r <= maxR; r++) {
      const hasNew = placements.some(p => p.row === r && p.col === minC)
      const hasOld = board[r][minC] !== null && !newCells.has(`${r},${minC}`)
      if (!hasNew && !hasOld) return { valid: false, error: 'Tiles must be continuous (no gaps).' }
    }
  }

  // First move must cover the centre square (7,7)
  if (isFirstMove) {
    const coversCentre = placements.some(p => p.row === 7 && p.col === 7)
    if (!coversCentre) return { valid: false, error: 'First word must cover the centre star ⭐.' }
  } else {
    // Must connect to at least one PRE-EXISTING tile (not one we just placed)
    const touches = placements.some(p => {
      const adjacent = [
        [p.row-1, p.col], [p.row+1, p.col],
        [p.row, p.col-1], [p.row, p.col+1],
      ]
      return adjacent.some(([r,c]) =>
        r >= 0 && r < 15 && c >= 0 && c < 15 &&
        board[r][c] !== null && !newCells.has(`${r},${c}`)
      )
    })
    if (!touches) return { valid: false, error: 'Word must connect to existing tiles.' }
  }

  return { valid: true }
}

// ── Word extraction ───────────────────────────────────────────

/** Given the board-with-new-tiles, extract every word formed */
export function extractWords(board, placements) {
  const words = []

  const rows = placements.map(p => p.row)
  const cols = placements.map(p => p.col)
  const minR = Math.min(...rows), maxR = Math.max(...rows)
  const minC = Math.min(...cols), maxC = Math.max(...cols)
  const sameRow = minR === maxR

  // Helper: read a word along a direction starting from a cell
  function readWord(startR, startC, dr, dc) {
    let r = startR - dr, c = startC - dc
    // Rewind to the beginning
    while (r >= 0 && r < 15 && c >= 0 && c < 15 && board[r][c]) {
      r -= dr; c -= dc
    }
    r += dr; c += dc
    const letters = []
    const cells   = []
    while (r >= 0 && r < 15 && c >= 0 && c < 15 && board[r][c]) {
      letters.push(board[r][c].letter)
      cells.push([r, c])
      r += dr; c += dc
    }
    return { word: letters.join(''), cells }
  }

  // Main word (along the direction of placement)
  if (sameRow) {
    const { word, cells } = readWord(minR, minC, 0, 1)
    if (word.length > 1) words.push({ word, cells })
  } else {
    const { word, cells } = readWord(minR, minC, 1, 0)
    if (word.length > 1) words.push({ word, cells })
  }

  // Cross-words (perpendicular to the placement direction)
  for (const p of placements) {
    const dr = sameRow ? 1 : 0
    const dc = sameRow ? 0 : 1
    const { word, cells } = readWord(p.row, p.col, dr, dc)
    if (word.length > 1) words.push({ word, cells })
  }

  return words
}

// ── Scoring ───────────────────────────────────────────────────

const newCellSet = (placements) =>
  new Set(placements.map(p => `${p.row},${p.col}`))

/** Calculate the total score for a set of placed words.
 *  layoutVersion selects which board bonus map to score against (per-game). */
export function calculateScore(board, placements, wordsWithCells, layoutVersion = 1) {
  const newCells = newCellSet(placements)
  let total = 0

  for (const { cells } of wordsWithCells) {
    let wordScore  = 0
    let wordMult   = 1

    for (const [r, c] of cells) {
      const tile    = board[r][c]
      const letter  = tile.letter
      const isNew   = newCells.has(`${r},${c}`)
      const bonus   = isNew ? getBonusType(r, c, layoutVersion) : null
      const val     = tile.isBlank ? 0 : (TILE_VALUES[letter] ?? 0)

      let letterVal = val
      if (bonus === 'DL') letterVal = val * 2
      if (bonus === 'TL') letterVal = val * 3
      wordScore += letterVal

      if (bonus === 'DW' || bonus === 'CT') wordMult *= 2
      if (bonus === 'TW')                   wordMult *= 3
    }
    total += wordScore * wordMult
  }

  // Bingo bonus: using all 7 tiles in one turn
  if (placements.length === 7) total += 50

  return total
}

// ── End-game detection ────────────────────────────────────────

/** Game ends when:
 *  (a) a player empties their rack and the bag is empty, OR
 *  (b) the bag is empty and all players pass/exchange consecutively
 *      (≥ 2 × numPlayers times) — a true endgame stalemate. With tiles
 *      still in the bag, passing never ends the game (c289: kills
 *      pass-out score farming; mid-bag quitters forfeit instead).
 */
export function isGameOver(bagLength, rack, consecutivePasses, numPlayers) {
  if (bagLength === 0 && rack.length === 0) return true
  if (bagLength === 0 && consecutivePasses >= numPlayers * 2) return true
  return false
}

/** Apply end-game rack penalties:
 *  each player loses points equal to their unplayed tile values;
 *  the emptying player gains the sum of all opponents' penalties */
export function applyEndgamePenalties(players, emptyingPlayerId) {
  const penaltyByPlayer = {}
  let totalPenalty = 0

  for (const p of players) {
    if (p.user_id === emptyingPlayerId) continue
    const penalty = p.rack.reduce((sum, t) => sum + (TILE_VALUES[t] ?? 0), 0)
    penaltyByPlayer[p.user_id] = penalty
    totalPenalty += penalty
  }

  return players.map(p => {
    if (p.user_id === emptyingPlayerId) {
      return { ...p, score: p.score + totalPenalty }
    }
    return { ...p, score: p.score - (penaltyByPlayer[p.user_id] ?? 0) }
  })
}

/** Apply end-game penalties and stamp is_winner on whichever players have
 *  the top score after penalties are settled. emptyingPlayerId is the user
 *  who emptied their rack (gets the bonus); pass null when the game ends
 *  via consecutive passes/exchanges (no one gets the bonus, only penalties). */
export function finalizeEndgame(players, emptyingPlayerId = null) {
  const withPenalties = applyEndgamePenalties(players, emptyingPlayerId)
  const maxScore = Math.max(...withPenalties.map(p => p.score))
  return withPenalties.map(p => ({ ...p, is_winner: p.score === maxScore }))
}
