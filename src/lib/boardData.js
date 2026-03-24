// ────────────────────────────────────────────────────────────
//  Standard Scrabble 15×15 bonus square layout
//  TW = Triple Word  |  DW = Double Word
//  TL = Triple Letter|  DL = Double Letter
//  CT = Centre star (also DW)
// ────────────────────────────────────────────────────────────

const TW = 'TW', DW = 'DW', TL = 'TL', DL = 'DL', CT = 'CT'

// Bonus type per [row][col] — only non-normal squares listed
const BONUS_MAP = {
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

/** Return the bonus type for a cell (null if normal) */
export function getBonusType(row, col) {
  return BONUS_MAP[`${row},${col}`] ?? null
}

/** Create an empty 15×15 board as a 2-D array of null */
export function createEmptyBoard() {
  return Array.from({ length: 15 }, () => Array(15).fill(null))
}

/** Convert the flat JSONB board stored in Supabase back to 2-D array */
export function deserializeBoard(flat) {
  if (!flat || flat.length === 0) return createEmptyBoard()
  // Stored as array of {row,col,letter,isBlank,hue?}
  const board = createEmptyBoard()
  for (const cell of flat) {
    board[cell.row][cell.col] = {
      letter: cell.letter,
      isBlank: cell.isBlank ?? false,
      ...(cell.hue != null ? { hue: cell.hue } : {}),
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
