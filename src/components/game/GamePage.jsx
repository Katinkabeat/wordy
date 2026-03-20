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
import Board      from './Board.jsx'
import TileRack   from './TileRack.jsx'
import ScorePanel from './ScorePanel.jsx'
import { useTheme } from '../../contexts/ThemeContext.jsx'

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
  const [profiles, setProfiles]       = useState({})
  const [lastMoveTiles, setLastMoveTiles] = useState([]) // tiles from the most recent move
  const [lastMoveScores, setLastMoveScores] = useState({}) // user_id → last move score
  const channelRef = useRef(null)

  // ── Cell size — fixed, device-appropriate ─────────────────
  const cellSize = useMemo(() => {
    const vw = window.innerWidth
    if (vw >= 1024) return 38                                   // desktop → 584px board
    if (vw >= 768)  return 32                                   // tablet  → 494px board
    // Container has p-3 (24px total) + 8px safety margin = 32px, plus 14px of gaps
    return Math.max(20, Math.floor((vw - 46) / 15))
  }, [])

  // ── Helpers ───────────────────────────────────────────────
  const isMyTurn = useCallback(() => {
    if (!game || !myPlayer) return false
    return game.current_player_idx === myPlayer.player_index && game.status === 'active'
  }, [game, myPlayer])

  const isFirstMove = board
    ? board.every(row => row.every(cell => cell === null))
    : true

  // ── Load game data ────────────────────────────────────────
  const loadGame = useCallback(async () => {
    const { data: g } = await supabase
      .from('games')
      .select('*')
      .eq('id', gameId).single()
    if (!g) { toast.error('Game not found.'); navigate('/lobby'); return }
    setGame(g)
    setBoard(deserializeBoard(g.board))

    const { data: ps } = await supabase
      .from('game_players')
      .select('*')
      .eq('game_id', gameId)
      .order('player_index')
    setPlayers(ps ?? [])
    const me = (ps ?? []).find(p => p.user_id === user.id)
    setMyPlayer(me ?? null)

    // Load the last move so we can highlight those tiles on the board
    const { data: lastMoves } = await supabase
      .from('game_moves')
      .select('tiles_placed')
      .eq('game_id', gameId)
      .eq('move_type', 'place')
      .order('created_at', { ascending: false })
      .limit(1)
    setLastMoveTiles(lastMoves?.[0]?.tiles_placed ?? [])

    // Load each player's last move score
    const playerIds = (ps ?? []).map(p => p.user_id)
    if (playerIds.length) {
      const scoreMap = {}
      for (const pid of playerIds) {
        const { data: moves } = await supabase
          .from('game_moves')
          .select('score')
          .eq('game_id', gameId)
          .eq('user_id', pid)
          .order('created_at', { ascending: false })
          .limit(1)
        if (moves?.[0]?.score != null) scoreMap[pid] = moves[0].score
      }
      setLastMoveScores(scoreMap)
    }

    // Load usernames — only update if the query succeeds so a transient
    // network failure on mobile doesn't wipe out already-loaded names
    const ids = (ps ?? []).map(p => p.user_id)
    if (ids.length) {
      const { data: profs, error: profsError } = await supabase
        .from('profiles').select('id, username').in('id', ids)
      if (!profsError && profs) {
        const map = {}
        for (const p of profs) map[p.id] = p.username
        setProfiles(map)
      }
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
          () => loadGame()
        )
        .on('postgres_changes', { event: '*', schema: 'public', table: 'game_players', filter: `game_id=eq.${gameId}` },
          () => loadGame()
        )
        .subscribe()
    }

    subscribe()

    // When the tab/phone wakes back up, reload state and reconnect if needed.
    // This handles the common case of taking a long time between turns.
    function handleVisible() {
      if (document.visibilityState !== 'visible') return
      loadGame()
      if (!channelRef.current || channelRef.current.state !== 'joined') {
        subscribe()
      }
    }

    document.addEventListener('visibilitychange', handleVisible)
    window.addEventListener('focus', handleVisible)

    return () => {
      supabase.removeChannel(channelRef.current)
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
    const newBoard = board.map(r => [...r])
    newBoard[row][col] = { letter, isBlank }
    setBoard(newBoard)

    // Remove from rack
    const newRack = [...(myPlayer.rack)]
    newRack.splice(selectedTile.rackIdx, 1)
    setMyPlayer(prev => ({ ...prev, rack: newRack }))

    setPlacements(prev => [...prev, {
      row, col, letter, isBlank,
      rackIdx: selectedTile.rackIdx,
      tileLetter: selectedTile.letter,
    }])
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
    setPlacements([])
    setSelected(null)
  }

  // ── Submit word ───────────────────────────────────────────
  async function submitWord() {
    if (submitting || placements.length === 0) return
    if (game.status !== 'active') return   // guard against post-forfeit submissions
    setSubmitting(true)

    try {
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

      // Persist to Supabase (best-effort in sequence)
      await supabase.from('games').update({
        board: newBoardFlat,
        tile_bag: newBag,
        current_player_idx: nextIdx,
        consecutive_passes: 0,
        ...(over ? { status: 'finished', finished_at: new Date().toISOString() } : {}),
      }).eq('id', gameId)

      await supabase.from('game_players').update({
        score: newScore,
        rack:  newRack,
      }).eq('game_id', gameId).eq('user_id', user.id)

      if (over) {
        await supabase.rpc('finish_game', {
          p_game_id: gameId,
          p_player_results: finalPlayers.map(fp => ({
            user_id:   fp.user_id,
            score:     fp.score,
            is_winner: fp.is_winner ?? false,
          })),
        })
      }

      await supabase.from('game_moves').insert({
        game_id: gameId, user_id: user.id,
        move_type: 'place',
        tiles_placed: placements,
        words_formed: words.map(w => w.word),
        score: turnScore,
        rack_after: newRack,
      })

      setPlacements([])
      toast.success(`+${turnScore} pts ✨  [${words.map(w => w.word).join(', ')}]`)
      if (over) toast('🏆 Game over!')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Pass turn ─────────────────────────────────────────────
  async function passTurn() {
    if (!isMyTurn()) return
    recall()
    const nextIdx = (myPlayer.player_index + 1) % players.length
    const newPasses = (game.consecutive_passes ?? 0) + 1

    await supabase.from('games').update({
      current_player_idx: nextIdx,
      consecutive_passes: newPasses,
    }).eq('id', gameId)

    await supabase.from('game_moves').insert({
      game_id: gameId, user_id: user.id,
      move_type: 'pass', score: 0, rack_after: myPlayer.rack,
    })

    toast('⏩ Turn passed.')
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

    const newRack   = [...myPlayer.rack]
    const returned  = exchangeSel.map(i => newRack[i])
    const remaining = newRack.filter((_, i) => !exchangeSel.includes(i))
    let   bag       = [...(game.tile_bag)]

    let { rack: refilled, bag: newBag } = refillRack(remaining, bag)
    newBag = [...newBag, ...returned]

    const nextIdx  = (myPlayer.player_index + 1) % players.length

    await supabase.from('games').update({
      tile_bag: newBag,
      current_player_idx: nextIdx,
      consecutive_passes: (game.consecutive_passes ?? 0) + 1,
    }).eq('id', gameId)

    await supabase.from('game_players').update({ rack: refilled })
      .eq('game_id', gameId).eq('user_id', user.id)

    await supabase.from('game_moves').insert({
      game_id: gameId, user_id: user.id,
      move_type: 'exchange', score: 0, rack_after: refilled,
    })

    setExchange(false)
    setExchangeSel([])
    toast('🔄 Tiles exchanged!')
  }

  // ── Shuffle rack ─────────────────────────────────────────
  function shuffleRack() {
    const shuffled = [...myPlayer.rack]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
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

  // ── Live score preview ────────────────────────────────────
  const liveScore = useMemo(() => {
    if (!board || placements.length === 0) return null
    try {
      const words = extractWords(board, placements)
      if (words.length === 0) return null
      return calculateScore(board, placements, words)
    } catch {
      return null
    }
  }, [board, placements])

  // ── Render ────────────────────────────────────────────────
  if (!game || !board) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-wordy-50 dark:bg-[#0f0a1e]">
        <p className="font-display text-2xl text-wordy-400 animate-pulse dark:text-wordy-300">Loading game… 🟣</p>
      </div>
    )
  }

  const currentPlayerName = profiles[players[game.current_player_idx]?.user_id] ?? '?'
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
            <button
              onClick={toggleTheme}
              className="text-lg leading-none hover:scale-110 transition-transform"
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDark ? '☀️' : '🌙'}
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row gap-3 max-w-6xl mx-auto w-full p-3">

        {/* Score panel — desktop sidebar / mobile top bar */}
        <div className="lg:w-48 shrink-0">
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
          <Board
            board={board}
            placements={placements}
            lastMoveTiles={lastMoveTiles}
            onCellClick={handleCellClick}
            myTurn={myTurn}
            cellSize={cellSize}
          />
        </div>

        {/* Invisible spacer — mirrors the score panel width so the board
            stays centred relative to the full page (not just the remaining space).
            Must always match the score panel's lg:w-48 class. */}
        <div className="hidden lg:block lg:w-48 shrink-0" aria-hidden="true" />
      </div>

      {/* Bottom controls (shown only to the current player) */}
      {game.status === 'active' && myPlayer && (
        <div className="bg-white border-t border-wordy-100 p-3 shadow-t-sm dark:bg-[#130c25] dark:border-[#2d1b55]">
          <div className="max-w-xl mx-auto space-y-3">
            {/* Tile rack */}
            <TileRack
              rack={myPlayer.rack}
              selected={selectedTile}
              exchangeMode={exchangeMode}
              exchangeSel={exchangeSel}
              onSelect={(letter, idx) => {
                if (exchangeMode) { toggleExchangeSelect(idx); return }
                if (!myTurn) return
                setSelected(prev =>
                  prev?.rackIdx === idx ? null : { letter, rackIdx: idx }
                )
              }}
              myTurn={myTurn}
            />

            {/* Shuffle button — available any time (pure visual reorder) */}
            <div className="text-center">
              <button
                onClick={shuffleRack}
                className="text-xs text-wordy-400 hover:text-wordy-600 transition-colors"
                title="Shuffle your tiles"
              >
                🔀 Shuffle
              </button>
            </div>

            {/* Live score preview */}
            {liveScore !== null && (
              <div className="text-center">
                <span className="inline-block bg-wordy-100 text-wordy-700 font-bold text-sm px-3 py-1 rounded-full dark:bg-[#2d1b55] dark:text-wordy-200">
                  ✨ +{liveScore} pts
                  {placements.length === 7 && <span className="ml-1 text-pink-500">🎉 Bingo!</span>}
                </span>
              </div>
            )}

            {/* Action buttons */}
            {myTurn && !exchangeMode && (
              <div className="flex flex-wrap gap-2 justify-center">
                <button onClick={submitWord} disabled={submitting || placements.length === 0}
                  className="btn-primary disabled:opacity-50 text-sm">
                  {submitting ? '⏳' : '✅ Submit Word'}
                </button>
                <button onClick={recall} disabled={placements.length === 0}
                  className="btn-secondary text-sm">
                  ↩ Recall
                </button>
                <button onClick={() => { setExchange(true); recall() }}
                  className="btn-secondary text-sm">
                  🔄 Exchange
                </button>
                <button onClick={passTurn} className="btn-secondary text-sm">
                  ⏩ Pass
                </button>
              </div>
            )}

            {myTurn && exchangeMode && (
              <div className="flex flex-wrap gap-2 justify-center">
                <p className="w-full text-center text-xs text-wordy-500 font-bold">
                  Tap tiles above to select them for exchange
                </p>
                <button onClick={confirmExchange}
                  className="btn-primary text-sm">
                  🔄 Exchange ({exchangeSel.length})
                </button>
                <button onClick={() => { setExchange(false); setExchangeSel([]) }}
                  className="btn-secondary text-sm">
                  Cancel
                </button>
              </div>
            )}

            {/* Forfeit — always visible while game is active */}
            <div className="text-center pt-1">
              <button
                onClick={() => setForfeitModal(true)}
                className="text-xs text-rose-400 hover:text-rose-600 underline transition-colors"
              >
                🏳️ Forfeit game
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Finished banner */}
      {game.status === 'finished' && (
        <div className="bg-gradient-to-r from-wordy-600 to-pink-500 text-white text-center p-4">
          <p className="font-display text-xl mb-1">
            {game.forfeit_user_id
              ? `🏳️ ${profiles[game.forfeit_user_id] ?? '?'} forfeited — ${profiles[players.find(p => p.user_id !== game.forfeit_user_id)?.user_id] ?? '?'} wins!`
              : players.find(p => p.is_winner)
                ? `🏆 ${profiles[players.find(p => p.is_winner)?.user_id] ?? '?'} wins!`
                : "🏆 It's a tie!"}
          </p>
          <button onClick={() => navigate('/stats')} className="text-sm underline opacity-80 hover:opacity-100">
            View Stats →
          </button>
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
