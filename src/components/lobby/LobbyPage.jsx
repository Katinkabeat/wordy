import { lazy, Suspense, useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase.js'
import { createGame as createGameMutation, joinGame as joinGameMutation } from '../../lib/gameMutations.js'
import { useUnseenResults } from '../../hooks/useUnseenResults.jsx'
import LobbyGameRow from './LobbyGameRow.jsx'
import { SQLobbyShell, SQLobbyHeader, SQCompletedGamesCard } from '../../../../rae-side-quest/packages/sq-ui/index.js'

// Admin-only panel — split out so non-admins (the vast majority of users)
// don't download its code with the lobby.
const AdminPanel = lazy(() => import('../admin/AdminPanel.jsx'))
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

  const { unseenResults, loadUnseenResults, handleFinishedToast } =
    useUnseenResults({ user, games, navigate })

  const handleGameChange = useCallback((payload) => {
    loadGames()
    handleFinishedToast(payload)
  }, [loadGames, handleFinishedToast])

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

  async function createGame() {
    setCreating(true)
    try {
      const { gameId } = await createGameMutation({ user, maxPlayers })
      toast.success('🎉 Game created! Waiting for friends to join…')
      navigate(`/game/${gameId}`)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setCreating(false)
    }
  }

  async function joinGame(game) {
    setJoiningId(game.id)
    try {
      const { gameId, alreadyIn } = await joinGameMutation({
        user, game, joinerName: profile?.username,
      })
      if (!alreadyIn) toast.success('🟣 Joined! Good luck!')
      navigate(`/game/${gameId}`)
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
    <SQLobbyShell
      header={
        <SQLobbyHeader
          title="Wordy"
          avatarSlot={<AvatarMenu profile={profile} onProfileUpdate={setProfile} />}
          rightSlot={
            <>
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
            </>
          }
        />
      }
    >
        {/* Admin Panel — lazy-loaded; only fetched when admin tab is opened */}
        {lobbyTab === 'admin' && adminRecord && (
          <Suspense fallback={<p className="text-sm text-wordy-500">Loading admin panel…</p>}>
            <AdminPanel session={session} adminRecord={adminRecord} />
          </Suspense>
        )}

        {/* Lobby content */}
        {lobbyTab === 'lobby' && (
          <>
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
                    <LobbyGameRow key={g.id} game={g} userId={user.id} onJoin={joinGame} joiningId={joiningId} profile={profile} />
                  ))}
                </div>
              ) : (
                <div className="text-center py-4 text-wordy-300">
                  <p className="font-display">No games yet — be the first to create one!</p>
                </div>
              )}
            </div>

            {/* Completed games — last 10 finished games */}
            <SQCompletedGamesCard emptyMessage="🪧 No finished games yet.">
              {unseenResults.map(({ gameId, game: g, winnerName, allPlayerNames }) => {
                const headline = g?.closed_by_admin
                  ? '🛑 Game closed by admin'
                  : g?.forfeit_user_id
                    ? '🏳️ Opponent forfeited!'
                    : winnerName
                      ? `🏆 ${winnerName} wins!`
                      : "🤝 It's a tie!"
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
                  </div>
                )
              })}
            </SQCompletedGamesCard>
          </>
        )}
    </SQLobbyShell>
  )
}

