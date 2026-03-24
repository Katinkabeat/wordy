import { useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase.js'
import { TILE_COLOR_OPTIONS, DEFAULT_TILE_HUE, tileStyle } from '../../lib/tileColors.js'
import { TILE_VALUES } from '../../lib/tileData.js'

const PREVIEW_LETTERS = ['W', 'O', 'R', 'D', 'Y']

export default function TileColorPicker({ profile, isDark, onClose, onProfileUpdate }) {
  const [selected, setSelected] = useState(profile?.tile_hue ?? DEFAULT_TILE_HUE)
  const [saving, setSaving]     = useState(false)

  async function handleSave() {
    if (selected === (profile?.tile_hue ?? DEFAULT_TILE_HUE)) {
      onClose()
      return
    }
    setSaving(true)
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ tile_hue: selected })
        .eq('id', profile.id)
      if (error) throw error
      toast.success('Tile colour updated!')
      onProfileUpdate({ ...profile, tile_hue: selected })
      onClose()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const previewStyle = tileStyle(selected, isDark)

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div className="tile-picker-modal card" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-lg text-wordy-700">Tile Colour</h2>
          <button onClick={onClose} className="text-wordy-400 hover:text-wordy-600 text-xl leading-none">✕</button>
        </div>

        {/* Preview tiles */}
        <div className="flex items-center justify-center gap-1.5 mb-4">
          {PREVIEW_LETTERS.map((letter, i) => {
            const val = TILE_VALUES[letter] ?? 0
            return (
              <div
                key={i}
                className="relative flex items-center justify-center rounded-lg font-bold select-none w-10 h-11"
                style={{
                  background: previewStyle.bg,
                  border: `1.5px solid ${previewStyle.border}`,
                  boxShadow: previewStyle.shadow,
                  color: previewStyle.color,
                }}
              >
                <span className="font-display text-lg">{letter}</span>
                <span
                  className="absolute font-bold leading-none"
                  style={{ fontSize: 9, bottom: 2, right: 3, color: previewStyle.valColor }}
                >
                  {val > 0 ? val : ''}
                </span>
              </div>
            )
          })}
        </div>

        {/* Color grid */}
        <div className="grid grid-cols-4 gap-2 mb-4">
          {TILE_COLOR_OPTIONS.map(opt => {
            const s = tileStyle(opt.hue, isDark)
            const isActive = selected === opt.hue
            return (
              <button
                key={opt.hue}
                onClick={() => setSelected(opt.hue)}
                className={`flex flex-col items-center gap-1 py-2 px-1 rounded-xl border-2 transition-all ${
                  isActive
                    ? 'border-wordy-600 bg-wordy-50 scale-105'
                    : 'border-transparent hover:border-wordy-200'
                }`}
              >
                <div
                  className="w-7 h-8 rounded-md"
                  style={{
                    background: s.bg,
                    border: `1.5px solid ${s.border}`,
                    boxShadow: isActive ? `0 0 0 2px ${s.border}` : 'none',
                  }}
                />
                <span className="text-xs font-bold text-wordy-600">{opt.name}</span>
              </button>
            )
          })}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary text-sm py-1.5 px-4">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary text-sm py-1.5 px-4 disabled:opacity-60"
          >
            {saving ? '⏳ Saving…' : '💾 Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
