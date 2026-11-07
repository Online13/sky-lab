export type Weather = {
  cloudCover: number // %
  windSpeed: number // km/h
  precipitation: number // %
  temperature: number // °C
}

export type SkyParams = Weather & {
  hour: number // 0–24, fractional
  moonPhase: number // 0 new, 0.5 full, 1 new again
  starCount: number
}

export type NumericParam = keyof SkyParams

export const PARAM_SPECS: Record<
  NumericParam,
  { label: string; min: number; max: number; step: number; unit: string }
> = {
  hour: { label: 'Time', min: 0, max: 24, step: 0.05, unit: '' },
  cloudCover: { label: 'Clouds', min: 0, max: 100, step: 1, unit: '%' },
  windSpeed: { label: 'Wind', min: 0, max: 120, step: 1, unit: 'km/h' },
  precipitation: {
    label: 'Precipitation',
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
  },
  temperature: { label: 'Temperature', min: -40, max: 50, step: 1, unit: '°C' },
  moonPhase: { label: 'Moon', min: 0, max: 1, step: 0.01, unit: '' },
  starCount: { label: 'Stars', min: 0, max: 3000, step: 50, unit: '' },
}

// Current time of day on the device, in hours, to the minute.
export function currentHour() {
  const now = new Date()
  return now.getHours() + now.getMinutes() / 60
}

export const DEFAULT_PARAMS: SkyParams = {
  hour: currentHour(),
  cloudCover: 55,
  windSpeed: 15,
  precipitation: 10,
  temperature: 16,
  moonPhase: 0.4,
  starCount: 1200,
}

// A sky can be shared as a link: each setting is a query parameter.
const URL_KEYS: Record<NumericParam, string> = {
  hour: 'time',
  cloudCover: 'clouds',
  windSpeed: 'wind',
  precipitation: 'rain',
  temperature: 'temp',
  moonPhase: 'moon',
  starCount: 'stars',
}

const PARAM_IDS = Object.keys(URL_KEYS) as NumericParam[]

// The settings a query string holds. Missing, malformed or out-of-range
// values are left out or clamped, so any link still opens a valid sky.
export function paramsFromSearch(search: string): Partial<SkyParams> {
  const query = new URLSearchParams(search)
  const params: Partial<SkyParams> = {}
  for (const id of PARAM_IDS) {
    const raw = query.get(URL_KEYS[id])
    if (raw === null || raw.trim() === '') continue
    const value = Number(raw)
    if (!Number.isFinite(value)) continue
    const { min, max } = PARAM_SPECS[id]
    params[id] =
      id === 'hour'
        ? ((value % 24) + 24) % 24
        : Math.min(max, Math.max(min, value))
  }
  return params
}

// A link to this page that opens on these exact settings.
export function shareURL(params: SkyParams) {
  const url = new URL(window.location.pathname, window.location.origin)
  for (const id of PARAM_IDS) {
    const decimals = id === 'hour' || id === 'moonPhase' ? 2 : 0
    url.searchParams.set(URL_KEYS[id], String(+params[id].toFixed(decimals)))
  }
  return url.toString()
}
