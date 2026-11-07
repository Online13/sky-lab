import { useEffect, useState } from 'react'
import { moonIllumination, moonPhaseImages, moonPhaseName } from '../sky/moon'

const PHASES = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]
const THUMB_RADIUS = 64 // device pixels of the rendered image

// Rendered ahead, while the page is idle, so the panel opens at once.
setTimeout(() => moonPhaseImages(PHASES, THUMB_RADIUS).catch(() => {}), 2000)

// Distance around the lunar cycle, so 0.95 is close to a new moon.
const cycleDistance = (a: number, b: number) => {
  const d = Math.abs(a - b) % 1
  return Math.min(d, 1 - d)
}

type Props = {
  phase: number
  onChange: (phase: number) => void
}

export function MoonPhasePicker({ phase, onChange }: Props) {
  const [images, setImages] = useState<string[] | null>(null)

  useEffect(() => {
    let alive = true
    moonPhaseImages(PHASES, THUMB_RADIUS).then(
      (urls) => alive && setImages(urls),
      (error: Error) => console.warn(error.message),
    )
    return () => {
      alive = false
    }
  }, [])

  const selected = PHASES.reduce((best, p) =>
    cycleDistance(p, phase) < cycleDistance(best, phase) ? p : best,
  )

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-ink-muted">
        {moonPhaseName(phase)} · {Math.round(moonIllumination(phase) * 100)}%
        lit
      </p>
      <div className="grid grid-cols-4 gap-2">
        {PHASES.map((p, i) => (
          <button
            key={p}
            type="button"
            aria-pressed={p === selected}
            onClick={() => onChange(p)}
            className="flex flex-col items-center gap-1.5 rounded-lg p-2 text-[11px] leading-tight text-ink-muted hover:bg-panel-raised focus-visible:outline-2 focus-visible:outline-accent aria-pressed:bg-accent aria-pressed:text-white"
          >
            <span className="grid size-14 place-items-center rounded-full bg-black/60 ring-1 ring-white/10">
              {images && (
                <img src={images[i]} alt="" className="size-14 rounded-full" />
              )}
            </span>
            {moonPhaseName(p)}
          </button>
        ))}
      </div>
    </div>
  )
}
