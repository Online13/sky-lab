import { keyName, withKey } from './shortcuts'

type Props = {
  onAbout: () => void
  onImmersive: () => void
  onPhoto: () => void
}

const ICON =
  'size-4.5 fill-none stroke-current stroke-[1.6] [stroke-linecap:round] [stroke-linejoin:round]'
const BUTTON =
  'grid size-9 place-items-center rounded-lg text-ink-muted hover:bg-panel-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-accent'

// The title of the scene, and what can be done with the whole view.
export function SceneBar({ onAbout, onImmersive, onPhoto }: Props) {
  return (
    <div className="flex items-center gap-0.5 rounded-xl border border-line bg-panel/90 p-1 text-ink shadow-xl shadow-black/40 backdrop-blur-md">
      <button
        type="button"
        onClick={onAbout}
        title={withKey('About', 'about')}
        aria-label="Sky Lab, about"
        aria-keyshortcuts={keyName('about')}
        className="flex h-9 items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium hover:bg-panel-raised focus-visible:outline-2 focus-visible:outline-accent"
      >
        Sky Lab
        <svg
          viewBox="0 0 24 24"
          aria-hidden
          className={`${ICON} text-ink-faint`}
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5M12 8v.01" />
        </svg>
      </button>
      <span aria-hidden className="mx-0.5 h-5 w-px bg-line" />
      <button
        type="button"
        onClick={onImmersive}
        title={withKey('Immersive mode', 'immersive')}
        aria-label="Immersive mode"
        aria-keyshortcuts={keyName('immersive')}
        className={BUTTON}
      >
        <svg viewBox="0 0 24 24" aria-hidden className={ICON}>
          <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
        </svg>
      </button>
      <button
        type="button"
        onClick={onPhoto}
        title={withKey('Take a photo', 'photo')}
        aria-label="Take a photo"
        aria-keyshortcuts={keyName('photo')}
        className={BUTTON}
      >
        <svg viewBox="0 0 24 24" aria-hidden className={ICON}>
          <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
          <circle cx="12" cy="13" r="3.5" />
        </svg>
      </button>
    </div>
  )
}
