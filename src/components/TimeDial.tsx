import type { ReactNode } from 'react'
import { formatHour } from './formatHour'
import { keyName, withKey } from './shortcuts'
import { Tape } from './Tape'

// The hours on a tape that wraps around midnight, a quarter hour per tick.

type Props = {
  value: number
  onChange: (hour: number) => void
  // Back to the current time on the device.
  onNow: () => void
  isNow: boolean
  // Controls shown in the middle of the row, and before the "now" button.
  center?: ReactNode
  after?: ReactNode
}

export function TimeDial({
  value,
  onChange,
  onNow,
  isNow,
  center,
  after,
}: Props) {
  return (
    <div className="flex flex-col">
      {/* Hour, play and speed laid out like a video player's controls: the
          middle column stays centred whatever the sides hold. */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1 px-1 pt-1">
        <span className="ml-1 justify-self-start text-[15px] font-medium tabular-nums">
          {formatHour(value)}
        </span>
        {center}
        <div className="flex items-center justify-end gap-1">
          {after}
          <button
            type="button"
            onClick={onNow}
            disabled={isNow}
            title={withKey('Back to the current time', 'now')}
            aria-keyshortcuts={keyName('now')}
            className="rounded-md px-1.5 py-0.5 text-[11px] text-ink-muted hover:bg-panel-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-40"
          >
            Now
          </button>
        </div>
      </div>
      <Tape
        value={value}
        onChange={onChange}
        min={0}
        max={24}
        step={1 / 60}
        tick={0.25}
        major={4}
        pxPerTick={11}
        wrap
        formatTick={(h) => String(h).padStart(2, '0')}
        keyStep={5 / 60}
        pageStep={1}
        label="Time"
        valueText={formatHour(value)}
        className="rounded-b-xl"
      />
    </div>
  )
}
