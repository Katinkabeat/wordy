// ────────────────────────────────────────────────────────────
//  Legal-move generator (Appel & Jacobson anchor algorithm).
//
//  Given a board, a rack, and a Dictionary, enumerate EVERY legal
//  play and score each one (reusing the game's own extractWords +
//  calculateScore so a bot scores identically to a human).
//
//  This is the bot's "eyesight" — it finds the options. It does
//  NOT decide which to play (that's the evaluator, card c161).
//
//  How it works (horizontal pass; vertical = same on the transpose):
//   • Anchors = empty squares adjacent to an existing tile (or the
//     centre on an empty board). Every legal move covers an anchor.
//   • For each anchor we build the word's LEFT part (existing tiles
//     to the left, or new tiles drawn from the rack — capped so we
//     never cross another anchor, which guarantees left-part squares
//     have no cross-words) then EXTEND RIGHT through the anchor,
//     placing rack tiles / reading existing tiles, recording a play
//     whenever the trie node is a complete word.
//   • Cross-checks prune letters whose perpendicular word would be
//     invalid, so every recorded play forms only real words.
//
//  Pure & environment-agnostic (no DOM/fetch/fs). Shared by the
//  React client and the Deno bot-move edge function.
// ────────────────────────────────────────────────────────────

import { extractWords, calculateScore } from '../gameLogic.js'

const SIZE = 15
const CENTRE = 7
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

/**
 * Enumerate every legal play.
 * @param {Array<Array<{letter:string,isBlank?:boolean}|null>>} board 15×15
 * @param {string[]} rack letters; '?' = blank
 * @param {Dictionary} dict
 * @param {{layoutVersion?:number}} [opts]
 * @returns {Array<{placements:Array,words:string[],score:number,leave:string[],bingo:boolean}>}
 *          sorted by score descending (order only — ranking lives in c161)
 */
export function generateMoves(board, rack, dict, { layoutVersion = 1 } = {}) {
  const rackCounts = countTiles(rack)
  const moves = []
  const seen = new Set()

  const add = (placements) => {
    const key = placements
      .map(p => `${p.row},${p.col},${p.letter},${p.isBlank ? 1 : 0}`)
      .sort()
      .join('|')
    if (seen.has(key)) return
    const scored = scorePlay(board, placements, rack, layoutVersion)
    if (!scored) return // formed no word ≥2 letters → not a legal play
    seen.add(key)
    moves.push(scored)
  }

  // Horizontal plays on the board as-is …
  collectPlays(board, rackCounts, dict, (pl) => add(pl))
  // … then vertical plays via the transpose, mapping coords back.
  const t = transpose(board)
  collectPlays(t, rackCounts, dict, (pl) =>
    add(pl.map(p => ({ row: p.col, col: p.row, letter: p.letter, isBlank: p.isBlank }))),
  )

  moves.sort((a, b) => b.score - a.score)
  return moves
}

// ── Generation (all coordinates are in the given board's space) ──

function collectPlays(board, rackCounts, dict, onPlay) {
  const empty = isEmptyBoard(board)
  const crossCache = new Map()
  const ctx = { board, rackCounts, dict, onPlay, crossCache }

  for (let row = 0; row < SIZE; row++) {
    const anchors = empty
      ? (row === CENTRE ? new Set([CENTRE]) : new Set())
      : anchorCols(board, row)
    if (anchors.size === 0) continue
    for (const anchorCol of anchors) {
      genAnchor(ctx, row, anchorCol, anchors)
    }
  }
}

function genAnchor(ctx, row, anchorCol, anchors) {
  const { board, dict } = ctx
  if (anchorCol > 0 && board[row][anchorCol - 1]) {
    // Left part already on the board: read the existing prefix and
    // start the trie from there, then extend right.
    let c = anchorCol - 1
    let prefix = ''
    while (c >= 0 && board[row][c]) {
      prefix = board[row][c].letter + prefix
      c--
    }
    const node = dict.walk(prefix)
    if (node) extendRight(ctx, row, anchorCol, anchorCol, node, [], [])
  } else {
    // Empty to the left: how many empty, non-anchor squares can a
    // new left part occupy? (Stopping at anchors keeps left-part
    // squares free of cross-words and avoids duplicate generation.)
    let limit = 0
    let c = anchorCol - 1
    while (c >= 0 && !board[row][c] && !anchors.has(c)) {
      limit++
      c--
    }
    leftPart(ctx, row, anchorCol, dict.root, [], limit)
  }
}

function leftPart(ctx, row, anchorCol, node, leftLetters, limit) {
  extendRight(ctx, row, anchorCol, anchorCol, node, leftLetters, [])
  if (limit <= 0) return
  const { rackCounts } = ctx
  for (const [ch, child] of node.children) {
    // Plain tile as `ch`
    if (take(rackCounts, ch)) {
      leftLetters.push({ letter: ch, isBlank: false })
      leftPart(ctx, row, anchorCol, child, leftLetters, limit - 1)
      leftLetters.pop()
      give(rackCounts, ch)
    }
    // Blank used as `ch`
    if (take(rackCounts, '?')) {
      leftLetters.push({ letter: ch, isBlank: true })
      leftPart(ctx, row, anchorCol, child, leftLetters, limit - 1)
      leftLetters.pop()
      give(rackCounts, '?')
    }
  }
}

function extendRight(ctx, row, anchorCol, col, node, leftLetters, rightPlacements) {
  const { board, rackCounts, dict, crossCache, onPlay } = ctx

  if (col < SIZE && board[row][col]) {
    // Read through an existing tile.
    const child = node.children.get(board[row][col].letter)
    if (child) extendRight(ctx, row, anchorCol, col + 1, child, leftLetters, rightPlacements)
    return
  }

  // Empty square or off the right edge → maybe complete a word here.
  // Require ≥1 tile placed at/after the anchor (rightPlacements): the word
  // must COVER the anchor square, so a left-part-only word (which sits
  // entirely left of the anchor and wouldn't connect) is never recorded.
  if (node.terminal && rightPlacements.length > 0) {
    record(onPlay, row, anchorCol, leftLetters, rightPlacements)
  }
  if (col >= SIZE) return

  const cross = crossSet(board, row, col, dict, crossCache) // null = any letter ok
  for (const [ch, child] of node.children) {
    if (cross && !cross.has(ch)) continue
    if (take(rackCounts, ch)) {
      rightPlacements.push({ col, letter: ch, isBlank: false })
      extendRight(ctx, row, anchorCol, col + 1, child, leftLetters, rightPlacements)
      rightPlacements.pop()
      give(rackCounts, ch)
    }
    if (take(rackCounts, '?')) {
      rightPlacements.push({ col, letter: ch, isBlank: true })
      extendRight(ctx, row, anchorCol, col + 1, child, leftLetters, rightPlacements)
      rightPlacements.pop()
      give(rackCounts, '?')
    }
  }
}

function record(onPlay, row, anchorCol, leftLetters, rightPlacements) {
  const placements = []
  const L = leftLetters.length
  for (let i = 0; i < L; i++) {
    const t = leftLetters[i]
    placements.push({ row, col: anchorCol - L + i, letter: t.letter, isBlank: t.isBlank })
  }
  for (const t of rightPlacements) {
    placements.push({ row, col: t.col, letter: t.letter, isBlank: t.isBlank })
  }
  if (placements.length > 0) onPlay(placements)
}

// ── Cross-checks ─────────────────────────────────────────────

/** Letters allowed at an empty square so its perpendicular (vertical,
 *  in this board's space) word stays valid. null ⇒ no vertical
 *  neighbours ⇒ any letter is fine. Memoized per square per pass. */
function crossSet(board, row, col, dict, cache) {
  const key = row * SIZE + col
  if (cache.has(key)) return cache.get(key)

  const hasUp = row > 0 && board[row - 1][col]
  const hasDown = row < SIZE - 1 && board[row + 1][col]
  let result = null

  if (hasUp || hasDown) {
    let pre = ''
    for (let r = row - 1; r >= 0 && board[r][col]; r--) pre = board[r][col].letter + pre
    let post = ''
    for (let r = row + 1; r < SIZE && board[r][col]; r++) post += board[r][col].letter
    result = new Set()
    for (const letter of ALPHABET) {
      if (dict.has(pre + letter + post)) result.add(letter)
    }
  }

  cache.set(key, result)
  return result
}

// ── Scoring (reuses the game's own logic) ────────────────────

function scorePlay(board, placements, rack, layoutVersion) {
  const b = board.map(r => r.slice())
  for (const p of placements) b[p.row][p.col] = { letter: p.letter, isBlank: p.isBlank }

  const words = extractWords(b, placements) // [{ word, cells }]; only words ≥2 letters
  if (words.length === 0) return null       // single tile forming no real word → illegal

  const score = calculateScore(b, placements, words, layoutVersion)
  return {
    placements: placements.map(p => ({ ...p })),
    words: words.map(w => w.word),
    score,
    leave: computeLeave(rack, placements),
    bingo: placements.length === 7,
  }
}

function computeLeave(rack, placements) {
  const counts = countTiles(rack)
  for (const p of placements) {
    const key = p.isBlank ? '?' : p.letter
    if (counts[key]) counts[key]--
  }
  const leave = []
  for (const [k, n] of Object.entries(counts)) {
    for (let i = 0; i < n; i++) leave.push(k)
  }
  return leave
}

// ── Small helpers ────────────────────────────────────────────

function countTiles(rack) {
  const counts = {}
  for (const t of rack) counts[t] = (counts[t] || 0) + 1
  return counts
}
function take(counts, ch) {
  if (counts[ch] > 0) { counts[ch]--; return true }
  return false
}
function give(counts, ch) {
  counts[ch] = (counts[ch] || 0) + 1
}

function isEmptyBoard(board) {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) if (board[r][c]) return false
  }
  return true
}

function anchorCols(board, row) {
  const anchors = new Set()
  for (let c = 0; c < SIZE; c++) {
    if (board[row][c]) continue
    const adjacent =
      (row > 0 && board[row - 1][c]) ||
      (row < SIZE - 1 && board[row + 1][c]) ||
      (c > 0 && board[row][c - 1]) ||
      (c < SIZE - 1 && board[row][c + 1])
    if (adjacent) anchors.add(c)
  }
  return anchors
}

function transpose(board) {
  const t = Array.from({ length: SIZE }, () => Array(SIZE).fill(null))
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) t[c][r] = board[r][c]
  }
  return t
}
