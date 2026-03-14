import { useEffect, useState, useCallback, useRef } from 'react'
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

export default function GamePage({ session }) {
  const { id: gameId } = useParams()
  const navigate        = useNavigate()
  const user            = session.user

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
  const [profiles, setProfiles]       = useState({})
  const channelRef = useRef(null)

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

    // Load usernames
    const ids = (ps ?? []).map(p => p.user_id)
    if (ids.length) {
      const { data: profs } = await supabase
        .from('profiles').select('id, username').in('id', ids)
      const map = {}
      for (const p of (profs ?? [])) map[p.id] = p.username
      setProfiles(map)
    }
  }, [gameId, user.id, navigate])

  useEffect(() => { loadGame() }, [loadGame])

  // Real-time subscription
  useEffect(() => {
    channelRef.current = supabase.channel(`game-${gameId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
        payload => {
          setGame(payload.new)
          setBoard(deserializeBoard(payload.new.board))
        }
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_players', filter: `game_id=eq.${gameId}` },
        () => loadGame()
      )
      .subscribe()
    return () => supabase.removeChannel(channelRef.current)
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
        for (const fp of finalPlayers) {
          await supabase.from('game_players').update({
            score: fp.score, is_winner: fp.is_winner ?? false,
          }).eq('game_id', gameId).eq('user_id', fp.user_id)
        }
        await supabase.rpc('record_game_result', { p_game_id: gameId })
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

  // ── Render ────────────────────────────────────────────────
  if (!game || !board) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-wordy-50">
        <p className="font-display text-2xl text-wordy-400 animate-pulse">Loading game… 🟣</p>
      </div>
    )
  }

  const currentPlayerName = profiles[players[game.current_player_idx]?.user_id] ?? '?'
  const myTurn = isMyTurn()

  return (
    <div className="min-h-screen bg-gradient-to-br from-wordy-50 to-pink-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-wordy-100 shadow-sm">
        <div className="max-w-6xl mx-auto px-3 py-2 flex items-center justify-between gap-3">
          <button onClick={() => navigate('/lobby')} className="text-wordy-400 hover:text-wordy-700 text-sm font-bold">
            ← Lobby
          </button>
          <div className="flex-1 text-center">
            <span className={`font-display text-base ${myTurn ? 'text-wordy-700' : 'text-wordy-400'}`}>
              {game.status === 'finished'
                ? '🏆 Game Over!'
                : myTurn
                ? '✨ Your turn!'
                : `⏳ ${currentPlayerName}'s turn`}
            </span>
          </div>
          <span className="text-xs text-wordy-300 font-bold">
            🎒 {game.tile_bag?.length ?? 0} left
          </span>
        </div>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row gap-3 max-w-6xl mx-auto w-full p-3">
        {/* Score panel */}
        <div className="lg:w-48 shrink-0">
          <ScorePanel
            players={players}
            profiles={profiles}
            currentIdx={game.current_player_idx}
            userId={user.id}
            status={game.status}
          />
        </div>

        {/* Board */}
        <div className="flex-1 flex items-center justify-center">
          <Board
            board={board}
            placements={placements}
            onCellClick={handleCellClick}
            myTurn={myTurn}
          />
        </div>
      </div>

      {/* Bottom controls (shown only to the current player) */}
      {game.status === 'active' && myPlayer && (
        <div className="bg-white border-t border-wordy-100 p-3 shadow-t-sm">
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
          </div>
        </div>
      )}

      {/* Finished banner */}
      {game.status === 'finished' && (
        <div className="bg-gradient-to-r from-wordy-600 to-pink-500 text-white text-center p-4">
          <p className="font-display text-xl mb-1">
            🏆 {players.find(p => p.is_winner)
              ? `${profiles[players.find(p => p.is_winner)?.user_id] ?? '?'} wins!`
              : "It's a tie!"}
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
    </div>
  )
}

// ── Blank tile letter picker ──────────────────────────────────
function BlankTileModal({ onConfirm, onCancel }) {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl p-5 max-w-sm w-full">
        <h3 className="font-display text-xl text-wordy-700 mb-3 text-center">
          🃏 Choose a letter for your blank tile
        </h3>
        <div className="grid grid-cols-9 gap-1">
          {letters.map(l => (
            <button key={l} onClick={() => onConfirm(l)}
              className="h-8 w-8 rounded-lg bg-wordy-100 hover:bg-wordy-300 text-wordy-800 font-bold text-xs transition-colors">
              {l}
            </button>
          ))}
        </div>
        <button onClick={onCancel} className="mt-3 w-full btn-secondary text-sm">Cancel</button>
      </div>
    </div>
  )
}
