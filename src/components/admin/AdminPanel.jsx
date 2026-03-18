import { useEffect, useState, useCallback } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase.js'

// All available admin permissions.
// Add new ones here as the system grows.
const ALL_PERMISSIONS = [
  {
    key: 'close_games',
    label: 'Close Games',
    description: 'Can close old or stuck games from the admin panel',
  },
]

export default function AdminPanel({ session, adminRecord }) {
  const [view, setView]           = useState('games')   // 'games' | 'admins'
  const [games, setGames]         = useState([])
  const [admins, setAdmins]       = useState([])
  const [allUsers, setAllUsers]   = useState([])
  const [closingId, setClosingId] = useState(null)
  const [loading, setLoading]     = useState(true)

  // New-admin form state
  const [selectedUserId, setSelectedUserId]     = useState('')
  const [selectedPerms, setSelectedPerms]       = useState([])
  const [addingAdmin, setAddingAdmin]           = useState(false)

  const isMaster = adminRecord?.is_master === true
  const myUserId = session.user.id

  // ── Data loaders ────────────────────────────────────────────

  const loadGames = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_list_open_games')
    if (!error) setGames(data ?? [])
  }, [])

  const loadAdmins = useCallback(async () => {
    if (!isMaster) return
    const { data, error } = await supabase
      .from('admins')
      .select('user_id, permissions, is_master, created_at, profiles ( username )')
      .order('created_at', { ascending: true })
    if (!error) setAdmins(data ?? [])
  }, [isMaster])

  const loadUsers = useCallback(async () => {
    if (!isMaster) return
    const { data, error } = await supabase.rpc('admin_list_profiles')
    if (!error) setAllUsers(data ?? [])
  }, [isMaster])

  useEffect(() => {
    setLoading(true)
    Promise.all([loadGames(), loadAdmins(), loadUsers()])
      .finally(() => setLoading(false))
  }, [loadGames, loadAdmins, loadUsers])

  // ── Actions ─────────────────────────────────────────────────

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

  async function addAdmin() {
    if (!selectedUserId) { toast.error('Please select a user.'); return }
    if (selectedPerms.length === 0) { toast.error('Please select at least one permission.'); return }

    setAddingAdmin(true)
    try {
      const { error } = await supabase.from('admins').insert({
        user_id:    selectedUserId,
        permissions: selectedPerms,
        is_master:  false,
        added_by:   myUserId,
      })
      if (error) throw error
      toast.success('Admin added!')
      setSelectedUserId('')
      setSelectedPerms([])
      loadAdmins()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setAddingAdmin(false)
    }
  }

  async function removeAdmin(userId) {
    if (!window.confirm('Remove this admin? They will lose all admin access.')) return
    const { error } = await supabase.from('admins').delete().eq('user_id', userId)
    if (error) { toast.error(error.message); return }
    toast.success('Admin removed.')
    loadAdmins()
  }

  async function togglePermission(userId, currentPerms, permKey) {
    const updated = currentPerms.includes(permKey)
      ? currentPerms.filter(p => p !== permKey)
      : [...currentPerms, permKey]

    const { error } = await supabase
      .from('admins')
      .update({ permissions: updated })
      .eq('user_id', userId)

    if (error) { toast.error(error.message); return }
    toast.success('Permissions updated.')
    loadAdmins()
  }

  // ── Helpers ─────────────────────────────────────────────────

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

  // Non-admin users that can be promoted
  const adminUserIds  = new Set(admins.map(a => a.user_id))
  const eligibleUsers = allUsers.filter(u => !adminUserIds.has(u.id))

  // ── Render ──────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="card text-center py-10">
        <div className="text-3xl mb-2 animate-bounce">🔐</div>
        <p className="text-wordy-400 font-bold">Loading admin panel…</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">

      {/* Tab bar */}
      <div className="flex gap-2 border-b border-wordy-100 dark:border-[#2d1b55] pb-1">
        <TabButton active={view === 'games'} onClick={() => setView('games')}>
          🔒 Games
        </TabButton>
        {isMaster && (
          <TabButton active={view === 'admins'} onClick={() => setView('admins')}>
            👑 Manage Admins
          </TabButton>
        )}
      </div>

      {/* ── GAMES VIEW ──────────────────────────────────────── */}
      {view === 'games' && (
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
                const isOld = Date.now() - new Date(g.created_at).getTime() > 3600000 // > 1 hour

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
      )}

      {/* ── ADMINS VIEW (master only) ────────────────────────── */}
      {view === 'admins' && isMaster && (
        <div className="space-y-4">

          {/* Current admins */}
          <div className="card">
            <h2 className="font-display text-xl text-wordy-700 mb-4">👑 Current Admins</h2>
            <div className="space-y-3">
              {admins.map(a => {
                const isSelf   = a.user_id === myUserId
                const username = a.profiles?.username ?? 'Unknown'

                return (
                  <div key={a.user_id} className="rounded-xl border border-wordy-100 bg-wordy-50 px-3 py-3 dark:bg-[#1a1040] dark:border-[#2d1b55]">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-wordy-700 text-sm">{username}</span>
                        {a.is_master && (
                          <span className="text-xs bg-yellow-100 text-yellow-700 border border-yellow-200 px-2 py-0.5 rounded-full font-bold">
                            👑 Master
                          </span>
                        )}
                        {isSelf && (
                          <span className="text-xs text-wordy-400">(you)</span>
                        )}
                      </div>
                      {/* Can't remove master or yourself */}
                      {!a.is_master && !isSelf && (
                        <button
                          onClick={() => removeAdmin(a.user_id)}
                          className="text-xs text-rose-500 hover:text-rose-700 underline"
                        >
                          Remove
                        </button>
                      )}
                    </div>

                    {/* Permissions toggles (not shown for master — always has everything) */}
                    {!a.is_master && (
                      <div className="flex flex-wrap gap-2">
                        {ALL_PERMISSIONS.map(perm => {
                          const active = a.permissions.includes(perm.key)
                          return (
                            <button
                              key={perm.key}
                              onClick={() => togglePermission(a.user_id, a.permissions, perm.key)}
                              title={perm.description}
                              className={`text-xs px-2 py-1 rounded-lg border font-bold transition-all ${
                                active
                                  ? 'bg-wordy-600 text-white border-wordy-600'
                                  : 'bg-white text-wordy-400 border-wordy-200 hover:border-wordy-400 dark:bg-[#130c25] dark:text-wordy-400 dark:border-[#2d1b55] dark:hover:border-wordy-500'
                              }`}
                            >
                              {active ? '✓ ' : ''}{perm.label}
                            </button>
                          )
                        })}
                      </div>
                    )}

                    {a.is_master && (
                      <p className="text-xs text-wordy-400">Has all permissions</p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Add new admin */}
          <div className="card">
            <h2 className="font-display text-xl text-wordy-700 mb-4">➕ Add Admin</h2>

            {eligibleUsers.length === 0 ? (
              <p className="text-xs text-wordy-400">All users are already admins.</p>
            ) : (
              <div className="space-y-4">
                {/* User picker */}
                <div>
                  <label className="block text-xs font-bold text-wordy-600 mb-1">Select User</label>
                  <select
                    value={selectedUserId}
                    onChange={e => setSelectedUserId(e.target.value)}
                    className="w-full border-2 border-wordy-200 rounded-xl px-3 py-2 text-sm text-wordy-700 focus:outline-none focus:border-wordy-400 bg-white"
                  >
                    <option value="">— Choose a user —</option>
                    {eligibleUsers.map(u => (
                      <option key={u.id} value={u.id}>{u.username}</option>
                    ))}
                  </select>
                </div>

                {/* Permissions picker */}
                <div>
                  <label className="block text-xs font-bold text-wordy-600 mb-2">Permissions</label>
                  <div className="flex flex-wrap gap-2">
                    {ALL_PERMISSIONS.map(perm => {
                      const checked = selectedPerms.includes(perm.key)
                      return (
                        <button
                          key={perm.key}
                          type="button"
                          onClick={() =>
                            setSelectedPerms(prev =>
                              checked ? prev.filter(p => p !== perm.key) : [...prev, perm.key]
                            )
                          }
                          title={perm.description}
                          className={`text-xs px-3 py-1.5 rounded-xl border font-bold transition-all ${
                            checked
                              ? 'bg-wordy-600 text-white border-wordy-600'
                              : 'bg-white text-wordy-400 border-wordy-200 hover:border-wordy-400 dark:bg-[#130c25] dark:text-wordy-400 dark:border-[#2d1b55] dark:hover:border-wordy-500'
                          }`}
                        >
                          {checked ? '✓ ' : ''}{perm.label}
                        </button>
                      )
                    })}
                  </div>
                  <p className="text-xs text-wordy-300 mt-1">
                    Click a permission to toggle it on or off.
                  </p>
                </div>

                <button
                  onClick={addAdmin}
                  disabled={addingAdmin || !selectedUserId || selectedPerms.length === 0}
                  className="btn-primary disabled:opacity-50"
                >
                  {addingAdmin ? '⏳ Adding…' : '➕ Add Admin'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`text-sm font-bold px-3 py-1.5 rounded-t-lg transition-all ${
        active
          ? 'text-wordy-700 border-b-2 border-wordy-600 dark:text-wordy-300 dark:border-wordy-400'
          : 'text-wordy-400 hover:text-wordy-600 dark:hover:text-wordy-300'
      }`}
    >
      {children}
    </button>
  )
}
