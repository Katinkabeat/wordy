// ── Tile color system ──────────────────────────────────────
// Generates tile gradients and styling from an HSL hue.
// Default hue = 270 (purple, the classic Wordy tile).

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
 * Generate all tile style properties from a hue, for a given mode.
 * @param {number} hue  – HSL hue (0-360)
 * @param {boolean} dark – dark mode?
 */
export function tileStyle(hue = DEFAULT_TILE_HUE, dark = false) {
  if (dark) {
    return {
      bg:       `linear-gradient(145deg, hsl(${hue},45%,42%), hsl(${hue},40%,34%))`,
      border:   `hsl(${hue},50%,50%)`,
      shadow:   `2px 3px 0px hsla(${hue},50%,20%,0.6)`,
      color:    `hsl(${hue},90%,92%)`,
      valColor: `hsl(${hue},50%,75%)`,
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
 * @param {number} hue
 * @param {'new'|'lastMove'|'old'} age
 * @param {boolean} dark
 */
export function boardTileStyle(hue = DEFAULT_TILE_HUE, age = 'old', dark = false) {
  if (dark) {
    const l = age === 'new' ? [45, 38] : age === 'lastMove' ? [40, 33] : [35, 28]
    return {
      bg:       `linear-gradient(145deg, hsl(${hue},45%,${l[0]}%), hsl(${hue},40%,${l[1]}%))`,
      color:    `hsl(${hue},90%,92%)`,
      valColor: `hsl(${hue},50%,75%)`,
    }
  }
  const l = age === 'new' ? [93, 87] : age === 'lastMove' ? [87, 78] : [78, 65]
  return {
    bg:       `linear-gradient(145deg, hsl(${hue},70%,${l[0]}%), hsl(${hue},60%,${l[1]}%))`,
    color:    `hsl(${hue},80%,15%)`,
    valColor: `hsl(${hue},65%,40%)`,
  }
}
