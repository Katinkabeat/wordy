import { Fragment, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase.js'

const NUDGE_COOLDOWN_MS = 12 * 60 * 60 * 1000 // 12 hours

// One row in the lobby's Multiplayer list. Renders the player chips,
// status label, and the join/resume button. The 🔔 nudge button only
// appears when it's the current user's opponent's turn AND it's been
// more than 12h since the turn started AND no nudge fired in the last 12h.
export default function LobbyGameRow({ game, userId, onJoin, joiningId, profile }) {
  const [nudging, setNudging] = useState(false)
  const [justNudged, setJustNudged] = useState(false)

  const players    = game.game_players ?? []
  const isMyGame   = players.some(p => p.user_id === userId)
  const isFull     = players.length >= game.max_players
  // Active games show "X ago" since the current turn started (last move).
  // Waiting and finished games keep their text label.
  const turnTimeAgo = (() => {
    if (!game.turn_started_at) return null
    const diff  = Date.now() - new Date(game.turn_started_at).getTime()
    const mins  = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days  = Math.floor(diff / 86400000)
    if (days  > 0) return `${days}d ago`
    if (hours > 0) return `${hours}h ago`
    if (mins  > 0) return `${mins}m ago`
    return 'just now'
  })()
  const statusLabel = game.status === 'active'
    ? (turnTimeAgo ?? '🟢 In progress')
    : { waiting: '⏳ Waiting for players', finished: '✅ Finished' }[game.status]

  // Nudge eligibility: active game, not my turn, turn started > 12h ago,
  // last nudge either null or > 12h ago
  const currentPlayer = players.find(p => p.player_index === game.current_player_idx)
  const isMyTurn = currentPlayer?.user_id === userId
  const now = Date.now()
  const turnAge = game.turn_started_at ? now - new Date(game.turn_started_at).getTime() : 0
  const nudgeAge = game.last_nudged_at ? now - new Date(game.last_nudged_at).getTime() : Infinity

  const canNudge = game.status === 'active'
    && isMyGame
    && !isMyTurn
    && turnAge > NUDGE_COOLDOWN_MS
    && nudgeAge > NUDGE_COOLDOWN_MS
    && !justNudged

  async function sendNudge(e) {
    e.stopPropagation()
    if (nudging || !canNudge) return
    setNudging(true)
    try {
      // Update last_nudged_at on the game (server-side cooldown enforcement)
      const { error: updateErr } = await supabase
        .from('games')
        .update({ last_nudged_at: new Date().toISOString() })
        .eq('id', game.id)
      if (updateErr) throw updateErr

      // Send push notification via Edge Function (fire-and-forget)
      fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/Push-Notification`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ type: 'nudge', game_id: game.id, nudger_name: profile?.username }),
      })
        .then(r => r.json().then(d => console.log('[nudge]', r.status, d)))
        .catch(e => console.warn('[nudge] failed:', e))

      setJustNudged(true)
      toast.success('🔔 Reminder sent!')
    } catch (err) {
      toast.error('Failed to send reminder')
      console.error('Nudge error:', err)
    } finally {
      setNudging(false)
    }
  }

  return (
    <div className="flex items-center justify-between bg-wordy-50 rounded-xl px-3 py-2 border border-wordy-100">
      <div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {players.map((p, i) => {
            const isCurrentTurn = game.status === 'active' && p.player_index === game.current_player_idx
            const showNudge = isCurrentTurn && canNudge
            // For 4-player games, force a row break after chip 2 so we get
            // 2 chips per line. Chips stay content-sized; the count pill
            // lands naturally at the end of row 2.
            const breakAfter = players.length === 4 && i === 1
            return (
              <Fragment key={p.user_id}>
                <span
                  className={`text-xs font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${
                    isCurrentTurn
                      ? 'text-white bg-wordy-500'
                      : 'text-wordy-700 bg-wordy-200'
                  }`}
                >
                  {showNudge && (
                    <button
                      onClick={sendNudge}
                      disabled={nudging}
                      className="hover:scale-110 transition-transform leading-none"
                      title="Send a reminder"
                    >
                      {nudging ? '⏳' : '🔔'}
                    </button>
                  )}
                  {p.profiles?.username ?? '?'}
                </span>
                {breakAfter && <div className="basis-full h-0" aria-hidden="true" />}
              </Fragment>
            )
          })}
          <span className="text-xs text-wordy-400">
            ({players.length}/{game.max_players})
          </span>
        </div>
        <p className="text-xs text-wordy-400 mt-0.5">{statusLabel}</p>
      </div>
      <button
        onClick={() => onJoin(game)}
        disabled={joiningId === game.id || (isFull && !isMyGame)}
        className={`text-xs px-3 py-1.5 rounded-lg font-bold transition-all shrink-0 min-w-[5rem] ${
          isMyGame
            ? 'btn-primary'
            : isFull
            ? 'opacity-40 cursor-default border border-wordy-200 text-wordy-400'
            : 'btn-primary'
        }`}
      >
        {joiningId === game.id ? '…' : isMyGame ? '▶ Resume' : '+ Join'}
      </button>
    </div>
  )
}
