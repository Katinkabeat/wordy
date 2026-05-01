import { SQModal, SQButton } from '../../../../../rae-side-quest/packages/sq-ui/index.js'

export default function ForfeitModal({ onConfirm, onCancel }) {
  return (
    <SQModal
      open={true}
      onClose={onCancel}
      title={null}
      actions={
        <>
          <SQButton variant="secondary" className="flex-1 text-sm" onClick={onCancel}>
            Keep Playing
          </SQButton>
          <SQButton variant="danger" className="flex-1 text-sm" onClick={onConfirm}>
            Yes, Forfeit
          </SQButton>
        </>
      }
    >
      <div className="text-center">
        <p className="text-4xl mb-3">🏳️</p>
        <h3 className="font-display text-xl text-wordy-700 mb-2 dark:text-wordy-300">Forfeit this game?</h3>
        <p className="text-sm text-wordy-400 dark:text-wordy-500">
          Your opponent wins regardless of the current score.
        </p>
      </div>
    </SQModal>
  )
}
