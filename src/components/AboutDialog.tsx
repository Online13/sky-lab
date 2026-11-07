import { useState } from 'react'
import { CARD, Modal, SECONDARY } from './Modal'
import { ShortcutList } from './ShortcutList'

// Who made it. Shown in the About dialog.
const AUTHOR = {
  name: '@Rayane',
  portfolio: 'https://nekena-rayane.com/',
}

const LINK =
  'font-medium text-ink underline decoration-ink-faint underline-offset-2 hover:decoration-ink focus-visible:outline-2 focus-visible:outline-accent'

type Props = { open: boolean; onClose: () => void }

export function AboutDialog({ open, onClose }: Props) {
  const [showKeys, setShowKeys] = useState(false)
  return (
    <Modal open={open} onClose={onClose} labelledBy="about-title">
      <div className={`${CARD} w-[min(26rem,calc(100vw-2rem))]`}>
        <h2 id="about-title" className="text-sm font-medium">
          Sky Lab
        </h2>
        <div className="flex flex-col gap-2 text-xs leading-relaxed text-ink-muted">
          <p>
            A simulated sky, computed frame by frame in your browser. No photos,
            no video: the colour of the air, the clouds, the moon, the stars and
            the rain all follow the settings you choose.
          </p>
          <p>
            Run the hours, change the weather, send a plane or a shooting star
            across, then take the sky as a photo or share it as a link.
          </p>
        </div>
        <p className="border-t border-line pt-3 text-xs text-ink-muted">
          Made by{' '}
          <a
            href={AUTHOR.portfolio}
            target="_blank"
            rel="noopener"
            className={LINK}
          >
            {AUTHOR.name}
          </a>
        </p>
        {showKeys && <ShortcutList id="about-shortcuts" />}
        <div className="flex justify-between gap-2">
          <button
            type="button"
            onClick={() => setShowKeys((s) => !s)}
            aria-expanded={showKeys}
            aria-controls="about-shortcuts"
            className={SECONDARY}
          >
            {showKeys ? 'Hide shortcuts' : 'Keyboard shortcuts'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className={SECONDARY}
            data-autofocus
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  )
}
