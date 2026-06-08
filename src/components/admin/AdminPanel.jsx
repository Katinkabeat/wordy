import { useEffect, useState, useCallback } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase.js'
import { timeAgo } from '../../../../rae-side-quest/packages/sq-ui/index.js'

export default function AdminPanel() {
  const [games, setGames]         = useState([])
  const [closingId, setClosingId] = useState(null)
  const [reasonFor, setReasonFor] = useState(null) // gameId being prompted for a reason
  const [reasonText, setReasonText] = useState('')
  const [loading, setLoading]     = useState(true)

  const loadGames = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_list_open_games')
    if (!error) setGames(data ?? [])
  }, [])

  useEffect(() => {
    setLoading(true)
    loadGames().finally(() => setLoading(false))
  }, [loadGames])

  function startClose(gameId) {
    setReasonFor(gameId)
    setReasonText('')
  }

  function cancelClose() {
    setReasonFor(null)
    setReasonText('')
  }

  async function confirmClose(gameId) {
    const reason = reasonText.trim()
    if (!reason) {
      toast.error('Please enter a reason for closing this game.')
      return
    }
    setClosingId(gameId)
    try {
      const { error } = await supabase.rpc('admin_close_game', { p_game_id: gameId, p_reason: reason })
      if (error) throw error
      toast.success('Game closed.')
      setGames(prev => prev.filter(g => g.id !== gameId))
      cancelClose()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setClosingId(null)
    }
  }


  if (loading) {
    return (
      <div className="card text-center py-10">
        <div className="text-3xl mb-2 animate-bounce">🔐</div>
        <p className="text-wordy-400 font-bold">Loading admin panel…</p>
      </div>
    )
  }

  return (
    <div className="card">
      <h2 className="font-display text-xl text-wordy-700 mb-1">🔒 Close Games</h2>
      <p className="text-xs text-wordy-400 mb-4">
        Close old or stuck games that are no longer active. This marks them as finished so they stop appearing in the lobby.
      </p>

      {games.length === 0 ? (
        <p className="text-center text-wordy-300 py-6 font-bold">
          No open games right now — all clear!
        </p>
      ) : (
        <div className="space-y-2">
          {games.map(g => {
            const playerList = (g.player_names ?? []).filter(Boolean)
            const statusLabel = g.status === 'waiting' ? '⏳ Waiting' : '🟢 Active'
            const isOld = Date.now() - new Date(g.created_at).getTime() > 3600000

            const isPrompting = reasonFor === g.id

            return (
              <div
                key={g.id}
                className={`rounded-xl px-3 py-2 border ${
                  isOld
                    ? 'bg-rose-50 border-rose-200 dark:bg-[#2a0a0a] dark:border-[#4a1a1a]'
                    : 'bg-wordy-50 border-wordy-100 dark:bg-[#1a1040] dark:border-[#2d1b55]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {playerList.length > 0
                        ? playerList.map(name => (
                            <span key={name} className="text-xs font-bold text-wordy-700 bg-wordy-200 px-2 py-0.5 rounded-full">
                              {name}
                            </span>
                          ))
                        : <span className="text-xs text-wordy-400">No players yet</span>
                      }
                      <span className="text-xs text-wordy-400">
                        ({playerList.length}/{g.max_players})
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-wordy-400">{statusLabel}</span>
                      <span className="text-xs text-wordy-300">·</span>
                      <span className={`text-xs font-bold ${isOld ? 'text-rose-500' : 'text-wordy-400'}`}>
                        Created {timeAgo(g.created_at)}
                      </span>
                    </div>
                  </div>
                  {!isPrompting && (
                    <button
                      onClick={() => startClose(g.id)}
                      disabled={closingId === g.id}
                      className="text-xs px-3 py-1.5 rounded-lg font-bold bg-rose-100 text-rose-600 hover:bg-rose-200 transition-colors disabled:opacity-50 border border-rose-200"
                    >
                      {closingId === g.id ? '…' : '✕ Close'}
                    </button>
                  )}
                </div>
                {isPrompting && (
                  <div className="mt-2 space-y-2">
                    <input
                      type="text"
                      value={reasonText}
                      onChange={(e) => setReasonText(e.target.value)}
                      placeholder="Reason for closing (required)"
                      autoFocus
                      maxLength={200}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') confirmClose(g.id)
                        if (e.key === 'Escape') cancelClose()
                      }}
                      className="w-full px-2 py-1.5 rounded-lg border-2 border-wordy-200 text-xs font-bold text-wordy-700 focus:border-wordy-400 focus:outline-none"
                    />
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={cancelClose}
                        disabled={closingId === g.id}
                        className="text-xs px-3 py-1.5 rounded-lg font-bold text-wordy-400 hover:text-wordy-600 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => confirmClose(g.id)}
                        disabled={closingId === g.id || !reasonText.trim()}
                        className="text-xs px-3 py-1.5 rounded-lg font-bold bg-rose-500 text-white hover:bg-rose-600 transition-colors disabled:opacity-50"
                      >
                        {closingId === g.id ? '…' : 'Confirm Close'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
