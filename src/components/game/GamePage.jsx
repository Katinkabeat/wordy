import { useEffect, useState, useRef, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { extractWords, calculateScore } from '../../lib/gameLogic.js'
import { joinGame as joinGameMutation } from '../../lib/gameMutations.js'
import ZoomableBoard from './ZoomableBoard.jsx'
import TileRack   from './TileRack.jsx'
import ScorePanel from './ScorePanel.jsx'
import { useTheme } from '../../contexts/ThemeContext.jsx'
import { useGameData } from '../../hooks/useGameData.js'
import { useGameMutations } from '../../hooks/useGameMutations.js'
import { DEFAULT_TILE_HUE } from '../../lib/tileColors.js'
import {
  SQBoardShell,
  SQBoardHeader,
  SQLobbyHeader,
  SQDropdown,
  SQSettingsRow,
} from '../../../../rae-side-quest/packages/sq-ui/index.js'
import AvatarMenu from '../lobby/AvatarMenu.jsx'
import BlankTileModal from './modals/BlankTileModal.jsx'
import ForfeitModal from './modals/ForfeitModal.jsx'

// Computes board cell size from current viewport width. Container has
// px-1 (8px total) + 14px grid gaps + 4px board border = 26px overhead
// on the board's column.
function computeCellSize() {
  const vw = window.innerWidth
  if (vw >= 1024) return 38   // desktop → 584px board
  if (vw >= 768)  return 32   // tablet  → 494px board
  return Math.max(20, Math.floor((vw - 26) / 15))
}

export default function GamePage({ session }) {
  const { id: gameId } = useParams()
  const navigate        = useNavigate()
  const user            = session.user
  const { isDark, toggle: toggleTheme } = useTheme()

  // ── Live game data + sync (loadGame, realtime, polling, visibility) ──
  const {
    game, players, myPlayer, setMyPlayer,
    board, setBoard,
    profiles, lastMoveTiles, lastMoveScores,
    loadError, loadGame,
    mutatingRef, placementsRef, localRackRef,
  } = useGameData(gameId, user)

  // ── Local UI state ────────────────────────────────────────
  const [placements, setPlacements]   = useState([])     // tiles placed this turn
  const [selectedTile, setSelected]   = useState(null)   // { letter, rackIdx }
  const [exchangeMode, setExchange]   = useState(false)
  const [exchangeSel, setExchangeSel] = useState([])     // rack indices
  const [blankModal, setBlankModal]   = useState(null)   // { row, col } pending blank assignment
  const [forfeitModal, setForfeitModal] = useState(false)
  const [passConfirm, setPassConfirm]   = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsRef = useRef(null)
  const [autoJoining, setAutoJoining] = useState(false)
  const autoJoinAttemptedRef = useRef(false)

  // Auto-accept invite when arriving from a notification deep-link.
  // The notification URL goes straight to /game/:id, so a user who hasn't
  // formally joined yet (no game_players row) lands on a game they can't
  // play. Detect that state and join on their behalf.
  useEffect(() => {
    if (!game || !players) return
    if (autoJoinAttemptedRef.current || autoJoining) return
    if (myPlayer) return

    const iAmInvited = (game.invited_user_ids ?? []).includes(user.id)
    const seatAvailable = players.length < game.max_players
    if (!iAmInvited || game.status !== 'waiting' || !seatAvailable) {
      autoJoinAttemptedRef.current = true
      toast.error("You're not in this game.")
      navigate('/lobby')
      return
    }

    autoJoinAttemptedRef.current = true
    setAutoJoining(true)
    ;(async () => {
      try {
        await joinGameMutation({
          user,
          game: { ...game, game_players: players },
          joinerName: profiles[user.id]?.username,
        })
        toast.success('🟣 Joined! Good luck!')
        await loadGame({ force: true })
      } catch (err) {
        toast.error(err.message ?? "Couldn't join game")
        navigate('/lobby')
      } finally {
        setAutoJoining(false)
      }
    })()
  }, [game, players, myPlayer, autoJoining, user, profiles, loadGame, navigate])

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

  // ── Cell size — reactive to viewport changes ──────────────
  // We can't useMemo with [] because mobile Firefox is mid-transition
  // at first mount (URL bar animating, dvh value still settling), so a
  // single mount-time reading captures a transient innerWidth and freezes
  // a too-large board. Listening to resize lets us recompute when the
  // viewport stabilises — and on browsers where it was already stable at
  // mount, the resize listener returns the same value (skip-if-equal in
  // setState), so there's no re-render and no visible change.
  const [cellSize, setCellSize] = useState(() => computeCellSize())
  useEffect(() => {
    const update = () => {
      const next = computeCellSize()
      setCellSize(prev => (prev === next ? prev : next))
    }
    window.addEventListener('resize', update)
    // Also one-shot recompute shortly after mount, in case no resize
    // fires but the viewport finished settling (Firefox Android).
    const timer = setTimeout(update, 200)
    return () => {
      window.removeEventListener('resize', update)
      clearTimeout(timer)
    }
  }, [])

  // ── Derived state ─────────────────────────────────────────
  function isMyTurn() {
    if (!game || !myPlayer) return false
    return game.current_player_idx === myPlayer.player_index && game.status === 'active'
  }

  // Derive from the DB board (game.board), not the live working board,
  // because the live board includes tiles placed this turn.
  const isFirstMove = !game?.board || game.board.length === 0

  // Keep placementsRef in sync so the polling guard (in useGameData) can read
  // it without being in the interval's closure / dependency array.
  useEffect(() => { placementsRef.current = placements }, [placements, placementsRef])

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

  // ── DB mutations (submit / pass / exchange / forfeit) ─────
  const { submitting, submitWord, passTurn, confirmExchange, forfeitGame } = useGameMutations({
    game, players, myPlayer,
    board,
    placements, setPlacements,
    exchangeSel, setExchange, setExchangeSel,
    setForfeitModal,
    gameId, user,
    loadGame,
    mutatingRef,
    isFirstMove, isMyTurn,
    recall,
  })

  // ── Pass turn (double-tap to confirm) ─────────────────────
  const passTimerRef = useRef(null)
  function handlePass() {
    if (!passConfirm) {
      setPassConfirm(true)
      clearTimeout(passTimerRef.current)
      passTimerRef.current = setTimeout(() => setPassConfirm(false), 3000)
      return
    }
    clearTimeout(passTimerRef.current)
    setPassConfirm(false)
    passTurn()
  }

  // ── Exchange tile selection toggle ────────────────────────
  function toggleExchangeSelect(idx) {
    setExchangeSel(prev =>
      prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]
    )
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
  if (!game || !board || autoJoining || (game && players && !myPlayer && !autoJoinAttemptedRef.current)) {
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
          <p className="font-display text-2xl text-wordy-400 animate-pulse dark:text-wordy-300">
            {autoJoining ? 'Joining game… 🟣' : 'Loading game… 🟣'}
          </p>
        )}
      </div>
    )
  }

  const currentPlayerName = profiles[players[game.current_player_idx]?.user_id]?.username ?? '?'
  const myTurn = isMyTurn()

  // Top header: app-level identity + nav. Same structure on lobby and board
  // (per sq-style-spec.md §4) so the user always has avatar / hub / settings
  // access.
  const topHeader = (
    <SQLobbyHeader
      title="Wordy"
      avatarSlot={<AvatarMenu profile={profiles[user.id]} />}
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
          <div className="relative" ref={settingsRef}>
            <button
              onClick={() => setSettingsOpen(o => !o)}
              className="text-lg leading-none hover:scale-110 transition-transform"
              title="Settings"
            >
              ⚙️
            </button>
            <SQDropdown
              open={settingsOpen}
              onClose={() => setSettingsOpen(false)}
              align="right"
              className="text-sm"
            >
              <SQSettingsRow
                label={isDark ? '☀️ Light mode' : '🌙 Dark mode'}
                onClick={() => { toggleTheme(); setSettingsOpen(false) }}
              />
              {game.status === 'active' && myPlayer && (
                <SQSettingsRow
                  label="🏳️ Forfeit game"
                  danger
                  onClick={() => { setForfeitModal(true); setSettingsOpen(false) }}
                />
              )}
            </SQDropdown>
          </div>
        </>
      }
    />
  )

  // Sub-header: minimal, just navigation + bag. Whose-turn indicator
  // already lives in the score panel (✨ next to the current player), so
  // we don't duplicate it here. Pattern matches Rungles' game pages.
  const subHeader = (
    <SQBoardHeader
      backLabel="← Lobby"
      onBackClick={() => navigate('/lobby')}
      centerSlot={null}
      rightSlot={
        <span className="text-xs text-wordy-600 dark:text-wordy-300 font-bold">
          🎒 {game.tile_bag?.length ?? 0} left
        </span>
      }
    />
  )

  // Custom-positioned bits below the action bar (finished banner) need to
  // live OUTSIDE SQBoardShell so they're not constrained to the play area.
  const actionBar = (game.status === 'active' && myPlayer) ? (
    <div className="p-1.5">
      <div className="max-w-xl mx-auto space-y-2">
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
            <div className="flex items-center justify-center gap-3 py-2">
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
                <button onClick={handlePass}
                  className={`btn-icon ${passConfirm ? 'btn-icon-danger' : 'btn-icon-secondary'}`}>
                  <span className="btn-icon-emoji">⏩</span>
                  <span className="btn-icon-label">{passConfirm ? 'Sure?' : 'Pass'}</span>
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
  ) : null

  const scorePanel = (
    <ScorePanel
      players={players}
      profiles={profiles}
      currentIdx={game.current_player_idx}
      userId={user.id}
      status={game.status}
      lastMoveScores={lastMoveScores}
    />
  )

  return (
    <SQBoardShell
      header={topHeader}
      subHeader={subHeader}
      scorePanel={scorePanel}
      actionBar={actionBar}
    >
      <ZoomableBoard
        board={board}
        placements={placements}
        lastMoveTiles={lastMoveTiles}
        onCellClick={handleCellClick}
        myTurn={myTurn}
        cellSize={cellSize}
        isDark={isDark}
      />

      {/* Finished banner — rendered inside the play area so it appears
          above the action bar but below the header. */}
      {game.status === 'finished' && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-r from-wordy-600 to-pink-500 text-white text-center p-4">
          <p className="font-display text-xl mb-1">
            {game.closed_by_admin
              ? '🛑 Game closed by admin'
              : game.forfeit_user_id
                ? `🏳️ ${profiles[game.forfeit_user_id]?.username ?? '?'} forfeited — ${profiles[players.find(p => p.user_id !== game.forfeit_user_id)?.user_id]?.username ?? '?'} wins!`
                : players.find(p => p.is_winner)
                  ? `🏆 ${profiles[players.find(p => p.is_winner)?.user_id]?.username ?? '?'} wins!`
                  : "🤝 It's a tie!"}
          </p>
          <div className="flex items-center justify-center gap-4 mt-2">
            <button onClick={() => navigate('/lobby')} className="bg-white/20 hover:bg-white/30 text-white font-bold text-sm px-4 py-1.5 rounded-full transition-colors">
              ← Back to Lobby
            </button>
          </div>
        </div>
      )}

      {blankModal && (
        <BlankTileModal onConfirm={confirmBlank} onCancel={() => setBlankModal(null)} />
      )}
      {forfeitModal && (
        <ForfeitModal onConfirm={forfeitGame} onCancel={() => setForfeitModal(false)} />
      )}
    </SQBoardShell>
  )
}