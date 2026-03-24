// ── Tile color system ──────────────────────────────────────
// Generates tile gradients and styling from an HSL hue.
// Default hue = 270 (purple, the classic Wordy tile).
//
// In dark mode, tiles use bright/saturated colours with a subtle
// glow so they stand out against the dark board background.

export const TILE_COLOR_OPTIONS = [
  { name: 'Purple',  hue: 270 },
  { name: 'Pink',    hue: 330 },
  { name: 'Blue',    hue: 220 },
  { name: 'Teal',    hue: 175 },
  { name: 'Green',   hue: 145 },
  { name: 'Orange',  hue: 25  },
  { name: 'Red',     hue: 0   },
  { name: 'Gold',    hue: 45  },
]

export const DEFAULT_TILE_HUE = 270

/**
 * Generate rack tile style properties from a hue, for a given mode.
 * @param {number} hue  – HSL hue (0-360)
 * @param {boolean} dark – dark mode?
 */
export function tileStyle(hue = DEFAULT_TILE_HUE, dark = false) {
  if (dark) {
    return {
      bg:       `linear-gradient(145deg, hsl(${hue},70%,78%), hsl(${hue},60%,68%))`,
      border:   `hsl(${hue},60%,58%)`,
      shadow:   `2px 3px 0px hsla(${hue},60%,15%,0.5), 0 0 8px hsla(${hue},70%,60%,0.3)`,
      color:    `hsl(${hue},80%,12%)`,
      valColor: `hsl(${hue},70%,30%)`,
    }
  }
  return {
    bg:       `linear-gradient(145deg, hsl(${hue},80%,93%), hsl(${hue},70%,87%))`,
    border:   `hsl(${hue},55%,68%)`,
    shadow:   `2px 3px 0px hsla(${hue},70%,25%,0.4)`,
    color:    `hsl(${hue},80%,15%)`,
    valColor: `hsl(${hue},65%,40%)`,
  }
}

/**
 * Generate board tile gradient based on hue and tile age.
 * In dark mode, tiles glow brightly against the dark board.
 *
 * Original purple hex values for reference:
 *   new:      #f3e8ff → #e9d5ff  (HSL 270, ~95%, 96→92%)
 *   lastMove: #e9d5ff → #d8b4fe  (HSL 270, ~90%, 92→85%)
 *   old:      #d8b4fe → #c084fc  (HSL 270, ~85%, 85→75%)
 *
 * @param {number} hue
 * @param {'new'|'lastMove'|'old'} age
 * @param {boolean} dark
 */
export function boardTileStyle(hue = DEFAULT_TILE_HUE, age = 'old', dark = false) {
  if (dark) {
    // Bright pastel tiles with glow — dark text for readability
    const l = age === 'new' ? [92, 85] : age === 'lastMove' ? [85, 75] : [78, 68]
    const s = age === 'new' ? [90, 80] : age === 'lastMove' ? [80, 70] : [70, 60]
    const glowStrength = age === 'new' ? 0.5 : age === 'lastMove' ? 0.4 : 0.3
    return {
      bg:       `linear-gradient(145deg, hsl(${hue},${s[0]}%,${l[0]}%), hsl(${hue},${s[1]}%,${l[1]}%))`,
      color:    `hsl(${hue},80%,12%)`,
      valColor: `hsl(${hue},70%,30%)`,
      glow:     `0 0 6px hsla(${hue},80%,65%,${glowStrength})`,
    }
  }
  const l = age === 'new' ? [93, 87] : age === 'lastMove' ? [87, 78] : [78, 65]
  return {
    bg:       `linear-gradient(145deg, hsl(${hue},70%,${l[0]}%), hsl(${hue},60%,${l[1]}%))`,
    color:    `hsl(${hue},80%,15%)`,
    valColor: `hsl(${hue},65%,40%)`,
    glow:     'none',
  }
}
