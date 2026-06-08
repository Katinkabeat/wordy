import { useEffect, useRef } from 'react'
import { SQReportPlayer, SQSettingsRow } from '../../../../rae-side-quest/packages/sq-ui/index.js'
import { supabase } from '../../lib/supabase.js'

export default function SettingsDropdown({ onClose, isDark, toggleTheme, isAdmin, lobbyTab, onToggleAdmin, onLogout, onHowToPlay, gameRows = null }) {
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

      {/* Canonical SQ order: Theme → How to play → Admin → game rows → Report → Log out */}
      <SQSettingsRow
        label="Theme"
        control={isDark ? '☀️ Light' : '🌙 Dark'}
        onClick={toggleTheme}
      />
      <SQSettingsRow
        label="How to play"
        control="📖 Open"
        onClick={onHowToPlay}
      />
      {isAdmin && (
        <SQSettingsRow
          label="Admin panel"
          control={lobbyTab === 'admin' ? '← Lobby' : '🔐 Open'}
          onClick={onToggleAdmin}
        />
      )}
      {/* Game-specific rows (Claim win / Forfeit / Quit) injected on the board
          via the gameRows render-prop; the lobby passes none. */}
      {gameRows && gameRows(onClose)}
      <SQReportPlayer supabase={supabase} game="wordy" />
      <SQSettingsRow label="Log out" danger onClick={onLogout} />

    </div>
  )
}
