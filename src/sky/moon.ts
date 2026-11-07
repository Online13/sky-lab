import { clamp } from './atmosphere'

// Lunar albedo map from NASA's CGI Moon Kit (LRO / LROC, public domain),
// equirectangular with longitude 0 (the centre of the near side) in the middle.
const ALBEDO_URL = `${import.meta.env.BASE_URL}moon.jpg`
// Brings the bright highlands of the map close to white at full moon.
const ALBEDO_GAIN = 1.5
// How much of the map's relief and maria shows: 1 the photo as is, 0 a
// plain disc. To the naked eye the maria are soft shades, not a picture.
const TEXTURE_CONTRAST = 0.3
// Earth's light on the night side, strongest around new moon.
const EARTHSHINE = 0.05
const EARTHSHINE_TINT = [0.8, 0.9, 1.1] as const
// Width of the limb's fade, in device pixels.
const LIMB_SOFTNESS = 2
// Width of the filtered map, all longitudes: about 20 texels across the face,
// enough for the shapes of the maria but not for craters, which the naked
// eye never sees.
const ALBEDO_WIDTH = 40
// Samples per pixel along each axis.
const SUBSAMPLES = 4

// Phase: 0 new moon, 0.25 first quarter, 0.5 full, 0.75 last quarter.
export const moonIllumination = (phase: number) =>
  (1 - Math.cos(2 * Math.PI * phase)) / 2

export function moonPhaseName(phase: number) {
  const p = ((phase % 1) + 1) % 1
  if (p < 0.03 || p > 0.97) return 'New moon'
  if (p < 0.22) return 'Waxing crescent'
  if (p < 0.28) return 'First quarter'
  if (p < 0.47) return 'Waxing gibbous'
  if (p < 0.53) return 'Full moon'
  if (p < 0.72) return 'Waning gibbous'
  if (p < 0.78) return 'Last quarter'
  return 'Waning crescent'
}

// Loaded and filtered once, shared by the sky and the phase picker.
let albedoPromise: Promise<ImageData> | null = null

function loadAlbedo() {
  albedoPromise ??= new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Moon texture failed to load'))
    image.src = ALBEDO_URL
  }).then(albedoFor)
  return albedoPromise
}

// The map filtered down to its broad shades; the bilinear lookup then
// smooths it over the disc.
function albedoFor(image: HTMLImageElement) {
  const width = Math.min(image.width, ALBEDO_WIDTH)
  const height = Math.round((width * image.height) / image.width)
  // Halved step by step: one large reduction averages too few texels.
  let source: CanvasImageSource = image
  let w = image.width
  let h = image.height
  while (w / 2 >= width) {
    w = Math.round(w / 2)
    h = Math.round(h / 2)
    source = scaled(source, w, h)
  }
  const ctx = scaled(source, width, height).getContext('2d', {
    willReadFrequently: true,
  })!
  const albedo = ctx.getImageData(0, 0, width, height)
  softenContrast(albedo.data)
  return albedo
}

// Pulls every texel toward the map's mean brightness.
function softenContrast(data: Uint8ClampedArray) {
  let sum = 0
  for (let i = 0; i < data.length; i += 4)
    sum += data[i] + data[i + 1] + data[i + 2]
  const mean = sum / ((data.length / 4) * 3)
  for (let i = 0; i < data.length; i += 4)
    for (let c = 0; c < 3; c++)
      data[i + c] = mean + (data[i + c] - mean) * TEXTURE_CONTRAST
}

function scaled(source: CanvasImageSource, width: number, height: number) {
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, width, height)
  return c
}

// Moonlight high in a dark sky, without the reddening near the horizon.
export const MOON_NEUTRAL_TINT = [1, 0.97, 0.92] as const

// One image per phase, as data URLs, for the phase picker. Rendered once,
// one disc per task so the sky keeps animating meanwhile.
const phaseImages = new Map<string, Promise<string[]>>()

export function moonPhaseImages(phases: readonly number[], radius: number) {
  const key = `${phases}|${radius}`
  let images = phaseImages.get(key)
  if (!images) {
    images = renderPhaseImages(phases, radius)
    phaseImages.set(key, images)
  }
  return images
}

async function renderPhaseImages(phases: readonly number[], radius: number) {
  const albedo = await loadAlbedo()
  const canvas = document.createElement('canvas')
  const urls: string[] = []
  for (const phase of phases) {
    await new Promise((resolve) => setTimeout(resolve))
    renderDisc(canvas, albedo, radius, phase, MOON_NEUTRAL_TINT)
    urls.push(canvas.toDataURL())
  }
  return urls
}

// The visible face of the Moon rendered as a sprite to be composited with
// 'lighter': the atmosphere in front adds its own light, so the night side
// vanishes into a bright twilight sky but shows its earthshine on a dark one.
// Re-rendered only when its size, phase or tint change.
export class MoonDisc {
  readonly canvas = document.createElement('canvas')
  private albedo: ImageData | null = null
  private key = ''

  constructor() {
    loadAlbedo().then(
      (albedo) => (this.albedo = albedo),
      (error: Error) => console.warn(error.message),
    )
  }

  // Radius in device pixels; tint is the light reaching us (0–1 per channel).
  // False until the texture has loaded.
  update(
    radius: number,
    phase: number,
    tint: readonly [number, number, number],
  ) {
    if (!this.albedo) return false
    const key = `${radius.toFixed(1)}|${phase.toFixed(3)}|${tint.map((t) => t.toFixed(2))}`
    if (key === this.key) return true
    this.key = key
    renderDisc(this.canvas, this.albedo, radius, phase, tint)
    return true
  }
}

function renderDisc(
  canvas: HTMLCanvasElement,
  albedo: ImageData,
  radius: number,
  phase: number,
  tint: readonly [number, number, number],
) {
  const size = Math.ceil(radius * 2 + LIMB_SOFTNESS) + 2
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const out = ctx.createImageData(size, size)
  const centre = size / 2
  // Direction of the sunlight in the Moon's view frame (x right, y up, z
  // toward us): behind the Moon at new moon, behind us at full moon, from
  // the right while waxing.
  const angle = 2 * Math.PI * phase
  const lx = Math.sin(angle)
  const lz = -Math.cos(angle)
  const earthshine = EARTHSHINE * (1 - moonIllumination(phase)) ** 2
  const n = SUBSAMPLES
  const colour = [0, 0, 0]

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const r = Math.hypot(px + 0.5 - centre, centre - py - 0.5) / radius
      // Limb softened over about two pixels, as the air's turbulence blurs
      // it; a one-pixel edge reads as a cut-out pasted on the sky.
      const coverage = clamp(((1 - r) * radius) / LIMB_SOFTNESS + 0.5)
      if (coverage <= 0) continue

      // Averaged over a grid of points inside the pixel, so the texture,
      // the limb and the terminator stay smooth instead of stair-stepped.
      colour.fill(0)
      for (let sy = 0; sy < n; sy++) {
        for (let sx = 0; sx < n; sx++) {
          const x = (px + (sx + 0.5) / n - centre) / radius
          const y = (centre - py - (sy + 0.5) / n) / radius
          const rs = Math.hypot(x, y)
          const k = rs > 1 ? 1 / rs : 1
          const nx = x * k
          const ny = y * k
          const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny))

          const a = sampleAlbedo(
            albedo,
            0.5 + Math.atan2(nx, nz) / (2 * Math.PI),
            0.5 - Math.asin(ny) / Math.PI,
          )
          // Lommel-Seeliger: the regolith scatters light back almost evenly,
          // so a full moon looks flat rather than shaded like a ball.
          const mu0 = Math.max(0, nx * lx + nz * lz)
          // Capped at full-moon brightness, and faded slightly toward the
          // limb: left alone, Lommel-Seeliger lights the sunward edge as a
          // bright rim.
          const sun =
            mu0 > 0
              ? Math.min(1, (2 * mu0) / (mu0 + nz + 1e-4)) *
                (0.8 + 0.2 * Math.sqrt(nz))
              : 0
          for (let c = 0; c < 3; c++) {
            const light = sun * tint[c] + earthshine * EARTHSHINE_TINT[c]
            colour[c] += rolloff(a[c] * ALBEDO_GAIN * light)
          }
        }
      }

      const i = (py * size + px) * 4
      for (let c = 0; c < 3; c++) {
        // Premultiplied by coverage for the 'lighter' composite.
        out.data[i + c] = (colour[c] / (n * n)) * coverage * 255
      }
      out.data[i + 3] = coverage * 255
    }
  }
  ctx.putImageData(out, 0, 0)
}

// Linear up to 0.8, then eases into white so bright highlands keep detail.
function rolloff(v: number) {
  if (v <= 0.8) return v
  return 0.8 + 0.2 * (1 - Math.exp(-(v - 0.8) / 0.2))
}

// Bilinear lookup, wrapping in longitude. Returns linear-ish 0–1 albedo.
function sampleAlbedo(
  { data, width, height }: ImageData,
  u: number,
  v: number,
) {
  const fx = u * width - 0.5
  const fy = clamp(v * height - 0.5, 0, height - 1)
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const tx = fx - x0
  const ty = fy - y0
  const y1 = Math.min(y0 + 1, height - 1)
  const wrap = (x: number) => ((x % width) + width) % width
  const i00 = (y0 * width + wrap(x0)) * 4
  const i10 = (y0 * width + wrap(x0 + 1)) * 4
  const i01 = (y1 * width + wrap(x0)) * 4
  const i11 = (y1 * width + wrap(x0 + 1)) * 4
  const out: [number, number, number] = [0, 0, 0]
  for (let c = 0; c < 3; c++) {
    const top = data[i00 + c] + (data[i10 + c] - data[i00 + c]) * tx
    const bottom = data[i01 + c] + (data[i11 + c] - data[i01 + c]) * tx
    out[c] = (top + (bottom - top) * ty) / 255
  }
  return out
}
