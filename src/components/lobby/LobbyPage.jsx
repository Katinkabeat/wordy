import { lazy, Suspense, useEffect, useMemo, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase.js'
import {
  joinGame as joinGameMutation,
  cancelGame as cancelGameMutation,
  declineInvite as declineInviteMutation,
  autoStartOrCancelStale,
} from '../../lib/gameMutations.js'
import { useUnseenResults } from '../../hooks/useUnseenResults.jsx'
import LobbyGameRow from './LobbyGameRow.jsx'
import CreateGameSheet from './CreateGameSheet.jsx'
import { SQLobbyShell, SQLobbyHeader, SQCompletedGamesCard } from '../../../../rae-side-quest/packages/sq-ui/index.js'

// Admin-only panel — split out so non-admins (the vast majority of users)
// don't download its code with the lobby.
const AdminPanel = lazy(() => import('../admin/AdminPanel.jsx'))
import SettingsDropdown from './SettingsModal.jsx'
import HowToPlayModal from '../HowToPlayModal.jsx'
import AvatarMenu from './AvatarMenu.jsx'
import { useTheme } from '../../contexts/ThemeContext.jsx'

const AVATAR_HUES = [270, 330, 190, 30, 160, 10]

export default function LobbyPage({ session }) {
  const navigate = useNavigate()
  const user = session.user
  const { isDark, toggle: toggleTheme } = useTheme()

  const [profile, setProfile]         = useState(null)
  const [games, setGames]             = useState([])
  const [joiningId, setJoiningId]     = useState(null)
  const [cancellingId, setCancellingId] = useState(null)
  const [decliningId, setDecliningId] = useState(null)
  const [showCreateSheet, setShowCreateSheet] = useState(false)
  const [adminRecord, setAdminRecord] = useState(null)  // null = not admin
  const [lobbyTab, setLobbyTab]       = useState('lobby') // 'lobby' | 'admin'
  const [showSettings, setShowSettings] = useState(false)
  const [showHowTo, setShowHowTo]       = useState(false)

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
    // Lazy server-side sweep — only acts on rows past expires_at.
    try { await autoStartOrCancelStale() } catch { /* non-fatal */ }

    const { data } = await supabase
      .from('games')
      .select(`
        id, status, max_players, created_at, current_player_idx,
        turn_started_at, last_nudged_at,
        invited_user_ids, expires_at, cancelled_at, created_by,
        game_players ( user_id, player_index, score, profiles ( username, is_bot ) )
      `)
      .in('status', ['waiting', 'active'])
      .order('created_at', { ascending: false })
      .limit(20)
    setGames(data ?? [])
  }, [])

  // Look up usernames for invitees that aren't yet game_players (so we
  // can show "Invited Onyi" subtext on the creator's row before they
  // accept). One query for all pending-invitee ids across visible games.
  const [pendingInviteeNames, setPendingInviteeNames] = useState({})
  useEffect(() => {
    const ids = new Set()
    for (const g of games) {
      if (!g.invited_user_ids) continue
      const joined = new Set((g.game_players ?? []).map(p => p.user_id))
      for (const id of g.invited_user_ids) {
        if (!joined.has(id)) ids.add(id)
      }
    }
    if (ids.size === 0) {
      setPendingInviteeNames({})
      return
    }
    supabase
      .from('profiles')
      .select('id, username')
      .in('id', [...ids])
      .then(({ data }) => {
        setPendingInviteeNames(
          Object.fromEntries((data ?? []).map(p => [p.id, p.username]))
        )
      })
  }, [games])

  useEffect(() => { loadGames() }, [loadGames])

  const { unseenResults, loadUnseenResults, handleFinishedToast } =
    useUnseenResults({ user, games, navigate })

  const handleGameChange = useCallback((payload) => {
    loadGames()
    handleFinishedToast(payload)
  }, [loadGames, handleFinishedToast])

  useEffect(() => {
    // Narrow filters: subscribe only to games I created and to game_players
    // rows that are mine. The previous unfiltered subscription fired on
    // every other player's move across the entire Wordy database, causing
    // the lobby to re-fetch + re-render constantly. Open games created by
    // OTHERS still appear via the 10s poll fallback below — that's fine
    // since urgent events ("your turn", "opponent joined") have push
    // notifications anyway.
    const channel = supabase.channel(`lobby-updates-${user.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'games',
        filter: `created_by=eq.${user.id}`,
      }, handleGameChange)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'game_players',
        filter: `user_id=eq.${user.id}`,
      }, loadGames)
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
  }, [user.id, loadGames, loadUnseenResults, handleGameChange])

  async function handleCancel(gameId) {
    if (cancellingId) return
    if (!confirm('Cancel this game?')) return
    setCancellingId(gameId)
    try {
      await cancelGameMutation(gameId)
      toast.success('Game cancelled.')
    } catch (err) {
      toast.error(err.message || 'Failed to cancel')
    } finally {
      setCancellingId(null)
      loadGames()
    }
  }

  async function handleDecline(gameId) {
    if (decliningId) return
    if (!confirm('Decline this invite?')) return
    setDecliningId(gameId)
    try {
      await declineInviteMutation(gameId)
      toast.success('Invite declined.')
    } catch (err) {
      toast.error(err.message || 'Failed to decline')
    } finally {
      setDecliningId(null)
      loadGames()
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

  const buckets = useMemo(() => {
    const invitedToYou = []
    const myGames = []
    const openGames = []
    const soloGames = []
    for (const g of games) {
      const hasBot = (g.game_players ?? []).some(p => p.profiles?.is_bot)
      const iAmPlayer = (g.game_players ?? []).some(p => p.user_id === user.id)
      const iAmInvitee = !iAmPlayer && (g.invited_user_ids ?? []).includes(user.id)
      if (iAmPlayer && hasBot) {
        soloGames.push(g)                 // Solo (you + bot) — listed under the Solo card, not multiplayer
      } else if (iAmInvitee && g.status === 'waiting') {
        invitedToYou.push(g)
      } else if (iAmPlayer) {
        myGames.push(g)
      } else if (g.status === 'waiting' && !hasBot && (g.game_players ?? []).length < g.max_players) {
        openGames.push(g)
      }
    }
    return { invitedToYou, myGames, openGames, soloGames }
  }, [games, user.id])

  // Render invites first, then open games, then your own active games.
  const multiplayerGames = [
    ...buckets.invitedToYou,
    ...buckets.openGames,
    ...buckets.myGames,
  ]

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
                    onHowToPlay={() => { setShowHowTo(true); setShowSettings(false) }}
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
            {/* Solo Play — practice against a computer character */}
            <div className="card">
              <h2 className="font-display text-xl text-wordy-700 mb-1">🤖 Solo Play</h2>
              <p className="text-sm text-wordy-500 dark:text-wordy-300 mb-3">
                Take on a computer opponent anytime. No waiting for friends.
              </p>
              <div className="flex items-center justify-between gap-3">
                <button onClick={() => navigate('/solo')} className="btn-primary">▶ Play</button>
                <div className="flex -space-x-2">
                  {[
                    { bg: 'hsl(145,60%,45%)', t: 'RO' },
                    { bg: 'hsl(210,70%,52%)', t: 'JA' },
                    { bg: 'hsl(25,75%,50%)', t: 'ME' },
                    { bg: 'linear-gradient(135deg,#ec4899,#a855f7)', t: '👑' },
                  ].map((a, i) => (
                    <span key={i} className="w-7 h-7 rounded-full grid place-items-center text-white font-display text-[10px] border-2 border-white dark:border-[#1a1130]" style={{ background: a.bg }}>{a.t}</span>
                  ))}
                </div>
              </div>
              {buckets.soloGames.length > 0 && (
                <div className="mt-3 space-y-2">
                  {buckets.soloGames.map(g => {
                    const bots = (g.game_players ?? [])
                      .filter(p => p.profiles?.is_bot)
                      .map(p => p.profiles?.username)
                      .join(', ')
                    return (
                      <div key={g.id} className="flex items-center justify-between rounded-xl px-3 py-2 border bg-wordy-50 border-wordy-100 dark:bg-[#1a1130] dark:border-[#2d1b55]">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-wordy-700 dark:text-wordy-100 truncate">vs {bots || 'computer'}</div>
                          <div className="text-xs text-wordy-400">in progress</div>
                        </div>
                        <button onClick={() => navigate(`/game/${g.id}`)} className="btn-primary text-xs px-3 py-1.5 rounded-lg font-bold shrink-0">Resume</button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Multiplayer */}
            <div className="card">
              <h2 className="font-display text-xl text-wordy-700 mb-3">🎮 Multiplayer</h2>
              <button
                onClick={() => setShowCreateSheet(true)}
                className="btn-primary mb-4"
              >
                ✨ Create Game
              </button>
              {multiplayerGames.length > 0 ? (
                <div className="space-y-2">
                  {multiplayerGames.map(g => {
                    const iAmPlayer = (g.game_players ?? []).some(p => p.user_id === user.id)
                    const iAmInvitee = !iAmPlayer && (g.invited_user_ids ?? []).includes(user.id)
                    const iCreated = g.created_by === user.id
                    return (
                      <LobbyGameRow
                        key={g.id}
                        game={g}
                        userId={user.id}
                        onJoin={joinGame}
                        joiningId={joiningId}
                        profile={profile}
                        isInviteToMe={iAmInvitee && g.status === 'waiting'}
                        pendingInviteeNames={pendingInviteeNames}
                        onCancel={
                          iCreated && g.status === 'waiting'
                            ? () => handleCancel(g.id)
                            : undefined
                        }
                        cancelDisabled={cancellingId === g.id}
                        onDecline={
                          iAmInvitee && g.status === 'waiting'
                            ? () => handleDecline(g.id)
                            : undefined
                        }
                        declineDisabled={decliningId === g.id}
                      />
                    )
                  })}
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

      {showCreateSheet && (
        <CreateGameSheet
          user={user}
          onClose={() => setShowCreateSheet(false)}
          onCreated={() => setShowCreateSheet(false)}
        />
      )}

      <HowToPlayModal open={showHowTo} onClose={() => setShowHowTo(false)} />
    </SQLobbyShell>
  )
}

