export default function ScorePanel({ players, profiles, currentIdx, userId, status }) {
  return (
    <div className="card space-y-2">
      <h3 className="font-display text-lg text-wordy-700 mb-1">🏅 Scores</h3>
      {players.map((p, i) => {
        const name      = profiles[p.user_id] ?? '?'
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
            <span className="font-display text-lg text-wordy-800">{p.score}</span>
          </div>
        )
      })}
    </div>
  )
}
