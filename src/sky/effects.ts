import {
  type Atmosphere,
  mixRGB,
  type RGB,
  rgba,
  scaleRGB,
  skyColorAt,
  smoothstep,
} from './atmosphere'
import {
  add,
  cross,
  dot,
  normalize,
  scale,
  type ScreenPoint,
  type SkyCamera,
  type Vec3,
} from './camera'

// Things that cross the sky once when asked: a plane, a flock of birds, a
// shooting star, a hot-air balloon. Planes, birds and balloons are bodies in
// the world, in metres around the viewer (see camera.ts): the camera gives
// them their perspective, the sun or moon lights them and the air between
// fades them toward the sky. A shooting star is at the edge of space, so it
// is laid out on screen, in shares of the view.

export type EffectKind = 'plane' | 'birds' | 'shootingStar' | 'balloon'

// The light of the brighter body: unit direction toward it, its color, and
// its strength (0 → 1, the sun at full day).
export type Light = { color: RGB; direction: Vec3; strength: number }

type Bird = {
  offset: Vec3 // place in the flock: metres behind, aside and above the leader
  phase: number
  rate: number // wingbeat, rad/s
  size: number
}

// Where the contrail was left, one point behind each engine.
type TrailSample = { at: number; points: Vec3[] }

type Flyer = {
  kind: 'plane' | 'birds' | 'balloon'
  age: number // s
  seed: number
  start: Vec3 // m
  velocity: Vec3 // m/s
  flock: Bird[]
  trail: TrailSample[]
}

type ShootingStar = {
  kind: 'shootingStar'
  age: number
  x: number // start, share of width
  y: number // start, share of height
  dir: 1 | -1
  speed: number // shares of width per second
  climb: number // shares of height per second, down is positive
}

type Effect = Flyer | ShootingStar

const UP: Vec3 = [0, 0, 1]
const SHOOTING_STAR_LIFE = 1.1 // s
const BALLOON_RADIUS = 8.5 // m, envelope
const BALLOON_GORES = 16
const BALLOON_COLORS: [RGB, RGB] = [
  [0.78, 0.2, 0.16],
  [0.92, 0.72, 0.24],
]
const CONTRAIL_LIFE = 30 // s
const CONTRAIL_STEP = 0.2 // s between samples
const PLANE_ENGINES: [number, number][] = [
  [-4, -10],
  [-4, 10],
]

const random = (a: number, b: number) => a + Math.random() * (b - a)

export class SkyEffects {
  private effects: Effect[] = []

  // Wind in km/h, positive toward the right like the rain.
  spawn(kind: EffectKind, wind: number, camera: SkyCamera) {
    const dir = Math.random() < 0.5 ? 1 : -1
    // Enters just past one side, `range` metres along the line of sight.
    const entry = (v: number, range: number, margin: number) =>
      scale(camera.ray(dir > 0 ? -margin : 1 + margin, v), range)
    // Heading across the view, turned a little toward or away from us.
    const heading = (speed: number, yaw: number, climb: number): Vec3 => {
      const a = random(-yaw, yaw)
      return [dir * Math.cos(a) * speed, Math.sin(a) * speed, climb]
    }
    const flyer = { kind, age: 0, seed: Math.random(), flock: [], trail: [] }
    switch (kind) {
      case 'plane':
        // A few kilometres up, crossing in under a minute.
        this.effects.push({
          ...flyer,
          kind,
          start: entry(random(0.12, 0.45), random(3500, 6000), 0.08),
          velocity: heading(random(200, 240), 0.5, random(-4, 6)),
        })
        break
      case 'birds':
        // Geese in a V, low enough to pass in front of the clouds.
        this.effects.push({
          ...flyer,
          kind,
          start: entry(random(0.35, 0.68), random(60, 140), 0.15),
          velocity: heading(random(10, 13), 0.45, random(-0.3, 0.8)),
          flock: makeFlock(),
        })
        break
      case 'shootingStar':
        // Anywhere up high, falling steeply to one side.
        this.effects.push({
          kind,
          age: 0,
          dir,
          x: random(0.2, 0.8),
          y: random(0.05, 0.35),
          speed: random(0.5, 0.75),
          climb: random(0.18, 0.32),
        })
        break
      case 'balloon': {
        // Drifts with the wind, slowly rising.
        const drift = wind >= 0 ? 1 : -1
        const speed = Math.max(1.5, Math.min(Math.abs(wind), 50) / 3.6) * 0.8
        this.effects.push({
          ...flyer,
          kind,
          start: scale(
            camera.ray(drift > 0 ? -0.06 : 1.06, random(0.45, 0.68)),
            random(220, 420),
          ),
          velocity: [drift * speed, random(-0.8, 0.8), random(0.3, 0.8)],
        })
        break
      }
    }
  }

  update(dt: number, camera: SkyCamera) {
    for (const e of this.effects) {
      e.age += dt
      if (e.kind === 'plane') leaveContrail(e)
    }
    const { width: w, height: h } = camera
    this.effects = this.effects.filter((e) => {
      if (e.kind === 'shootingStar') return e.age < SHOOTING_STAR_LIFE
      if (e.age > 240) return false
      // Once in view, gone as soon as it leaves it.
      const p = camera.project(position(e))
      const inside =
        p.depth > 1 &&
        p.x > -0.45 * w &&
        p.x < 1.45 * w &&
        p.y > -0.6 * h &&
        p.y < 1.4 * h
      return inside || e.age < 1.5
    })
  }

  // Far away, so hidden by the clouds: shooting stars and planes.
  drawBehindClouds(
    ctx: CanvasRenderingContext2D,
    camera: SkyCamera,
    atm: Atmosphere,
    light: Light,
  ) {
    const env = environment(camera, atm, light)
    for (const e of this.effects) {
      if (e.kind === 'shootingStar') drawShootingStar(ctx, e, camera, atm)
      else if (e.kind === 'plane') drawPlane(ctx, e, env)
    }
  }

  // Low enough to pass in front of the clouds, the farthest first.
  drawInFrontOfClouds(
    ctx: CanvasRenderingContext2D,
    camera: SkyCamera,
    atm: Atmosphere,
    light: Light,
  ) {
    const env = environment(camera, atm, light)
    const near = this.effects
      .filter((e): e is Flyer => e.kind === 'birds' || e.kind === 'balloon')
      .map((e) => ({ e, depth: camera.project(position(e)).depth }))
      .sort((a, b) => b.depth - a.depth)
    for (const { e } of near) {
      if (e.kind === 'birds') drawBirds(ctx, e, env)
      else if (e.kind === 'balloon') drawBalloon(ctx, e, env)
    }
  }
}

// A loose V, the leader in front, each bird a wingspan or so from the next.
function makeFlock(): Bird[] {
  return Array.from({ length: 9 + Math.floor(Math.random() * 5) }, (_, i) => {
    const rank = Math.ceil(i / 2)
    const side = i % 2 ? 1 : -1
    return {
      offset: [
        rank * 1.9 + random(-0.4, 0.4),
        side * rank * 1.5 + random(-0.4, 0.4),
        random(-0.5, 0.5),
      ],
      phase: Math.random() * Math.PI * 2,
      rate: 2 * Math.PI * random(2.6, 3.2),
      size: random(0.9, 1.1),
    }
  })
}

function position(e: Flyer, age = e.age): Vec3 {
  return add(e.start, scale(e.velocity, age))
}

// Forward, right and up of a body flying level along its velocity.
function frame(velocity: Vec3) {
  const f = normalize([velocity[0], velocity[1], 0])
  return { f, r: cross(f, UP) }
}

// A point given in a body's own axes: ahead, to the right, above.
function local(
  origin: Vec3,
  { f, r }: { f: Vec3; r: Vec3 },
  a: number,
  b: number,
  c: number,
): Vec3 {
  return add(add(add(origin, scale(f, a)), scale(r, b)), scale(UP, c))
}

// ─── Light ──────────────────────────────────────────────────────────────

type Environment = {
  camera: SkyCamera
  atm: Atmosphere
  toLight: Vec3
  sun: RGB // direct light falling on a surface facing it
  sky: RGB // light from the sky dome above
  ground: RGB // light thrown back by the ground below
  visibility: number // m, distance at which the air hides two thirds
}

function environment(
  camera: SkyCamera,
  atm: Atmosphere,
  light: Light,
): Environment {
  return {
    camera,
    atm,
    toLight: light.direction,
    sun: scaleRGB(light.color, light.strength * 0.9),
    sky: scaleRGB(mixRGB(atm.zenith, atm.horizon, 0.5), 0.85),
    // Sunlit fields and roofs by day, a few lights at night; dimmer under
    // a heavy sky.
    ground: scaleRGB(
      mixRGB([5, 6, 10], [130, 120, 100], atm.daylight),
      1 - atm.overcast * 0.4,
    ),
    visibility: 25000 * (1 - 0.85 * atm.hazeStrength),
  }
}

// Light reaching a surface of normal `n`: the sky above it, the ground below,
// the sun on its face and, for thin feathers and fabric, through it.
function irradiance(env: Environment, n: Vec3, translucency = 0): RGB {
  const ambient = mixRGB(env.ground, env.sky, n[2] * 0.5 + 0.5)
  const facing = dot(n, env.toLight)
  const direct = Math.max(0, facing) + translucency * Math.max(0, -facing)
  return add(ambient, scale(env.sun, direct)) as RGB
}

// Color of a surface of albedo `albedo` (0 → 1 per channel).
function shade(env: Environment, albedo: RGB, n: Vec3, translucency = 0): RGB {
  const e = irradiance(env, n, translucency)
  return [albedo[0] * e[0], albedo[1] * e[1], albedo[2] * e[2]]
}

// The side of a flat surface seen from the camera.
function facingCamera(n: Vec3, at: Vec3): Vec3 {
  return dot(n, at) > 0 ? scale(n, -1) : n
}

// Air between the camera and a point seen at `p` lends it the sky's color.
function airLight(env: Environment, color: RGB, at: Vec3, p: ScreenPoint) {
  const fog = 1 - Math.exp(-Math.hypot(...at) / env.visibility)
  return mixRGB(color, skyColorAt(env.atm, p.y / env.camera.height), fog)
}

function fillPolygon(
  ctx: CanvasRenderingContext2D,
  points: ScreenPoint[],
  color: string,
) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
  ctx.closePath()
  ctx.fill()
}

// ─── Shooting star ──────────────────────────────────────────────────────

function drawShootingStar(
  ctx: CanvasRenderingContext2D,
  e: ShootingStar,
  camera: SkyCamera,
  atm: Atmosphere,
) {
  const { width: w, height: h } = camera
  const at = (age: number) => ({
    x: (e.x + e.dir * e.speed * age) * w,
    y: (e.y + e.climb * age) * h,
  })
  const t = e.age / SHOOTING_STAR_LIFE
  // Flares up then burns out; still faintly seen by day.
  const alpha =
    Math.sin(Math.PI * t) ** 0.7 * (0.35 + 0.65 * atm.starVisibility)
  const head = at(e.age)
  const tail = at(Math.max(0, e.age - 0.25))
  const g = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y)
  g.addColorStop(0, 'rgba(255,255,255,0)')
  g.addColorStop(1, `rgba(255,250,235,${alpha})`)
  ctx.strokeStyle = g
  ctx.lineWidth = 1.6
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(tail.x, tail.y)
  ctx.lineTo(head.x, head.y)
  ctx.stroke()
  ctx.fillStyle = `rgba(255,255,255,${alpha})`
  ctx.beginPath()
  ctx.arc(head.x, head.y, 1.4, 0, Math.PI * 2)
  ctx.fill()
}

// ─── Plane ──────────────────────────────────────────────────────────────

function enginePoints(e: Flyer, at: Vec3) {
  const axes = frame(e.velocity)
  return PLANE_ENGINES.map(([a, b]) => local(at, axes, a, b, 0))
}

function leaveContrail(e: Flyer) {
  const last = e.trail[e.trail.length - 1]
  if (!last || e.age - last.at >= CONTRAIL_STEP)
    e.trail.push({ at: e.age, points: enginePoints(e, position(e)) })
  while (e.trail.length && e.age - e.trail[0].at > CONTRAIL_LIFE)
    e.trail.shift()
}

// Outline of an airliner seen from above or below, in metres: x ahead,
// y to the right.
const PLANE_PARTS: [number, number][][] = [
  // Fuselage.
  [
    [31, 0],
    [27, 1.9],
    [-22, 1.9],
    [-32, 0.5],
    [-32, -0.5],
    [-22, -1.9],
    [27, -1.9],
  ],
  // Swept wings.
  [
    [7, 2],
    [-11, 30],
    [-14.5, 30],
    [-6, 2],
    [-6, -2],
    [-14.5, -30],
    [-11, -30],
    [7, -2],
  ],
  // Tailplane.
  [
    [-21, 1.5],
    [-28, 9.5],
    [-30.5, 9.5],
    [-28.5, 1.5],
    [-28.5, -1.5],
    [-30.5, -9.5],
    [-28, -9.5],
    [-21, -1.5],
  ],
]

function drawPlane(ctx: CanvasRenderingContext2D, e: Flyer, env: Environment) {
  const { camera, atm } = env
  const p = position(e)
  const center = camera.project(p)
  if (center.depth <= 0) return

  // The contrail, widening and fading behind, toned like the clouds: lit
  // by the sun, lost at night.
  const day = smoothstep(0.05, 0.4, atm.daylight)
  if (day > 0) {
    const color = mixRGB(atm.cloudShadow, atm.cloudLit, 0.35 + 0.65 * day)
    const samples = [{ at: e.age, points: enginePoints(e, p) }]
    for (let i = e.trail.length - 1; i >= 0; i--) samples.push(e.trail[i])
    for (let k = 0; k < PLANE_ENGINES.length; k++)
      drawContrail(ctx, env, color, day, e.age, samples, k)
  }

  // White paint lit from the side we see: from below, the bright ground
  // and sky by day, the sun only when it is low and catches the side.
  const axes = frame(e.velocity)
  const n = facingCamera(UP, p)
  const color = rgba(
    airLight(env, shade(env, [0.82, 0.83, 0.86], n), p, center),
  )
  for (const part of PLANE_PARTS)
    fillPolygon(
      ctx,
      part.map(([a, b]) => camera.project(local(p, axes, a, b, 0))),
      color,
    )

  // Navigation lights and the strobe, which carry it through the night.
  const night = 1 - atm.daylight
  if (night > 0.05) {
    const strobe = (e.age + e.seed) % 1.2 < 0.08 ? 1 : 0
    // Red on the left wingtip, green on the right, white strobes.
    const lights: [number, number, string][] = [
      [-32, 0, `rgba(255,255,255,${strobe * night})`],
      [-14, -30, `rgba(255,60,60,${0.9 * night})`],
      [-14, 30, `rgba(80,255,120,${0.9 * night})`],
    ]
    for (const [a, b, c] of lights) {
      const l = camera.project(local(p, axes, a, b, 0))
      ctx.fillStyle = c
      ctx.beginPath()
      ctx.arc(l.x, l.y, 1.3, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

// One engine's trail, newest sample first, as a single ribbon: spreading
// with age, faded along its length by a gradient. Drawn in one fill so the
// pieces never overlap and dot it.
function drawContrail(
  ctx: CanvasRenderingContext2D,
  env: Environment,
  color: RGB,
  day: number,
  now: number,
  samples: TrailSample[],
  engine: number,
) {
  const { camera } = env
  const pts = samples
    .map((s) => ({
      p: camera.project(s.points[engine]),
      age: now - s.at,
    }))
    .filter((s) => s.p.depth > 0)
  if (pts.length < 2) return
  const left: { x: number; y: number }[] = []
  const right: { x: number; y: number }[] = []
  const lengths = [0]
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)].p
    const b = pts[Math.min(pts.length - 1, i + 1)].p
    const d = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const half =
      Math.max(0.3, (camera.focal * (3 + 1.8 * pts[i].age)) / pts[i].p.depth) /
      2
    const nx = (-(b.y - a.y) / d) * half
    const ny = ((b.x - a.x) / d) * half
    const { x, y } = pts[i].p
    left.push({ x: x + nx, y: y + ny })
    right.push({ x: x - nx, y: y - ny })
    if (i > 0)
      lengths.push(
        lengths[i - 1] + Math.hypot(x - pts[i - 1].p.x, y - pts[i - 1].p.y),
      )
  }
  const total = lengths[lengths.length - 1]
  if (total < 1) return
  const head = pts[0].p
  const tail = pts[pts.length - 1].p
  const tone = airLight(env, color, samples[0].points[engine], head)
  const g = ctx.createLinearGradient(head.x, head.y, tail.x, tail.y)
  const every = Math.max(1, Math.floor(pts.length / 24))
  for (let i = 0; i < pts.length; i += every) {
    const age = pts[i].age
    // Forms a wingspan or so behind, then spreads and thins out.
    const alpha =
      0.6 *
      day *
      smoothstep(0, 0.6, age) *
      Math.max(0, 1 - age / CONTRAIL_LIFE) ** 2
    g.addColorStop(lengths[i] / total, rgba(tone, alpha))
  }
  g.addColorStop(1, rgba(tone, 0))
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.moveTo(left[0].x, left[0].y)
  for (const q of left) ctx.lineTo(q.x, q.y)
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y)
  ctx.closePath()
  ctx.fill()
}

// ─── Birds ──────────────────────────────────────────────────────────────

const BIRD_BODY: RGB = [0.5, 0.47, 0.42]
const BIRD_NECK: RGB = [0.07, 0.07, 0.07]
const BIRD_ARM: RGB = [0.4, 0.37, 0.33]
const BIRD_HAND: RGB = [0.16, 0.15, 0.14] // dark primaries

function drawBirds(ctx: CanvasRenderingContext2D, e: Flyer, env: Environment) {
  const center = position(e)
  const axes = frame(e.velocity)
  const birds = e.flock
    .map((b) => {
      const at = local(center, axes, -b.offset[0], b.offset[1], b.offset[2])
      return { b, at, depth: env.camera.project(at).depth }
    })
    .filter((b) => b.depth > 0.5)
    .sort((a, b) => b.depth - a.depth)
  for (const { b, at } of birds) drawBird(ctx, env, e.age, b, at, axes)
}

function drawBird(
  ctx: CanvasRenderingContext2D,
  env: Environment,
  age: number,
  bird: Bird,
  at: Vec3,
  axes: { f: Vec3; r: Vec3 },
) {
  const { camera } = env
  const k = bird.size
  const phi = age * bird.rate + bird.phase
  // The body rises as the wings beat down.
  const origin = add(at, scale(UP, -0.05 * k * Math.sin(phi)))
  const world = (a: number, b: number, c: number) =>
    local(origin, axes, a * k, b * k, c * k)
  const screen = (a: number, b: number, c: number) =>
    camera.project(world(a, b, c))
  const center = camera.project(origin)
  const tone = (albedo: RGB, n: Vec3, translucency = 0) =>
    rgba(airLight(env, shade(env, albedo, n, translucency), origin, center))

  // Wing angle above level: the arm beats, the hand follows a little late,
  // and the wing folds slightly on the upstroke.
  const arm = 0.1 + 0.55 * Math.sin(phi)
  const hand = arm + 0.35 * Math.sin(phi - 0.9)
  const fold = 1 - 0.22 * Math.max(0, Math.cos(phi))

  type Part = { depth: number; draw: () => void }
  const parts: Part[] = []

  for (const side of [-1, 1]) {
    // Offsets along the wing in body axes (ahead, right, up).
    const span = (angle: number, length: number) =>
      [0, side * Math.cos(angle) * length, Math.sin(angle) * length] as const
    const shoulder = [0.08, side * 0.08, 0] as const
    const s1 = span(arm, 0.36)
    const elbow = [shoulder[0], shoulder[1] + s1[1], shoulder[2] + s1[2]]
    const s2 = span(hand, 0.46 * fold)
    const tip = [elbow[0] - 0.12, elbow[1] + s2[1], elbow[2] + s2[2]]
    const mid = [
      elbow[0] - 0.22,
      elbow[1] + s2[1] * 0.55,
      elbow[2] + s2[2] * 0.55,
    ]
    const p = (v: readonly number[], da = 0) => screen(v[0] + da, v[1], v[2])

    // Each panel's top side, turned to the side we see.
    const normal = (s: readonly number[]) => {
      const dir = add(scale(axes.r, s[1]), scale(UP, s[2]))
      return facingCamera(normalize(scale(cross(dir, axes.f), side)), origin)
    }
    const armColor = tone(BIRD_ARM, normal(s1), 0.35)
    const handColor = tone(BIRD_HAND, normal(s2), 0.2)
    const inner = [
      p(shoulder, 0.07),
      p(elbow, 0.06),
      p(elbow, -0.22),
      p(shoulder, -0.22),
    ]
    const outer = [p(elbow, 0.06), p(tip), p(mid), p(elbow, -0.22)]
    parts.push({
      depth: p(elbow).depth,
      draw: () => {
        fillPolygon(ctx, inner, armColor)
        fillPolygon(ctx, outer, handColor)
      },
    })
  }

  // The body has volume: an ellipse along its axis, as thick as it is wide
  // from any side, then the long dark neck and the head.
  const front = screen(0.18, 0, 0)
  const back = screen(-0.4, 0, 0)
  const neck = screen(0.62, 0, 0.02)
  const unit = (camera.focal * k) / center.depth // pixels per metre
  const toCamera = normalize(scale(origin, -1))
  parts.push({
    depth: center.depth,
    draw: () => {
      ctx.fillStyle = tone(BIRD_BODY, toCamera)
      ctx.beginPath()
      ctx.ellipse(
        (front.x + back.x) / 2,
        (front.y + back.y) / 2,
        Math.max(
          Math.hypot(front.x - back.x, front.y - back.y) / 2,
          unit * 0.1,
        ),
        unit * 0.1,
        Math.atan2(front.y - back.y, front.x - back.x),
        0,
        Math.PI * 2,
      )
      ctx.fill()
      const dark = tone(BIRD_NECK, toCamera)
      ctx.strokeStyle = dark
      ctx.lineCap = 'round'
      ctx.lineWidth = Math.max(0.8, unit * 0.07)
      ctx.beginPath()
      ctx.moveTo(front.x, front.y)
      ctx.lineTo(neck.x, neck.y)
      ctx.stroke()
      ctx.fillStyle = dark
      ctx.beginPath()
      ctx.arc(neck.x, neck.y, Math.max(0.6, unit * 0.06), 0, Math.PI * 2)
      ctx.fill()
    },
  })

  parts.sort((a, b) => b.depth - a.depth)
  for (const part of parts) part.draw()
}

// ─── Balloon ────────────────────────────────────────────────────────────

const BALLOON_ROPE: RGB = [0.35, 0.27, 0.2]
const BALLOON_BASKET: RGB = [0.47, 0.34, 0.2]

// Half-width of the envelope at height y below its widest point, both in
// envelope radii: round on top, narrowing to the mouth.
function envelopeWidth(y: number) {
  if (y <= 0) return Math.sqrt(Math.max(0, 1 - y * y))
  const t = Math.min(1, y / 1.25)
  return 1 - 0.68 * t ** 1.6
}

function drawBalloon(
  ctx: CanvasRenderingContext2D,
  e: Flyer,
  env: Environment,
) {
  const { camera, atm, toLight } = env
  const p = position(e)
  const c = camera.project(p)
  if (c.depth <= 0) return
  const r = (camera.focal * BALLOON_RADIUS) / c.depth
  // Points on the envelope seen from here: facing us, toward the light and
  // away from it, on the limb when the light is behind.
  const toCamera = normalize(scale(p, -1))
  const across = add(toLight, scale(toCamera, -dot(toLight, toCamera)))
  const hasSide = Math.hypot(...across) > 1e-3
  const lit =
    dot(toLight, toCamera) >= 0 || !hasSide ? toLight : normalize(across)
  const dark = hasSide ? normalize(scale(across, -1)) : toCamera
  const onEnvelope = (n: Vec3) =>
    camera.project(add(p, scale(n, BALLOON_RADIUS)))
  const litPoint = onEnvelope(lit)
  const darkPoint = onEnvelope(dark)
  // Fabric glows when the sun shines through it from behind.
  const glow = scale(env.sun, 0.35 * Math.max(0, -dot(toCamera, toLight)))
  const light = (n: Vec3) => {
    const e = add(irradiance(env, n), glow)
    return `rgb(${[0, 1, 2].map((i) => Math.min(255, Math.round(e[i]))).join(',')})`
  }

  // Swings gently under the envelope.
  const sway = Math.sin(e.age * 0.7 + e.seed * 6) * 0.04
  ctx.save()
  ctx.translate(c.x, c.y)
  ctx.rotate(sway)

  const envelope = new Path2D()
  const steps = 24
  for (let i = 0; i <= steps; i++) {
    const a = Math.PI + (i / steps) * Math.PI
    envelope.lineTo(Math.cos(a) * r, Math.sin(a) * r - r * 0.2)
  }
  for (let i = 0; i <= steps; i++) {
    const y = (i / steps) * 1.25
    envelope.lineTo(envelopeWidth(y) * r, (y - 0.2) * r)
  }
  for (let i = steps; i >= 0; i--) {
    const y = (i / steps) * 1.25
    envelope.lineTo(-envelopeWidth(y) * r, (y - 0.2) * r)
  }
  envelope.closePath()

  ctx.save()
  ctx.clip(envelope)
  // Gores between meridians, which curve around the envelope and turn
  // slowly as it spins.
  const spin = e.seed * Math.PI * 2 + e.age * 0.05
  const step = (Math.PI * 2) / BALLOON_GORES
  const meridian = (lon: number, y: number) =>
    Math.sin(lon) *
    (y < 0 ? Math.sqrt(Math.max(0, 1 - y * y)) : envelopeWidth(y)) *
    r
  for (let g = 0; g < BALLOON_GORES; g++) {
    let a = ((spin + g * step) % (Math.PI * 2)) - Math.PI
    let b = a + step
    if (b < -Math.PI / 2 || a > Math.PI / 2) continue
    a = Math.max(a, -Math.PI / 2)
    b = Math.min(b, Math.PI / 2)
    ctx.fillStyle = rgba(scaleRGB(BALLOON_COLORS[g % 2], 255))
    ctx.beginPath()
    for (let i = 0; i <= steps; i++) {
      const y = -1 + (i / steps) * 2.25
      ctx.lineTo(meridian(a, y), (y - 0.2) * r)
    }
    for (let i = steps; i >= 0; i--) {
      const y = -1 + (i / steps) * 2.25
      ctx.lineTo(meridian(b, y), (y - 0.2) * r)
    }
    ctx.closePath()
    ctx.fill()
  }
  // Lit like a sphere: brightest where it faces the light, shading off
  // across the side we see to the one turned away.
  const hx = litPoint.x - c.x
  const hy = litPoint.y - c.y
  const reach = Math.max(
    r * 0.5,
    Math.hypot(darkPoint.x - litPoint.x, darkPoint.y - litPoint.y),
  )
  const shading = ctx.createRadialGradient(hx, hy, 0, hx, hy, reach)
  shading.addColorStop(0, light(lit))
  shading.addColorStop(
    Math.min(0.9, Math.max(0.05, Math.hypot(hx, hy) / reach)),
    light(toCamera),
  )
  shading.addColorStop(1, light(dark))
  ctx.globalCompositeOperation = 'multiply'
  ctx.fillStyle = shading
  ctx.fillRect(-r * 1.3, -r * 1.4, r * 2.6, r * 2.7)
  ctx.globalCompositeOperation = 'source-over'
  // The air in between.
  const fog = 1 - Math.exp(-Math.hypot(...p) / env.visibility)
  ctx.fillStyle = rgba(skyColorAt(atm, c.y / camera.height), fog)
  ctx.fillRect(-r * 1.3, -r * 1.4, r * 2.6, r * 2.7)
  ctx.restore()

  // Ropes and basket, seen from below.
  const under = facingCamera(UP, p)
  ctx.strokeStyle = rgba(
    airLight(env, shade(env, BALLOON_ROPE, toCamera), p, c),
  )
  ctx.lineWidth = Math.max(0.6, r * 0.03)
  ctx.beginPath()
  ctx.moveTo(-r * 0.3, r * 1.05)
  ctx.lineTo(-r * 0.16, r * 1.4)
  ctx.moveTo(r * 0.3, r * 1.05)
  ctx.lineTo(r * 0.16, r * 1.4)
  ctx.stroke()
  const side = shade(env, BALLOON_BASKET, toCamera)
  const bottom = shade(env, BALLOON_BASKET, under)
  ctx.fillStyle = rgba(airLight(env, side, p, c))
  ctx.fillRect(-r * 0.18, r * 1.4, r * 0.36, r * 0.24)
  ctx.fillStyle = rgba(airLight(env, bottom, p, c))
  ctx.fillRect(-r * 0.18, r * 1.58, r * 0.36, r * 0.06)

  // The burner glows now and then; at night it lights the envelope.
  const burn = Math.max(0, Math.sin(e.age * 0.9 + e.seed * 10)) ** 8
  if (burn > 0.02) {
    const g = ctx.createRadialGradient(0, r * 0.95, 0, 0, r * 0.95, r * 0.9)
    const a = burn * (0.35 + 0.55 * (1 - atm.daylight))
    g.addColorStop(0, `rgba(255,190,90,${a})`)
    g.addColorStop(1, 'rgba(255,140,40,0)')
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = g
    ctx.fillRect(-r, 0, r * 2, r * 1.9)
    ctx.globalCompositeOperation = 'source-over'
  }
  ctx.restore()
}
