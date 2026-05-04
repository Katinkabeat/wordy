// ────────────────────────────────────────────────────────────
//  CreateGameSheet — pick mode + player count + (optionally) friends.
//
//  Two modes inside one sheet:
//    🌍 Open       — anyone can join. Auto-cancels after 7 days.
//    👥 With friends — pick up to (max-1) friends. Their slots are
//                      reserved; remaining slots fill from open lobby.
//                      Auto-starts after 24h with whoever joined
//                      (min 2 players); cancels if fewer.
//
//  Friend list comes from the SQ hub's `friendships` table via
//  useFriends. Multi-select: tapping a friend toggles them in the
//  selection. The button label updates with the selection count.
// ────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useFriends } from '../../hooks/useFriends.js'
import { createGame } from '../../lib/gameMutations.js'

export default function CreateGameSheet({ user, onClose, onCreated }) {
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [mode, setMode] = useState('open')
  const [maxPlayers, setMaxPlayers] = useState(2)
  const [search, setSearch] = useState('')
  const [selectedFriendIds, setSelectedFriendIds] = useState(new Set())
  const { friends, loading: friendsLoading } = useFriends(user?.id)

  useEffect(() => {
    const id = requestAnimationFrame(() => setOpen(true))
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // If maxPlayers shrinks while we have too many invitees selected, trim.
  useEffect(() => {
    const limit = maxPlayers - 1
    if (selectedFriendIds.size > limit) {
      const arr = [...selectedFriendIds].slice(0, limit)
      setSelectedFriendIds(new Set(arr))
    }
  }, [maxPlayers, selectedFriendIds])

  const filteredFriends = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return friends
    return friends.filter(f => f.username?.toLowerCase().includes(q))
  }, [friends, search])

  const inviteLimit = maxPlayers - 1
  const selectedCount = selectedFriendIds.size

  function toggleFriend(id) {
    setSelectedFriendIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else if (next.size < inviteLimit) next.add(id)
      else toast(`You can invite up to ${inviteLimit} friend${inviteLimit > 1 ? 's' : ''} for a ${maxPlayers}-player game.`)
      return next
    })
  }

  async function handlePostOpen() {
    if (submitting) return
    setSubmitting(true)
    try {
      const { gameId } = await createGame({ user, maxPlayers })
      toast.success('🎉 Game posted — waiting for an opponent.')
      onCreated(gameId)
    } catch (err) {
      toast.error(err.message || 'Failed to create game')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSendInvite() {
    if (submitting || selectedCount === 0) return
    setSubmitting(true)
    try {
      const { gameId } = await createGame({
        user,
        maxPlayers,
        invitedUserIds: [...selectedFriendIds],
      })
      const names = friends
        .filter(f => selectedFriendIds.has(f.id))
        .map(f => f.username)
      toast.success(
        names.length === 1
          ? `Invite sent to ${names[0]}.`
          : `Invites sent to ${names.length} friends.`
      )
      onCreated(gameId)
    } catch (err) {
      toast.error(err.message || 'Failed to send invites')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className={`fixed inset-0 z-50 grid place-items-center p-4 bg-black/40 transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0'}`}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`relative card p-6 w-full max-w-sm transition-all duration-300 ease-out ${
          open ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
        }`}
        style={{ transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 w-8 h-8 grid place-items-center rounded-full bg-wordy-100 text-wordy-700 hover:bg-wordy-200 transition-colors"
          aria-label="Close"
        >
          ×
        </button>

        <h2 className="font-display text-xl text-wordy-800 dark:text-wordy-100 mb-1">
          New Game
        </h2>
        <p className="text-xs text-wordy-500 mb-4">
          Pick how you want to play.
        </p>

        <div className="flex bg-wordy-100 rounded-full p-1 mb-4">
          <button
            type="button"
            onClick={() => setMode('open')}
            className={`flex-1 px-3 py-2 rounded-full text-sm font-display transition-all ${
              mode === 'open'
                ? 'bg-white text-wordy-800 shadow-sm'
                : 'text-wordy-600 hover:text-wordy-800'
            }`}
          >
            🌍 Open
          </button>
          <button
            type="button"
            onClick={() => setMode('friend')}
            className={`flex-1 px-3 py-2 rounded-full text-sm font-display transition-all ${
              mode === 'friend'
                ? 'bg-white text-wordy-800 shadow-sm'
                : 'text-wordy-600 hover:text-wordy-800'
            }`}
          >
            👥 With friends
          </button>
        </div>

        {/* Player count toggle (shared by both modes) */}
        <div className="mb-4">
          <label className="block text-[11px] uppercase font-bold text-wordy-500 mb-1.5 tracking-wide">Players</label>
          <div className="flex gap-2">
            {[2, 3, 4].map(n => (
              <button
                key={n}
                type="button"
                onClick={() => setMaxPlayers(n)}
                className={`flex-1 h-10 rounded-xl font-bold text-sm transition-all ${
                  maxPlayers === n
                    ? 'bg-wordy-600 text-white shadow'
                    : 'border-2 border-wordy-200 text-wordy-500 hover:border-wordy-400'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {mode === 'open' && (
          <>
            <div className="text-xs text-wordy-700 dark:text-wordy-200 bg-wordy-50 dark:bg-[#1f1240] border border-dashed border-wordy-200 rounded-lg px-3 py-2 mb-4">
              Anyone in Wordy can join your game from their lobby. Auto-cancels after 7 days.
            </div>
            <button
              onClick={handlePostOpen}
              disabled={submitting}
              className="btn-primary w-full text-sm font-display disabled:opacity-60"
            >
              {submitting ? '⏳ Posting…' : '✨ Post open game'}
            </button>
          </>
        )}

        {mode === 'friend' && (
          <>
            <div className="text-xs text-wordy-700 dark:text-wordy-200 bg-wordy-50 dark:bg-[#1f1240] border border-dashed border-wordy-200 rounded-lg px-3 py-2 mb-3">
              Pick up to {inviteLimit} friend{inviteLimit > 1 ? 's' : ''}. Their slots are reserved.
              {selectedCount < inviteLimit && (
                <> Remaining {inviteLimit - selectedCount} slot{inviteLimit - selectedCount > 1 ? 's' : ''} will fill from the open lobby.</>
              )}{' '}
              Auto-starts after 24h with whoever joined (min 2 players).
            </div>

            {friendsLoading ? (
              <p className="text-xs text-wordy-500 italic text-center py-4">Loading friends…</p>
            ) : friends.length === 0 ? (
              <div className="text-center py-4">
                <p className="text-sm text-wordy-600 mb-1">No friends yet.</p>
                <p className="text-xs text-wordy-500 italic">Add friends in the Side Quest hub settings.</p>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search friends by name…"
                  className="w-full px-3 py-2 rounded-lg border border-wordy-200 bg-wordy-50 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-wordy-400"
                />

                <div className="max-h-44 overflow-y-auto rounded-lg border border-wordy-100 mb-3">
                  {filteredFriends.length === 0 ? (
                    <p className="text-xs text-wordy-500 italic text-center py-3">No friends match.</p>
                  ) : (
                    filteredFriends.map(f => {
                      const isSelected = selectedFriendIds.has(f.id)
                      const atLimit = !isSelected && selectedCount >= inviteLimit
                      return (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => toggleFriend(f.id)}
                          className={`w-full flex items-center gap-2.5 px-3 py-2 border-b border-wordy-100 last:border-b-0 transition-colors ${
                            isSelected
                              ? 'bg-wordy-100'
                              : atLimit
                                ? 'opacity-40'
                                : 'hover:bg-wordy-50'
                          }`}
                        >
                          <span
                            className="w-8 h-8 rounded-full grid place-items-center text-white font-display text-xs shrink-0"
                            style={{ background: `hsl(${f.avatar_hue ?? 280}, 70%, 55%)` }}
                          >
                            {(f.username ?? '?').slice(0, 2).toUpperCase()}
                          </span>
                          <span className="flex-1 text-left font-bold text-sm text-wordy-800 truncate">
                            {f.username ?? 'unknown'}
                          </span>
                          <span
                            className={`w-5 h-5 rounded-full border-2 grid place-items-center text-white text-[10px] shrink-0 ${
                              isSelected
                                ? 'bg-wordy-600 border-wordy-600'
                                : 'border-wordy-300'
                            }`}
                          >
                            {isSelected ? '✓' : ''}
                          </span>
                        </button>
                      )
                    })
                  )}
                </div>

                <button
                  onClick={handleSendInvite}
                  disabled={submitting || selectedCount === 0}
                  className="btn-primary w-full text-sm font-display disabled:opacity-50"
                >
                  {submitting
                    ? '⏳ Sending…'
                    : selectedCount === 0
                      ? '📨 Pick at least one friend'
                      : selectedCount === 1
                        ? `📨 Send invite (1 friend)`
                        : `📨 Send invites (${selectedCount} friends)`}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
