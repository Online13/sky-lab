import { type Action, keyName } from './shortcuts'

const ACTIONS: [Action, string][] = [
  ['photo', 'Take a photo'],
  ['immersive', 'Immersive mode'],
  ['about', 'About'],
  ['play', 'Run or stop time'],
  ['now', 'Back to now'],
  ['cloudCover', 'Clouds'],
  ['windSpeed', 'Wind'],
  ['precipitation', 'Rain'],
  ['temperature', 'Temperature'],
  ['starCount', 'Stars'],
  ['moon', 'Moon phase'],
  ['effects', 'Effects'],
  ['plane', 'Send a plane'],
  ['birds', 'Send birds'],
  ['shootingStar', 'Send a shooting star'],
  ['balloon', 'Send a balloon'],
]

const ROWS = [
  ...ACTIONS.map(([action, label]) => ({ key: keyName(action), label })),
  { key: 'Esc', label: 'Close, or bring the toolbars back' },
]

// Every keyboard shortcut, listed in the About dialog.
export function ShortcutList({ id }: { id: string }) {
  return (
    <dl
      id={id}
      className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-xs text-ink-muted"
    >
      {ROWS.map(({ key, label }) => (
        <div key={label} className="contents">
          <dt className="justify-self-end">
            <kbd className="inline-block min-w-6 rounded border border-line bg-panel-raised px-1.5 py-0.5 text-center font-sans text-[11px] leading-none text-ink">
              {key}
            </kbd>
          </dt>
          <dd>{label}</dd>
        </div>
      ))}
    </dl>
  )
}
