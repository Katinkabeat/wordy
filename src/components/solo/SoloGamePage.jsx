import { useEffect, useState, useRef, useMemo, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import toast from 'react-hot-toast'
import { validatePlacement, extractWords, calculateScore } from '../../lib/gameLogic.js'
import { validateWords } from '../../lib/wordValidator.js'
import {
  initSoloGame, applyPlay, applyPass, applyExchange,
  botDecide, applyBotAction, isBoardEmpty,
} from '../../lib/soloGame.js'
import { loadBotDictionary } from '../../lib/botDictionary.js'
import ZoomableBoard from '../game/ZoomableBoard.jsx'
import TileRack from '../game/TileRack.jsx'
import ScorePanel from '../game/ScorePanel.jsx'
import BlankTileModal from '../game/modals/BlankTileModal.jsx'
import { useTheme } from '../../contexts/ThemeContext.jsx'
import {
  SQBoardShell, SQBoardHeader, SQLobbyHeader, SQDropdown, SQSettingsRow,
} from '../../../../rae-side-quest/packages/sq-ui/index.js'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// Cell sizing — identical approach to GamePage: fit the largest readable
// cell into the measured play area.
function fitCellSize(w, h) {
  const vw = window.innerWidth
  let fromW
  if (vw >= 1024) fromW = 38
  else if (vw >= 768) fromW = 32
  else fromW = Math.max(20, Math.floor((w - 18) / 15))
  const fromH = Math.max(20, Math.floor((h - 22) / 15))
  return Math.min(fromW, fromH)
}
function initialCellSize() {
  const vw = window.innerWidth
  if (vw >= 1024) return 38
  if (vw >= 768) return 32
  return Math.max(20, Math.floor((vw - 26) / 15))
}

export default function SoloGamePage({ session }) {
  const navigate = useNavigate()
  const location = useLocation()
  const user = session.user
  const { isDark, toggle: toggleTheme } = useTheme()

  const seats = location.state?.seats

  // No seats (e.g. a page refresh lost router state) → back to character select.
  useEffect(() => {
    if (!seats) navigate('/solo', { replace: true })
  }, [seats, navigate])

  // ── Local game state ──────────────────────────────────────
  const [state, setState] = useState(() =>
    seats ? initSoloGame({ humanId: user.id, humanName: 'You', seats }) : null,
  )
  const [workRack, setWorkRack] = useState(() => (state ? state.players[0].rack : []))
  const [placements, setPlacements] = useState([])
  const [selectedTile, setSelected] = useState(null)
  const [exchangeMode, setExchange] = useState(false)
  const [exchangeSel, setExchangeSel] = useState([])
  const [blankModal, setBlankModal] = useState(null)
  const [passConfirm, setPassConfirm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [botThinking, setBotThinking] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsRef = useRef(null)
  const passTimerRef = useRef(null)

  // ── Cell size (ResizeObserver on the play area) ───────────
  const [cellSize, setCellSize] = useState(initialCellSize)
  const observerRef = useRef(null)
  const resizeHandlerRef = useRef(null)
  const boardSlotRef = useCallback((el) => {
    if (observerRef.current) { observerRef.current.disconnect(); observerRef.current = null }
    if (resizeHandlerRef.current) { window.removeEventListener('resize', resizeHandlerRef.current); resizeHandlerRef.current = null }
    if (!el) return
    const update = () => {
      const w = el.clientWidth, h = el.clientHeight
      if (!w || !h) return
      const next = fitCellSize(w, h)
      setCellSize(prev => (prev === next ? prev : next))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    observerRef.current = observer
    window.addEventListener('resize', update)
    resizeHandlerRef.current = update
  }, [])
  useEffect(() => () => {
    if (observerRef.current) observerRef.current.disconnect()
    if (resizeHandlerRef.current) window.removeEventListener('resize', resizeHandlerRef.current)
  }, [])

  // Close settings on outside click.
  useEffect(() => {
    if (!settingsOpen) return
    function onClick(e) { if (settingsRef.current && !settingsRef.current.contains(e.target)) setSettingsOpen(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [settingsOpen])

  // Reset the human's in-progress turn whenever the committed game changes
  // (after any move, or when the turn returns to the human).
  useEffect(() => {
    if (!state) return
    setWorkRack(state.players[0].rack)
    setPlacements([])
    setSelected(null)
    setExchange(false)
    setExchangeSel([])
  }, [state])

  // ── Bot turn loop ─────────────────────────────────────────
  useEffect(() => {
    if (!state || state.status !== 'active') return
    const cur = state.players[state.currentPlayerIdx]
    if (!cur.isBot) return
    let cancelled = false
    setBotThinking(true)
    ;(async () => {
      try {
        const dict = await loadBotDictionary()
        if (cancelled) return
        const action = botDecide(state, dict)
        await sleep(700 + Math.random() * 500) // human-ish pause
        if (cancelled) return
        const name = state.profiles[cur.user_id]?.username ?? 'Computer'
        if (action.type === 'play') toast(`🤖 ${name}: ${action.move.words.join(', ')} (+${action.move.score})`)
        else if (action.type === 'exchange') toast(`🤖 ${name} swapped tiles`)
        else toast(`🤖 ${name} passed`)
        setState(s => applyBotAction(s, action))
      } finally {
        if (!cancelled) setBotThinking(false)
      }
    })()
    return () => { cancelled = true }
  }, [state?.currentPlayerIdx, state?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived ───────────────────────────────────────────────
  const myTurn = !!state && state.currentPlayerIdx === 0 && state.status === 'active' && !botThinking
  const isFirstMove = !!state && isBoardEmpty(state.board)

  const workBoard = useMemo(() => {
    if (!state) return null
    const b = state.board.map(r => r.slice())
    for (const p of placements) b[p.row][p.col] = { letter: p.letter, isBlank: p.isBlank }
    return b
  }, [state, placements])

  const liveScore = useMemo(() => {
    if (!workBoard || placements.length === 0) return 0
    try {
      const words = extractWords(workBoard, placements)
      if (words.length === 0) return 0
      return calculateScore(workBoard, placements, words, state.layoutVersion)
    } catch { return 0 }
  }, [workBoard, placements, state])

  if (!state || !workBoard) return null

  // ── Human turn handlers ───────────────────────────────────
  function handleCellClick(row, col) {
    if (!myTurn || exchangeMode) return
    const existingIdx = placements.findIndex(p => p.row === row && p.col === col)
    if (existingIdx !== -1) {
      const removed = placements[existingIdx]
      const newRack = [...workRack]
      newRack.splice(removed.rackIdx, 0, removed.tileLetter)
      setWorkRack(newRack)
      setPlacements(prev => prev.filter((_, i) => i !== existingIdx))
      setSelected(null)
      return
    }
    if (state.board[row][col]) return // committed tile
    if (!selectedTile) return
    if (selectedTile.letter === '?') { setBlankModal({ row, col }); return }
    placeTile(row, col, selectedTile.letter, false)
  }

  function placeTile(row, col, letter, isBlank) {
    const newRack = [...workRack]
    newRack.splice(selectedTile.rackIdx, 1)
    setWorkRack(newRack)
    setPlacements(prev => [...prev, { row, col, letter, isBlank, rackIdx: selectedTile.rackIdx, tileLetter: selectedTile.letter }])
    setSelected(null)
  }

  function confirmBlank(letter) {
    if (!blankModal) return
    placeTile(blankModal.row, blankModal.col, letter, true)
    setBlankModal(null)
  }

  function recall() {
    if (placements.length === 0) return
    const restored = placements.map(p => ({ letter: p.tileLetter, rackIdx: p.rackIdx })).sort((a, b) => a.rackIdx - b.rackIdx)
    const newRack = [...workRack]
    for (const t of restored) newRack.splice(t.rackIdx, 0, t.letter)
    setWorkRack(newRack)
    setPlacements([])
    setSelected(null)
  }

  function shuffleRack() {
    const s = [...workRack]
    for (let i = s.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [s[i], s[j]] = [s[j], s[i]] }
    setWorkRack(s)
    setSelected(null)
  }

  async function submitWord() {
    if (submitting || placements.length === 0 || state.status !== 'active' || !myTurn) return
    setSubmitting(true)
    try {
      const v = validatePlacement(workBoard, placements, isFirstMove)
      if (!v.valid) { toast.error(v.error); return }
      const words = extractWords(workBoard, placements)
      if (words.length === 0) { toast.error('No valid words formed.'); return }
      const { allValid, invalidWords } = await validateWords(words.map(w => w.word))
      if (!allValid) { toast.error(`Not valid words: ${invalidWords.join(', ')}`); return }
      const turnScore = calculateScore(workBoard, placements, words, state.layoutVersion)
      const committed = placements.map(p => ({ row: p.row, col: p.col, letter: p.letter, isBlank: p.isBlank }))
      setState(s => applyPlay(s, committed))
      toast.success(`+${turnScore} ✨  [${words.map(w => w.word).join(', ')}]`)
    } finally {
      setSubmitting(false)
    }
  }

  function handlePass() {
    if (!myTurn) return
    if (!passConfirm) {
      setPassConfirm(true)
      clearTimeout(passTimerRef.current)
      passTimerRef.current = setTimeout(() => setPassConfirm(false), 3000)
      return
    }
    clearTimeout(passTimerRef.current)
    setPassConfirm(false)
    setState(s => applyPass(s))
    toast('⏩ Turn passed.')
  }

  function toggleExchangeSelect(idx) {
    setExchangeSel(prev => prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx])
  }

  function confirmExchange() {
    if (exchangeSel.length === 0) { toast.error('Select tiles to exchange.'); return }
    if (state.tileBag.length < exchangeSel.length) { toast.error('Not enough tiles in the bag.'); return }
    setState(s => applyExchange(s, exchangeSel))
    toast('🔄 Tiles exchanged!')
  }

  const human = state.players[0]
  const currentName = state.profiles[state.players[state.currentPlayerIdx]?.user_id]?.username ?? '?'
  const winner = state.players.find(p => p.is_winner)

  const topHeader = (
    <SQLobbyHeader
      title="Solo Play"
      rightSlot={
        <>
          <a href="/games/" className="text-2xl leading-none hover:scale-110 transition-transform" title="Rae's Side Quest" aria-label="Rae's Side Quest">🏠</a>
          <div className="relative" ref={settingsRef}>
            <button onClick={() => setSettingsOpen(o => !o)} className="text-lg leading-none hover:scale-110 transition-transform" title="Settings">⚙️</button>
            <SQDropdown open={settingsOpen} onClose={() => setSettingsOpen(false)} align="right" className="text-sm">
              <SQSettingsRow label={isDark ? '☀️ Light mode' : '🌙 Dark mode'} onClick={() => { toggleTheme(); setSettingsOpen(false) }} />
              <SQSettingsRow label="🏳️ Quit to lobby" danger onClick={() => navigate('/lobby')} />
            </SQDropdown>
          </div>
        </>
      }
    />
  )

  const subHeader = (
    <SQBoardHeader
      backLabel="← Lobby"
      onBackClick={() => navigate('/lobby')}
      centerSlot={
        state.status === 'active'
          ? <span className="text-xs font-bold text-wordy-600 dark:text-wordy-300">{botThinking ? `🤖 ${currentName} is thinking…` : myTurn ? '✨ Your turn' : `${currentName}'s turn`}</span>
          : null
      }
      rightSlot={<span className="text-xs text-wordy-600 dark:text-wordy-300 font-bold">🎒 {state.tileBag.length} left</span>}
    />
  )

  const actionBar = (state.status === 'active') ? (
    <div className="p-1.5">
      <div className="max-w-xl mx-auto space-y-2">
        <TileRack
          rack={workRack}
          selected={selectedTile}
          exchangeMode={exchangeMode}
          exchangeSel={exchangeSel}
          isDark={isDark}
          onSelect={(letter, idx) => {
            if (exchangeMode) { toggleExchangeSelect(idx); return }
            if (!myTurn) return
            if (selectedTile && selectedTile.rackIdx !== idx) {
              const newRack = [...workRack]
              ;[newRack[selectedTile.rackIdx], newRack[idx]] = [newRack[idx], newRack[selectedTile.rackIdx]]
              setWorkRack(newRack)
              setSelected(null)
              return
            }
            setSelected(prev => prev?.rackIdx === idx ? null : { letter, rackIdx: idx })
          }}
          myTurn={myTurn}
        />

        <div className="flex items-center justify-center gap-3 py-2">
          <button onClick={shuffleRack} className="text-xs text-wordy-400 hover:text-wordy-600 transition-colors" title="Shuffle your tiles">🔀 Shuffle</button>
          <span className={`inline-block font-bold text-sm px-3 py-0.5 rounded-full ${liveScore > 0 ? 'bg-wordy-100 text-wordy-700 dark:bg-[#2d1b55] dark:text-wordy-200' : 'bg-wordy-100/50 text-wordy-400 dark:bg-[#2d1b55]/50 dark:text-wordy-400'}`}>
            {liveScore > 0 ? '✨ ' : ''}+{liveScore} pts
            {placements.length === 7 && <span className="ml-1 text-pink-500">🎉 Bingo!</span>}
          </span>
        </div>

        {!exchangeMode ? (
          <div className={`flex gap-2 justify-center transition-opacity ${myTurn ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            <button onClick={submitWord} disabled={submitting || placements.length === 0} className="btn-icon btn-icon-primary disabled:opacity-50">
              <span className="btn-icon-emoji">{submitting ? '⏳' : '✅'}</span><span className="btn-icon-label">Submit</span>
            </button>
            <button onClick={recall} disabled={placements.length === 0} className="btn-icon btn-icon-secondary disabled:opacity-50">
              <span className="btn-icon-emoji">↩️</span><span className="btn-icon-label">Recall</span>
            </button>
            <button onClick={() => { setExchange(true); recall() }} className="btn-icon btn-icon-secondary">
              <span className="btn-icon-emoji">🔄</span><span className="btn-icon-label">Swap</span>
            </button>
            <button onClick={handlePass} className={`btn-icon ${passConfirm ? 'btn-icon-danger' : 'btn-icon-secondary'}`}>
              <span className="btn-icon-emoji">⏩</span><span className="btn-icon-label">{passConfirm ? 'Sure?' : 'Pass'}</span>
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5">
            <p className="text-center text-xs text-wordy-500 font-bold">Tap tiles above to select for exchange</p>
            <div className="flex gap-2 justify-center">
              <button onClick={confirmExchange} className="btn-icon btn-icon-primary">
                <span className="btn-icon-emoji">🔄</span><span className="btn-icon-label">Swap ({exchangeSel.length})</span>
              </button>
              <button onClick={() => { setExchange(false); setExchangeSel([]) }} className="btn-icon btn-icon-secondary">
                <span className="btn-icon-emoji">✖️</span><span className="btn-icon-label">Cancel</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  ) : null

  const scorePanel = (
    <ScorePanel
      players={state.players}
      profiles={state.profiles}
      currentIdx={state.currentPlayerIdx}
      userId={user.id}
      status={state.status}
      lastMoveScores={state.lastMoveScores}
    />
  )

  return (
    <SQBoardShell header={topHeader} subHeader={subHeader} scorePanel={scorePanel} actionBar={actionBar}>
      <div ref={boardSlotRef} className="self-stretch flex-1 min-h-0 w-full flex items-start justify-center">
        <ZoomableBoard
          board={workBoard}
          placements={placements}
          lastMoveTiles={state.lastMoveTiles}
          onCellClick={handleCellClick}
          myTurn={myTurn}
          cellSize={cellSize}
          isDark={isDark}
          layoutVersion={state.layoutVersion}
        />
      </div>

      {state.status === 'finished' && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-r from-wordy-600 to-pink-500 text-white text-center p-4">
          <p className="font-display text-xl mb-1">
            {winner
              ? (winner.user_id === user.id ? '🏆 You win!' : `🏆 ${state.profiles[winner.user_id]?.username ?? '?'} wins!`)
              : "🤝 It's a tie!"}
          </p>
          <div className="flex items-center justify-center gap-3 mt-2">
            <button onClick={() => navigate('/solo')} className="bg-white/20 hover:bg-white/30 text-white font-bold text-sm px-4 py-1.5 rounded-full transition-colors">🔁 New game</button>
            <button onClick={() => navigate('/lobby')} className="bg-white/20 hover:bg-white/30 text-white font-bold text-sm px-4 py-1.5 rounded-full transition-colors">← Lobby</button>
          </div>
        </div>
      )}

      {blankModal && <BlankTileModal onConfirm={confirmBlank} onCancel={() => setBlankModal(null)} />}
    </SQBoardShell>
  )
}
