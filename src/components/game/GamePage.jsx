import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase.js'
import { refillRack }  from '../../lib/tileData.js'
import { deserializeBoard, serializeBoard } from '../../lib/boardData.js'
import {
  validatePlacement, extractWords, calculateScore,
  isGameOver, applyEndgamePenalties,
} from '../../lib/gameLogic.js'
import { validateWords } from '../../lib/wordValidator.js'
import ZoomableBoard from './ZoomableBoard.jsx'
import TileRack   from './TileRack.jsx'
import ScorePanel from './ScorePanel.jsx'
import { useTheme } from '../../contexts/ThemeContext.jsx'
import { DEFAULT_TILE_HUE } from '../../lib/tileColors.js'

export default function GamePage({ session }) {
  const { id: gameId } = useParams()
  const navigate        = useNavigate()
  const user            = session.user
  const { isDark, toggle: toggleTheme } = useTheme()

  // ── State ─────────────────────────────────────────────────
  const [game, setGame]               = useState(null)
  const [players, setPlayers]         = useState([])
  const [myPlayer, setMyPlayer]       = useState(null)
  const [board, setBoard]             = useState(null)   // 2-D 15×15
  const [placements, setPlacements]   = useState([])     // tiles placed this turn
  const [selectedTile, setSelected]   = useState(null)   // { letter, rackIdx }
  const [submitting, setSubmitting]   = useState(false)
  const [exchangeMode, setExchange]   = useState(false)
  const [exchangeSel, setExchangeSel] = useState([])     // rack indices
  const [blankModal, setBlankModal]   = useState(null)   // { row, col } pending blank assignment
  const [forfeitModal, setForfeitModal] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsRef = useRef(null)
  const [profiles, setProfiles]       = useState({})
  const [lastMoveTiles, setLastMoveTiles] = useState([]) // tiles from the most recent move
  const [lastMoveScores, setLastMoveScores] = useState({}) // user_id → last move score
  const channelRef = useRef(null)
  const mutatingRef = useRef(false)  // suppress real-time reloads during DB writes
  const placementsRef = useRef([])   // mirror of placements state for polling guard
  const localRackRef = useRef(null)  // preserve local rack order across polls

  // ── Close settings menu on outside click ──────────────────
  useEffect(() => {
    if (!settingsOpen) return
    function handleClick(e) {
      if (settingsRef.current && !settingsRef.current.contains(e.target)) {
        setSettingsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [settingsOpen])

  // ── Cell size — fixed, device-appropriate ─────────────────
  const cellSize = useMemo(() => {
    const vw = window.innerWidth
    if (vw >= 1024) return 38                                   // desktop → 584px board
    if (vw >= 768)  return 32                                   // tablet  → 494px board
    // Container has px-1 (8px total) + 14px grid gaps + 4px board border = 26px
    return Math.max(20, Math.floor((vw - 26) / 15))
  }, [])

  // ── Helpers ───────────────────────────────────────────────
  // Check if two racks have the same tiles (ignoring order).
  // Used to preserve the user's local shuffle across poll refreshes.
  function sameRackContents(a, b) {
    if (!a || !b || a.length !== b.length) return false
    const sorted = arr => [...arr].sort().join(',')
    return sorted(a) === sorted(b)
  }

  const isMyTurn = useCallback(() => {
    if (!game || !myPlayer) return false
    return game.current_player_idx === myPlayer.player_index && game.status === 'active'
  }, [game, myPlayer])

  // Derive from the DB board (game.board), not the live working board,
  // because the live board includes tiles placed this turn.
  const isFirstMove = !game?.board || game.board.length === 0

  const [loadError, setLoadError] = useState(null)

  // ── Load game data ────────────────────────────────────────
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

      // Fetch last move, scores, and profiles in parallel (non-critical)
      const playerIds = (ps ?? []).map(p => p.user_id)
      const [lastMovesRes, scoresResults, profsRes] = await Promise.all([
        supabase.from('game_moves').select('tiles_placed')
          .eq('game_id', gameId).eq('move_type', 'place')
          .order('created_at', { ascending: false }).limit(1),
        playerIds.length
          ? Promise.all(playerIds.map(pid =>
              supabase.from('game_moves').select('score, user_id')
                .eq('game_id', gameId).eq('user_id', pid)
                .order('created_at', { ascending: false }).limit(1)
                .then(({ data }) => data?.[0] ?? null)
            ))
          : Promise.resolve([]),
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
      setPlacements([])  // clear stale placements — DB board is the source of truth
      placementsRef.current = []
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

      if (scoresResults.length) {
        const scoreMap = {}
        for (const r of scoresResults) {
          if (r?.score != null) scoreMap[r.user_id] = r.score
        }
        setLastMoveScores(scoreMap)
      }

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

  // Keep placementsRef in sync so the polling guard can read it without
  // being in the interval's closure / dependency array.
  useEffect(() => { placementsRef.current = placements }, [placements])

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

  // ── Board cell click ──────────────────────────────────────
  function handleCellClick(row, col) {
    if (!isMyTurn()) return
    if (exchangeMode) return

    const cellOccupied = board[row][col] !== null

    // Check if this cell already has a newly placed tile — remove it
    const existingIdx = placements.findIndex(p => p.row === row && p.col === col)
    if (existingIdx !== -1) {
      // Return tile to rack
      const removed = placements[existingIdx]
      const newRack = [...(myPlayer.rack)]
      newRack.splice(removed.rackIdx, 0, removed.tileLetter)
      localRackRef.current = newRack
      setMyPlayer(prev => ({ ...prev, rack: newRack }))
      setPlacements(prev => prev.filter((_, i) => i !== existingIdx))
      setBoard(prev => {
        const newBoard = prev.map(r => [...r])
        newBoard[row][col] = null
        return newBoard
      })
      setSelected(null)
      return
    }

    if (cellOccupied) return
    if (!selectedTile) return

    // Place tile — if blank, ask for letter
    if (selectedTile.letter === '?') {
      setBlankModal({ row, col })
      return
    }
    placeTile(row, col, selectedTile.letter, false)
  }

  function placeTile(row, col, letter, isBlank) {
    const myHue = DEFAULT_TILE_HUE
    const newBoard = board.map(r => [...r])
    newBoard[row][col] = { letter, isBlank, hue: myHue, uid: user.id }
    setBoard(newBoard)

    // Remove from rack and sync localRackRef so loadGame's
    // sameRackContents check won't restore the old full rack
    const newRack = [...(myPlayer.rack)]
    newRack.splice(selectedTile.rackIdx, 1)
    localRackRef.current = newRack
    setMyPlayer(prev => ({ ...prev, rack: newRack }))

    const newPlacement = {
      row, col, letter, isBlank,
      rackIdx: selectedTile.rackIdx,
      tileLetter: selectedTile.letter,
    }
    // Sync ref IMMEDIATELY so polling/RT guards see it before React batches
    placementsRef.current = [...placementsRef.current, newPlacement]
    setPlacements(prev => [...prev, newPlacement])
    setSelected(null)
  }

  function confirmBlank(letter) {
    if (!blankModal) return
    placeTile(blankModal.row, blankModal.col, letter, true)
    setBlankModal(null)
  }

  // ── Recall all placed tiles ───────────────────────────────
  function recall() {
    if (placements.length === 0) return
    const newBoard = board.map(r => [...r])
    const restoredTiles = []
    for (const p of placements) {
      newBoard[p.row][p.col] = null
      restoredTiles.push({ letter: p.tileLetter, rackIdx: p.rackIdx })
    }
    restoredTiles.sort((a, b) => a.rackIdx - b.rackIdx)
    const restoredRack = [...(myPlayer.rack)]
    for (const t of restoredTiles) restoredRack.splice(t.rackIdx, 0, t.letter)
    setBoard(newBoard)
    setMyPlayer(prev => ({ ...prev, rack: restoredRack }))
    localRackRef.current = restoredRack
    placementsRef.current = []  // sync ref immediately
    setPlacements([])
    setSelected(null)
  }

  // ── Submit word ───────────────────────────────────────────
  async function submitWord() {
    if (submitting || placements.length === 0) return
    if (game.status !== 'active') return   // guard against post-forfeit submissions
    setSubmitting(true)

    try {
      // ── Validation phase ──────────────────────────────────
      // No mutation guard here — if validation fails, local state is correct
      // (tiles on board, removed from rack, tracked by placements).
      const validation = validatePlacement(board, placements, isFirstMove)
      if (!validation.valid) { toast.error(validation.error); return }

      const words = extractWords(board, placements)
      if (words.length === 0) { toast.error('No valid words formed.'); return }

      const { allValid, invalidWords } = await validateWords(words.map(w => w.word))
      if (!allValid) {
        toast.error(`Not valid words: ${invalidWords.join(', ')}`)
        return
      }

      const turnScore  = calculateScore(board, placements, words)
      const newScore   = (myPlayer.score ?? 0) + turnScore
      const newBoardFlat = serializeBoard(board)

      let { rack: newRack, bag: newBag } = refillRack(myPlayer.rack, [...(game.tile_bag)])

      // Advance turn
      const nextIdx = (myPlayer.player_index + 1) % players.length

      // Check game over
      const over = isGameOver(newBag.length, newRack, 0, players.length)

      // If game over, apply end-game penalties
      let finalPlayers = players.map(p =>
        p.user_id === user.id ? { ...p, score: newScore, rack: newRack } : p
      )

      if (over) {
        finalPlayers = applyEndgamePenalties(finalPlayers, user.id)
        const maxScore = Math.max(...finalPlayers.map(p => p.score))
        finalPlayers   = finalPlayers.map(p => ({ ...p, is_winner: p.score === maxScore }))
      }

      // ── DB write phase ────────────────────────────────────
      // Suppress real-time reloads while parallel writes are in progress.
      mutatingRef.current = true
      try {
        // Run game + player updates in parallel (independent tables)
        const [{ error: gameErr }, { error: playerErr }] = await Promise.all([
          supabase.from('games').update({
            board: newBoardFlat,
            tile_bag: newBag,
            current_player_idx: nextIdx,
            consecutive_passes: 0,
            ...(over ? { status: 'finished', finished_at: new Date().toISOString() } : {}),
          }).eq('id', gameId),
          supabase.from('game_players').update({
            score: newScore,
            rack:  newRack,
          }).eq('game_id', gameId).eq('user_id', user.id),
        ])
        if (gameErr) { console.error('games update failed:', gameErr); toast.error('Failed to save move — please retry.'); recall(); return }
        if (playerErr) { console.error('game_players update failed:', playerErr); toast.error('Failed to save rack — please retry.'); recall(); return }

        // Fire-and-forget: move log + finish RPC are non-critical for gameplay
        if (over) {
          supabase.rpc('finish_game', {
            p_game_id: gameId,
            p_player_results: finalPlayers.map(fp => ({
              user_id:   fp.user_id,
              score:     fp.score,
              is_winner: fp.is_winner ?? false,
            })),
          }).then(({ error }) => { if (error) console.error('finish_game RPC failed:', error) })
        }

        supabase.from('game_moves').insert({
          game_id: gameId, user_id: user.id,
          move_type: 'place',
          tiles_placed: placements,
          words_formed: words.map(w => w.word),
          score: turnScore,
          rack_after: newRack,
        }).then(({ error }) => { if (error) console.error('game_moves insert failed:', error) })

        setPlacements([])
        toast.success(`+${turnScore} pts ✨  [${words.map(w => w.word).join(', ')}]`)
        if (over) toast('🏆 Game over!')
      } finally {
        mutatingRef.current = false
        // Reload from DB now that critical writes have completed
        loadGame({ force: true })
      }
    } finally {
      setSubmitting(false)
    }
  }

  // ── Pass turn ─────────────────────────────────────────────
  async function passTurn() {
    if (!isMyTurn()) return
    recall()
    mutatingRef.current = true
    const nextIdx   = (myPlayer.player_index + 1) % players.length
    const newPasses = (game.consecutive_passes ?? 0) + 1
    const over      = newPasses >= players.length * 2

    // If game over via passes: everyone loses their rack value (no one gets the bonus)
    let finalPlayers = [...players]
    if (over) {
      finalPlayers = applyEndgamePenalties(finalPlayers, null)
      const maxScore = Math.max(...finalPlayers.map(p => p.score))
      finalPlayers   = finalPlayers.map(p => ({ ...p, is_winner: p.score === maxScore }))
    }

    try {
      const { error: gameErr } = await supabase.from('games').update({
        current_player_idx: nextIdx,
        consecutive_passes: newPasses,
        ...(over ? { status: 'finished', finished_at: new Date().toISOString() } : {}),
      }).eq('id', gameId)
      if (gameErr) { console.error('pass: games update failed:', gameErr); toast.error('Failed to pass — please retry.'); return }

      // Fire-and-forget: move log + finish RPC are non-critical
      supabase.from('game_moves').insert({
        game_id: gameId, user_id: user.id,
        move_type: 'pass', score: 0, rack_after: myPlayer.rack,
      }).then(({ error }) => { if (error) console.error('pass: game_moves insert failed:', error) })

      if (over) {
        supabase.rpc('finish_game', {
          p_game_id: gameId,
          p_player_results: finalPlayers.map(fp => ({
            user_id:   fp.user_id,
            score:     fp.score,
            is_winner: fp.is_winner ?? false,
          })),
        }).then(({ error }) => { if (error) console.error('finish_game RPC failed:', error) })
        toast('🏆 Game over — no moves left!')
      } else {
        toast('⏩ Turn passed.')
      }
    } finally {
      mutatingRef.current = false
      loadGame({ force: true })
    }
  }

  // ── Exchange tiles ────────────────────────────────────────
  function toggleExchangeSelect(idx) {
    setExchangeSel(prev =>
      prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]
    )
  }

  async function confirmExchange() {
    if (exchangeSel.length === 0) { toast.error('Select tiles to exchange.'); return }
    if ((game.tile_bag?.length ?? 0) < exchangeSel.length) {
      toast.error('Not enough tiles in the bag to exchange.')
      return
    }
    mutatingRef.current = true

    try {
      const newRack   = [...myPlayer.rack]
      const returned  = exchangeSel.map(i => newRack[i])
      const remaining = newRack.filter((_, i) => !exchangeSel.includes(i))
      let   bag       = [...(game.tile_bag)]

      let { rack: refilled, bag: newBag } = refillRack(remaining, bag)
      newBag = [...newBag, ...returned]

      const nextIdx   = (myPlayer.player_index + 1) % players.length
      const newPasses = (game.consecutive_passes ?? 0) + 1
      const over      = newPasses >= players.length * 2

      let finalPlayers = [...players]
      if (over) {
        finalPlayers = applyEndgamePenalties(finalPlayers, null)
        const maxScore = Math.max(...finalPlayers.map(p => p.score))
        finalPlayers   = finalPlayers.map(p => ({ ...p, is_winner: p.score === maxScore }))
      }

      // Run game + player updates in parallel (independent tables)
      const [{ error: gameErr }, { error: playerErr }] = await Promise.all([
        supabase.from('games').update({
          tile_bag: newBag,
          current_player_idx: nextIdx,
          consecutive_passes: newPasses,
          ...(over ? { status: 'finished', finished_at: new Date().toISOString() } : {}),
        }).eq('id', gameId),
        supabase.from('game_players').update({ rack: refilled })
          .eq('game_id', gameId).eq('user_id', user.id),
      ])
      if (gameErr) { console.error('exchange: games update failed:', gameErr); toast.error('Failed to exchange — please retry.'); return }
      if (playerErr) { console.error('exchange: game_players update failed:', playerErr); toast.error('Failed to save rack — please retry.'); return }

      // Fire-and-forget: move log + finish RPC are non-critical
      supabase.from('game_moves').insert({
        game_id: gameId, user_id: user.id,
        move_type: 'exchange', score: 0, rack_after: refilled,
      }).then(({ error }) => { if (error) console.error('exchange: game_moves insert failed:', error) })

      if (over) {
        supabase.rpc('finish_game', {
          p_game_id: gameId,
          p_player_results: finalPlayers.map(fp => ({
            user_id:   fp.user_id,
            score:     fp.score,
            is_winner: fp.is_winner ?? false,
          })),
        }).then(({ error }) => { if (error) console.error('finish_game RPC failed:', error) })
        toast('🏆 Game over — no moves left!')
      } else {
        toast('🔄 Tiles exchanged!')
      }

      setExchange(false)
      setExchangeSel([])
    } finally {
      mutatingRef.current = false
      loadGame({ force: true })
    }
  }

  // ── Shuffle rack ─────────────────────────────────────────
  function shuffleRack() {
    const shuffled = [...myPlayer.rack]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    localRackRef.current = shuffled
    setMyPlayer(prev => ({ ...prev, rack: shuffled }))
    setSelected(null)
  }

  // ── Forfeit ───────────────────────────────────────────────
  async function forfeitGame() {
    // Uses a SECURITY DEFINER function so it can update all players' rows
    // regardless of RLS (which would otherwise block updating opponents' rows)
    await supabase.rpc('forfeit_game', {
      p_game_id: gameId,
      p_forfeit_user_id: user.id,
    })
    // Reload immediately so profiles/players are fresh before the banner renders
    await loadGame()
    setForfeitModal(false)
  }

  // ── Live score preview (always visible: 0 when no tiles placed) ──
  const liveScore = useMemo(() => {
    if (!board || placements.length === 0) return 0
    try {
      const words = extractWords(board, placements)
      if (words.length === 0) return 0
      return calculateScore(board, placements, words)
    } catch {
      return 0
    }
  }, [board, placements])

  // ── Render ────────────────────────────────────────────────
  if (!game || !board) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-wordy-50 dark:bg-[#0f0a1e]">
        {loadError ? (
          <div className="text-center space-y-3">
            <p className="text-4xl">😵</p>
            <p className="font-display text-xl text-wordy-600 dark:text-wordy-300">Couldn't load game</p>
            <p className="text-sm text-wordy-400 dark:text-wordy-500">{loadError}</p>
            <div className="flex gap-3 justify-center">
              <button onClick={loadGame} className="btn-primary text-sm">🔄 Retry</button>
              <button onClick={() => navigate('/lobby')} className="btn-secondary text-sm">← Lobby</button>
            </div>
          </div>
        ) : (
          <p className="font-display text-2xl text-wordy-400 animate-pulse dark:text-wordy-300">Loading game… 🟣</p>
        )}
      </div>
    )
  }

  const currentPlayerName = profiles[players[game.current_player_idx]?.user_id]?.username ?? '?'
  const myTurn = isMyTurn()

  return (
    <div className="min-h-screen bg-gradient-to-br from-wordy-50 to-pink-50 flex flex-col dark:bg-[#0f0a1e] dark:bg-none">

      {/* Header */}
      <header className="bg-white border-b border-wordy-100 shadow-sm dark:bg-[#130c25] dark:border-[#2d1b55]">
        <div className="max-w-6xl mx-auto px-3 py-2 flex items-center justify-between gap-3">
          <button onClick={() => navigate('/lobby')} className="text-wordy-400 hover:text-wordy-700 text-sm font-bold dark:text-wordy-400 dark:hover:text-wordy-300">
            ← Lobby
          </button>
          <div className="flex-1 text-center">
            <span className={`font-display text-base ${myTurn ? 'text-wordy-700 dark:text-wordy-300' : 'text-wordy-400'}`}>
              {game.status === 'finished'
                ? '🏆 Game Over!'
                : myTurn
                ? '✨ Your turn!'
                : `⏳ ${currentPlayerName}'s turn`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-wordy-300 font-bold">
              🎒 {game.tile_bag?.length ?? 0} left
            </span>
            <div className="relative" ref={settingsRef}>
              <button
                onClick={() => setSettingsOpen(o => !o)}
                className="text-lg leading-none hover:scale-110 transition-transform"
                title="Settings"
              >
                ⚙️
              </button>
              {settingsOpen && (
                <div className="absolute right-0 top-8 w-44 bg-white dark:bg-[#1a1130] border border-wordy-100 dark:border-[#2d1b55] rounded-xl shadow-lg z-50 py-1 text-sm">
                  <button
                    onClick={() => { toggleTheme(); setSettingsOpen(false) }}
                    className="w-full text-left px-4 py-2 hover:bg-wordy-50 dark:hover:bg-[#2d1b55] text-wordy-600 dark:text-wordy-300 transition-colors"
                  >
                    {isDark ? '☀️ Light mode' : '🌙 Dark mode'}
                  </button>
                  {game.status === 'active' && myPlayer && (
                    <button
                      onClick={() => { setForfeitModal(true); setSettingsOpen(false) }}
                      className="w-full text-left px-4 py-2 hover:bg-rose-50 dark:hover:bg-rose-900/20 text-rose-500 transition-colors"
                    >
                      🏳️ Forfeit game
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row gap-3 max-w-6xl mx-auto w-full px-1 py-3 lg:p-3">

        {/* Score panel — desktop sidebar / mobile top bar */}
        <div className="lg:w-56 shrink-0">
          <ScorePanel
            players={players}
            profiles={profiles}
            currentIdx={game.current_player_idx}
            userId={user.id}
            status={game.status}
            lastMoveScores={lastMoveScores}
          />
        </div>

        {/* Board */}
        <div className="flex-1 flex items-center justify-center">
          <ZoomableBoard
            board={board}
            placements={placements}
            lastMoveTiles={lastMoveTiles}
            onCellClick={handleCellClick}
            myTurn={myTurn}
            cellSize={cellSize}
            isDark={isDark}
          />
        </div>

        {/* Invisible spacer — mirrors the score panel width so the board
            stays centred relative to the full page (not just the remaining space).
            Must always match the score panel's lg:w-56 class. */}
        <div className="hidden lg:block lg:w-56 shrink-0" aria-hidden="true" />
      </div>

      {/* Bottom controls — sticky bar, always visible at bottom */}
      {game.status === 'active' && myPlayer && (
        <div className="sticky bottom-0 z-20 bg-white border-t border-wordy-100 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-t-sm dark:bg-[#130c25] dark:border-[#2d1b55]">
          <div className="max-w-xl mx-auto space-y-1.5">
            {/* Row 1: Tile rack */}
            <TileRack
              rack={myPlayer.rack}
              selected={selectedTile}
              exchangeMode={exchangeMode}
              exchangeSel={exchangeSel}
              isDark={isDark}
              onSelect={(letter, idx) => {
                if (exchangeMode) { toggleExchangeSelect(idx); return }
                if (!myTurn) return
                if (selectedTile && selectedTile.rackIdx !== idx) {
                  setMyPlayer(prev => {
                    const newRack = [...prev.rack]
                    const i = selectedTile.rackIdx
                    ;[newRack[i], newRack[idx]] = [newRack[idx], newRack[i]]
                    localRackRef.current = newRack
                    return { ...prev, rack: newRack }
                  })
                  setSelected(null)
                  return
                }
                setSelected(prev =>
                  prev?.rackIdx === idx ? null : { letter, rackIdx: idx }
                )
              }}
              myTurn={myTurn}
            />

            {/* Row 2: Shuffle + live score preview */}
            <div className="flex items-center justify-center gap-3 h-6 my-3">
              <button
                onClick={shuffleRack}
                className="text-xs text-wordy-400 hover:text-wordy-600 transition-colors"
                title="Shuffle your tiles"
              >
                🔀 Shuffle
              </button>
              <span className={`inline-block font-bold text-sm px-3 py-0.5 rounded-full ${
                liveScore > 0
                  ? 'bg-wordy-100 text-wordy-700 dark:bg-[#2d1b55] dark:text-wordy-200'
                  : 'bg-wordy-100/50 text-wordy-400 dark:bg-[#2d1b55]/50 dark:text-wordy-400'
              }`}>
                {liveScore > 0 ? '✨ ' : ''}+{liveScore} pts
                {placements.length === 7 && <span className="ml-1 text-pink-500">🎉 Bingo!</span>}
              </span>
            </div>

            {/* Row 3: Action buttons — single row of icon buttons */}
            {!exchangeMode ? (
              <div className={`flex gap-2 justify-center transition-opacity ${myTurn ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                <button onClick={submitWord} disabled={submitting || placements.length === 0}
                  className="btn-icon btn-icon-primary disabled:opacity-50">
                  <span className="btn-icon-emoji">{submitting ? '⏳' : '✅'}</span>
                  <span className="btn-icon-label">Submit</span>
                </button>
                <button onClick={recall} disabled={placements.length === 0}
                  className="btn-icon btn-icon-secondary disabled:opacity-50">
                  <span className="btn-icon-emoji">↩️</span>
                  <span className="btn-icon-label">Recall</span>
                </button>
                <button onClick={() => { setExchange(true); recall() }}
                  className="btn-icon btn-icon-secondary">
                  <span className="btn-icon-emoji">🔄</span>
                  <span className="btn-icon-label">Swap</span>
                </button>
                <button onClick={passTurn}
                  className="btn-icon btn-icon-secondary">
                  <span className="btn-icon-emoji">⏩</span>
                  <span className="btn-icon-label">Pass</span>
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1.5">
                <p className="text-center text-xs text-wordy-500 font-bold">
                  Tap tiles above to select for exchange
                </p>
                <div className="flex gap-2 justify-center">
                  <button onClick={confirmExchange}
                    className="btn-icon btn-icon-primary">
                    <span className="btn-icon-emoji">🔄</span>
                    <span className="btn-icon-label">Swap ({exchangeSel.length})</span>
                  </button>
                  <button onClick={() => { setExchange(false); setExchangeSel([]) }}
                    className="btn-icon btn-icon-secondary">
                    <span className="btn-icon-emoji">✖️</span>
                    <span className="btn-icon-label">Cancel</span>
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      )}

      {/* Finished banner */}
      {game.status === 'finished' && (
        <div className="bg-gradient-to-r from-wordy-600 to-pink-500 text-white text-center p-4">
          <p className="font-display text-xl mb-1">
            {game.forfeit_user_id
              ? `🏳️ ${profiles[game.forfeit_user_id]?.username ?? '?'} forfeited — ${profiles[players.find(p => p.user_id !== game.forfeit_user_id)?.user_id]?.username ?? '?'} wins!`
              : players.find(p => p.is_winner)
                ? `🏆 ${profiles[players.find(p => p.is_winner)?.user_id]?.username ?? '?'} wins!`
                : "🏆 It's a tie!"}
          </p>
          <div className="flex items-center justify-center gap-4 mt-2">
            <button onClick={() => navigate('/lobby')} className="bg-white/20 hover:bg-white/30 text-white font-bold text-sm px-4 py-1.5 rounded-full transition-colors">
              ← Back to Lobby
            </button>
            <button onClick={() => navigate('/stats')} className="text-sm underline opacity-80 hover:opacity-100">
              View Stats →
            </button>
          </div>
        </div>
      )}

      {/* Blank tile modal */}
      {blankModal && (
        <BlankTileModal onConfirm={confirmBlank} onCancel={() => setBlankModal(null)} />
      )}

      {/* Forfeit confirmation modal */}
      {forfeitModal && (
        <ForfeitModal onConfirm={forfeitGame} onCancel={() => setForfeitModal(false)} />
      )}
    </div>
  )
}

// ── Blank tile letter picker ──────────────────────────────────
function BlankTileModal({ onConfirm, onCancel }) {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl p-5 max-w-sm w-full dark:bg-[#1a1130] dark:border dark:border-[#2d1b55]">
        <h3 className="font-display text-xl text-wordy-700 mb-3 text-center dark:text-wordy-300">
          🃏 Choose a letter for your blank tile
        </h3>
        <div className="grid grid-cols-9 gap-1">
          {letters.map(l => (
            <button key={l} onClick={() => onConfirm(l)}
              className="h-8 w-8 rounded-lg bg-wordy-100 hover:bg-wordy-300 text-wordy-800 font-bold text-xs transition-colors dark:bg-[#2d1b55] dark:hover:bg-wordy-700 dark:text-wordy-200">
              {l}
            </button>
          ))}
        </div>
        <button onClick={onCancel} className="mt-3 w-full btn-secondary text-sm">Cancel</button>
      </div>
    </div>
  )
}

// ── Forfeit confirmation ───────────────────────────────────────
function ForfeitModal({ onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl p-5 max-w-sm w-full text-center dark:bg-[#1a1130] dark:border dark:border-[#2d1b55]">
        <p className="text-4xl mb-3">🏳️</p>
        <h3 className="font-display text-xl text-wordy-700 mb-2 dark:text-wordy-300">Forfeit this game?</h3>
        <p className="text-sm text-wordy-400 mb-5 dark:text-wordy-500">
          Your opponent wins regardless of the current score.
        </p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 btn-secondary text-sm">
            Keep Playing
          </button>
          <button onClick={onConfirm} className="flex-1 btn-danger text-sm">
            Yes, Forfeit
          </button>
        </div>
      </div>
    </div>
  )
}