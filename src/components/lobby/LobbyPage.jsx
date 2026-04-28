import { Fragment, useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase.js'
import { createTileBag, refillRack } from '../../lib/tileData.js'
import { createEmptyBoard, serializeBoard } from '../../lib/boardData.js'
import AdminPanel from '../admin/AdminPanel.jsx'
import IOSInstallPrompt from './IOSInstallPrompt.jsx'
import SettingsDropdown from './SettingsModal.jsx'
import AvatarMenu from './AvatarMenu.jsx'
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
        turn_started_at, last_nudged_at,
        game_players ( user_id, player_index, score, profiles ( username ) )
      `)
      .in('status', ['waiting', 'active'])
      .order('created_at', { ascending: false })
      .limit(20)
    setGames(data ?? [])
  }, [])

  useEffect(() => { loadGames() }, [loadGames])

  // Show a banner for any recently finished game the user hasn't dismissed yet.
  // Extracted as a stable callback so it can be re-invoked from the real-time handler.
  const seenKey = `wordy_seen_results_${user.id}`
  const loadUnseenResults = useCallback(async () => {
    const seen = new Set(JSON.parse(localStorage.getItem(seenKey) ?? '[]'))

    // Query game_players first (user-scoped) then join games — guarantees we only
    // fetch THIS user's records regardless of how many total games exist.
    // NOTE: avoid .order() on foreign table columns — supabase-js v2 can silently
    // fail with certain syntaxes.  Sort client-side instead.
    const { data: gps, error: gpErr } = await supabase
      .from('game_players')
      .select('game_id, is_winner, dismissed_at, games!inner(id, status, finished_at, forfeit_user_id)')
      .eq('user_id', user.id)
      .eq('games.status', 'finished')
      .is('dismissed_at', null)
      .limit(50)
    if (gpErr) { console.error('loadUnseenResults: query failed:', gpErr); return }

    // localStorage is a fast local fallback; dismissed_at in DB is the source of truth
    const unseen = (gps ?? []).filter(gp => !seen.has(gp.game_id))
    if (unseen.length === 0) { setUnseenResults([]); return }

    // Sort newest-first client-side
    unseen.sort((a, b) => (b.games?.finished_at ?? '').localeCompare(a.games?.finished_at ?? ''))

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
  }, [user.id, seenKey])

  // Run on mount
  useEffect(() => { loadUnseenResults() }, [loadUnseenResults])

  function dismissResult(gameId) {
    // Persist server-side so dismissal survives across devices/browsers
    supabase
      .from('game_players')
      .update({ dismissed_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('game_id', gameId)
      .then(({ error }) => { if (error) console.error('dismiss write failed:', error) })
    // Also keep localStorage as instant local cache
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
  // Also watch for a game the user is in finishing and show a winner notification.
  const handleGameChange = useCallback(async (payload) => {
    loadGames()
    if (payload.new?.status === 'finished' && myGameIdsRef.current.has(payload.new.id)) {
      // Refresh the persistent banner list so it appears even after the toast expires
      // Small delay lets the finish_game RPC complete so is_winner is set in DB
      setTimeout(() => loadUnseenResults(), 1500)

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
              onClick={() => { navigate(`/game/${gameId}`); toast.dismiss(t.id) }}
              style={{ fontSize: 12, textDecoration: 'underline', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              View final board →
            </button>
          </div>
        ),
        { duration: 15000 }
      )
    }
  }, [loadGames, loadUnseenResults, navigate, user.id])

  useEffect(() => {
    const channel = supabase.channel('lobby-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, handleGameChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_players' }, loadGames)
      .subscribe()

    // Polling fallback: if Supabase Realtime is down (free-tier limits, etc.)
    // the lobby still refreshes every 10 seconds while visible.
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadGames()
        loadUnseenResults()
      }
    }, 10_000)

    // Also refresh immediately when the tab/phone wakes back up.
    function handleVisible() {
      if (document.visibilityState !== 'visible') return
      loadGames()
      loadUnseenResults()
    }
    document.addEventListener('visibilitychange', handleVisible)
    window.addEventListener('focus', handleVisible)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(poll)
      document.removeEventListener('visibilitychange', handleVisible)
      window.removeEventListener('focus', handleVisible)
    }
  }, [loadGames, loadUnseenResults, handleGameChange])

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
  // Single Multiplayer list: open joinable games first (so users see what
  // they can jump into), then their own active games.
  const multiplayerGames = [...openGames, ...myGames]

  return (
    <div className="min-h-screen bg-gradient-to-br from-wordy-50 via-pink-50 to-wordy-100 dark:bg-[#0f0a1e] dark:bg-none">
      {/* Header */}
      <header className="bg-white border-b border-wordy-100 shadow-sm sticky top-0 z-10 dark:bg-[#130c25] dark:border-[#2d1b55]">
        <div className="max-w-[480px] mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AvatarMenu profile={profile} onProfileUpdate={setProfile} />
            <span className="font-display text-2xl text-wordy-700">Wordy</span>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="/games/"
              className="text-2xl leading-none hover:scale-110 transition-transform"
              title="Rae's Side Quest"
              aria-label="Rae's Side Quest"
            >
              🏠
            </a>
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
                  onClose={() => setShowSettings(false)}
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
                    window.location.replace('/games/')
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-[480px] mx-auto px-4 py-6 space-y-6">

        {/* Admin Panel */}
        {lobbyTab === 'admin' && adminRecord && (
          <AdminPanel session={session} adminRecord={adminRecord} />
        )}

        {/* Lobby content */}
        {lobbyTab === 'lobby' && (
          <>
            {/* iOS: guide user to install PWA for push support (still useful
                even though notification opt-in moved to the SideQuest hub —
                PWA install gives proper push delivery on iOS). */}
            <IOSInstallPrompt />

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

            {/* Multiplayer (open joinable games first, then my active games) */}
            <div className="card">
              <h2 className="font-display text-xl text-wordy-700 mb-3">🎮 Multiplayer</h2>
              {multiplayerGames.length > 0 ? (
                <div className="space-y-2">
                  {multiplayerGames.map(g => (
                    <GameRow key={g.id} game={g} userId={user.id} onJoin={joinGame} joiningId={joiningId} profile={profile} />
                  ))}
                </div>
              ) : (
                <div className="text-center py-6 text-wordy-300">
                  <div className="text-4xl mb-2">🟣</div>
                  <p className="font-display">No games yet — be the first to create one!</p>
                </div>
              )}
            </div>

            {/* Completed games — banners persist until user dismisses them */}
            <div className="card">
              <h2 className="font-display text-xl text-wordy-700 mb-3">🏁 Completed Games</h2>
              <div className="space-y-2">
                {unseenResults.map(({ gameId, game: g, winnerName, allPlayerNames }) => {
                  const isForfeit = !!g?.forfeit_user_id
                  const headline = isForfeit ? '🏳️ Opponent forfeited!' : `🏆 ${winnerName} wins!`
                  return (
                    <div
                      key={gameId}
                      className="flex items-center gap-2 rounded-xl px-3 py-2.5 bg-gradient-to-r from-wordy-100 to-pink-50 border border-wordy-200 dark:from-wordy-900/40 dark:to-purple-900/30 dark:border-wordy-700"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-display text-sm text-wordy-700 dark:text-wordy-100 truncate">
                          {headline}
                        </div>
                        {allPlayerNames && (
                          <div className="text-xs text-wordy-500 dark:text-wordy-300 truncate">
                            {allPlayerNames}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => navigate(`/game/${gameId}`)}
                        className="shrink-0 text-xs font-bold text-wordy-700 dark:text-wordy-200 underline hover:no-underline"
                      >
                        View Game
                      </button>
                      <button
                        type="button"
                        onClick={() => dismissResult(gameId)}
                        aria-label="Dismiss result"
                        className="shrink-0 w-7 h-7 rounded-full text-wordy-500 hover:text-wordy-700 hover:bg-white/60 dark:text-wordy-300 dark:hover:bg-black/20 flex items-center justify-center text-sm"
                      >
                        ✕
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        )}
      </main>

    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────

const NUDGE_COOLDOWN_MS = 12 * 60 * 60 * 1000 // 12 hours

function GameRow({ game, userId, onJoin, joiningId, profile }) {
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

