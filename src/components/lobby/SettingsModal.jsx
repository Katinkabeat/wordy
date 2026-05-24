import { useEffect, useRef } from 'react'

export default function SettingsDropdown({ onClose, isDark, toggleTheme, isAdmin, lobbyTab, onToggleAdmin, onLogout, onHowToPlay }) {
  const dropdownRef = useRef(null)

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

  return (
    <div ref={dropdownRef} className="settings-dropdown card">

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

      {/* How to play */}
      <div className="settings-row">
        <span className="text-sm font-bold text-wordy-600">How to play</span>
        <button
          onClick={onHowToPlay}
          className="text-sm font-bold text-wordy-700 hover:text-wordy-500 transition-colors"
        >
          📖 Open
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

    </div>
  )
}
