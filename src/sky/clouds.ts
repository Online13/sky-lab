import { clamp, smoothstep, type Atmosphere, type RGB } from './atmosphere'
import type { SkyParams } from './params'
import { SUNLIGHT } from './sunlight'

export type CloudKind =
  | 'cirrus'
  | 'altocumulus'
  | 'lenticular'
  | 'stratocumulus'
  | 'cumulus'
  | 'cumulonimbus'
  | 'fractus'

type KindSpec = {
  name: string
  description: string
  speed: number // drift relative to wind, 0 = stationary
}

// Order matches the layer indices of the cloud shader.
export const CLOUD_KINDS: Record<CloudKind, KindSpec> = {
  cirrus: {
    name: 'Cirrus',
    description:
      'High wisps of ice, a sign of fair weather, drawn out by the wind',
    speed: 2.5,
  },
  altocumulus: {
    name: 'Altocumulus',
    description:
      'Fields of small fleecy clouds in stable air, away from convection',
    speed: 1.5,
  },
  lenticular: {
    name: 'Lenticular',
    description: 'Still lenses over the relief when the wind is strong and dry',
    speed: 0,
  },
  stratocumulus: {
    name: 'Stratocumulus',
    description: 'A lumpy grey layer as the sky fills in',
    speed: 1,
  },
  cumulus: {
    name: 'Cumulus',
    description:
      'Fair-weather clouds born of the heat, mostly in the afternoon',
    speed: 1,
  },
  cumulonimbus: {
    name: 'Cumulonimbus',
    description: 'Storm tower with an anvil: heat and heavy rain',
    speed: 0.6,
  },
  fractus: {
    name: 'Fractus',
    description: 'Fast, ragged shreds under rain and wind',
    speed: 1.4,
  },
}

export const CLOUD_KIND_IDS = Object.keys(CLOUD_KINDS) as CloudKind[]

// How developed each genre is (0–1) for the current weather. Uniform overcast
// (stratus / nimbostratus) is an extra layer of the cloud shader.
export function cloudAmounts(
  params: SkyParams,
  atm: Atmosphere,
): Record<CloudKind, number> {
  const cover = atm.effectiveCover
  const { precipitation: rain, temperature, windSpeed: wind } = params
  // Thermals need warmth and sun; they peak in the afternoon and die at night.
  const convection =
    atm.nightProgress > 0
      ? 0
      : smoothstep(10, 28, temperature) *
        smoothstep(0.1, 0.5, atm.dayProgress) *
        (1 - smoothstep(0.8, 1, atm.dayProgress))
  const storm = smoothstep(35, 75, rain) * smoothstep(16, 26, temperature)
  const notOvercast = 1 - smoothstep(70, 95, cover)

  return {
    cirrus:
      smoothstep(2, 20, cover) *
      (1 - smoothstep(55, 85, cover)) *
      (0.5 + 0.5 * smoothstep(10, 60, wind)),
    altocumulus:
      smoothstep(15, 40, cover) * notOvercast * (1 - 0.6 * convection),
    // The relief is out of sight: only a strong wind betrays it.
    lenticular: smoothstep(40, 70, wind) * (1 - smoothstep(10, 30, rain)),
    stratocumulus:
      smoothstep(35, 80, cover) * (1 - 0.5 * convection) * (1 - 0.5 * storm),
    cumulus:
      smoothstep(2, 30, cover) *
      notOvercast *
      (0.35 + 0.65 * convection) *
      (1 - storm),
    cumulonimbus: storm,
    fractus: smoothstep(10, 50, rain) * (0.4 + 0.6 * smoothstep(20, 70, wind)),
  }
}

// The light fields describe the sun, or the moon at night when it is the
// brighter of the two.
export type CloudFrame = {
  lit: RGB // thin cloud, lit by the sky
  shadow: RGB // thick cloud base
  sun: RGB
  sunDirection: readonly [number, number, number] // camera space, z = zenith
  sunLight: number // 0–1 direct light reaching the clouds
  sunUV: readonly [number, number] // sun on screen, 0–1 with y up
  turbidity: number // aerosol load: size and strength of the aureole
  viewTan: { x: number; y: number } // tangents of the camera half-angles
}

const LAYER_COUNT = CLOUD_KIND_IDS.length + 1 // + stratus overcast
const STRATUS = LAYER_COUNT - 1
const STRATUS_SPEED = 0.8
const COVER_FADE_PER_SECOND = 0.4
const MAX_PIXELS = 320_000 // clouds are soft, render below screen resolution

const VERTEX = /* glsl */ `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

// Each genre is a horizontal layer at its real altitude. Every pixel casts a
// ray from the ground through the same camera as the renderer (facing south,
// pitched so the horizon is the bottom edge) and samples a noise field where
// it crosses the layer, so clouds flatten and crowd toward the horizon: grey
// where they are thick, bright at the thin edges facing the sun. The wind
// blows along the camera's right axis, so clouds slide straight across.
const FRAGMENT = /* glsl */ `#version 300 es
precision highp float;

uniform vec2 uSize;
uniform float uTime;
uniform float uFrame;
uniform float uStretch;
uniform float uCover[${LAYER_COUNT}];
uniform vec2 uOffset[${LAYER_COUNT}];
uniform vec3 uLit;
uniform vec3 uShadow;
uniform vec3 uSun;
uniform vec3 uSunDir;
uniform float uSunLight;
uniform vec2 uViewTan;

out vec4 outColor;

// km: cirrus, altocumulus, lenticular, stratocumulus, cumulus, cumulonimbus,
// fractus, stratus
const float ALTITUDE[${LAYER_COUNT}] = float[](9.0, 4.5, 5.0, 2.0, 1.4, 1.2, 0.6, 0.9);
const float DARKNESS[${LAYER_COUNT}] = float[](0.0, 0.35, 0.45, 0.75, 0.85, 1.4, 0.9, 0.8);
// Back to front: highest layers first.
const int ORDER[${LAYER_COUNT}] = int[](0, 2, 1, 3, 4, 5, 7, 6);

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x),
        mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
        mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

// Octaves may be fractional: the last one fades to its mean so detail can be
// dropped smoothly with distance.
float fbm(vec3 p, float octaves) {
  const mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
  float sum = 0.0, amp = 0.5, norm = 0.0;
  for (int i = 0; i < 6; i++) {
    float w = clamp(octaves - float(i), 0.0, 1.0);
    if (w <= 0.0) break;
    sum += amp * mix(0.5, noise(p), w);
    norm += amp;
    p.xy = rot * p.xy * 2.03;
    p.z *= 1.7;
    amp *= 0.5;
  }
  return sum / norm;
}

// Octaves worth computing for a noise of unit wavelength seen through a pixel
// of that footprint (same units): finer ones would only sparkle as grain. The
// base octave stays, or clouds cut at a threshold would vanish in the distance.
float lod(float footprint, float octaves) {
  return clamp(1.0 - log2(2.0 * footprint), 1.0, octaves);
}

// Footprint (km) of one pixel on a layer at that distance (km). Rays grazing
// the layer stretch it along the line of sight; the geometric mean keeps
// detail across while removing most of the grain.
float footprint(float dist, float z) {
  return dist * 2.0 * uViewTan.y / uSize.y / sqrt(z);
}

// Coverage 0 → nothing passes the threshold, 1 → the fraction set by lo.
float threshold(float cover, float lo) { return mix(0.64, lo, cover); }

// Heaped genres: scale (km), coverage threshold, edge softness, evolution
// rate and depth of the slab (km).
struct Heap { float scale, lo, soft, rate, depth; };

Heap heapSpec(int k) {
  if (k == 3) return Heap(2.6, 0.45, 0.05, 1.0, 0.6);
  if (k == 4) return Heap(1.4, 0.55, 0.04, 1.0, 1.6);
  if (k == 5) return Heap(5.0, 0.47, 0.05, 0.5, 8.0);
  return Heap(0.6, 0.56, 0.1, 3.0, 0.3);
}

const int MIN_STEPS = 6;
const int MAX_STEPS = 14;

// Heaped clouds are slabs of 3D noise between a flat base and their top, cut
// tighter with height so they round off into domes. The ray is marched from
// the base to the top with steps sized to the clouds, so towers rise toward
// the horizon where the ray crosses the slab at a grazing angle. Each sample
// is lit by its height and by the field one step toward the sun: tops and
// sunward sides bright, bases grey. Returns premultiplied color and the
// thickness weighted by opacity.
vec4 heapVolume(int k, vec3 dir, float z, vec2 offset, float cover, float t,
                out float thickness) {
  Heap s = heapSpec(k);
  float h = ALTITUDE[k];
  float d = DARKNESS[k];
  float th0 = threshold(cover, s.lo);
  vec3 dark = uShadow * (1.0 - 0.3 * d);
  vec3 toSun = uSunDir * s.scale * 0.15;
  // Ray length (km) through the slab and its horizontal run.
  float span = s.depth / z;
  float run = span * length(dir.xy);
  int steps = int(clamp(ceil(run / (s.scale * 0.35)) + float(MIN_STEPS),
                        float(MIN_STEPS), float(MAX_STEPS)));
  float seg = span / float(steps);
  // Opacity of one step through dense cloud.
  float density = seg / (s.scale * 0.12);

  // Jitter the samples per pixel and per frame so the steps don't show as
  // contour bands; the accumulation pass averages the noise out.
  // Golden-ratio steps between frames spread the samples evenly over time.
  float jitter = fract(hash(vec3(gl_FragCoord.xy, float(k))) + uFrame * 0.618034);
  vec4 acc = vec4(0.0);
  thickness = 0.0;
  for (int i = 0; i < MAX_STEPS; i++) {
    if (i >= steps || acc.a > 0.98) break;
    float y = (float(i) + jitter) / float(steps);
    vec3 w = dir * ((h + y * s.depth) / z);
    vec2 p = w.xy - offset;
    float fp = footprint(length(w), z) / s.scale;
    p.x /= uStretch;
    vec3 q = vec3(p, (w.z - h) * 1.5) / s.scale + vec3(0.0, 0.0, t * s.rate);
    float n = fbm(q, lod(fp, 4.0));
    float th = th0 + y * y * 0.14;
    float a = smoothstep(th, th + s.soft, n);
    if (a <= 0.0) continue;
    a = 1.0 - exp(-a * density);
    float lit = smoothstep(-0.03, 0.08, n - fbm(q + toSun / s.scale, lod(fp, 2.0))) * uSunLight;
    float shade = clamp(d * (1.0 - 0.8 * y) * (1.0 - 0.85 * lit) * 1.15, 0.0, 1.0);
    vec3 color = mix(uLit, dark, shade);
    float weight = a * (1.0 - acc.a);
    thickness += smoothstep(th, th + 0.22, n) * weight;
    acc += vec4(color, 1.0) * weight;
  }
  return acc;
}

vec2 sampleLayer(int k, vec2 p, float cover, float t, float fp) {
  if (k == 0) {
    // Cirrus: ridged filaments combed along the wind.
    vec3 q = vec3(p / vec2(7.0, 1.6), t * 0.5);
    q.y += (fbm(q * 0.5, lod(fp / 1.6 * 0.5, 3.0)) - 0.5) * 1.2;
    float strands = 1.0 - abs(2.0 * fbm(q * vec3(1.0, 3.0, 1.0), lod(fp / 1.6 * 3.0, 5.0)) - 1.0);
    float th = threshold(cover, 0.4);
    float mask = smoothstep(th, th + 0.15, fbm(q * 0.35 + 3.1, lod(fp / 1.6 * 0.35, 3.0)));
    return vec2(pow(strands, 5.0) * mask * 0.8, 0.0);
  }
  if (k == 1) {
    // Altocumulus: small tufts gathered in patches.
    float patches = fbm(vec3(p / 3.0, t), lod(fp / 3.0, 4.0));
    float tufts = fbm(vec3(p / 0.3, t * 2.0), lod(fp / 0.3, 5.0));
    float n = tufts * 0.5 + patches * 0.5;
    float th = threshold(cover, 0.52);
    return vec2(smoothstep(th, th + 0.08, n) * 0.9, smoothstep(th, th + 0.2, n));
  }
  if (k == 2) {
    // Lenticular: smooth lenses standing still over the relief.
    float n = fbm(vec3(p / vec2(9.0, 2.6), 0.0), lod(fp / 2.6, 3.0));
    float th = mix(0.7, 0.58, cover);
    return vec2(smoothstep(th, th + 0.025, n), smoothstep(th, th + 0.12, n));
  }
  // Stratus: a nearly uniform sheet with slow undulations.
  float n = fbm(vec3(p / 4.0, t * 0.3), lod(fp / 4.0, 4.0));
  return vec2(cover * (0.82 + 0.18 * n), 0.4 + 0.6 * n);
}

void main() {
  // World axes: x west, y south, z zenith.
  vec2 ndc = gl_FragCoord.xy / uSize * 2.0 - 1.0;
  float pitch = atan(uViewTan.y);
  vec3 forward = vec3(0.0, cos(pitch), sin(pitch));
  vec3 up = vec3(0.0, -sin(pitch), cos(pitch));
  vec3 dir = normalize(vec3(ndc.x * uViewTan.x, 0.0, 0.0) +
                       up * (ndc.y * uViewTan.y) + forward);
  float z = max(dir.z, 0.002);
  // Light sneaking through thin cloud around the sun, and silver linings.
  float mu = max(dot(dir, uSunDir), 0.0);
  float glow = (pow(mu, 8.0) * 0.2 + pow(mu, 64.0) * 0.8) * uSunLight;
  float horizon = smoothstep(0.0, 0.06, dir.z);
  float t = uTime * 0.008;

  vec4 acc = vec4(0.0);
  for (int i = 0; i < ${LAYER_COUNT}; i++) {
    int k = ORDER[i];
    if (uCover[k] < 0.003) continue;
    float h = ALTITUDE[k];
    float dist = h / z;
    float fade = horizon * exp(-dist / 90.0);
    float tk = t + float(k) * 7.3;
    vec4 layer;
    float thick;
    if (k >= 3 && k <= 6) {
      layer = heapVolume(k, dir, z, uOffset[k], uCover[k], tk, thick);
      thick /= max(layer.a, 1e-3);
    } else {
      vec2 p = dir.xy * dist - uOffset[k];
      p.x /= uStretch;
      vec2 c = sampleLayer(k, p, uCover[k], tk, footprint(dist, z));
      float d = DARKNESS[k];
      vec3 color = mix(uLit, uShadow * (1.0 - 0.3 * d), clamp(c.y * d, 0.0, 1.0));
      layer = vec4(color * c.x, c.x);
      thick = c.y;
    }
    layer *= fade;
    if (layer.a <= 0.0) continue;
    // Light sneaks through the thin edges, not the dense core.
    vec3 color = min(layer.rgb / layer.a + uSun * glow * (1.0 - thick * 0.85), 1.0);
    acc = vec4(color * layer.a, layer.a) + acc * (1.0 - layer.a);
  }
  outColor = acc;
}`

// Temporal accumulation: each jittered march is blended into the history of
// the previous frames, which averages the noise away. Clouds drift slowly
// enough that the lag stays under a pixel.
const ACCUMULATE = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uCurrent;
uniform sampler2D uHistory;
uniform float uBlend;
out vec4 outColor;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  outColor = mix(texelFetch(uHistory, c, 0), texelFetch(uCurrent, c, 0), uBlend);
}`

const COPY = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uSource;
out vec4 outColor;
void main() {
  outColor = texelFetch(uSource, ivec2(gl_FragCoord.xy), 0);
}`

// Time constant of the accumulation, seconds.
const HISTORY_SECONDS = 0.2

type Target = { texture: WebGLTexture; framebuffer: WebGLFramebuffer }

function createProgram(gl: WebGL2RenderingContext, fragment: string) {
  const program = gl.createProgram()
  for (const [type, source] of [
    [gl.VERTEX_SHADER, VERTEX],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(shader) ?? 'shader error')
    gl.attachShader(program, shader)
  }
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(program) ?? 'link error')
  return program
}

function createTarget(gl: WebGL2RenderingContext): Target {
  const texture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, texture)
  // Linear for the sunlight pass; the others read texels directly.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return { texture, framebuffer: gl.createFramebuffer() }
}

export class CloudLayer {
  readonly canvas = document.createElement('canvas')
  private readonly gl: WebGL2RenderingContext | null
  private readonly uniforms: Record<string, WebGLUniformLocation | null> = {}
  private readonly sunUniforms: Record<string, WebGLUniformLocation | null> = {}
  private readonly programs: Record<
    'clouds' | 'accumulate' | 'copy' | 'sunlight',
    WebGLProgram | null
  > = { clouds: null, accumulate: null, copy: null, sunlight: null }
  // The march renders into `current`, which is blended into one history
  // target from the other, then copied to the canvas.
  private targets: { current: Target; history: [Target, Target] } | null = null
  // Half floats keep the slow blend from sticking on 8-bit steps.
  private halfFloat = false
  private historyValid = false
  // History target holding the clouds of the last render.
  private latest: Target | null = null
  private frameIndex = 0
  private blend = 1
  private readonly cover = new Float32Array(LAYER_COUNT)
  private readonly offsets = new Float32Array(LAYER_COUNT * 2)
  private stretch = 1
  private time = 0

  constructor() {
    this.gl = this.canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
    })
    if (!this.gl) {
      console.warn('WebGL2 unavailable: clouds disabled')
      return
    }
    const gl = this.gl
    const program = createProgram(gl, FRAGMENT)
    this.programs.clouds = program
    this.programs.accumulate = createProgram(gl, ACCUMULATE)
    this.programs.copy = createProgram(gl, COPY)
    this.programs.sunlight = createProgram(gl, SUNLIGHT)
    for (const name of [
      'uSize',
      'uViewTan',
      'uSunUV',
      'uSun',
      'uSunLight',
      'uTurbidity',
    ])
      this.sunUniforms[name] = gl.getUniformLocation(
        this.programs.sunlight,
        name,
      )
    gl.useProgram(this.programs.accumulate)
    gl.uniform1i(gl.getUniformLocation(this.programs.accumulate, 'uCurrent'), 0)
    gl.uniform1i(gl.getUniformLocation(this.programs.accumulate, 'uHistory'), 1)
    this.uniforms.uBlend = gl.getUniformLocation(
      this.programs.accumulate,
      'uBlend',
    )
    this.halfFloat = gl.getExtension('EXT_color_buffer_float') !== null
    this.targets = {
      current: createTarget(gl),
      history: [createTarget(gl), createTarget(gl)],
    }
    for (const name of [
      'uSize',
      'uTime',
      'uFrame',
      'uStretch',
      'uCover',
      'uOffset',
      'uLit',
      'uShadow',
      'uSun',
      'uSunDir',
      'uSunLight',
      'uViewTan',
    ])
      this.uniforms[name] = gl.getUniformLocation(program, name)
  }

  resize(width: number, height: number) {
    const scale = Math.min(1, Math.sqrt(MAX_PIXELS / (width * height)))
    this.canvas.width = Math.max(1, Math.round(width * scale))
    this.canvas.height = Math.max(1, Math.round(height * scale))
    const { gl, targets } = this
    if (!gl || !targets) return
    for (const { texture, framebuffer } of [
      targets.current,
      ...targets.history,
    ]) {
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        this.halfFloat ? gl.RGBA16F : gl.RGBA8,
        this.canvas.width,
        this.canvas.height,
        0,
        gl.RGBA,
        this.halfFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE,
        null,
      )
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        texture,
        0,
      )
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.historyValid = false
  }

  // Ease coverage toward the weather and drift each layer with the wind.
  update(
    dt: number,
    amounts: Record<CloudKind, number>,
    overcast: number,
    wind: number,
  ) {
    this.time += dt
    this.blend = 1 - Math.exp(-dt / HISTORY_SECONDS)
    this.stretch = 1 + (wind / 120) * 0.7
    const kmPerSecond = (wind * 3 + 4) / 350
    const step = COVER_FADE_PER_SECOND * dt
    for (let k = 0; k < LAYER_COUNT; k++) {
      const kind = CLOUD_KIND_IDS[k]
      const target = k === STRATUS ? overcast : amounts[kind]
      const speed = k === STRATUS ? STRATUS_SPEED : CLOUD_KINDS[kind].speed
      const c = this.cover[k]
      this.cover[k] = c + clamp(target - c, -step, step)
      this.offsets[k * 2] += kmPerSecond * speed * dt
    }
  }

  render(frame: CloudFrame) {
    const { gl, uniforms: u, targets, programs } = this
    if (!gl || !targets) return
    const n = (c: RGB) => [c[0] / 255, c[1] / 255, c[2] / 255] as const
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.bindFramebuffer(gl.FRAMEBUFFER, targets.current.framebuffer)
    gl.useProgram(programs.clouds)
    gl.uniform2f(u.uSize, this.canvas.width, this.canvas.height)
    gl.uniform1f(u.uTime, this.time)
    this.frameIndex = (this.frameIndex + 1) % 1024
    gl.uniform1f(u.uFrame, this.frameIndex)
    gl.uniform1f(u.uStretch, this.stretch)
    gl.uniform1fv(u.uCover, this.cover)
    gl.uniform2fv(u.uOffset, this.offsets)
    gl.uniform3f(u.uLit, ...n(frame.lit))
    gl.uniform3f(u.uShadow, ...n(frame.shadow))
    gl.uniform3f(u.uSun, ...n(frame.sun))
    gl.uniform3f(u.uSunDir, ...frame.sunDirection)
    gl.uniform1f(u.uSunLight, frame.sunLight)
    gl.uniform2f(u.uViewTan, frame.viewTan.x, frame.viewTan.y)
    gl.drawArrays(gl.TRIANGLES, 0, 3)

    const [previous, next] =
      this.frameIndex % 2 ? targets.history : [...targets.history].reverse()
    gl.bindFramebuffer(gl.FRAMEBUFFER, next.framebuffer)
    gl.useProgram(programs.accumulate)
    gl.uniform1f(u.uBlend, this.historyValid ? this.blend : 1)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, previous.texture)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, targets.current.texture)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    this.historyValid = true
    this.latest = next

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.useProgram(programs.copy)
    gl.bindTexture(gl.TEXTURE_2D, next.texture)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  // Replaces the canvas content with the sunlight shadowed by the clouds of
  // the last render, to be composited with 'lighter'. False without WebGL.
  renderSunlight(frame: CloudFrame) {
    const { gl, sunUniforms: u, programs, latest } = this
    if (!gl || !latest) return false
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.useProgram(programs.sunlight)
    gl.uniform2f(u.uSize, this.canvas.width, this.canvas.height)
    gl.uniform2f(u.uViewTan, frame.viewTan.x, frame.viewTan.y)
    gl.uniform2f(u.uSunUV, ...frame.sunUV)
    gl.uniform3f(
      u.uSun,
      frame.sun[0] / 255,
      frame.sun[1] / 255,
      frame.sun[2] / 255,
    )
    gl.uniform1f(u.uSunLight, frame.sunLight)
    gl.uniform1f(u.uTurbidity, frame.turbidity)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, latest.texture)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    return true
  }
}
