import type { SkyParams } from './params'

export type RGB = readonly [number, number, number]

export const clamp = (v: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, v))

export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}

export const mixRGB = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
]

export const scaleRGB = (c: RGB, k: number): RGB => [
  c[0] * k,
  c[1] * k,
  c[2] * k,
]

export const rgba = (c: RGB, a = 1) =>
  `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`

// Peak of the sun and moon arcs. Kept low so the path, which crosses most of
// the width, reads as a flat ellipse rather than a tall dome.
export const MAX_SKY_ELEVATION = 35
const MAX_SUN_DEPTH = 40

type Keyframes<T extends Record<string, RGB>> = {
  elevation: number
  colors: T
}[]

function atElevation<T extends Record<string, RGB>>(
  keys: Keyframes<T>,
  elevation: number,
): T {
  if (elevation <= keys[0].elevation) return keys[0].colors
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i]
    if (elevation <= b.elevation) {
      const a = keys[i - 1]
      const t = (elevation - a.elevation) / (b.elevation - a.elevation)
      const out: Record<string, RGB> = {}
      for (const k in a.colors) out[k] = mixRGB(a.colors[k], b.colors[k], t)
      return out as T
    }
  }
  return keys[keys.length - 1].colors
}

// Clear-sky colors by sun elevation (degrees). Daytime blues come from the
// Ghibli reference painting (deep cerulean fading to a pale horizon), the blue
// hour (-6°) from the lavender one.
const SKY_KEYS: Keyframes<{ zenith: RGB; horizon: RGB }> = [
  { elevation: -18, colors: { zenith: [2, 4, 16], horizon: [8, 12, 34] } },
  { elevation: -12, colors: { zenith: [30, 30, 62], horizon: [52, 50, 88] } },
  {
    elevation: -6,
    colors: { zenith: [104, 98, 138], horizon: [128, 118, 152] },
  },
  { elevation: 0, colors: { zenith: [28, 70, 160], horizon: [246, 150, 116] } },
  { elevation: 6, colors: { zenith: [22, 92, 182], horizon: [236, 196, 170] } },
  {
    elevation: 20,
    colors: { zenith: [14, 98, 182], horizon: [112, 182, 230] },
  },
  {
    elevation: 60,
    colors: { zenith: [10, 92, 178], horizon: [104, 178, 228] },
  },
]

// Cloud tones seen from below: thin lit cloud and thick blue-grey bases.
const CLOUD_KEYS: Keyframes<{ lit: RGB; shadow: RGB }> = [
  {
    elevation: -18,
    colors: { lit: [62, 66, 98], shadow: [32, 38, 66] },
  },
  {
    elevation: -6,
    colors: {
      lit: [196, 196, 212],
      shadow: [86, 94, 130],
    },
  },
  {
    elevation: 0,
    colors: {
      lit: [255, 206, 176],
      shadow: [128, 100, 150],
    },
  },
  {
    elevation: 8,
    colors: {
      lit: [255, 240, 224],
      shadow: [148, 150, 196],
    },
  },
  {
    elevation: 20,
    colors: {
      lit: [255, 255, 252],
      shadow: [160, 180, 214],
    },
  },
]

// The sky belongs to no place: an even day of a temperate spring, under a
// light haze.
const SUNRISE = 7
const SUNSET = 19.5
const HAZE: RGB = [200, 205, 215]
const HAZE_STRENGTH = 0.12

// Simplified sun path: a sine arc between sunrise and sunset, mirrored below
// the horizon during the night.
function solarPosition(hour: number, sunrise: number, sunset: number) {
  const dayLength = sunset - sunrise
  if (hour >= sunrise && hour <= sunset) {
    const p = (hour - sunrise) / dayLength
    return {
      elevation: Math.sin(Math.PI * p) * MAX_SKY_ELEVATION,
      dayProgress: p,
      nightProgress: 0,
    }
  }
  const q = ((hour - sunset + 24) % 24) / (24 - dayLength)
  return {
    elevation: -Math.sin(Math.PI * q) * MAX_SUN_DEPTH,
    dayProgress: hour < sunrise ? 0 : 1,
    nightProgress: q,
  }
}

export type Atmosphere = {
  sunElevation: number
  dayProgress: number // 0 at sunrise → 1 at sunset
  nightProgress: number // 0 at sunset → 1 at sunrise
  daylight: number // 0 night → 1 full day
  starVisibility: number
  heat: number // 0 → 1 above ~22 °C
  overcast: number // how much the sky turns grey
  effectiveCover: number // % of sky covered, rain implies clouds
  zenith: RGB
  horizon: RGB
  sunColor: RGB
  cloudLit: RGB
  cloudShadow: RGB
  haze: RGB
  hazeStrength: number
  turbidity: number // aerosols and humidity scattering sunlight forward
  snow: boolean
}

export function computeAtmosphere(params: SkyParams): Atmosphere {
  const { cloudCover, precipitation, temperature } = params
  const sun = solarPosition(params.hour, SUNRISE, SUNSET)
  const elev = sun.elevation

  const daylight = smoothstep(-8, 10, elev)
  const starVisibility = 1 - smoothstep(-14, -3, elev)
  const heat = clamp((temperature - 22) / 22)
  const cold = clamp(-temperature / 30)
  const rain = precipitation / 100

  const effectiveCover = Math.max(cloudCover, precipitation * 0.9)
  const overcast = clamp((effectiveCover / 100) * 0.6 + rain * 0.6)

  let { zenith, horizon } = atElevation(SKY_KEYS, elev)

  // Heat whitens the horizon, cold deepens the zenith.
  horizon = mixRGB(
    horizon,
    scaleRGB([240, 222, 190], 0.3 + 0.7 * daylight),
    heat * 0.35 * daylight,
  )
  zenith = scaleRGB(zenith, 1 - cold * 0.15 * daylight)

  const grey = scaleRGB(
    mixRGB([12, 14, 30], [140, 146, 190], daylight),
    1 - rain * 0.4,
  )
  zenith = mixRGB(zenith, scaleRGB(grey, 0.88), overcast)
  horizon = mixRGB(horizon, grey, overcast)

  const sunColor = mixRGB(
    [255, 140, 60],
    [255, 248, 230],
    smoothstep(0, 25, elev),
  )

  // Rain turns clouds into darker, desaturated grey-blue masses.
  const storm = (c: RGB) =>
    scaleRGB(mixRGB(c, [128, 132, 160], rain * 0.7), 1 - rain * 0.5)
  const clouds = atElevation(CLOUD_KEYS, elev)
  const cloudLit = storm(clouds.lit)
  const cloudShadow = storm(clouds.shadow)

  const haze = mixRGB(scaleRGB(HAZE, 0.12), HAZE, daylight)

  return {
    sunElevation: elev,
    dayProgress: sun.dayProgress,
    nightProgress: sun.nightProgress,
    daylight,
    starVisibility,
    heat,
    overcast,
    effectiveCover,
    zenith,
    horizon,
    sunColor,
    cloudLit,
    cloudShadow,
    haze,
    hazeStrength: clamp(HAZE_STRENGTH + rain * 0.3),
    // Dust, humidity and heat thicken the aureole; a low sun looks through
    // more air.
    turbidity: clamp(
      0.25 +
        HAZE_STRENGTH * 1.5 +
        rain * 0.5 +
        heat * 0.25 +
        (1 - smoothstep(0, 15, elev)) * 0.3,
      0,
      1.2,
    ),
    snow: temperature < 1,
  }
}

// Clear-sky gradient from the top of the view (0) down to the horizon (1).
export function skyStops(atm: Atmosphere): [number, RGB][] {
  return [
    [0, atm.zenith],
    [0.6, mixRGB(atm.zenith, atm.horizon, 0.4)],
    [1, atm.horizon],
  ]
}

// Sky color at a height on screen, the color of the air in front of anything
// seen there.
export function skyColorAt(atm: Atmosphere, t: number): RGB {
  const stops = skyStops(atm)
  t = clamp(t)
  for (let i = 1; i < stops.length; i++) {
    const [b, cb] = stops[i]
    if (t <= b) {
      const [a, ca] = stops[i - 1]
      return mixRGB(ca, cb, (t - a) / (b - a))
    }
  }
  return stops[stops.length - 1][1]
}
