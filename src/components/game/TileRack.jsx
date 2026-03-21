import { TILE_VALUES } from '../../lib/tileData.js'

export default function TileRack({ rack, selected, onSelect, myTurn, exchangeMode, exchangeSel }) {
  return (
    <div className="flex items-center justify-center gap-1.5 flex-wrap">
      {rack.map((letter, idx) => {
        const val         = TILE_VALUES[letter] ?? 0
        const isSelected  = selected?.rackIdx === idx
        const isExchanged = exchangeSel?.includes(idx)

        return (
          <button
            key={idx}
            onClick={() => onSelect(letter, idx)}
            disabled={!myTurn}
            style={isExchanged ? {
              background: 'linear-gradient(145deg, #fb7185, #e11d48)',
              boxShadow: '0 0 0 3px #fb7185',
              borderColor: '#fb7185',
              transform: 'translateY(-2px)',
            } : undefined}
            className={`
              tile relative
              w-10 h-11 text-wordy-800 text-lg
              ${isSelected  ? 'tile-selected' : ''}
              ${!myTurn     ? 'tile-disabled' : ''}
            `}
          >
            <span className="font-display">{letter === '?' ? '\u{1f0cf}' : letter}</span>
            <span className="tile-value">{val > 0 ? val : ''}</span>
          </button>
        )
      })}
      {rack.length === 0 && (
        <span className="text-wordy-300 text-sm italic">Empty rack</span>
      )}
    </div>
  )
}
