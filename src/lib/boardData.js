// ────────────────────────────────────────────────────────────
//  15×15 bonus square layouts (versioned per game)
//  TW = Triple Word  |  DW = Double Word
//  TL = Triple Letter|  DL = Double Letter
//  CT = Centre star (also DW)
//
//  Each game stores `board_layout_version`. Existing/in-progress games are
//  version 1 (the original Scrabble layout). New games use CURRENT_LAYOUT_VERSION
//  so a layout change never alters a board already in play.
// ────────────────────────────────────────────────────────────

const TW = 'TW', DW = 'DW', TL = 'TL', DL = 'DL', CT = 'CT'

// Version used for all newly-created games.
export const CURRENT_LAYOUT_VERSION = 2

// V1 — original Scrabble layout (kept so games started before the change are unaffected).
const BONUS_MAP_V1 = {
  '0,0':TW,  '0,7':TW,  '0,14':TW,
  '7,0':TW,  '7,14':TW,
  '14,0':TW, '14,7':TW, '14,14':TW,

  '1,1':DW,  '2,2':DW,  '3,3':DW,  '4,4':DW,
  '1,13':DW, '2,12':DW, '3,11':DW, '4,10':DW,
  '10,4':DW, '11,3':DW, '12,2':DW, '13,1':DW,
  '10,10':DW,'11,11':DW,'12,12':DW,'13,13':DW,
  '7,7':CT,

  '1,5':TL,  '1,9':TL,
  '5,1':TL,  '5,5':TL,  '5,9':TL,  '5,13':TL,
  '9,1':TL,  '9,5':TL,  '9,9':TL,  '9,13':TL,
  '13,5':TL, '13,9':TL,

  '0,3':DL,  '0,11':DL,
  '2,6':DL,  '2,8':DL,
  '3,0':DL,  '3,7':DL,  '3,14':DL,
  '6,2':DL,  '6,6':DL,  '6,8':DL,  '6,12':DL,
  '7,3':DL,  '7,11':DL,
  '8,2':DL,  '8,6':DL,  '8,8':DL,  '8,12':DL,
  '11,0':DL, '11,7':DL, '11,14':DL,
  '12,6':DL, '12,8':DL,
  '14,3':DL, '14,11':DL,
}

// V2 — "Faithful Clipped": an original, non-copyrighted layout engineered to
// match Scrabble's spacing (no adjacent premiums; no short word can land on two
// word-multipliers) while sharing almost no squares with Scrabble or Words With
// Friends. Same 8/16/12/24 premium counts and centre start.
const BONUS_MAP_V2 = {
  '0,1':TW,  '0,13':TW, '1,0':TW,  '1,14':TW,
  '13,0':TW, '13,14':TW,'14,1':TW, '14,13':TW,

  '0,5':DW,  '0,9':DW,  '1,4':DW,  '1,10':DW,
  '4,1':DW,  '4,13':DW, '5,0':DW,  '5,14':DW,
  '9,0':DW,  '9,14':DW, '10,1':DW, '10,13':DW,
  '13,4':DW, '13,10':DW,'14,5':DW, '14,9':DW,
  '7,7':CT,

  '1,7':TL,  '2,2':TL,  '2,12':TL, '3,3':TL,
  '3,11':TL, '7,1':TL,  '7,13':TL, '11,3':TL,
  '11,11':TL,'12,2':TL, '12,12':TL,'13,7':TL,

  '0,3':DL,  '0,11':DL, '3,0':DL,  '3,14':DL,
  '4,4':DL,  '4,7':DL,  '4,10':DL, '5,5':DL,
  '5,9':DL,  '6,6':DL,  '6,8':DL,  '7,4':DL,
  '7,10':DL, '8,6':DL,  '8,8':DL,  '9,5':DL,
  '9,9':DL,  '10,4':DL, '10,7':DL, '10,10':DL,
  '11,0':DL, '11,14':DL,'14,3':DL, '14,11':DL,
}

const BONUS_MAPS = { 1: BONUS_MAP_V1, 2: BONUS_MAP_V2 }

/** Return the bonus type for a cell (null if normal), for the given layout version. */
export function getBonusType(row, col, version = 1) {
  const map = BONUS_MAPS[version] ?? BONUS_MAP_V1
  return map[`${row},${col}`] ?? null
}

/** Create an empty 15×15 board as a 2-D array of null */
export function createEmptyBoard() {
  return Array.from({ length: 15 }, () => Array(15).fill(null))
}

/** Convert the flat JSONB board stored in Supabase back to 2-D array */
export function deserializeBoard(flat) {
  if (!flat || flat.length === 0) return createEmptyBoard()
  // Stored as array of {row,col,letter,isBlank,hue?,uid?}
  const board = createEmptyBoard()
  for (const cell of flat) {
    board[cell.row][cell.col] = {
      letter: cell.letter,
      isBlank: cell.isBlank ?? false,
      ...(cell.hue != null ? { hue: cell.hue } : {}),
      ...(cell.uid != null ? { uid: cell.uid } : {}),
    }
  }
  return board
}

/** Convert 2-D board back to flat array for Supabase */
export function serializeBoard(board) {
  const flat = []
  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      if (board[r][c]) flat.push({ row: r, col: c, ...board[r][c] })
    }
  }
  return flat
}
