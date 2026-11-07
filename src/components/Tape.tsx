import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

// A swipeable tape of ticks sliding under a fixed centre mark, used for every
// value set by hand. Keeps moving with the momentum of a flick and eases to a
// tick that is tapped. A wrapping tape (the hours) goes round from max back
// to min; any other stops at its ends.

// Share of a flick's speed left after one second.
const MOMENTUM_PER_SECOND = 0.005
const TAP_SLOP = 5 // px

type Props = {
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  // Smallest change the value takes.
  step: number
  // Spacing of the small ticks, in value units; every `major`th one is
  // labelled.
  tick: number
  major: number
  pxPerTick: number
  wrap?: boolean
  formatTick: (value: number) => string
  // Arrow keys move by keyStep, with Shift or Page keys by pageStep.
  keyStep: number
  pageStep: number
  label: string
  valueText: string
  className?: string
}

export function Tape({
  value,
  onChange,
  min,
  max,
  step,
  tick,
  major,
  pxPerTick,
  wrap = false,
  formatTick,
  keyStep,
  pageStep,
  label,
  valueText,
  className = '',
}: Props) {
  const tapeRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const animation = useRef(0)
  const drag = useRef<{
    x: number
    start: number
    moved: boolean
    samples: { t: number; x: number }[]
  } | null>(null)
  const pxPerUnit = pxPerTick / tick
  const period = max - min

  const limit = (v: number) =>
    wrap
      ? ((((v - min) % period) + period) % period) + min
      : Math.min(max, Math.max(min, v))
  const quantize = (v: number) =>
    limit(Number((Math.round(v / step) * step).toFixed(6)))

  // Gestures work on an unrounded, unwrapped position so slow wheels add up
  // and crossing midnight stays smooth; a wrapping tape repeats every period,
  // so drawing it around the wrapped value looks the same.
  const raw = useRef(value)
  // Last value sent, to tell it apart from one set from elsewhere.
  const emitted = useRef(value)
  const position = () => (quantize(raw.current) === value ? raw.current : value)
  const emit = (v: number) => {
    raw.current = wrap ? v : limit(v)
    emitted.current = quantize(raw.current)
    onChange(emitted.current)
  }

  useLayoutEffect(() => {
    const tape = tapeRef.current!
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    )
    observer.observe(tape)
    return () => observer.disconnect()
  }, [])

  useEffect(() => () => cancelAnimationFrame(animation.current), [])

  // A value set from elsewhere (the "now" button, the running clock) ends
  // any glide in progress.
  useEffect(() => {
    if (value === emitted.current) return
    cancelAnimationFrame(animation.current)
    animation.current = 0
  }, [value])

  const stop = () => {
    cancelAnimationFrame(animation.current)
    animation.current = 0
  }

  const animate = (step: (dt: number) => boolean) => {
    stop()
    let last = performance.now()
    const frame = (now: number) => {
      const dt = Math.min(now - last, 50)
      last = now
      animation.current = step(dt) ? requestAnimationFrame(frame) : 0
    }
    animation.current = requestAnimationFrame(frame)
  }

  const glide = (velocity: number) => {
    let v = velocity // units per ms
    let p = position()
    animate((dt) => {
      v *= MOMENTUM_PER_SECOND ** (dt / 1000)
      p += v * dt
      emit(p)
      const stuck = !wrap && (p <= min || p >= max)
      return !stuck && Math.abs(v) * pxPerUnit > 0.005
    })
  }

  const easeTo = (target: number) => {
    const from = position()
    let t = 0
    animate((dt) => {
      t = Math.min(1, t + dt / 350)
      emit(from + (target - from) * (1 - (1 - t) ** 3))
      return t < 1
    })
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    stop()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = {
      x: e.clientX,
      start: position(),
      moved: false,
      samples: [{ t: e.timeStamp, x: e.clientX }],
    }
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    if (Math.abs(dx) > TAP_SLOP) d.moved = true
    if (!d.moved) return
    d.samples.push({ t: e.timeStamp, x: e.clientX })
    if (d.samples.length > 6) d.samples.shift()
    emit(d.start - dx / pxPerUnit)
  }

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (!d.moved) {
      const rect = e.currentTarget.getBoundingClientRect()
      const offset = (e.clientX - rect.left - rect.width / 2) / pxPerUnit
      // Taps land on the nearest tick.
      easeTo(Math.round((position() + offset) / tick) * tick)
      return
    }
    const first = d.samples[0]
    const elapsed = e.timeStamp - first.t
    if (elapsed > 0 && elapsed < 150)
      glide(-(e.clientX - first.x) / pxPerUnit / elapsed)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const small = e.shiftKey ? pageStep : keyStep
    const next = {
      ArrowLeft: value - small,
      ArrowDown: value - small,
      ArrowRight: value + small,
      ArrowUp: value + small,
      PageDown: value - pageStep,
      PageUp: value + pageStep,
      Home: min,
      End: wrap ? max - step : max,
    }[e.key]
    if (next === undefined) return
    e.preventDefault()
    stop()
    emit(next)
  }

  const centre = value
  const half = width / 2 / pxPerUnit + tick
  const ticks: { q: number; t: number }[] = []
  for (
    let q = Math.floor((centre - half) / tick);
    q <= Math.ceil((centre + half) / tick);
    q++
  ) {
    const t = q * tick
    if (wrap || (t >= min - 1e-9 && t <= max + 1e-9)) ticks.push({ q, t })
  }

  return (
    <div
      ref={tapeRef}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (drag.current = null)}
      onWheel={(e) => {
        stop()
        emit(position() + (e.deltaX || e.deltaY) / pxPerUnit / 2)
      }}
      onKeyDown={onKeyDown}
      className={`relative h-9 cursor-grab touch-none overflow-hidden outline-none select-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset active:cursor-grabbing ${className}`}
      style={{
        maskImage:
          'linear-gradient(to right, transparent, black 18%, black 82%, transparent)',
      }}
    >
      {ticks.map(({ q, t }) => {
        const isMajor = q % major === 0
        return (
          <div
            key={q}
            aria-hidden
            className="absolute top-0 flex flex-col items-center"
            style={{
              transform: `translateX(${width / 2 + (t - centre) * pxPerUnit}px) translateX(-50%)`,
            }}
          >
            <span
              className={`w-px rounded-full ${isMajor ? 'h-2.5 bg-white/60' : 'h-1.5 bg-white/25'}`}
            />
            {isMajor && (
              <span className="mt-1 text-[10px] leading-none text-ink-faint tabular-nums">
                {formatTick(wrap ? limit(t) : t)}
              </span>
            )}
          </div>
        )
      })}
      <span
        aria-hidden
        className="absolute top-0 left-1/2 h-4 w-0.5 -translate-x-1/2 rounded-full bg-accent"
      />
    </div>
  )
}
