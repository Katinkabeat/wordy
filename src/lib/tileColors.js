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
  { name: 'Grey',    hue: -1 },
]

// Grey uses hue -1 as a sentinel; style functions map it to desaturated tones.
export const GREY_HUE = -1

export const DEFAULT_TILE_HUE = 270

/**
 * Generate rack tile style properties from a hue, for a given mode.
 * @param {number} hue  – HSL hue (0-360)
 * @param {boolean} dark – dark mode?
 */
export function tileStyle(hue = DEFAULT_TILE_HUE, dark = false) {
  const isGrey = hue === GREY_HUE
  const h = isGrey ? 0 : hue
  if (dark) {
    return {
      bg:       `linear-gradient(145deg, hsl(${h},${isGrey ? 0 : 70}%,78%), hsl(${h},${isGrey ? 0 : 60}%,68%))`,
      border:   `hsl(${h},${isGrey ? 0 : 60}%,58%)`,
      shadow:   `2px 3px 0px hsla(${h},${isGrey ? 0 : 60}%,15%,0.5), 0 0 8px hsla(${h},${isGrey ? 0 : 70}%,60%,0.3)`,
      color:    `hsl(${h},${isGrey ? 0 : 80}%,12%)`,
      valColor: `hsl(${h},${isGrey ? 0 : 70}%,30%)`,
    }
  }
  return {
    bg:       `linear-gradient(145deg, hsl(${h},${isGrey ? 0 : 80}%,93%), hsl(${h},${isGrey ? 0 : 70}%,87%))`,
    border:   `hsl(${h},${isGrey ? 0 : 55}%,68%)`,
    shadow:   `2px 3px 0px hsla(${h},${isGrey ? 0 : 70}%,25%,0.4)`,
    color:    `hsl(${h},${isGrey ? 0 : 80}%,15%)`,
    valColor: `hsl(${h},${isGrey ? 0 : 65}%,40%)`,
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
  const isGrey = hue === GREY_HUE
  const h = isGrey ? 0 : hue
  if (dark) {
    // Bright pastel tiles with glow — dark text for readability
    const l = age === 'new' ? [92, 85] : age === 'lastMove' ? [94, 87] : [78, 68]
    const s = age === 'new' ? [90, 80] : age === 'lastMove' ? [100, 92] : [70, 60]
    const glow = age === 'lastMove'
      ? `0 0 0 2px #c084fc, 0 0 16px hsla(${h},${isGrey ? 0 : 100}%,75%,1.0)`
      : age === 'new'
        ? `0 0 6px hsla(${h},${isGrey ? 0 : 80}%,65%,0.5)`
        : `0 0 6px hsla(${h},${isGrey ? 0 : 80}%,65%,0.3)`
    return {
      bg:       `linear-gradient(145deg, hsl(${h},${isGrey ? 0 : s[0]}%,${l[0]}%), hsl(${h},${isGrey ? 0 : s[1]}%,${l[1]}%))`,
      color:    `hsl(${h},${isGrey ? 0 : 80}%,12%)`,
      valColor: `hsl(${h},${isGrey ? 0 : 70}%,30%)`,
      glow,
    }
  }
  // Light mode — lastMove: near-white, fully saturated, with ring + glow combined in one boxShadow
  const l = age === 'new' ? [93, 87] : age === 'lastMove' ? [96, 90] : [78, 65]
  const s = age === 'lastMove' ? [100, 95] : [70, 60]
  const glow = age === 'lastMove'
    ? `0 0 0 2px #a855f7, 0 0 10px hsla(${h},${isGrey ? 0 : 90}%,60%,0.8)`
    : 'none'
  return {
    bg:       `linear-gradient(145deg, hsl(${h},${isGrey ? 0 : s[0]}%,${l[0]}%), hsl(${h},${isGrey ? 0 : s[1]}%,${l[1]}%))`,
    color:    `hsl(${h},${isGrey ? 0 : 80}%,15%)`,
    valColor: `hsl(${h},${isGrey ? 0 : 65}%,40%)`,
    glow,
  }
}
