export const SUN_R = 38
export const MIN_ORBIT = SUN_R * 3.2    // centrality 1.0
export const MAX_ORBIT = SUN_R * 11     // centrality 0.0 (min rendered)
export const MOON_ORBIT_R = 52          // moon orbit around parent planet
export const MOON_ORBIT_R2 = 34         // alternate ring
export const ASTEROID_ORBIT_R = 64      // asteroid orbit around parent planet

// Multiple comets supported — each open_thought gets its own orbit slot
export const COMET_E = 0.72
export function cometOrbitParams(slotIndex: number) {
  return {
    a: MAX_ORBIT * (0.95 + slotIndex * 0.12),
    phi: Math.PI * (0.38 + slotIndex * 0.27),
  }
}

export function planetOrbitR(centrality: number): number {
  return MIN_ORBIT + (1 - Math.max(0.3, centrality)) / 0.7 * (MAX_ORBIT - MIN_ORBIT)
}

export function angularVelocity(orbitR: number): number {
  const BASE = 0.00018
  const REF = 180
  return BASE * Math.pow(REF / orbitR, 1.5)
}

export function moonAngularVelocity(): number { return 0.0008 }
export function asteroidAngularVelocity(): number { return 0.00055 }

export function ellipsePos(
  cx: number, cy: number,
  a: number, e: number,
  theta: number, phi = 0,
): { x: number; y: number } {
  const b = a * Math.sqrt(Math.max(0, 1 - e * e))
  const xl = a * Math.cos(theta)
  const yl = b * Math.sin(theta)
  return {
    x: cx + xl * Math.cos(phi) - yl * Math.sin(phi),
    y: cy + xl * Math.sin(phi) + yl * Math.cos(phi),
  }
}

export function ellipseAngularDelta(e: number, theta: number, baseDt: number): number {
  const r2 = 1 + e * Math.cos(theta)
  return baseDt * r2 * r2 * (1 - e * e)
}

export function cometTailDir(theta: number, e: number, phi: number): number {
  const b2a = Math.sqrt(1 - e * e)
  const vx = -Math.sin(theta)
  const vy = b2a * Math.cos(theta)
  return Math.atan2(vy, vx) + phi + Math.PI
}

// Deterministic irregular polygon vertices for asteroids, seeded by id
export function asteroidVerts(id: string, r: number): { x: number; y: number }[] {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0
  const rng = () => { h = (Math.imul(1664525, h) + 1013904223) | 0; return (h >>> 0) / 0xffffffff }
  const n = 8 + Math.floor(rng() * 4) // 8–11 vertices
  const verts: { x: number; y: number }[] = []
  for (let i = 0; i < n; i++) {
    const baseAngle = (i / n) * Math.PI * 2
    const jitter = (rng() - 0.5) * 0.55
    const angle = baseAngle + jitter
    const radius = r * (0.55 + rng() * 0.65)
    verts.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius })
  }
  return verts
}

export type ScreenPos = { x: number; y: number; r: number; nodeId: string }
