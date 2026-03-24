import { TILE_VALUES } from '../../lib/tileData.js'
import { tileStyle, DEFAULT_TILE_HUE } from '../../lib/tileColors.js'

export default function TileRack({ rack, selected, onSelect, myTurn, exchangeMode, exchangeSel, tileHue = DEFAULT_TILE_HUE, isDark = false }) {
  const s = tileStyle(tileHue, isDark)

  return (
    <div className="flex items-center justify-center gap-1.5 flex-wrap">
      {rack.map((letter, idx) => {
        const val         = TILE_VALUES[letter] ?? 0
        const isSelected  = selected?.rackIdx === idx
        const isExchanged = exchangeSel?.includes(idx)

        const inlineStyle = isExchanged
          ? {
              background: 'linear-gradient(145deg, #fb7185, #e11d48)',
              boxShadow: '0 0 0 3px #fb7185',
              borderColor: '#fb7185',
              transform: 'translateY(-2px)',
              color: '#fff',
            }
          : {
              background: s.bg,
              border: `1.5px solid ${s.border}`,
              boxShadow: isSelected ? `0 0 0 3px #f472b6` : s.shadow,
              transform: isSelected ? 'translateY(-3px)' : undefined,
              color: s.color,
            }

        return (
          <button
            key={idx}
            onClick={() => onSelect(letter, idx)}
            disabled={!myTurn}
            style={inlineStyle}
            className={`
              relative flex items-center justify-center rounded-lg font-bold select-none cursor-pointer
              transition-all duration-100
              w-10 h-11 text-lg
              ${isSelected  ? 'ring-2 ring-pink-400' : ''}
              ${!myTurn     ? 'opacity-50 cursor-default' : ''}
            `}
          >
            <span className="font-display">{letter === '?' ? '🃏' : letter}</span>
            <span
              className="absolute font-bold leading-none"
              style={{ fontSize: 9, bottom: 2, right: 3, color: isExchanged ? '#fff' : s.valColor }}
            >
              {val > 0 ? val : ''}
            </span>
          </button>
        )
      })}
      {rack.length === 0 && (
        <span className="text-wordy-300 text-sm italic">Empty rack</span>
      )}
    </div>
  )
}
