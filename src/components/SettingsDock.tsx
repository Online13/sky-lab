import { type ReactNode, useEffect } from 'react'
import { computeAtmosphere } from '../sky/atmosphere'
import { CLOUD_KIND_IDS, CLOUD_KINDS, cloudAmounts } from '../sky/clouds'
import type { EffectKind } from '../sky/effects'
import { PARAM_SPECS, type SkyParams } from '../sky/params'
import { MoonPhasePicker } from './MoonPhasePicker'
import { keyName, withKey } from './shortcuts'
import { Tape } from './Tape'

type Tool =
  'cloudCover' | 'windSpeed' | 'precipitation' | 'temperature' | 'starCount'

export type PanelId = Tool | 'moon' | 'effects'

type Change = (patch: Partial<SkyParams>) => void

const ICONS: Record<Tool, ReactNode> = {
  cloudCover: (
    <path d="M7 18h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.2 11 3.5 3.5 0 0 0 7 18z" />
  ),
  windSpeed: <path d="M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7" />,
  precipitation: <path d="M12 3s-5 6-5 10a5 5 0 0 0 10 0c0-4-5-10-5-10z" />,
  temperature: (
    <>
      <path d="M10 14V5a2 2 0 1 1 4 0v9a4 4 0 1 1-4 0z" />
      <path d="M12 17v-5" />
    </>
  ),
  starCount: (
    <path d="m12 3 2.6 5.6 6 .7-4.5 4.1 1.2 5.9L12 16.3l-5.3 3 1.2-5.9-4.5-4.1 6-.7z" />
  ),
}

const TOOLS = Object.keys(ICONS) as Tool[]

const EFFECTS: { id: EffectKind; label: string; icon: ReactNode }[] = [
  {
    id: 'plane',
    label: 'Plane',
    icon: (
      <path d="M21 12a1.5 1.5 0 0 0-1.5-1.5H15L10 3H8l2.5 7.5H6L4 8H2.5l1 4-1 4H4l2-2.5h4.5L8 21h2l5-7.5h4.5A1.5 1.5 0 0 0 21 12z" />
    ),
  },
  {
    id: 'birds',
    label: 'Birds',
    icon: <path d="M3 9q2.5-2 5 0q2.5-2 5 0M11 16q2.5-2 5 0q2.5-2 5 0" />,
  },
  {
    id: 'shootingStar',
    label: 'Shooting star',
    icon: (
      <path d="M3 21l7-7M15 3l1.5 3.2 3.5.4-2.6 2.4.7 3.5-3.1-1.7-3.1 1.7.7-3.5L10 6.6l3.5-.4z" />
    ),
  },
  {
    id: 'balloon',
    label: 'Balloon',
    icon: (
      <path d="M12 3c-3.3 0-6 2.6-6 6 0 3.6 3.6 6.2 4.5 8h3c.9-1.8 4.5-4.4 4.5-8 0-3.4-2.7-6-6-6zM10.5 17v3h3v-3M12 3c-1.6 2-2 4-2 6s1 5.5 1.5 8M12 3c1.6 2 2 4 2 6s-1 5.5-1.5 8" />
    ),
  },
]

const SPARKLES = (
  <path d="M11 3l1.8 4.6L17.5 9l-4.7 1.4L11 15l-1.8-4.6L4.5 9l4.7-1.4zM18.5 14.5l.8 2 2.2.8-2.2.8-.8 2.4-.8-2.4-2.2-.8 2.2-.8z" />
)

const ICON =
  'size-5 fill-none stroke-current stroke-[1.6] [stroke-linecap:round] [stroke-linejoin:round]'
const RAIL_BUTTON =
  'group flex h-13 w-13 flex-col items-center justify-center gap-1 rounded-lg text-ink hover:bg-panel-raised focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent aria-expanded:bg-accent'
const RAIL_CHIP =
  'text-[10px] leading-none whitespace-nowrap text-ink-muted tabular-nums group-hover:text-ink group-aria-expanded:text-white'

// Each button sends one across the sky; the panel stays open for more.
function EffectsPanel({ onEffect }: { onEffect: (kind: EffectKind) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {EFFECTS.map((effect) => (
        <button
          key={effect.id}
          type="button"
          title={withKey(effect.label, effect.id)}
          aria-keyshortcuts={keyName(effect.id)}
          onClick={() => onEffect(effect.id)}
          className="flex flex-col items-center gap-1.5 rounded-lg bg-panel-raised/60 px-2 py-3 text-[11px] text-ink-muted hover:bg-panel-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-accent active:bg-accent active:text-white"
        >
          <svg viewBox="0 0 24 24" aria-hidden className={ICON}>
            {effect.icon}
          </svg>
          {effect.label}
        </button>
      ))}
    </div>
  )
}

// Short form for the chip floating over each tool.
function toolValue(id: Tool, params: SkyParams) {
  const v = params[id]
  switch (id) {
    case 'temperature':
      return `${v}°`
    case 'windSpeed':
      return `${v} km/h`
    case 'starCount':
      return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)
    default:
      return `${v}%`
  }
}

// Tick spacing of each tape, in the value's units, and how many ticks
// between two labels.
const TAPES: Record<Tool, { tick: number; major: number }> = {
  cloudCover: { tick: 2, major: 5 },
  windSpeed: { tick: 2, major: 5 },
  precipitation: { tick: 2, major: 5 },
  temperature: { tick: 1, major: 5 },
  starCount: { tick: 50, major: 5 },
}

// The value large in the middle, set on a tape like the hour.
function ParamTape({
  param,
  params,
  onChange,
}: {
  param: Tool
  params: SkyParams
  onChange: Change
}) {
  const spec = PARAM_SPECS[param]
  const { tick, major } = TAPES[param]
  const value = params[param]
  return (
    <div className="flex flex-col gap-1">
      <output
        aria-hidden
        className="text-center text-2xl leading-8 font-medium tabular-nums"
      >
        {value}
        {spec.unit && (
          <span className="ml-1 text-sm font-normal text-ink-muted">
            {spec.unit}
          </span>
        )}
      </output>
      <Tape
        value={value}
        onChange={(v) => onChange({ [param]: v })}
        min={spec.min}
        max={spec.max}
        step={spec.step}
        tick={tick}
        major={major}
        pxPerTick={8}
        formatTick={String}
        keyStep={spec.step}
        pageStep={tick * major}
        label={spec.label}
        valueText={`${value} ${spec.unit}`.trim()}
        className="rounded-lg"
      />
    </div>
  )
}

function CloudPanel({ params, onChange }: PanelProps) {
  const amounts = cloudAmounts(params, computeAtmosphere(params))
  const present = CLOUD_KIND_IDS.filter((k) => amounts[k] >= 0.1)
  return (
    <div className="flex flex-col gap-3">
      <ParamTape param="cloudCover" params={params} onChange={onChange} />
      {present.length === 0 ? (
        <p className="text-xs text-ink-muted">Clear sky</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {present.map((k) => (
            <li key={k} className="text-xs text-ink-muted">
              <span className="font-medium text-ink">
                {CLOUD_KINDS[k].name}
              </span>{' '}
              — {CLOUD_KINDS[k].description}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function PrecipitationPanel({ params, onChange }: PanelProps) {
  return (
    <div className="flex flex-col gap-3">
      <ParamTape param="precipitation" params={params} onChange={onChange} />
      <p className="text-xs text-ink-muted">
        {params.precipitation === 0
          ? 'No precipitation'
          : params.temperature < 1
            ? 'Snow (below 1 °C)'
            : 'Rain'}
      </p>
    </div>
  )
}

type PanelProps = { params: SkyParams; onChange: Change }

function PanelContent({
  id,
  onEffect,
  ...props
}: PanelProps & { id: PanelId; onEffect: (kind: EffectKind) => void }) {
  switch (id) {
    case 'effects':
      return <EffectsPanel onEffect={onEffect} />
    case 'cloudCover':
      return <CloudPanel {...props} />
    case 'precipitation':
      return <PrecipitationPanel {...props} />
    case 'moon':
      return (
        <MoonPhasePicker
          phase={props.params.moonPhase}
          onChange={(moonPhase) => props.onChange({ moonPhase })}
        />
      )
    default:
      return <ParamTape param={id} {...props} />
  }
}

type Props = PanelProps & {
  panel: PanelId | null
  onPanel: (panel: PanelId | null) => void
  onEffect: (kind: EffectKind) => void
}

const PANEL_TITLES = { moon: 'Moon phase', effects: 'Effects' }

export function SettingsDock({
  params,
  onChange,
  panel,
  onPanel,
  onEffect,
}: Props) {
  useEffect(() => {
    if (!panel) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onPanel(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panel, onPanel])

  return (
    // A rail on the right edge, like a design tool's inspector; panels open
    // beside it so the middle of the sky stays clear.
    <div className="relative">
      <nav
        aria-label="Sky settings"
        className="flex flex-col gap-1 rounded-xl border border-line bg-panel/90 p-1 text-ink shadow-xl shadow-black/40 backdrop-blur-md"
      >
        {TOOLS.map((id) => {
          const open = panel === id
          const label = PARAM_SPECS[id].label
          return (
            <button
              key={id}
              type="button"
              title={withKey(label, id)}
              aria-keyshortcuts={keyName(id)}
              aria-label={`${label}: ${toolValue(id, params)}`}
              aria-expanded={open}
              aria-controls={open ? 'settings-panel' : undefined}
              onClick={() => onPanel(open ? null : id)}
              className={RAIL_BUTTON}
            >
              <svg viewBox="0 0 24 24" aria-hidden className={ICON}>
                {ICONS[id]}
              </svg>
              <span aria-hidden className={RAIL_CHIP}>
                {toolValue(id, params)}
              </span>
            </button>
          )
        })}
        <span aria-hidden className="mx-2 my-0.5 h-px bg-line" />
        <button
          type="button"
          title={withKey('Effects', 'effects')}
          aria-keyshortcuts={keyName('effects')}
          aria-label="Effects"
          aria-expanded={panel === 'effects'}
          aria-controls={panel === 'effects' ? 'settings-panel' : undefined}
          onClick={() => onPanel(panel === 'effects' ? null : 'effects')}
          className={RAIL_BUTTON}
        >
          <svg viewBox="0 0 24 24" aria-hidden className={ICON}>
            {SPARKLES}
          </svg>
          <span aria-hidden className={RAIL_CHIP}>
            Effects
          </span>
        </button>
      </nav>
      {panel && (
        <section
          id="settings-panel"
          aria-labelledby="settings-panel-title"
          // On phones it starts below the place, which shares the top row.
          className="absolute top-0 right-full mr-2 w-[min(20rem,calc(100vw-6rem))] rounded-xl border border-line bg-panel/95 p-3 text-ink shadow-xl shadow-black/40 backdrop-blur-md max-sm:top-15"
        >
          <h2
            id="settings-panel-title"
            className="mb-3 text-[11px] font-medium text-ink"
          >
            {panel === 'moon' || panel === 'effects'
              ? PANEL_TITLES[panel]
              : PARAM_SPECS[panel].label}
          </h2>
          <PanelContent
            id={panel}
            params={params}
            onChange={onChange}
            onEffect={onEffect}
          />
        </section>
      )}
    </div>
  )
}
