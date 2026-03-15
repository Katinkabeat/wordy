import { getBonusType } from '../../lib/boardData.js'
import { TILE_VALUES }  from '../../lib/tileData.js'

const BONUS_LABELS = { TW: 'TW', DW: 'DW', TL: 'TL', DL: 'DL', CT: '★' }
const BONUS_CLASSES = {
  TW: 'cell-tw',
  DW: 'cell-dw',
  TL: 'cell-tl',
  DL: 'cell-dl',
  CT: 'cell-centre',
}

export default function Board({ board, placements, onCellClick, myTurn }) {
  const placedSet = new Set(placements.map(p => `${p.row},${p.col}`))

  return (
    <div
      className="inline-grid gap-px bg-wordy-300 border-2 border-wordy-400 rounded-xl overflow-hidden shadow-lg"
      style={{ gridTemplateColumns: 'repeat(15, 1fr)', width: 'min(90vw, 600px)', height: 'min(90vw, 600px)' }}
    >
      {Array.from({ length: 15 }, (_, r) =>
        Array.from({ length: 15 }, (_, c) => {
          const cell    = board[r][c]
          const bonus   = getBonusType(r, c)
          const isNew   = placedSet.has(`${r},${c}`)
          const key     = `${r}-${c}`

          if (cell) {
            return (
              <BoardTile
                key={key} row={r} col={c}
                letter={cell.letter} isBlank={cell.isBlank}
                isNew={isNew} onClick={() => onCellClick(r, c)}
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
                <span className="text-[8px] font-bold leading-tight text-center select-none">
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

function BoardTile({ letter, isBlank, isNew, onClick }) {
  const val = isBlank ? 0 : (TILE_VALUES[letter] ?? 0)
  return (
    <div
      onClick={onClick}
      className={`board-cell cell-occupied ${isNew ? 'ring-2 ring-pink-400' : ''}`}
      style={{
        background: isNew
          ? 'linear-gradient(145deg, #f3e8ff, #e9d5ff)'
          : 'linear-gradient(145deg, #d8b4fe, #c084fc)',
        cursor: isNew ? 'pointer' : 'default',
        touchAction: 'manipulation',
      }}
    >
      <div className="relative flex items-center justify-center w-full h-full">
        <span className="font-display text-[clamp(7px,1.5vw,14px)] text-wordy-900 select-none">
          {letter}
        </span>
        <span className="absolute bottom-[1px] right-[2px] text-[clamp(5px,0.9vw,9px)] text-wordy-700 font-bold select-none">
          {val > 0 ? val : ''}
        </span>
      </div>
    </div>
  )
}
