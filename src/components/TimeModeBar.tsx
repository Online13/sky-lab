import { keyName, withKey } from './shortcuts'

export type TimeMode = 'auto' | 'manual'

// Simulated seconds per real second.
const SPEEDS = [
  { value: 1, label: '×1', title: 'Real time' },
  { value: 60, label: '×60', title: '1 minute per second' },
  { value: 600, label: '×600', title: '10 minutes per second' },
  { value: 3600, label: '×3600', title: '1 hour per second' },
] as const

export type Speed = (typeof SPEEDS)[number]['value']

const BUTTON =
  'flex h-7 items-center justify-center rounded-md text-[11px] text-ink-muted hover:bg-panel-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-accent aria-pressed:bg-accent aria-pressed:text-white'

// Starts the hour running by itself, or stops it to set it by hand.
export function PlayButton({
  mode,
  onMode,
}: {
  mode: TimeMode
  onMode: (mode: TimeMode) => void
}) {
  const auto = mode === 'auto'
  const label = auto ? 'Stop time' : 'Run time'
  return (
    <button
      type="button"
      title={withKey(label, 'play')}
      aria-label={label}
      aria-keyshortcuts={keyName('play')}
      onClick={() => onMode(auto ? 'manual' : 'auto')}
      className={`${BUTTON} w-7 text-ink`}
    >
      <svg viewBox="0 0 24 24" aria-hidden className="size-3.5 fill-current">
        {auto ? (
          <>
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </>
        ) : (
          <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z" />
        )}
      </svg>
    </button>
  )
}

// How fast the hour runs. The speed stays remembered while stopped.
export function SpeedPicker({
  mode,
  onMode,
  speed,
  onSpeed,
}: {
  mode: TimeMode
  onMode: (mode: TimeMode) => void
  speed: Speed
  onSpeed: (speed: Speed) => void
}) {
  const auto = mode === 'auto'
  return (
    <div role="group" aria-label="Speed" className="flex gap-0.5">
      {SPEEDS.map((s) => (
        <button
          key={s.value}
          type="button"
          title={s.title}
          aria-label={s.title}
          aria-pressed={auto && speed === s.value}
          // Picking a speed starts the clock.
          onClick={() => {
            onSpeed(s.value)
            onMode('auto')
          }}
          className={`${BUTTON} px-1.5 tabular-nums ${auto ? '' : 'opacity-50 hover:opacity-100'}`}
        >
          {s.label}
        </button>
      ))}
    </div>
  )
}
