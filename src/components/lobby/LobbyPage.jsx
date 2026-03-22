import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase.js'
import { createTileBag, refillRack } from '../../lib/tileData.js'
import { createEmptyBoard, serializeBoard } from '../../lib/boardData.js'
import AdminPanel from '../admin/AdminPanel.jsx'
import NotificationBanner from './NotificationBanner.jsx'
import IOSInstallPrompt from './IOSInstallPrompt.jsx'
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

  // ── Load profile ──────────────────────────────────────────
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

  // Real-time: refresh list when a game changes
  useEffect(() => {
    const channel = supabase.channel('lobby-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, loadGames)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_players' }, loadGames)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [loadGames])

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

      toast.success('🎉 Game created! Waiting for friends to join…')
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

      // If we now have enough players, start the game
      if (playerIndex + 1 === game.max_players) {
        await supabase.from('games').update({ status: 'active' }).eq('id', game.id)
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
            {adminRecord && (
              <button
                onClick={() => setLobbyTab(t => t === 'admin' ? 'lobby' : 'admin')}
                className={`text-sm py-1.5 px-3 rounded-xl font-bold border-2 transition-all ${
                  lobbyTab === 'admin'
                    ? 'bg-wordy-600 text-white border-wordy-600'
                    : 'border-wordy-200 text-wordy-600 hover:border-wordy-400'
                }`}
              >
                🔐 Admin
              </button>
            )}
            <button onClick={() => navigate('/stats')} className="btn-secondary text-sm py-1.5 px-3">
              📊 Stats
            </button>
            <div className="flex items-center gap-2">
              <Avatar hue={profile?.avatar_hue ?? 270} name={profile?.username ?? '?'} size={8} />
              <span className="text-sm font-bold text-wordy-700 hidden sm:block">
                {profile?.username ?? '…'}
              </span>
            </div>
            <button
              onClick={toggleTheme}
              className="text-lg leading-none hover:scale-110 transition-transform"
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDark ? '☀️' : '🌙'}
            </button>
            <button
              onClick={async () => {
                try { await supabase.auth.signOut() } catch {}
                // Fallback: nuke auth tokens from localStorage so even
                // a corrupt session gets cleared and we return to login
                Object.keys(localStorage).forEach(k => {
                  if (k.startsWith('sb-')) localStorage.removeItem(k)
                })
                window.location.replace('/wordy/auth')
              }}
              className="text-xs text-wordy-400 hover:text-wordy-600 underline dark:text-wordy-500 dark:hover:text-wordy-300"
            >
              Log out
            </button>
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
  )
}
