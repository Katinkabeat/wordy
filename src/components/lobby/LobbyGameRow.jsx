import { Fragment, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase.js'
import { timeAgo } from '../../../../rae-side-quest/packages/sq-ui/index.js'

const NUDGE_COOLDOWN_MS = 12 * 60 * 60 * 1000 // 12 hours

// One row in the lobby's Multiplayer list. Renders the player chips,
// status label, and the join/resume button. The 🔔 nudge button only
// appears when it's the current user's opponent's turn AND it's been
// more than 12h since the turn started AND no nudge fired in the last 12h.
//
// Invite-aware variants:
//   • isInviteToMe: amber row with "Accept" button + "{creator} invited
//     you" subtext. Used in invitedToYou bucket.
//   • onCancel: ✕ button on creator's own waiting rows.
//   • pendingInviteeNames: { uuid → username } for any invitees that
//     haven't yet joined, used to render "Invited X, Y" subtext on the
//     creator's own row.
export default function LobbyGameRow({
  game, userId, onJoin, joiningId, profile,
  isInviteToMe = false,
  pendingInviteeNames,
  onCancel,
  cancelDisabled,
  onDecline,
  declineDisabled,
}) {
  const [nudging, setNudging] = useState(false)
  const [justNudged, setJustNudged] = useState(false)

  const players    = game.game_players ?? []
  const isMyGame   = players.some(p => p.user_id === userId)
  const isFull     = players.length >= game.max_players
  // Active games show "X ago" since the current turn started (last move).
  // Waiting and finished games keep their text label.
  const turnTimeAgo = game.turn_started_at ? timeAgo(game.turn_started_at) : null
  // Pending invitees = those in invited_user_ids who haven't yet joined.
  const joinedIds = new Set(players.map(p => p.user_id))
  const pendingInviteeIds = (game.invited_user_ids ?? []).filter(id => !joinedIds.has(id))
  const iAmCreator = game.created_by === userId

  let statusLabel
  if (isInviteToMe) {
    const creatorPlayer = players.find(p => p.user_id === game.created_by)
    const inviterName = creatorPlayer?.profiles?.username ?? 'Someone'
    statusLabel = `📨 ${inviterName} invited you`
  } else if (game.status === 'waiting' && iAmCreator && pendingInviteeIds.length > 0) {
    const names = pendingInviteeIds
      .map(id => pendingInviteeNames?.[id] ?? 'friend')
      .join(', ')
    statusLabel = `📨 Invited ${names}`
  } else if (game.status === 'active') {
    statusLabel = turnTimeAgo ?? '🟢 In progress'
  } else {
    statusLabel = { waiting: '⏳ Waiting for players', finished: '✅ Finished' }[game.status]
  }

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
      // The push IS the nudge — await it so a dropped POST surfaces instead
      // of a false "sent" toast (c239). 8s cap so a hung edge fn can't spin
      // the button forever.
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 8000)
      let ok = false
      try {
        const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/push-notification`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ type: 'nudge', game_id: game.id, nudger_name: profile?.username }),
          signal: ctrl.signal,
        })
        ok = r.ok
        if (!ok) console.warn(`[nudge] push failed: HTTP ${r.status}`)
      } catch (err) {
        console.warn('[nudge] push error:', err?.name === 'AbortError' ? 'timeout' : err)
      } finally {
        clearTimeout(timer)
      }
      if (!ok) throw new Error("Couldn't send the reminder")

      // Stamp the 12h cooldown only once the push has landed, so a failed
      // send doesn't lock the game out of retries for 12h (c248, Yahdle).
      // The push is what "sent" means, so a failed stamp warns rather than
      // throws — worst case the cooldown doesn't hold for this nudge.
      const { error: updateErr } = await supabase
        .from('games')
        .update({ last_nudged_at: new Date().toISOString() })
        .eq('id', game.id)
      if (updateErr) console.warn('[nudge] cooldown stamp failed:', updateErr)

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
    <div className="flex items-center justify-between rounded-xl px-3 py-2 border bg-wordy-50 border-wordy-100">
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
      <div className="flex items-center gap-1.5 shrink-0">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={cancelDisabled}
            className="w-7 h-7 grid place-items-center rounded-full text-wordy-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-40 transition-colors"
            aria-label="Cancel game"
            title="Cancel game"
          >
            ✕
          </button>
        )}
        {onDecline && (
          <button
            type="button"
            onClick={onDecline}
            disabled={declineDisabled}
            className="w-7 h-7 grid place-items-center rounded-full text-wordy-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-40 transition-colors"
            aria-label="Decline invite"
            title="Decline invite"
          >
            ✕
          </button>
        )}
        <button
          onClick={() => onJoin(game)}
          disabled={joiningId === game.id || (isFull && !isMyGame && !isInviteToMe)}
          className={`text-xs px-3 py-1.5 rounded-lg font-bold transition-all shrink-0 min-w-[5rem] ${
            isInviteToMe
              ? 'btn-primary bg-amber-500 hover:bg-amber-600'
              : isMyGame
                ? 'btn-primary'
                : isFull
                  ? 'opacity-40 cursor-default border border-wordy-200 text-wordy-400'
                  : 'btn-primary'
          }`}
        >
          {joiningId === game.id
            ? '…'
            : isInviteToMe
              ? 'Accept'
              : isMyGame
                ? '▶ Resume'
                : '+ Join'}
        </button>
      </div>
    </div>
  )
}
