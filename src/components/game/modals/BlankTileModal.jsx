import { SQModal, SQButton } from '../../../../../rae-side-quest/packages/sq-ui/index.js'

export default function BlankTileModal({ onConfirm, onCancel }) {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
  return (
    <SQModal
      open={true}
      onClose={onCancel}
      title="🃏 Choose a letter for your blank tile"
    >
      <div className="grid grid-cols-9 gap-1">
        {letters.map(l => (
          <button key={l} onClick={() => onConfirm(l)}
            className="h-8 w-8 rounded-lg bg-wordy-100 hover:bg-wordy-300 text-wordy-800 font-bold text-xs transition-colors dark:bg-[#2d1b55] dark:hover:bg-wordy-700 dark:text-wordy-200">
            {l}
          </button>
        ))}
      </div>
      <div className="mt-4">
        <SQButton variant="secondary" className="w-full text-sm" onClick={onCancel}>Cancel</SQButton>
      </div>
    </SQModal>
  )
}
