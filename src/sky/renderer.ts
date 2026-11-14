import {
  computeAtmosphere,
  MAX_SKY_ELEVATION,
  type RGB,
  mixRGB,
  rgba,
  skyStops,
  smoothstep,
  type Atmosphere,
} from './atmosphere'
import { SkyCamera, type Vec3 } from './camera'
import { cloudAmounts, CloudLayer } from './clouds'
import { type EffectKind, SkyEffects } from './effects'
import { MOON_NEUTRAL_TINT, MoonDisc, moonIllumination } from './moon'
import type { SkyParams } from './params'

// Drops and flakes in camera space: x, y across the view (y down), z the
// distance along the line of sight.
type Particle = {
  x: number
  y: number
  z: number
  speed: number
  size: number
  phase: number
}

type Star = { x: number; y: number; size: number; phase: number; rate: number }

type Moon = {
  direction: Vec3
  x: number
  y: number
  radius: number // CSS pixels
  elevation: number
  visibility: number
  light: number // strength of its glow, same scale as the sun's
}

const PARTICLE_FAR = 4
const PARTICLE_NEAR = 0.15
// Share of the horizontal field of view the sun and moon cross in a day.
const SKY_PATH_SPREAD = 0.85
// Share of the view height the path climbs at its peak.
const SKY_PATH_HEIGHT = 0.58
// The real moon spans 0.52°, a few pixels here: it is enlarged a little so
// its face reads, but kept small, as the eye sees it, rather than the large
// disc of a long-lens photo, which looks pasted on a wide sky.
const MOON_RADIUS = 0.02 // of the view height
const MOON_GLOW = 0.3 // full-moon glow relative to the sun's
const MOON_LIGHT: RGB = [215, 222, 240]

export class SkyRenderer {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private params: SkyParams | null = null
  private width = 0
  private height = 0
  private readonly clouds = new CloudLayer()
  private readonly moon = new MoonDisc()
  private readonly effects = new SkyEffects()
  private readonly camera = new SkyCamera()
  private dpr = 1
  private particles: Particle[] = []
  private stars: Star[] = []
  private frameId = 0
  // Where the moon was last drawn, for hit testing.
  private lastMoon: Moon | null = null
  private lastTime = 0
  private time = 0

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
  }

  setParams(params: SkyParams) {
    // Grow or shrink the star field so existing stars stay in place.
    while (this.stars.length < params.starCount) {
      this.stars.push({
        x: Math.random(),
        y: Math.random(),
        size: 0.5 + Math.random() ** 3 * 1.6,
        phase: Math.random() * Math.PI * 2,
        rate: 0.5 + Math.random() * 3,
      })
    }
    this.stars.length = params.starCount
    this.params = params
  }

  // Sends something across the sky once.
  spawn(kind: EffectKind) {
    this.effects.spawn(kind, this.params?.windSpeed ?? 0, this.camera)
  }

  // Whether a point in CSS pixels falls on the moon, with some slack so a
  // thin crescent or a small disc stays easy to hit.
  moonAt(x: number, y: number) {
    const m = this.lastMoon
    return (
      m !== null && Math.hypot(x - m.x, y - m.y) < Math.max(m.radius * 1.4, 22)
    )
  }

  // False when the clouds cannot be drawn (no WebGL2).
  get hasClouds() {
    return this.clouds.supported
  }

  // The sky as last drawn, at full resolution.
  snapshot() {
    return new Promise<Blob>((resolve, reject) =>
      this.canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Empty capture'))),
        'image/png',
      ),
    )
  }

  resize(width: number, height: number) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.dpr = dpr
    this.width = width
    this.height = height
    this.canvas.width = Math.round(width * dpr)
    this.canvas.height = Math.round(height * dpr)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.clouds.resize(width, height)
    this.camera.resize(width, height)
  }

  start() {
    this.lastTime = performance.now()
    this.frameId = requestAnimationFrame(this.frame)
  }

  stop() {
    cancelAnimationFrame(this.frameId)
  }

  private frame = (now: number) => {
    const dt = Math.min((now - this.lastTime) / 1000, 0.05)
    this.lastTime = now
    this.time += dt
    if (this.params && this.width > 0 && this.height > 0) {
      const atm = computeAtmosphere(this.params)
      this.clouds.update(
        dt,
        cloudAmounts(this.params, atm),
        smoothstep(55, 100, atm.effectiveCover),
        this.params.windSpeed,
      )
      this.updateParticles(dt, atm, this.params)
      this.effects.update(dt, this.camera)
      this.draw(atm)
    }
    this.frameId = requestAnimationFrame(this.frame)
  }

  // Half-width of the view at distance z, in camera-space units.
  private viewExtent(z: number) {
    const f = this.focal()
    return { x: ((this.width / 2) * z) / f, y: ((this.height / 2) * z) / f }
  }

  private focal() {
    return Math.min(this.width, this.height) * 0.5
  }

  private spawnParticle(p: Particle) {
    p.z = PARTICLE_NEAR + Math.random() * (PARTICLE_FAR - PARTICLE_NEAR)
    const e = this.viewExtent(p.z)
    p.x = (Math.random() * 2 - 1) * e.x * 1.1
    p.y = (Math.random() * 2 - 1) * e.y * 1.1
  }

  private updateParticles(dt: number, atm: Atmosphere, params: SkyParams) {
    const { width, height, particles } = this
    const target = Math.round(
      (params.precipitation / 100) * Math.min(1500, (width * height) / 1200),
    )
    while (particles.length < target) {
      const p: Particle = {
        x: 0,
        y: 0,
        z: 0,
        speed: 0.7 + Math.random() * 0.6,
        size: 0.6 + Math.random(),
        phase: Math.random() * Math.PI * 2,
      }
      this.spawnParticle(p)
      particles.push(p)
    }
    particles.length = target

    for (const p of particles) {
      const v = this.particleVelocity(p, atm.snow, params.windSpeed)
      p.x += v.x * dt
      p.y += v.y * dt
      const e = this.viewExtent(p.z)
      // Fallen out of view: start again above the top edge.
      if (p.y > e.y * 1.2 || Math.abs(p.x) > e.x * 1.3) {
        this.spawnParticle(p)
        p.y = -this.viewExtent(p.z).y * 1.2
      }
    }
  }

  private particleVelocity(p: Particle, snow: boolean, wind: number) {
    return snow
      ? {
          x:
            wind * 0.004 * p.speed + Math.sin(this.time * 1.5 + p.phase) * 0.05,
          y: 0.35 * p.speed,
        }
      : { x: wind * 0.03, y: 5 * p.speed }
  }

  private project(x: number, y: number, z: number) {
    const f = this.focal()
    return { x: this.width / 2 + (x / z) * f, y: this.height / 2 + (y / z) * f }
  }

  // Unit direction of a body on its daily path, crossing the view from east
  // on the left (progress 0) to west (1). The path is laid out on screen as
  // half an ellipse resting on the horizon, its height following the
  // elevation, then cast back into the sky: the perspective would otherwise
  // flatten its top into a plateau.
  private skyDirection(elevation: number, progress: number) {
    const u = 0.5 - 0.5 * SKY_PATH_SPREAD * Math.cos(Math.PI * progress)
    const v = 1 - SKY_PATH_HEIGHT * (elevation / MAX_SKY_ELEVATION)
    return this.camera.ray(u, v)
  }

  private moonState(atm: Atmosphere, phase: number): Moon | null {
    const q = atm.nightProgress
    if (q === 0) return null
    const elevation = MAX_SKY_ELEVATION * Math.sin(Math.PI * q)
    const direction = this.skyDirection(elevation, q)
    const visibility = smoothstep(-1, 2, elevation) * (1 - atm.overcast * 0.8)
    if (visibility < 0.01) return null
    return {
      direction,
      ...this.camera.project(direction),
      radius: Math.max(9, this.height * MOON_RADIUS),
      elevation,
      visibility,
      // Brightness falls faster than the lit area: shadows of the relief
      // spread as the phase thins.
      light: visibility * MOON_GLOW * moonIllumination(phase) ** 1.5,
    }
  }

  private sunVisibility(atm: Atmosphere) {
    return smoothstep(-4, 1, atm.sunElevation) * (1 - atm.overcast * 0.85)
  }

  // Gradient from the top of the view (0) down to the horizon (1).
  private vertical(stops: [number, string][]) {
    const g = this.ctx.createLinearGradient(0, 0, 0, this.height)
    for (const [t, c] of stops) g.addColorStop(t, c)
    return g
  }

  private draw(atm: Atmosphere) {
    const { ctx, width: w, height: h } = this
    const moon = this.moonState(atm, this.params!.moonPhase)
    this.lastMoon = moon

    ctx.fillStyle = this.vertical(
      skyStops(atm).map(([t, c]) => [t, rgba(c)] as [number, string]),
    )
    ctx.fillRect(0, 0, w, h)

    this.drawStars(atm, moon)
    if (moon) this.drawMoon(moon, this.params!.moonPhase)

    // The clouds are lit by the brighter of the sun and moon. Only the sun
    // gets the light pass: moonlight is far too faint to raise glare, an
    // aureole or shafts the eye or a camera would see.
    const sunLight = this.sunVisibility(atm)
    const moonLit = moon !== null && moon.light > sunLight
    const light = moonLit
      ? { color: MOON_LIGHT, direction: moon.direction, strength: moon.light }
      : {
          color: atm.sunColor,
          direction: this.skyDirection(atm.sunElevation, atm.dayProgress),
          strength: sunLight,
        }
    this.effects.drawBehindClouds(ctx, this.camera, atm, light)
    const lightPoint = this.camera.project(light.direction)
    const frame = {
      lit: atm.cloudLit,
      shadow: atm.cloudShadow,
      sun: light.color,
      sunDirection: light.direction,
      sunLight: light.strength,
      sunUV: [lightPoint.x / w, 1 - lightPoint.y / h] as const,
      turbidity: atm.turbidity,
      viewTan: this.camera.tan,
    }
    this.clouds.render(frame)
    ctx.drawImage(this.clouds.canvas, 0, 0, w, h)
    // Sunlight goes over the clouds, which shadow it, and under the haze,
    // which dims it near the horizon.
    if (
      !moonLit &&
      frame.sunLight > 0.01 &&
      this.clouds.renderSunlight(frame)
    ) {
      ctx.globalCompositeOperation = 'lighter'
      ctx.drawImage(this.clouds.canvas, 0, 0, w, h)
      ctx.globalCompositeOperation = 'source-over'
    }

    this.effects.drawInFrontOfClouds(ctx, this.camera, atm, light)

    // Haze thickens toward the horizon at the edges of the view.
    ctx.fillStyle = this.vertical([
      [0.55, rgba(atm.haze, 0)],
      [1, rgba(atm.haze, atm.hazeStrength)],
    ])
    ctx.fillRect(0, 0, w, h)

    this.drawPrecipitation(atm)
  }

  private drawStars(atm: Atmosphere, moon: Moon | null) {
    const visibility = atm.starVisibility * (1 - atm.overcast * 0.85)
    if (visibility < 0.01) return
    const { ctx, width: w, height: h } = this
    ctx.fillStyle = '#fff'
    for (const s of this.stars) {
      const x = s.x * w
      const y = s.y * h
      // Hidden behind the moon, whose dark side would otherwise show them.
      if (moon && Math.hypot(x - moon.x, y - moon.y) < moon.radius + 1) continue
      // Extinction dims stars low over the horizon.
      const low = s.y
      const twinkle = 0.55 + 0.45 * Math.sin(this.time * s.rate + s.phase)
      ctx.globalAlpha = visibility * twinkle * (1 - low * 0.6)
      ctx.fillRect(x, y, s.size, s.size)
    }
    ctx.globalAlpha = 1
  }

  private drawMoon(moon: Moon, phase: number) {
    // Reddened by the long path through the air when low.
    const warm = Math.round(smoothstep(0, 25, moon.elevation) * 20) / 20
    const tint = mixRGB([1, 0.72, 0.5], MOON_NEUTRAL_TINT, warm)
    if (!this.moon.update(moon.radius * this.dpr, phase, tint)) return
    const { ctx } = this
    const size = this.moon.canvas.width / this.dpr
    ctx.globalCompositeOperation = 'lighter'

    ctx.globalAlpha = moon.visibility
    ctx.drawImage(
      this.moon.canvas,
      moon.x - size / 2,
      moon.y - size / 2,
      size,
      size,
    )
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }

  private drawPrecipitation(atm: Atmosphere) {
    if (this.particles.length === 0 || !this.params) return
    const { ctx } = this
    const wind = this.params.windSpeed
    ctx.beginPath()
    if (atm.snow) {
      for (const p of this.particles) {
        const { x, y } = this.project(p.x, p.y, p.z)
        // Nearer flakes look bigger.
        const r = (p.size * 1.2) / p.z
        ctx.moveTo(x + r, y)
        ctx.arc(x, y, r, 0, Math.PI * 2)
      }
      ctx.fillStyle = rgba(
        mixRGB([120, 128, 145], [250, 252, 255], atm.daylight),
        0.85,
      )
      ctx.fill()
    } else {
      // Each drop streaks along its fall during one exposure.
      for (const p of this.particles) {
        const v = this.particleVelocity(p, false, wind)
        const t = 0.012 * p.size
        const a = this.project(p.x - v.x * t, p.y - v.y * t, p.z)
        const b = this.project(p.x, p.y, p.z)
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
      }
      ctx.strokeStyle = rgba(
        mixRGB([80, 90, 110], [200, 210, 225], atm.daylight),
        0.45,
      )
      ctx.lineWidth = 1
      ctx.stroke()
    }
  }
}
