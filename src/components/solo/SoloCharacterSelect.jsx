import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

// The four computer characters. easy/medium/hard are bird names; Claudette
// is the expert "boss" (breaks the bird theme on purpose).
export const CHARACTERS = [
  { id: 'robin', name: 'Robin', tier: 'Easy', pips: 1, bg: 'hsl(145,60%,45%)',
    blurb: "Here for fun — short, friendly words, no big plays." },
  { id: 'jay', name: 'Jay', tier: 'Medium', pips: 2, bg: 'hsl(210,70%,52%)',
    blurb: 'A solid casual player who knows the common words.' },
  { id: 'merlin', name: 'Merlin', tier: 'Hard', pips: 3, bg: 'hsl(25,75%,50%)',
    blurb: 'Sharp and tactical — hunts premium squares and big words.' },
  { id: 'claudette', name: 'Claudette', tier: 'Expert · the boss', pips: 4, boss: true,
    bg: 'linear-gradient(135deg,#ec4899,#a855f7)',
    blurb: "Sees every play, holds the perfect tiles. Beat her and you've earned the crown." },
]
export const CHAR_BY_ID = Object.fromEntries(CHARACTERS.map(c => [c.id, c]))

function Pips({ n, boss }) {
  return (
    <div className="flex gap-[3px] mt-2">
      {[0, 1, 2, 3].map(i => (
        <span key={i} className={`h-[5px] w-[18px] rounded-full ${
          i < n
            ? (boss ? 'bg-pink-400' : 'bg-wordy-600 dark:bg-wordy-400')
            : (boss ? 'bg-white/20' : 'bg-wordy-200 dark:bg-[#3a2466]')
        }`} />
      ))}
    </div>
  )
}

export default function SoloCharacterSelect() {
  const navigate = useNavigate()
  const [count, setCount] = useState(2)        // total players (you + bots)
  const [seats, setSeats] = useState(['robin']) // one entry per opponent seat
  const [active, setActive] = useState(0)

  function firstEmpty(arr) { return arr.findIndex(s => !s) }

  function changeCount(n) {
    const opp = n - 1
    const next = Array.from({ length: opp }, (_, i) => seats[i] ?? null)
    setCount(n)
    setSeats(next)
    setActive(Math.max(0, firstEmpty(next)))
  }

  function assign(id) {
    setSeats(prev => {
      const next = [...prev]
      const idx = (active >= 0 && !next[active]) ? active : (firstEmpty(next) === -1 ? active : firstEmpty(next))
      next[idx] = id
      const fe = firstEmpty(next)
      setActive(fe === -1 ? idx : fe)
      return next
    })
  }

  function clearSeat(i) {
    setSeats(prev => { const n = [...prev]; n[i] = null; return n })
    setActive(i)
  }

  const filled = seats.every(Boolean)
  const remaining = seats.filter(s => !s).length

  function start() {
    if (!filled) return
    const chosen = seats.map(id => ({ characterId: id, name: CHAR_BY_ID[id].name }))
    navigate('/solo/play', { state: { seats: chosen } })
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-wordy-50 via-pink-50 to-wordy-100 dark:bg-[#0f0a1e] dark:bg-none px-4 py-6">
      <div className="max-w-[480px] mx-auto">
        {/* Back bar */}
        <button onClick={() => navigate('/lobby')} className="flex items-center gap-2 mb-4">
          <span className="w-9 h-9 grid place-items-center rounded-full border border-wordy-200 bg-white dark:bg-[#1a1130] dark:border-[#2d1b55] text-lg">‹</span>
          <span className="font-display text-2xl text-wordy-700 dark:text-wordy-200">Solo Play</span>
        </button>

        <section className="card">
          {/* Player count */}
          <p className="text-xs font-bold uppercase tracking-wide text-wordy-500 mb-2">Players</p>
          <div className="flex gap-2 mb-5">
            {[2, 3, 4].map(n => (
              <button key={n} onClick={() => changeCount(n)}
                className={`flex-1 h-11 rounded-xl font-bold text-sm transition border-2 ${
                  count === n
                    ? 'bg-wordy-600 text-white border-wordy-600 shadow'
                    : 'border-wordy-200 text-wordy-500 hover:border-wordy-400 dark:border-[#3a2466]'
                }`}>
                {n}
              </button>
            ))}
          </div>

          {/* Opponent seats */}
          <p className="text-xs font-bold uppercase tracking-wide text-wordy-500 mb-2">
            {seats.length > 1 ? `Your opponents (${seats.length})` : 'Your opponent'}
          </p>
          <div className="flex gap-2 flex-wrap mb-5">
            {seats.map((s, i) => {
              const c = s ? CHAR_BY_ID[s] : null
              const isActive = i === active
              return c ? (
                <div key={i} onClick={() => setActive(i)}
                  className={`flex-1 min-w-[120px] flex items-center gap-2 rounded-xl px-3 py-2 border-2 cursor-pointer ${
                    isActive ? 'border-wordy-500 ring-2 ring-wordy-500/20' : 'border-wordy-100 dark:border-[#2d1b55]'
                  } bg-wordy-50 dark:bg-[#1f1240]`}>
                  <span className="w-8 h-8 rounded-full grid place-items-center text-white font-display text-xs shrink-0"
                    style={{ background: c.bg }}>{c.boss ? '👑' : c.name.slice(0, 2).toUpperCase()}</span>
                  <span className="leading-tight">
                    <span className="block font-display text-sm text-wordy-800 dark:text-wordy-100">{c.name}</span>
                    <span className="block text-[10px] font-bold uppercase tracking-wide text-wordy-500">{c.tier.split(' ')[0]}</span>
                  </span>
                  <button onClick={(e) => { e.stopPropagation(); clearSeat(i) }}
                    className="ml-auto text-wordy-400 hover:text-rose-500 text-sm">✕</button>
                </div>
              ) : (
                <button key={i} onClick={() => setActive(i)}
                  className={`flex-1 min-w-[120px] rounded-xl px-3 py-2 border-2 border-dashed text-xs font-bold ${
                    isActive ? 'border-wordy-500 text-wordy-600' : 'border-wordy-200 text-wordy-400 dark:border-[#3a2466]'
                  }`}>＋ Seat {i + 1}</button>
              )
            })}
          </div>

          {/* Character cards */}
          <p className="text-xs font-bold uppercase tracking-wide text-wordy-500 mb-2">Tap to fill the highlighted seat</p>
          <div className="space-y-2.5">
            {CHARACTERS.map(c => (
              <button key={c.id} onClick={() => assign(c.id)}
                className={`w-full text-left rounded-xl p-3 border-2 transition relative overflow-hidden ${
                  c.boss
                    ? 'border-[#3a1d6e] text-white'
                    : 'border-wordy-100 dark:border-[#2d1b55] bg-wordy-50 dark:bg-[#1f1240] hover:border-wordy-400'
                }`}
                style={c.boss ? { background: 'linear-gradient(135deg,#2a1551,#4c1d95)' } : undefined}>
                {c.boss && <span className="absolute top-2.5 right-3 text-lg">👑</span>}
                <div className="flex items-center gap-2.5">
                  <span className="w-9 h-9 rounded-full grid place-items-center text-white font-display text-xs shrink-0"
                    style={{ background: c.bg }}>{c.name.slice(0, 2).toUpperCase()}</span>
                  <div>
                    <div className={`font-display text-base leading-none ${c.boss ? 'text-white' : 'text-wordy-800 dark:text-wordy-100'}`}>{c.name}</div>
                    <div className={`text-[10px] font-bold uppercase tracking-wide mt-1 ${c.boss ? 'text-pink-200' : 'text-wordy-500'}`}>{c.tier}</div>
                  </div>
                  <span className={`ml-auto text-xs font-display rounded-full px-3 py-1 border ${
                    c.boss ? 'text-pink-100 border-pink-300/50' : 'text-wordy-600 border-wordy-300 dark:text-wordy-300 dark:border-[#4c1d95]'
                  }`}>+ Add</span>
                </div>
                <p className={`text-xs mt-2 leading-snug ${c.boss ? 'text-pink-50/90' : 'text-wordy-500 dark:text-wordy-300'}`}>{c.blurb}</p>
                <Pips n={c.pips} boss={c.boss} />
              </button>
            ))}
          </div>

          <div className="text-xs text-wordy-700 dark:text-wordy-200 bg-wordy-50 dark:bg-[#1f1240] border border-dashed border-wordy-200 dark:border-[#2d1b55] rounded-lg px-3 py-2 my-4">
            🏆 Solo games don't count toward the leaderboard — play freely.
          </div>

          <button onClick={start} disabled={!filled}
            className="btn-primary w-full disabled:opacity-50">
            {filled ? '✨ Start game' : `Fill ${remaining} more seat${remaining > 1 ? 's' : ''}`}
          </button>
        </section>
      </div>
    </div>
  )
}
