import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase.js'

export default function StatsPage({ session }) {
  const navigate = useNavigate()
  const user     = session.user

  const [profile,   setProfile]  = useState(null)
  const [matchups,  setMatchups] = useState([])
  const [history,   setHistory]  = useState([])
  const [loading,   setLoading]  = useState(true)

  useEffect(() => {
    async function load() {
      // My profile
      const { data: prof } = await supabase
        .from('profiles').select('*').eq('id', user.id).single()
      setProfile(prof)

      // Matchup stats vs each opponent
      const { data: mu } = await supabase
        .from('player_matchups')
        .select('*, opponent:opponent_id ( profiles ( username ) )')
        .eq('player_id', user.id)
        .order('wins', { ascending: false })
      setMatchups(mu ?? [])

      // Recent finished games I was in
      const { data: gp } = await supabase
        .from('game_players')
        .select(`
          score, is_winner,
          games ( id, status, finished_at, max_players,
            game_players ( score, is_winner, profiles ( username ) )
          )
        `)
        .eq('user_id', user.id)
        .eq('games.status', 'finished')
        .order('games(finished_at)', { ascending: false })
        .limit(10)
      setHistory((gp ?? []).filter(g => g.games?.status === 'finished'))

      setLoading(false)
    }
    load()
  }, [user.id])

  const totalWins   = matchups.reduce((s, m) => s + m.wins, 0)
  const totalGames  = matchups.reduce((s, m) => s + m.wins + m.losses, 0)
  const winRate     = totalGames > 0 ? Math.round((totalWins / totalGames) * 100) : 0

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-wordy-50">
        <p className="font-display text-2xl text-wordy-400 animate-pulse">Loading stats… 🟣</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-wordy-50 to-pink-50">
      {/* Header */}
      <header className="bg-white border-b border-wordy-100 shadow-sm sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate('/lobby')} className="text-wordy-400 hover:text-wordy-700 font-bold text-sm">
            ← Lobby
          </button>
          <span className="font-display text-xl text-wordy-700">📊 Your Stats</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-3">
          <StatCard emoji="🏆" label="Total Wins"  value={totalWins}  color="wordy" />
          <StatCard emoji="🎮" label="Games Played" value={totalGames} color="pink" />
          <StatCard emoji="📈" label="Win Rate"    value={`${winRate}%`} color="indigo" />
        </div>

        {/* Head-to-head */}
        {matchups.length > 0 && (
          <div className="card">
            <h2 className="font-display text-xl text-wordy-700 mb-3">🤝 Head-to-Head</h2>
            <div className="space-y-2">
              {matchups.map(m => {
                const oppName  = m.opponent?.profiles?.username ?? 'Unknown'
                const total    = m.wins + m.losses
                const pct      = total > 0 ? Math.round((m.wins / total) * 100) : 0
                return (
                  <div key={m.id} className="bg-wordy-50 rounded-xl px-4 py-3 border border-wordy-100">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-wordy-700 text-sm">{oppName}</span>
                      <span className="text-xs text-wordy-400 font-bold">
                        {m.wins}W – {m.losses}L
                      </span>
                    </div>
                    {/* Progress bar */}
                    <div className="h-2 bg-wordy-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-wordy-500 to-pink-400 rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="text-right text-xs text-wordy-400 mt-0.5">{pct}% win rate</p>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Recent games */}
        {history.length > 0 && (
          <div className="card">
            <h2 className="font-display text-xl text-wordy-700 mb-3">🕑 Recent Games</h2>
            <div className="space-y-2">
              {history.map(gp => {
                const g = gp.games
                if (!g) return null
                const opponents = g.game_players?.filter(p => {
                  const name = p.profiles?.username
                  return name && name !== profile?.username
                }) ?? []

                return (
                  <div key={g.id} className={`rounded-xl px-4 py-2 border text-sm ${
                    gp.is_winner
                      ? 'bg-green-50 border-green-200'
                      : 'bg-rose-50 border-rose-200'
                  }`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <span className={`font-bold ${gp.is_winner ? 'text-green-700' : 'text-rose-700'}`}>
                          {gp.is_winner ? '🏆 Win' : '😅 Loss'}
                        </span>
                        <span className="text-wordy-400 text-xs ml-2">
                          vs {opponents.map(o => o.profiles?.username ?? '?').join(', ') || '?'}
                        </span>
                      </div>
                      <span className="font-display text-lg text-wordy-700">{gp.score} pts</span>
                    </div>
                    {g.finished_at && (
                      <p className="text-xs text-wordy-300 mt-0.5">
                        {new Date(g.finished_at).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {totalGames === 0 && (
          <div className="text-center py-12 text-wordy-300">
            <div className="text-5xl mb-3">🌸</div>
            <p className="font-display text-xl">No finished games yet — go play!</p>
            <button onClick={() => navigate('/lobby')} className="btn-primary mt-4 text-sm">
              Go to Lobby →
            </button>
          </div>
        )}
      </main>
    </div>
  )
}

function StatCard({ emoji, label, value, color }) {
  const colours = {
    wordy:  'from-wordy-500  to-wordy-600',
    pink:   'from-pink-400   to-pink-500',
    indigo: 'from-indigo-400 to-indigo-500',
  }
  return (
    <div className={`rounded-2xl bg-gradient-to-br ${colours[color]} p-4 text-white shadow`}>
      <div className="text-2xl mb-1">{emoji}</div>
      <div className="font-display text-2xl">{value}</div>
      <div className="text-xs opacity-80 font-bold">{label}</div>
    </div>
  )
}
