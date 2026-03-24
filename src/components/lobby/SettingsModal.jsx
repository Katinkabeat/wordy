import { useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase.js'

export default function SettingsModal({ profile, onClose, onProfileUpdate }) {
  const [newName, setNewName] = useState(profile?.username ?? '')
  const [saving, setSaving]   = useState(false)

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
    if (trimmed === profile?.username) {
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
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-xl text-wordy-700">⚙️ Settings</h2>
          <button
            onClick={onClose}
            className="text-wordy-400 hover:text-wordy-600 text-xl leading-none"
          >
            ✕
          </button>
        </div>

        {/* Name change */}
        <div className="mb-4">
          <label className="block text-xs font-bold text-wordy-600 mb-1">
            Display Name
          </label>
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

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary text-sm py-1.5 px-4">
            Cancel
          </button>
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
