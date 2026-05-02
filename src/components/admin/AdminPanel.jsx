import { useEffect, useState, useCallback } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase.js'

export default function AdminPanel() {
  const [games, setGames]         = useState([])
  const [closingId, setClosingId] = useState(null)
  const [loading, setLoading]     = useState(true)

  const loadGames = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_list_open_games')
    if (!error) setGames(data ?? [])
  }, [])

  useEffect(() => {
    setLoading(true)
    loadGames().finally(() => setLoading(false))
  }, [loadGames])

  async function closeGame(gameId) {
    setClosingId(gameId)
    try {
      const { error } = await supabase.rpc('admin_close_game', { p_game_id: gameId })
      if (error) throw error
      toast.success('Game closed.')
      setGames(prev => prev.filter(g => g.id !== gameId))
    } catch (err) {
      toast.error(err.message)
    } finally {
      setClosingId(null)
    }
  }

  function timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins  = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days  = Math.floor(diff / 86400000)
    if (days  > 0) return `${days}d ago`
    if (hours > 0) return `${hours}h ago`
    if (mins  > 0) return `${mins}m ago`
    return 'just now'
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

            return (
              <div
                key={g.id}
                className={`flex items-center justify-between rounded-xl px-3 py-2 border ${
                  isOld
                    ? 'bg-rose-50 border-rose-200 dark:bg-[#2a0a0a] dark:border-[#4a1a1a]'
                    : 'bg-wordy-50 border-wordy-100 dark:bg-[#1a1040] dark:border-[#2d1b55]'
                }`}
              >
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
                <button
                  onClick={() => closeGame(g.id)}
                  disabled={closingId === g.id}
                  className="text-xs px-3 py-1.5 rounded-lg font-bold bg-rose-100 text-rose-600 hover:bg-rose-200 transition-colors disabled:opacity-50 border border-rose-200"
                >
                  {closingId === g.id ? '…' : '✕ Close'}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
