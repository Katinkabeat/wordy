import { useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase.js'

export default function SettingsModal({ profile, onClose, onProfileUpdate, isDark, toggleTheme }) {
  const [newName, setNewName] = useState(profile?.username ?? '')
  const [saving, setSaving]   = useState(false)

  const nameChanged = newName.trim() !== (profile?.username ?? '')

  async function handleSave() {
    const trimmed = newName.trim()
    if (!trimmed) {
      toast.error('Name cannot be empty')
      return
    }
    if (trimmed.length < 2) {
      toast.error('Name must be at least 2 characters')
      return
    }
    if (trimmed.length > 20) {
      toast.error('Name must be 20 characters or less')
      return
    }
    if (!nameChanged) {
      onClose()
      return
    }

    setSaving(true)
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ username: trimmed })
        .eq('id', profile.id)
      if (error) {
        if (error.code === '23505') {
          toast.error('That name is already taken!')
        } else {
          throw error
        }
        return
      }
      toast.success('Name updated!')
      onProfileUpdate({ ...profile, username: trimmed })
      onClose()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div
        className="settings-modal card"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display text-xl text-wordy-700">⚙️ Settings</h2>
          <button
            onClick={onClose}
            className="text-wordy-400 hover:text-wordy-600 text-xl leading-none"
          >
            ✕
          </button>
        </div>

        {/* ── Display Name ── */}
        <div className="mb-5">
          <h3 className="text-sm font-bold text-wordy-600 mb-2">Display Name</h3>
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            maxLength={20}
            className="w-full px-3 py-2 rounded-xl border-2 border-wordy-200 text-sm font-bold text-wordy-700
                       focus:border-wordy-400 focus:outline-none transition-colors"
            onKeyDown={e => e.key === 'Enter' && handleSave()}
          />
          <p className="text-xs text-wordy-400 mt-1">
            {newName.trim().length}/20 characters
          </p>
        </div>

        {/* ── Appearance ── */}
        <div className="mb-5">
          <h3 className="text-sm font-bold text-wordy-600 mb-2">Appearance</h3>
          <div className="flex items-center justify-between bg-wordy-50 rounded-xl px-3 py-2.5 border border-wordy-100">
            <span className="text-sm text-wordy-700 font-bold">Theme</span>
            <button
              onClick={toggleTheme}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border-2 border-wordy-200 text-sm font-bold
                         text-wordy-600 hover:border-wordy-400 transition-all active:scale-95"
            >
              {isDark ? '☀️ Light' : '🌙 Dark'}
            </button>
          </div>
        </div>

        {/* ── Actions ── */}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary text-sm py-1.5 px-4">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !nameChanged}
            className="btn-primary text-sm py-1.5 px-4 disabled:opacity-60"
          >
            {saving ? '⏳ Saving…' : '💾 Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
