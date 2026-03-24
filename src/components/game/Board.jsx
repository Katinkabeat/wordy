import { getBonusType } from '../../lib/boardData.js'
import { TILE_VALUES }  from '../../lib/tileData.js'
import { boardTileStyle, DEFAULT_TILE_HUE } from '../../lib/tileColors.js'

const BONUS_LABELS = { TW: 'TW', DW: 'DW', TL: 'TL', DL: 'DL', CT: '★' }
const BONUS_CLASSES = {
  TW: 'cell-tw',
  DW: 'cell-dw',
  TL: 'cell-tl',
  DL: 'cell-dl',
  CT: 'cell-centre',
}

// cellSize = each cell's width/height in pixels.
// Fonts scale proportionally so the board looks great at any zoom level.
export default function Board({ board, placements, lastMoveTiles = [], onCellClick, myTurn, cellSize = 36, isDark = false }) {
  const placedSet   = new Set(placements.map(p => `${p.row},${p.col}`))
  const lastMoveSet = new Set(lastMoveTiles.map(t => `${t.row},${t.col}`))

  // 15 cells × cellSize + 14 one-pixel gaps + 4px for border-2 (2px each side)
  const totalSize  = 15 * cellSize + 18
  const letterSize = Math.max(8,  Math.round(cellSize * 0.38))
  const valueSize  = Math.max(5,  Math.round(cellSize * 0.22))
  const bonusSize  = Math.max(6,  Math.round(cellSize * 0.26))

  return (
    <div
      className="inline-grid gap-px bg-wordy-300 border-2 border-wordy-400 overflow-hidden shadow-lg"
      style={{
        gridTemplateColumns: `repeat(15, ${cellSize}px)`,
        width:  totalSize,
        height: totalSize,
      }}
    >
      {Array.from({ length: 15 }, (_, r) =>
        Array.from({ length: 15 }, (_, c) => {
          const cell  = board[r][c]
          const bonus = getBonusType(r, c)
          const isNew      = placedSet.has(`${r},${c}`)
          const isLastMove = !isNew && lastMoveSet.has(`${r},${c}`)
          const key        = `${r}-${c}`

          if (cell) {
            return (
              <BoardTile
                key={key}
                letter={cell.letter}
                isBlank={cell.isBlank}
                hue={cell.hue ?? DEFAULT_TILE_HUE}
                isNew={isNew}
                isLastMove={isLastMove}
                isDark={isDark}
                onClick={() => onCellClick(r, c)}
                letterSize={letterSize}
                valueSize={valueSize}
              />
            )
          }

          return (
            <div
              key={key}
              onClick={() => onCellClick(r, c)}
              style={{ touchAction: 'manipulation' }}
              className={`board-cell ${bonus ? BONUS_CLASSES[bonus] : 'cell-normal'} ${myTurn && !cell ? 'cursor-pointer hover:opacity-80' : ''}`}
            >
              {bonus && (
                <span
                  style={{ fontSize: bonusSize }}
                  className="font-bold leading-none text-center select-none"
                >
                  {BONUS_LABELS[bonus]}
                </span>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}

function BoardTile({ letter, isBlank, hue, isNew, isLastMove, isDark, onClick, letterSize, valueSize }) {
  const val = isBlank ? 0 : (TILE_VALUES[letter] ?? 0)
  const age = isNew ? 'new' : isLastMove ? 'lastMove' : 'old'
  const s   = boardTileStyle(hue, age, isDark)

  return (
    <div
      onClick={onClick}
      className={`board-cell cell-occupied ${isNew ? 'ring-1 ring-pink-400' : ''} ${isLastMove ? 'ring-1 ring-purple-300' : ''}`}
      style={{
        background: s.bg,
        cursor: isNew ? 'pointer' : 'default',
        touchAction: 'manipulation',
      }}
    >
      <div className="relative flex items-center justify-center w-full h-full">
        <span
          style={{ fontSize: letterSize, color: s.color }}
          className="font-display select-none leading-none"
        >
          {letter}
        </span>
        <span
          style={{ fontSize: valueSize, color: s.valColor }}
          className="absolute bottom-px right-px font-bold select-none leading-none"
        >
          {val > 0 ? val : ''}
        </span>
      </div>
    </div>
  )
}
