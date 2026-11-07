import { TimeDial } from './TimeDial'
import {
  PlayButton,
  type Speed,
  SpeedPicker,
  type TimeMode,
} from './TimeModeBar'

type Props = {
  hour: number
  onHour: (hour: number) => void
  onNow: () => void
  isNow: boolean
  mode: TimeMode
  onMode: (mode: TimeMode) => void
  speed: Speed
  onSpeed: (speed: Speed) => void
}

// The time, set like a media player's timeline: play in the middle, speed
// beside it, the tape of hours always under the hand.
export function TimerBar({
  hour,
  onHour,
  onNow,
  isNow,
  mode,
  onMode,
  speed,
  onSpeed,
}: Props) {
  return (
    <div className="pointer-events-auto w-[min(34rem,100%)] rounded-xl border border-line bg-panel/90 text-ink shadow-xl shadow-black/40 backdrop-blur-md select-none">
      <TimeDial
        value={hour}
        onChange={onHour}
        onNow={onNow}
        isNow={isNow}
        center={<PlayButton mode={mode} onMode={onMode} />}
        after={
          <SpeedPicker
            mode={mode}
            onMode={onMode}
            speed={speed}
            onSpeed={onSpeed}
          />
        }
      />
    </div>
  )
}
