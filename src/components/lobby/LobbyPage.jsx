import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase.js'
import { createTileBag, refillRack } from '../../lib/tileData.js'
import { createEmptyBoard, serializeBoard } from '../../lib/boardData.js'
import AdminPanel from '../admin/AdminPanel.jsx'
import NotificationBanner from './NotificationBanner.jsx'
import IOSInstallPrompt from './IOSInstallPrompt.jsx'
import SettingsDropdown from './SettingsModal.jsx'
import { useTheme } from '../../contexts/ThemeContext.jsx'

const AVATAR_HUES = [270, 330, 190, 30, 160, 10]

export default function LobbyPage({ session }) {
  const navigate = useNavigate()
  const user = session.user
  const { isDark, toggle: toggleTheme } = useTheme()

  const [profile, setProfile]         = useState(null)
  const [games, setGames]             = useState([])
  const [maxPlayers, setMax]          = useState(2)
  const [creating, setCreating]       = useState(false)
  const [joiningId, setJoiningId]     = useState(null)
  const [adminRecord, setAdminRecord] = useState(null)  // null = not admin
  const [lobbyTab, setLobbyTab]       = useState('lobby') // 'lobby' | 'admin'
  const [showSettings, setShowSettings] = useState(false)
  const [unseenResults, setUnseenResults] = useState([]) // finished games not yet acknowledged

  // ── Load profile ───────────────────────────────────────────
  useEffect(() => {
    supabase.from('profiles').select('*').eq('id', user.id).single()
      .then(({ data }) => setProfile(data))
  }, [user.id])

  // ── Load admin status ─────────────────────────────────────
  useEffect(() => {
    supabase.from('admins').select('*').eq('user_id', user.id).maybeSingle()
      .then(({ data }) => setAdminRecord(data ?? null))
  }, [user.id])

  // ── Load available games ──────────────────────────────────
  const loadGames = useCallback(async () => {
    const { data } = await supabase
      .from('games')
      .select(`
        id, status, max_players, created_at, current_player_idx,
        game_players ( user_id, player_index, score, profiles ( username ) )
      `)
      .in('status', ['waiting', 'active'])
      .order('created_at', { ascending: false })
      .limit(20)
    setGames(data ?? [])
  }, [])

  useEffect(() => { loadGames() }, [loadGames])

  // On mount: show a banner for any recently finished game the user hasn't dismissed yet
  const seenKey = `wordy_seen_results_${user.id}`
  useEffect(() => {
    async function loadUnseenResults() {
      const seen = new Set(JSON.parse(localStorage.getItem(seenKey) ?? '[]'))

      // Fetch the user's finished game records (no nested joins — avoids RLS/circular-join issues)
      const { data: gps } = await supabase
        .from('game_players')
        .select('game_id, is_winner, games(id, status, finished_at, forfeit_user_id)')
        .eq('user_id', user.id)
        .order('games(finished_at)', { ascending: false })
        .limit(20)

      const unseen = (gps ?? []).filter(gp => gp.games?.status === 'finished' && !seen.has(gp.game_id))
      if (unseen.length === 0) { setUnseenResults([]); return }

      // Fetch ALL players for those games in a flat separate query (avoids RLS blocking nested join)
      const gameIds = unseen.map(gp => gp.game_id)
      const { data: allGamePlayers } = await supabase
        .from('game_players')
        .select('game_id, user_id, is_winner, score')
        .in('game_id', gameIds)

      // Batch-fetch all usernames
      const allUserIds = [...new Set((allGamePlayers ?? []).map(p => p.user_id))]
      const { data: profs } = await supabase.from('profiles').select('id, username').in('id', allUserIds)
      const profileMap = Object.fromEntries((profs ?? []).map(p => [p.id, p.username]))

      // Group players by game_id
      const playersByGame = {}
      for (const p of (allGamePlayers ?? [])) {
        if (!playersByGame[p.game_id]) playersByGame[p.game_id] = []
        playersByGame[p.game_id].push(p)
      }

      setUnseenResults(unseen.map(gp => {
        const allPlayers = playersByGame[gp.game_id] ?? []
        // Prefer is_winner flag; fall back to highest score if RPC didn't set it
        const winnerPlayer = allPlayers.find(p => p.is_winner)
          ?? allPlayers.reduce((best, p) => (p.score ?? 0) > (best?.score ?? -1) ? p : best, null)
        return {
          gameId:     gp.game_id,
          isWinner:   gp.is_winner,
          game:       gp.games,
          winnerName:     profileMap[winnerPlayer?.user_id] ?? '?',
          allPlayerNames: allPlayers.map(p => profileMap[p.user_id] ?? '?').join(' · '),
        }
      }))
    }
    loadUnseenResults()
  }, [user.id, seenKey])

  function dismissResult(gameId) {
    const seen = new Set(JSON.parse(localStorage.getItem(seenKey) ?? '[]'))
    seen.add(gameId)
    localStorage.setItem(seenKey, JSON.stringify([...seen]))
    setUnseenResults(prev => prev.filter(r => r.gameId !== gameId))
  }

  // Track which game IDs the user is currently in so the real-time handler can detect finishes
  const myGameIdsRef = useRef(new Set())
  useEffect(() => {
    myGameIdsRef.current = new Set(
      games.filter(g => g.game_players.some(p => p.user_id === user.id)).map(g => g.id)
    )
  }, [games, user.id])

  // Real-time: refresh list when a game changes.
  // Also watch for a game the user is in finishing and show a winner rotification.
  const handleGameChange = useCallback(async (payload) => {
    loadGames()
    if (payload.new?.status === 'finished' && myGameIdsRef.current.has(payload.new.id)) {
      const gameId = payload.new.id
      const { data: gps } = await supabase
        .from('game_players')
        .select('user_id, is_winner, score')
        .eq('game_id', gameId)
      // Prefer is_winner flag; fall back to highest score if RPC didn't set it
      const winnerPlayer = gps?.find(p => p.is_winner)
        ?? gps?.reduce((best, p) => (p.score ?? 0) > (best?.score ?? -1) ? p : best, null)
      let name = '?'
      if (winnerPlayer) {
        const { data: prof } = await supabase.from('profiles').select('username').eq('id', winnerPlayer.user_id).single()
        name = prof?.username ?? '?'
      }
      const headline = payload.new.forfeit_user_id
        ? '🏳️ Opponent forfeited!'
        : `🏆 ${name} wins!`
      toast(
        (t) => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontWeight: 'bold' }}>{headline}</span>
            <button
              onClick={() => { dismissResult(gameId); navigate(`/game/${gameId}`); toast.dismiss(t.id) }}
              style={{ fontSize: 12, textDecoration: 'underline', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              View final board →
            </button>
          </div>
        ),
        { duration: 15000 }
      )
    }
  }, [loadGames, navigate, user.id])

  useEffect(() => {
    const channel = supabase.channel('lobby-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, handleGameChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_players' }, loadGames)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [loadGames, handleGameChange])

  // ── Create a new game ─────────────────────────────────────
  async function createGame() {
    setCreating(true)
    try {
      // Build the initial tile bag
      let bag  = createTileBag()
      let rack = []
     ;({ rack, bag } = refillRack(rack, bag))

      const board = serializeBoard(createEmptyBoard())

      const { data: game, error: gameErr } = await supabase
        .from('games')
        .insert({ status: 'waiting', max_players: maxPlayers, tile_bag: bag, board, created_by: user.id })
        .select().single()
      if (gameErr) throw gameErr

      const { error: playerErr } = await supabase
        .from('game_players')
        .insert({ game_id: game.id, user_id: user.id, player_index: 0, rack })
      if (playerErr) throw playerErr

      toast.success('🎉 Game created! Waiting for friends to join …')
      navigate(`/game/${game.id}`)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setCreating(false)
    }
  }

  // ── Join an existing game ─────────────────────────────────
  async function joinGame(game) {
    setJoiningId(game.id)
    try {
      // Check if already in game
      const alreadyIn = game.game_players.some(p => p.user_id === user.id)
      if (alreadyIn) { navigate(`/game/${game.id}`); return }

      const playerIndex = game.game_players.length
      if (playerIndex >= game.max_players) {
        toast.error('This game is full!')
        return
      }

      // Get fresh bag & deal rack
      const { data: fresh } = await supabase
        .from('games').select('tile_bag').eq('id', game.id).single()
      let bag  = fresh.tile_bag
      let rack = []
      ;({ rack, bag } = refillRack(rack, bag))

      const { error: joinErr } = await supabase
        .from('game_players')
        .insert({ game_id: game.id, user_id: user.id, player_index: playerIndex, rack })
      if (joinErr) throw joinErr

      // Update the tile bag
      await supabase.from('games').update({ tile_bag: bag }).eq('id', game.id)

      // If we now have enough players, start the game with a random first player
      if (playerIndex + 1 === game.max_players) {
        const randomFirst = Math.floor(Math.random() * game.max_players)
        await supabase.from('games').update({ status: 'active', current_player_idx: randomFirst }).eq('id', game.id)
      }

      // Notify the game creator that someone joined (fire-and-forget)
      fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/Push-Notification`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ type: 'player_joined', game_id: game.id, joiner_name: profile?.username }),
      })
        .then(r => r.json().then(d => console.log('[push-notify]', r.status, d)))
        .catch(e => console.warn('[push-notify] failed:', e))

      toast.success('🟣 Joined! Good luck!')
      navigate(`/game/${game.id}`)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setJoiningId(null)
    }
  }

  const myGames   = games.filter(g => g.game_players.some(p => p.user_id === user.id))
  const openGames = games.filter(g =>
    !g.game_players.some(p => p.user_id === user.id) &&
    g.status === 'waiting' &&
    g.game_players.length < g.max_players
  )

  return (
    <div className="min-h-screen bg-gradient-to-br from-wordy-50 via-pink-50 to-wordy-100 dark:bg-[#0f0a1e] dark:bg-none">
      {/* Header */}
      <header className="bg-white border-b border-wordy-100 shadow-sm sticky top-0 z-10 dark:bg-[#130c25] dark:border-[#2d1b55]">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-wordy-600 flex items-center justify-center">
              <span className="font-display text-xl text-white">W</span>
            </div>
            <span className="font-display text-2xl text-wordy-700">Wordy</span>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/stats')} className="btn-secondary text-sm py-1.5 px-3">
              📊 Stats
            </button>
            <div className="flex items-center gap-2">
              <Avatar hue={profile?.avatar_hue ?? 270} name={profile?.username ?? '?'} size={8} />
              <span className="text-sm font-bold text-wordy-700 hidden sm:block">
                {profile?.username ?? '…'}
              </span>
            </div>
            <div className="relative">
              <button
                onClick={() => setShowSettings(s => !s)}
                className="text-lg leading-none hover:scale-110 transition-transform text-wordy-500 hover:text-wordy-700"
                title="Settings"
              >
                ⚙️
              </button>
              {showSettings && profile && (
                <SettingsDropdown
                  profile={profile}
                  onClose={() => setShowSettings(false)}
                  onProfileUpdate={updated => setProfile(updated)}
                  isDark={isDark}
                  toggleTheme={toggleTheme}
                  isAdmin={!!adminRecord}
                  lobbyTab={lobbyTab}
                  onToggleAdmin={() => { setLobbyTab(t => t === 'admin' ? 'lobby' : 'admin'); setShowSettings(false) }}
                  onLogout={async () => {
                    try { await supabase.auth.signOut() } catch {}
                    // Fallback: nuke auth tokens from localStorage so even
                    // a corrupt session gets cleared and we return to login
                    Object.keys(localStorage).forEach(k => {
                      if (k.startsWith('sb-')) localStorage.removeItem(k)
                    })
                    window.location.replace('/wordy/auth')
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">

        {/* Admin Panel */}
        {lobbyTab === 'admin' && adminRecord && (
          <AdminPanel session={session} adminRecord={adminRecord} />
        )}

        {/* Lobby content */}
        {lobbyTab === 'lobby' && (
          <>
            {/* iOS: guide user to install PWA for push support */}
            <IOSInstallPrompt />

            {/* Push notification opt-in */}
            <NotificationBanner userId={user.id} />

            {/* Create game panel */}
            <div className="card">
              <h2 className="font-display text-xl text-wordy-700 mb-4">🌸 New Game</h2>
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <label className="block text-xs font-bold text-wordy-600 mb-1">Players</label>
                  <div className="flex gap-2">
                    {[2, 3, 4].map(n => (
                      <button
                        key={n}
                        onClick={() => setMax(n)}
                        className={`w-10 h-10 rounded-xl font-bold text-sm transition-all ${
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
                <button
                  onClick={createGame} disabled={creating}
                  className="btn-primary disabled:opacity-60"
                >
                  {creating ? '⏳ Creating…' : '✨ Create Game'}
                </button>
              </div>
            </div>

            {/* My active games */}
            {myGames.length > 0 && (
              <div className="card">
                <h2 className="font-display text-xl text-wordy-700 mb-3">🎮 My Games</h2>
                <div className="space-y-2">
                  {myGames.map(g => (
                    <GameRow key={g.id} game={g} userId={user.id} onJoin={joinGame} joiningId={joiningId} />
                  ))}
                </div>
              </div>
            )}

            {/* Unseen game results — shown until dismissed */}
            {unseenResults.map(({ gameId, isWinner, game: g, winnerName, allPlayerNames }) => {
              const isForfeit = !!g?.forfeit_user_id
              return (
                <div key={gameId} className="flex items-center justify-between gap-3 bg-wordy-600 text-white rounded-2xl px-4 py-3 shadow">
                  <div>
                    <p className="font-display text-base leading-tight">
                      {isForfeit ? '🏳️ Opponent forfeited!' : `🏆 ${winnerName} wins!`}
                    </p>
                    {allPlayerNames && <p className="text-xs opacity-80 mt-0.5 pl-6">{allPlayerNames}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => { dismissResult(gameId); navigate(`/game/${gameId}`) }}
                      className="text-sm font-bold opacity-90 hover:opacity-100 whitespace-nowrap"
                    >
                      View board
                    </button>
                    <button
                      onClick={() => dismissResult(gameId)}
                      className="text-white opacity-70 hover:opacity-100 text-2xl leading-none font-bold"
                      title="Dismiss"
                    >
                      ×
                    </button>
                  </div>
                </div>
              )
            })}

            {/* Open games to join */}
            {openGames.length > 0 && (
              <div className="card">
                <h2 className="font-display text-xl text-wordy-700 mb-3">🚪 Open Games</h2>
                <div className="space-y-2">
                  {openGames.map(g => (
                    <GameRow key={g.id} game={g} userId={user.id} onJoin={joinGame} joiningId={joiningId} />
                  ))}
                </div>
              </div>
            )}

            {games.length === 0 && (
              <div className="text-center py-12 text-wordy-300">
                <div className="text-5xl mb-3">🟣</div>
                <p className="font-display text-xl">No games yet — be the first to create one!</p>
              </div>
            )}
          </>
        )}
      </main>

    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────

function GameRow({ game, userId, onJoin, joiningId }) {
  const players    = game.game_players ?? []
  const isMyGame   = players.some(p => p.user_id === userId)
  const isFull     = players.length >= game.max_players
  const statusLabel = {
    waiting:  '⏳ Waiting for players',
    active:   '🟢 In progress',
    finished: '✅ Finished',
  }[game.status]

  return (
    <div className="flex items-center justify-between bg-wordy-50 rounded-xl px-3 py-2 border border-wordy-100">
      <div>
        <div className="flex items-center gap-1.5">
          {players.map(p => {
            const isCurrentTurn = game.status === 'active' && p.player_index === game.current_player_idx
            return (
              <span
                key={p.user_id}
                className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                  isCurrentTurn
                    ? 'text-white bg-wordy-500'
                    : 'text-wordy-700 bg-wordy-200'
                }`}
              >
                {p.profiles?.username ?? '?'}
              </span>
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
        className={`text-sm px-3 py-1.5 rounded-lg font-bold transition-all ${
          isMyGame
            ? 'btn-primary text-xs'
            : isFull
            ? 'opacity-40 cursor-default border border-wordy-200 text-wordy-400 text-xs'
            : 'btn-primary text-xs'
        }`}
      >
        {joiningId === game.id ? '…' : isMyGame ? '▶ Resume' : '+ Join'}
      </button>
    </div>
  )
}

function Avatar({ hue, name, size = 8 }) {
  const initials = name?.slice(0, 2).toUpperCase() ?? '?'
  return (
    <div
      className={`w-${size} h-${size} rounded-full flex items-center justify-center font-bold text-white text-xs`}
      style={{ background: `hsl(${hue}, 70%, 55%)` }}
    >
      {initials}
    </div>
  
  
 "�div>
  �J 
}

