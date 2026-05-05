import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase.js'
import { deserializeBoard } from '../lib/boardData.js'

// Check if two racks have the same tiles (ignoring order).
// Used to preserve the user's local shuffle across poll refreshes.
function sameRackContents(a, b) {
  if (!a || !b || a.length !== b.length) return false
  const sorted = arr => [...arr].sort().join(',')
  return sorted(a) === sorted(b)
}

// Loads a game + players + profiles + last move data, keeps it in sync via
// Supabase Realtime, with a 10-second polling fallback and a visibility-change
// re-sync. Returns state plus the refs the caller (GamePage) needs to coordinate
// in-progress placements and mutations with the sync loop.
export function useGameData(gameId, user) {
  const navigate = useNavigate()

  const [game, setGame]                   = useState(null)
  const [players, setPlayers]             = useState([])
  const [myPlayer, setMyPlayer]           = useState(null)
  const [board, setBoard]                 = useState(null)   // 2-D 15×15
  const [profiles, setProfiles]           = useState({})
  const [lastMoveTiles, setLastMoveTiles] = useState([])
  const [lastMoveScores, setLastMoveScores] = useState({})
  const [loadError, setLoadError]         = useState(null)

  const channelRef     = useRef(null)
  const mutatingRef    = useRef(false)  // suppress real-time reloads during DB writes
  const placementsRef  = useRef([])     // mirror of placements state for polling guard
  const localRackRef   = useRef(null)   // preserve local rack order across polls

  const loadGame = useCallback(async ({ force = false } = {}) => {
    // Skip real-time-triggered reloads while a mutation (submit/exchange/pass)
    // is in progress — the mutation will call loadGame({ force: true }) when done.
    if (mutatingRef.current && !force) return
    try {
      // ── Phase 1: fetch ALL data before touching any state ────
      // This prevents a race where the user places a tile between two async
      // fetches and the second fetch's state update overwrites their rack.
      const { data: g, error: gErr } = await supabase
        .from('games')
        .select('*')
        .eq('id', gameId).single()
      if (gErr) throw gErr
      if (!g) { toast.error('Game not found.'); navigate('/lobby'); return }

      const { data: ps, error: psErr } = await supabase
        .from('game_players')
        .select('*')
        .eq('game_id', gameId)
        .order('player_index')
      if (psErr) throw psErr

      // Fetch last move, scores, and profiles in parallel (non-critical).
      // Scores are one batched query (.in player_ids) sorted DESC by time;
      // the first row per user_id is their most recent score. This replaces
      // a per-player Promise.all that fired N queries (one per player).
      const playerIds = (ps ?? []).map(p => p.user_id)
      const [lastMovesRes, allMovesRes, profsRes] = await Promise.all([
        supabase.from('game_moves').select('tiles_placed')
          .eq('game_id', gameId).eq('move_type', 'place')
          .order('created_at', { ascending: false }).limit(1),
        playerIds.length
          ? supabase.from('game_moves').select('user_id, score')
              .eq('game_id', gameId)
              .in('user_id', playerIds)
              .order('created_at', { ascending: false })
          : Promise.resolve({ data: [], error: null }),
        playerIds.length
          ? supabase.from('profiles').select('id, username').in('id', playerIds)
          : Promise.resolve({ data: null, error: null }),
      ])

      // ── Phase 2: guard check AFTER all fetches, BEFORE any state updates ──
      // If the user placed tiles while we were fetching, bail out entirely
      // so we don't overwrite their in-progress placement.
      if (placementsRef.current.length > 0 && !force) return

      // ── Phase 3: apply all state updates atomically ──────────
      setGame(g)
      setBoard(deserializeBoard(g.board))
      setLoadError(null)

      setPlayers(ps ?? [])
      const me = (ps ?? []).find(p => p.user_id === user.id)
      // Preserve the user's local rack order (from shuffle / tile swaps)
      // if the DB rack has the same tiles — just possibly in different order.
      if (me && localRackRef.current && sameRackContents(me.rack, localRackRef.current)) {
        me.rack = localRackRef.current
      }
      if (me) localRackRef.current = me.rack
      setMyPlayer(me ?? null)

      setLastMoveTiles(lastMovesRes?.data?.[0]?.tiles_placed ?? [])

      // Rows are sorted by created_at DESC, so the first occurrence of
      // each user_id is their most recent score.
      const scoreMap = {}
      for (const row of allMovesRes?.data ?? []) {
        if (!(row.user_id in scoreMap) && row.score != null) {
          scoreMap[row.user_id] = row.score
        }
      }
      setLastMoveScores(scoreMap)

      // Only update profiles if the query succeeded so a transient
      // network failure on mobile doesn't wipe out already-loaded names
      if (!profsRes.error && profsRes.data) {
        const map = {}
        for (const p of profsRes.data) map[p.id] = { username: p.username }
        setProfiles(map)
      }
    } catch (err) {
      console.error('loadGame failed:', err)
      setLoadError(err.message ?? 'Failed to load game')
    }
  }, [gameId, user.id, navigate])

  useEffect(() => { loadGame() }, [loadGame])

  // Real-time subscription with auto-reconnect.
  // Both handlers call loadGame() for a guaranteed fresh fetch.
  // Note: game_players filters on game_id (non-PK), which requires
  // REPLICA IDENTITY FULL on the table — set via SQL migration.
  useEffect(() => {
    function subscribe() {
      if (channelRef.current) supabase.removeChannel(channelRef.current)
      channelRef.current = supabase.channel(`game-${gameId}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
          () => { if (placementsRef.current.length === 0) loadGame() }
        )
        .on('postgres_changes', { event: '*', schema: 'public', table: 'game_players', filter: `game_id=eq.${gameId}` },
          () => { if (placementsRef.current.length === 0) loadGame() }
        )
        .subscribe()
    }

    subscribe()

    // Polling fallback: if Supabase Realtime is down (free-tier limits, etc.)
    // the game view still refreshes every 10 seconds while visible.
    // IMPORTANT: skip when the user has tiles on the board — reloading would
    // wipe their in-progress placement and return tiles to the rack.
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible' && placementsRef.current.length === 0) loadGame()
    }, 10_000)

    // When the tab/phone wakes back up, reload state and reconnect if needed.
    // This handles the common case of taking a long time between turns.
    function handleVisible() {
      if (document.visibilityState !== 'visible') return
      // Only auto-reload if the user has no tiles placed on the board —
      // otherwise switching apps and back would wipe their in-progress word.
      if (placementsRef.current.length === 0) loadGame()
      if (!channelRef.current || channelRef.current.state !== 'joined') {
        subscribe()
      }
    }

    document.addEventListener('visibilitychange', handleVisible)
    window.addEventListener('focus', handleVisible)

    return () => {
      supabase.removeChannel(channelRef.current)
      clearInterval(poll)
      document.removeEventListener('visibilitychange', handleVisible)
      window.removeEventListener('focus', handleVisible)
    }
  }, [gameId, loadGame])

  return {
    game, setGame,
    players, setPlayers,
    myPlayer, setMyPlayer,
    board, setBoard,
    profiles,
    lastMoveTiles,
    lastMoveScores,
    loadError,
    loadGame,
    mutatingRef,
    placementsRef,
    localRackRef,
  }
}
