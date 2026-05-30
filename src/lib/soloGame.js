// ────────────────────────────────────────────────────────────
//  Local (client-only) Solo game loop.
//
//  A pure, in-memory game state + reducers so a human can play
//  computer characters with NO Supabase, NO network — perfect for
//  practice and for tuning the bots. Mirrors the multiplayer game's
//  rules by reusing the SAME scoring/endgame logic (gameLogic.js)
//  and the SAME move engine (engine/), so a bot plays exactly as it
//  would server-side.
//
//  Persistence + stats (the "vs <character>" record) are deferred to
//  the server-backed path (card c163); a Solo game lives only in
//  memory for now.
//
//  State shape (kept compatible with ScorePanel / Board props):
//   { board, tileBag, players[], profiles{}, currentPlayerIdx,
//     consecutivePasses, status, layoutVersion,
//     lastMoveScores{}, lastMoveTiles[] }
//   player: { user_id, player_index, score, rack, is_winner, isBot, characterId? }
// ────────────────────────────────────────────────────────────

import { createTileBag, refillRack } from './tileData.js'
import { createEmptyBoard, CURRENT_LAYOUT_VERSION } from './boardData.js'
import { extractWords, calculateScore, isGameOver, finalizeEndgame } from './gameLogic.js'
import { DEFAULT_TILE_HUE } from './tileColors.js'
import { generateMoves, chooseMoveFor } from './engine/index.js'

export function isBoardEmpty(board) {
  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) if (board[r][c]) return false
  }
  return true
}

/** Start a new local game. seats = [{ characterId, name }] (one per bot). */
export function initSoloGame({ humanId, humanName, seats }) {
  const bag = createTileBag()
  const players = []
  const profiles = {}

  const human = refillRack([], bag)
  players.push({ user_id: humanId, player_index: 0, score: 0, rack: human.rack, is_winner: false, isBot: false })
  profiles[humanId] = { username: humanName || 'You' }

  seats.forEach((seat, i) => {
    const id = `bot-${seat.characterId}-${i + 1}`
    const drawn = refillRack([], bag)
    players.push({
      user_id: id, player_index: i + 1, score: 0, rack: drawn.rack,
      is_winner: false, isBot: true, characterId: seat.characterId,
    })
    profiles[id] = { username: seat.name }
  })

  return {
    board: createEmptyBoard(),
    tileBag: bag,
    players,
    profiles,
    currentPlayerIdx: 0,
    consecutivePasses: 0,
    status: 'active',
    layoutVersion: CURRENT_LAYOUT_VERSION,
    lastMoveScores: {},
    lastMoveTiles: [],
  }
}

const nextIdx = (state) => (state.currentPlayerIdx + 1) % state.players.length

/** Commit a tile placement by the current player. `placements` = [{row,col,letter,isBlank}]. */
export function applyPlay(state, placements) {
  const me = state.players[state.currentPlayerIdx]

  const board = state.board.map(r => r.slice())
  for (const p of placements) {
    board[p.row][p.col] = { letter: p.letter, isBlank: !!p.isBlank, hue: DEFAULT_TILE_HUE, uid: me.user_id }
  }

  const words = extractWords(board, placements)
  const turnScore = calculateScore(board, placements, words, state.layoutVersion)

  // Remove the used tiles from the rack, then refill from the bag.
  const rack = [...me.rack]
  for (const p of placements) {
    const tile = p.isBlank ? '?' : p.letter
    const idx = rack.indexOf(tile)
    if (idx !== -1) rack.splice(idx, 1)
  }
  const bag = [...state.tileBag]
  const refilled = refillRack(rack, bag)

  let players = state.players.map((pl, i) =>
    i === state.currentPlayerIdx ? { ...pl, score: pl.score + turnScore, rack: refilled.rack } : pl,
  )

  const over = isGameOver(refilled.bag.length, refilled.rack, 0, players.length)
  let status = state.status
  if (over) { players = finalizeEndgame(players, me.user_id); status = 'finished' }

  return {
    ...state,
    board,
    tileBag: refilled.bag,
    players,
    status,
    currentPlayerIdx: over ? state.currentPlayerIdx : nextIdx(state),
    consecutivePasses: 0,
    lastMoveScores: { [me.user_id]: turnScore },
    lastMoveTiles: placements.map(p => ({ row: p.row, col: p.col })),
    lastWords: words.map(w => w.word),
  }
}

/** Current player passes. */
export function applyPass(state) {
  const passes = state.consecutivePasses + 1
  const over = passes >= state.players.length * 2
  const players = over ? finalizeEndgame(state.players, null) : state.players
  return {
    ...state,
    players,
    consecutivePasses: passes,
    status: over ? 'finished' : state.status,
    currentPlayerIdx: over ? state.currentPlayerIdx : nextIdx(state),
    lastMoveScores: {},
    lastMoveTiles: [],
  }
}

/** Current player exchanges the rack tiles at `indices` (counts as a pass for end-game). */
export function applyExchange(state, indices) {
  const me = state.players[state.currentPlayerIdx]
  const rack = [...me.rack]
  const returned = indices.map(i => rack[i])
  const remaining = rack.filter((_, i) => !indices.includes(i))

  const bag = [...state.tileBag]
  const refilled = refillRack(remaining, bag)
  const newBag = [...refilled.bag, ...returned]

  let players = state.players.map((pl, i) =>
    i === state.currentPlayerIdx ? { ...pl, rack: refilled.rack } : pl,
  )

  const passes = state.consecutivePasses + 1
  const over = passes >= players.length * 2
  let status = state.status
  if (over) { players = finalizeEndgame(players, null); status = 'finished' }

  return {
    ...state,
    tileBag: newBag,
    players,
    consecutivePasses: passes,
    status,
    currentPlayerIdx: over ? state.currentPlayerIdx : nextIdx(state),
    lastMoveScores: {},
    lastMoveTiles: [],
  }
}

/**
 * Decide the current BOT's action. Returns one of:
 *   { type:'play', placements, move }  |  { type:'exchange', indices }  |  { type:'pass' }
 * @param {object} state
 * @param {Dictionary} dict
 * @param {{rng?:()=>number}} [opts]
 */
export function botDecide(state, dict, opts) {
  const bot = state.players[state.currentPlayerIdx]
  const moves = generateMoves(state.board, bot.rack, dict, { layoutVersion: state.layoutVersion })
  const choice = chooseMoveFor(moves, bot.characterId, opts)
  if (choice) return { type: 'play', placements: choice.placements, move: choice }

  // No legal play: dump tiles if the bag allows, else pass.
  const canSwap = Math.min(bot.rack.length, state.tileBag.length)
  if (canSwap > 0) return { type: 'exchange', indices: bot.rack.slice(0, canSwap).map((_, i) => i) }
  return { type: 'pass' }
}

/** Apply a decided bot action to the state. */
export function applyBotAction(state, action) {
  if (action.type === 'play') return applyPlay(state, action.placements)
  if (action.type === 'exchange') return applyExchange(state, action.indices)
  return applyPass(state)
}
