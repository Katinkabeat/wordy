import { useState, useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase.js'
import { TILE_COLOR_OPTIONS, DEFAULT_TILE_HUE, tileStyle } from '../../lib/tileColors.js'
import TileColorPicker from './TileColorPicker.jsx'

const PW_RULES = { number: /\d/, special: /[^A-Za-z0-9]/ }

export default function SettingsDropdown({ profile, onClose, onProfileUpdate, isDark, toggleTheme, isAdmin, lobbyTab, onToggleAdmin, onLogout }) {
  const [newName, setNewName]   = useState(profile?.username ?? '')
  const [editing, setEditing]   = useState(false)
  const [saving, setSaving]     = useState(false)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const dropdownRef             = useRef(null)
  const inputRef                = useRef(null)

  // Password change state
  const [changingPw, setChangingPw]     = useState(false)
  const [oldPw, setOldPw]               = useState('')
  const [newPw, setNewPw]               = useState('')
  const [confirmPw, setConfirmPw]       = useState('')
  const [savingPw, setSavingPw]         = useState(false)
  const [showOldPw, setShowOldPw]       = useState(false)
  const [showNewPw, setShowNewPw]       = useState(false)
  const [showConfirmPw, setShowConfirmPw] = useState(false)

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

  // Auto-focus input when editing name
  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus()
  }, [editing])

  // ── Name save ──
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

  // ── Password change ──
  function cancelPwChange() {
    setOldPw('')
    setNewPw('')
    setConfirmPw('')
    setShowOldPw(false)
    setShowNewPw(false)
    setShowConfirmPw(false)
    setChangingPw(false)
  }

  async function handlePasswordChange() {
    if (!oldPw) { toast.error('Enter your current password'); return }
    if (newPw.length < 6) { toast.error('New password must be at least 6 characters'); return }
    if (!PW_RULES.number.test(newPw)) { toast.error('New password must include a number'); return }
    if (!PW_RULES.special.test(newPw)) { toast.error('New password must include a special character'); return }
    if (newPw !== confirmPw) { toast.error('New passwords don\'t match'); return }

    setSavingPw(true)
    try {
      // Verify old password by signing in
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: profile?.id ? (await supabase.auth.getUser()).data.user.email : '',
        password: oldPw,
      })
      if (signInErr) {
        toast.error('Current password is incorrect')
        return
      }

      // Set new password
      const { error: updateErr } = await supabase.auth.updateUser({ password: newPw })
      if (updateErr) throw updateErr

      toast.success('Password updated!')
      cancelPwChange()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSavingPw(false)
    }
  }

  const hasNumber  = PW_RULES.number.test(newPw)
  const hasSpecial = PW_RULES.special.test(newPw)
  const longEnough = newPw.length >= 6
  const pwMatch    = newPw && confirmPw && newPw === confirmPw

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

      {/* Password */}
      <div className={changingPw ? 'settings-section' : 'settings-row'}>
        {!changingPw ? (
          <>
            <span className="text-sm font-bold text-wordy-600">Password</span>
            <button
              onClick={() => setChangingPw(true)}
              className="text-sm font-bold text-wordy-700 hover:text-wordy-500 transition-colors flex items-center gap-1"
            >
              Change <span className="text-xs text-wordy-400">✏️</span>
            </button>
          </>
        ) : (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-wordy-600">Change Password</span>
              <button onClick={cancelPwChange} className="text-xs font-bold text-wordy-400 hover:text-wordy-600 transition-colors">✕</button>
            </div>

            {/* Current password */}
            <div className="relative">
              <input
                type={showOldPw ? 'text' : 'password'}
                value={oldPw}
                onChange={e => setOldPw(e.target.value)}
                placeholder="Current password"
                className="w-full px-2 py-1.5 pr-8 rounded-lg border-2 border-wordy-200 text-xs font-bold text-wordy-700
                           focus:border-wordy-400 focus:outline-none transition-colors"
              />
              <button type="button" onClick={() => setShowOldPw(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-wordy-400 hover:text-wordy-700 text-xs">
                {showOldPw ? '🙈' : '👁️'}
              </button>
            </div>

            {/* New password */}
            <div className="relative">
              <input
                type={showNewPw ? 'text' : 'password'}
                value={newPw}
                onChange={e => setNewPw(e.target.value)}
                placeholder="New password"
                className="w-full px-2 py-1.5 pr-8 rounded-lg border-2 border-wordy-200 text-xs font-bold text-wordy-700
                           focus:border-wordy-400 focus:outline-none transition-colors"
              />
              <button type="button" onClick={() => setShowNewPw(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-wordy-400 hover:text-wordy-700 text-xs">
                {showNewPw ? '🙈' : '👁️'}
              </button>
            </div>

            {/* Confirm new password */}
            <div className="relative">
              <input
                type={showConfirmPw ? 'text' : 'password'}
                value={confirmPw}
                onChange={e => setConfirmPw(e.target.value)}
                placeholder="Confirm new password"
                className={`w-full px-2 py-1.5 pr-8 rounded-lg border-2 text-xs font-bold text-wordy-700
                           focus:outline-none transition-colors ${
                  confirmPw && !pwMatch
                    ? 'border-rose-400 focus:border-rose-500'
                    : 'border-wordy-200 focus:border-wordy-400'
                }`}
              />
              <button type="button" onClick={() => setShowConfirmPw(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-wordy-400 hover:text-wordy-700 text-xs">
                {showConfirmPw ? '🙈' : '👁️'}
              </button>
            </div>

            {/* Requirements checklist */}
            <div className="text-xs space-y-0.5 pl-0.5">
              <p className={longEnough ? 'text-green-600' : 'text-wordy-400'}>
                {longEnough ? '✓' : '○'} At least 6 characters
              </p>
              <p className={hasNumber ? 'text-green-600' : 'text-wordy-400'}>
                {hasNumber ? '✓' : '○'} Contains a number
              </p>
              <p className={hasSpecial ? 'text-green-600' : 'text-wordy-400'}>
                {hasSpecial ? '✓' : '○'} Contains a special character
              </p>
              {confirmPw && !pwMatch && (
                <p className="text-rose-500">✗ Passwords don't match</p>
              )}
            </div>

            {/* Save button */}
            <button
              onClick={handlePasswordChange}
              disabled={savingPw}
              className="w-full text-xs font-bold text-white bg-wordy-600 px-2 py-1.5 rounded-lg hover:bg-wordy-500 transition-colors disabled:opacity-60"
            >
              {savingPw ? '⏳ Saving…' : '🔑 Update Password'}
            </button>
          </div>
        )}
      </div>

      {/* Tiles */}
      <div className="settings-row">
        <span className="text-sm font-bold text-wordy-600">Tiles</span>
        <button
          onClick={() => setShowColorPicker(true)}
          className="text-sm font-bold text-wordy-700 hover:text-wordy-500 transition-colors flex items-center gap-1.5"
        >
          <span
            className="inline-block w-4 h-5 rounded"
            style={{
              background: tileStyle(profile?.tile_hue ?? DEFAULT_TILE_HUE, isDark).bg,
              border: `1px solid ${tileStyle(profile?.tile_hue ?? DEFAULT_TILE_HUE, isDark).border}`,
            }}
          />
          {TILE_COLOR_OPTIONS.find(o => o.hue === (profile?.tile_hue ?? DEFAULT_TILE_HUE))?.name ?? 'Purple'}
          <span className="text-xs text-wordy-400">✏️</span>
        </button>
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

      {/* Admin (only for admins) */}
      {isAdmin && (
        <div className="settings-row">
          <span className="text-sm font-bold text-wordy-600">Admin</span>
          <button
            onClick={onToggleAdmin}
            className={`text-sm font-bold transition-colors ${
              lobbyTab === 'admin'
                ? 'text-wordy-500 hover:text-wordy-700'
                : 'text-wordy-700 hover:text-wordy-500'
            }`}
          >
            {lobbyTab === 'admin' ? '← Lobby' : '🔐 Open'}
          </button>
        </div>
      )}

      {/* Log out */}
      <div className="settings-row">
        <button
          onClick={onLogout}
          className="text-sm font-bold text-rose-500 hover:text-rose-700 transition-colors"
        >
          Log out
        </button>
      </div>

      {/* Tile color picker popup */}
      {showColorPicker && (
        <TileColorPicker
          profile={profile}
          isDark={isDark}
          onClose={() => setShowColorPicker(false)}
          onProfileUpdate={onProfileUpdate}
        />
      )}
    </div>
  )
}
