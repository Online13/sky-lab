// The sky camera: a pinhole at the origin facing south with no roll, pitched
// up by VIEW_HALF_ANGLE so the horizon is the bottom edge and the top of the
// screen looks 75° up. World axes: x west (right on screen), y south (away),
// z up. Shared by the sky path, the cloud shader and the effects.

export type Vec3 = readonly [number, number, number]

export const VIEW_HALF_ANGLE = (37.5 * Math.PI) / 180

const COS = Math.cos(VIEW_HALF_ANGLE)
const SIN = Math.sin(VIEW_HALF_ANGLE)

// Camera axes in world space.
export const CAMERA_FORWARD: Vec3 = [0, COS, SIN]
export const CAMERA_UP: Vec3 = [0, -SIN, COS]

export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const add = (a: Vec3, b: Vec3): Vec3 => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
]
export const scale = (a: Vec3, k: number): Vec3 => [
  a[0] * k,
  a[1] * k,
  a[2] * k,
]
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
export const normalize = (a: Vec3): Vec3 => scale(a, 1 / Math.hypot(...a))

export type ScreenPoint = { x: number; y: number; depth: number }

export class SkyCamera {
  width = 0
  height = 0

  resize(width: number, height: number) {
    this.width = width
    this.height = height
  }

  // Tangents of the half-angles of the view.
  get tan() {
    const y = Math.tan(VIEW_HALF_ANGLE)
    return { x: (y * this.width) / this.height, y }
  }

  // Pixels per world unit at a depth of one.
  get focal() {
    return this.height / (2 * this.tan.y)
  }

  // Screen position (CSS pixels) of a point or direction, with its depth
  // along the line of sight. Points behind the camera get a negative depth.
  project(p: Vec3): ScreenPoint {
    const tan = this.tan
    const depth = dot(p, CAMERA_FORWARD)
    const up = dot(p, CAMERA_UP)
    return {
      x: (0.5 + p[0] / depth / (2 * tan.x)) * this.width,
      y: (0.5 - up / depth / (2 * tan.y)) * this.height,
      depth,
    }
  }

  // Unit direction through a point on screen given as shares of the view.
  ray(u: number, v: number): Vec3 {
    const tan = this.tan
    const x = (u - 0.5) * 2 * tan.x
    const y = (0.5 - v) * 2 * tan.y
    return normalize(add(add([x, 0, 0], CAMERA_FORWARD), scale(CAMERA_UP, y)))
  }
}
