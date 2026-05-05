// On mobile: renders as a compact horizontal row of score chips (saves vertical space).
// On desktop (lg+): renders as a vertical sidebar card with full player rows.
export default function ScorePanel({ players, profiles, currentIdx, userId, status, lastMoveScores = {} }) {
  return (
    <>
      {/* ── Desktop: vertical sidebar card ─────────────────── */}
      <div className="card space-y-2 hidden lg:block">
        <h3 className="font-display text-lg text-wordy-700 mb-1">🏅 Scores</h3>
        {players.map((p, i) => {
          const name      = profiles[p.user_id]?.username ?? '?'
          const isMe      = p.user_id === userId
          const isCurrent = i === currentIdx && status === 'active'
          const isWinner  = p.is_winner && status === 'finished'
          return (
            <div
              key={p.user_id}
              className={`
                flex items-center justify-between rounded-xl px-3 py-2 transition-all
                ${isCurrent ? 'bg-wordy-100 border-2 border-wordy-400' : 'bg-wordy-50 border border-wordy-100'}
                ${isWinner  ? 'bg-yellow-50 border-yellow-300' : ''}
              `}
            >
              <div className="flex items-center gap-2">
                {isCurrent && <span className="text-sm">✨</span>}
                {isWinner  && <span className="text-sm">🏆</span>}
                <span className={`text-sm font-bold ${isMe ? 'text-wordy-700' : 'text-wordy-500'}`}>
                  {name}{isMe ? ' (you)' : ''}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="font-display text-lg text-wordy-800">{p.score}</span>
                {lastMoveScores[p.user_id] != null && lastMoveScores[p.user_id] > 0 && (
                  <span className="text-xs font-bold text-green-500">+{lastMoveScores[p.user_id]}</span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Mobile: compact horizontal score bar ────────────── */}
      <div className="flex lg:hidden gap-x-2 gap-y-1 flex-wrap px-1">
        {players.map((p, i) => {
          const name      = profiles[p.user_id]?.username ?? '?'
          const isMe      = p.user_id === userId
          const isCurrent = i === currentIdx && status === 'active'
          const isWinner  = p.is_winner && status === 'finished'
          return (
            <div
              key={p.user_id}
              className={`
                flex items-center gap-1.5 rounded-full px-3 py-0.5 text-xs font-bold transition-all
                ${isCurrent ? 'bg-wordy-200 border-2 border-wordy-500 text-wordy-800' : 'bg-wordy-50 border border-wordy-200 text-wordy-500'}
                ${isWinner  ? 'bg-yellow-50 border-yellow-300 text-yellow-800' : ''}
              `}
            >
              {isCurrent && <span>✨</span>}
              {isWinner  && <span>🏆</span>}
              <span>{name}{isMe ? ' (you)' : ''}</span>
              <span className="font-display text-sm text-wordy-800">{p.score}</span>
              {lastMoveScores[p.user_id] != null && lastMoveScores[p.user_id] > 0 && (
                <span className="text-xs font-bold text-green-500">+{lastMoveScores[p.user_id]}</span>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}
