import { CARD, Modal, PRIMARY, SECONDARY } from './Modal'

type Props = { open: boolean; onClose: () => void; onConfirm: () => void }

// Says how to come back before the toolbars disappear.
export function ImmersiveDialog({ open, onClose, onConfirm }: Props) {
  return (
    <Modal open={open} onClose={onClose} labelledBy="immersive-title">
      <div className={`${CARD} w-[min(24rem,calc(100vw-2rem))]`}>
        <h2 id="immersive-title" className="text-sm font-medium">
          Immersive mode
        </h2>
        <p className="text-xs leading-relaxed text-ink-muted">
          The toolbars hide to leave the whole sky in view. To bring them back,
          press{' '}
          <kbd className="rounded border border-line bg-panel-raised px-1.5 py-0.5 font-sans text-[11px] text-ink">
            Esc
          </kbd>
          , or double-tap the screen.
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={SECONDARY}>
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={PRIMARY}
            data-autofocus
          >
            Hide toolbars
          </button>
        </div>
      </div>
    </Modal>
  )
}
