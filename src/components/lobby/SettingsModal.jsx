import { useState, useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase.js'

export default function SettingsDropdown({ profile, onClose, onProfileUpdate, isDark, toggleTheme, onLogout }) {
  const [newName, setNewName]   = useState(profile?.username ?? '')
  const [editing, setEditing]   = useState(false)
  const [saving, setSaving]     = useState(false)
  const dropdownRef             = useRef(null)
  const inputRef                = useRef(null)

  // Close on click outside
  useEffect(() => {
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  // Close on Escape
  useEffect(() => {
    function handleKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  // Auto-focus input when editing
  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus()
  }, [editing])

  async function handleSave() {
    const trimmed = newName.trim()
    if (!trimmed || trimmed.length < 2) {
      toast.error('Name must be at least 2 characters')
      return
    }
    if (trimmed.length > 20) {
      toast.error('Name must be 20 characters or less')
      return
    }
    if (trimmed === profile?.username) {
      setEditing(false)
      return
    }

    setSaving(true)
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ username: trimmed })
        .eq('id', profile.id)
      if (error) {
        if (error.code === '23505') toast.error('That name is already taken!')
        else throw error
        return
      }
      toast.success('Name updated!')
      onProfileUpdate({ ...profile, username: trimmed })
      setEditing(false)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  function cancelEdit() {
    setNewName(profile?.username ?? '')
    setEditing(false)
  }

  return (
    <div ref={dropdownRef} className="settings-dropdown card">

      {/* Display Name */}
      <div className="settings-row">
        <span className="text-sm font-bold text-wordy-600">Name</span>
        {!editing ? (
          <button
            onClick={() => setEditing(true)}
            className="text-sm font-bold text-wordy-700 hover:text-wordy-500 transition-colors flex items-center gap-1"
          >
            {profile?.username ?? '…'}
            <span className="text-xs text-wordy-400">✏️</span>
          </button>
        ) : (
          <div className="flex items-center gap-1.5">
            <input
              ref={inputRef}
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              maxLength={20}
              className="w-28 px-2 py-1 rounded-lg border-2 border-wordy-200 text-sm font-bold text-wordy-700
                         focus:border-wordy-400 focus:outline-none transition-colors"
              onKeyDown={e => {
                if (e.key === 'Enter') handleSave()
                if (e.key === 'Escape') cancelEdit()
              }}
            />
            <button
              onClick={handleSave}
              disabled={saving}
              className="text-xs font-bold text-white bg-wordy-600 px-2 py-1 rounded-lg hover:bg-wordy-500 transition-colors disabled:opacity-60"
            >
              {saving ? '…' : '✓'}
            </button>
            <button
              onClick={cancelEdit}
              className="text-xs font-bold text-wordy-400 hover:text-wordy-600 px-1 py-1 transition-colors"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Theme */}
      <div className="settings-row">
        <span className="text-sm font-bold text-wordy-600">Theme</span>
        <button
          onClick={toggleTheme}
          className="text-sm font-bold text-wordy-700 hover:text-wordy-500 transition-colors"
        >
          {isDark ? '☀️ Light' : '🌙 Dark'}
        </button>
      </div>

      {/* Log out */}
      <div className="settings-row">
        <button
          onClick={onLogout}
          className="text-sm font-bold text-rose-500 hover:text-rose-700 transition-colors"
        >
          Log out
        </button>
      </div>
    </div>
  )
}
