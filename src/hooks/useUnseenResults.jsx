import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase.js'

// Owns the "you have a finished game you haven't acknowledged" banner state.
// Loads on mount, exposes dismissResult, and listens to the supplied games
// list so it can react when one of the user's games transitions to finished.
export function useUnseenResults({ user, games, navigate }) {
  const [unseenResults, setUnseenResults] = useState([])

  const loadUnseenResults = useCallback(async () => {
    const { data: gps, error: gpErr } = await supabase
      .from('game_players')
      .select('game_id, is_winner, dismissed_at, games!inner(id, status, finished_at, forfeit_user_id, closed_by_admin)')
      .eq('user_id', user.id)
      .eq('games.status', 'finished')
      .is('dismissed_at', null)
      .order('finished_at', { referencedTable: 'games', ascending: false })
      .limit(10)
    if (gpErr) { console.error('loadUnseenResults: query failed:', gpErr); return }

    const unseen = gps ?? []
    if (unseen.length === 0) { setUnseenResults([]); return }

    unseen.sort((a, b) => (b.games?.finished_at ?? '').localeCompare(a.games?.finished_at ?? ''))

    const gameIds = unseen.map(gp => gp.game_id)
    const { data: allGamePlayers } = await supabase
      .from('game_players')
      .select('game_id, user_id, is_winner, score')
      .in('game_id', gameIds)

    const allUserIds = [...new Set((allGamePlayers ?? []).map(p => p.user_id))]
    const { data: profs } = await supabase.from('profiles').select('id, username').in('id', allUserIds)
    const profileMap = Object.fromEntries((profs ?? []).map(p => [p.id, p.username]))

    const playersByGame = {}
    for (const p of (allGamePlayers ?? [])) {
      if (!playersByGame[p.game_id]) playersByGame[p.game_id] = []
      playersByGame[p.game_id].push(p)
    }

    setUnseenResults(unseen.map(gp => {
      const allPlayers = playersByGame[gp.game_id] ?? []
      // Only an explicit is_winner flag counts as a winner — no highest-score
      // fallback (would mislabel admin-closed games and ties).
      const winnerPlayer = allPlayers.find(p => p.is_winner) ?? null
      return {
        gameId:     gp.game_id,
        isWinner:   gp.is_winner,
        game:       gp.games,
        winnerName:     winnerPlayer ? (profileMap[winnerPlayer.user_id] ?? '?') : null,
        allPlayerNames: allPlayers.map(p => profileMap[p.user_id] ?? '?').join(' · '),
      }
    }))
  }, [user.id])

  useEffect(() => { loadUnseenResults() }, [loadUnseenResults])

  function dismissResult(gameId) {
    supabase
      .from('game_players')
      .update({ dismissed_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('game_id', gameId)
      .then(({ error }) => { if (error) console.error('dismiss write failed:', error) })
    setUnseenResults(prev => prev.filter(r => r.gameId !== gameId))
  }

  // Track which game IDs the user is currently in, so the realtime handler
  // can detect when one of their games transitions to finished.
  const myGameIdsRef = useRef(new Set())
  useEffect(() => {
    myGameIdsRef.current = new Set(
      games.filter(g => g.game_players.some(p => p.user_id === user.id)).map(g => g.id)
    )
  }, [games, user.id])

  // Returned to caller so it can be wired into the lobby's realtime channel
  // alongside the normal loadGames refresh.
  const handleFinishedToast = useCallback(async (payload) => {
    if (payload.new?.status !== 'finished') return
    if (!myGameIdsRef.current.has(payload.new.id)) return

    // Refresh the persistent banner list so it appears even after the toast expires.
    // Small delay lets the finish_game RPC complete so is_winner is set in DB.
    setTimeout(() => loadUnseenResults(), 1500)

    const gameId = payload.new.id
    let headline
    if (payload.new.closed_by_admin) {
      headline = '🛑 Game closed by admin'
    } else if (payload.new.forfeit_user_id) {
      headline = '🏳️ Opponent forfeited!'
    } else {
      const { data: gps } = await supabase
        .from('game_players')
        .select('user_id, is_winner')
        .eq('game_id', gameId)
      const winnerPlayer = gps?.find(p => p.is_winner) ?? null
      if (winnerPlayer) {
        const { data: prof } = await supabase.from('profiles').select('username').eq('id', winnerPlayer.user_id).single()
        headline = `🏆 ${prof?.username ?? '?'} wins!`
      } else {
        headline = "🤝 It's a tie!"
      }
    }
    toast(
      (t) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontWeight: 'bold' }}>{headline}</span>
          <button
            onClick={() => { navigate(`/game/${gameId}`); toast.dismiss(t.id) }}
            style={{ fontSize: 12, textDecoration: 'underline', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            View final board →
          </button>
        </div>
      ),
      { duration: 15000 }
    )
  }, [loadUnseenResults, navigate])

  return { unseenResults, loadUnseenResults, dismissResult, handleFinishedToast }
}
