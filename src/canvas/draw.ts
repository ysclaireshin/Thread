import type { ThreadNode, ThreadEdge, RenderState, Organizer } from '../types'

// Always derive color from organizer - never trust n.color (may be stale seed data)
const ORGANIZER_COLORS: Record<Organizer, string> = {
  core_idea:         '#4CC9A0',  // --core
  point_of_tension:  '#E06B5A',  // --tension
  open_thought:      '#E8A84A',  // --open
}
function nodeColor(n: ThreadNode): string {
  return ORGANIZER_COLORS[n.organizer] ?? '#4A4946'
}
import {
  SUN_R, MIN_ORBIT, MAX_ORBIT, MOON_ORBIT_R, MOON_ORBIT_R2, ASTEROID_ORBIT_R,
  COMET_E, cometOrbitParams,
  planetOrbitR, ellipsePos, cometTailDir, asteroidVerts,
  type ScreenPos,
} from './orbital'
import { getMoonParentId } from './renderState'

export interface AnimState {
  angles: Record<string, number>
  moonAngles: Record<string, number>
  moonRings: Record<string, number>
  asteroidAngles: Record<string, number>
  cometAngles: Record<string, number>   // keyed by node id
  cometSlots: Record<string, number>    // comet id → slot index
  births: Record<string, number>        // node id → anim.time it first appeared
  discardFade: Record<string, number>
  promotions: Record<string, { progress: number; startX: number; startY: number; targetPlanetId: string }>
  camera: Camera
  time: number
  lastFrameTime: number
  screenPositions: ScreenPos[]
}

export interface Camera {
  x: number; y: number; zoom: number
  tx: number; ty: number; tzoom: number
}

export function makeInitialAnimState(): AnimState {
  return {
    angles: {}, moonAngles: {}, moonRings: {}, asteroidAngles: {},
    cometAngles: {}, cometSlots: {}, births: {},
    discardFade: {}, promotions: {},
    camera: { x: 0, y: 0, zoom: 1, tx: 0, ty: 0, tzoom: 1 },
    time: 0, lastFrameTime: 0, screenPositions: [],
  }
}

export function screenToWorld(sx: number, sy: number, cam: Camera, w: number, h: number) {
  return { wx: (sx - w / 2) / cam.zoom + cam.x, wy: (sy - h / 2) / cam.zoom + cam.y }
}

export interface StarDot { x: number; y: number; r: number; alpha: number; twinkle: number }

export function generateStarfield(count = 280): StarDot[] {
  let seed = 42
  const rng = () => { seed = (seed * 1664525 + 1013904223) & 0xffffffff; return (seed >>> 0) / 0xffffffff }
  return Array.from({ length: count }, () => ({
    x: (rng() - 0.5) * 3200, y: (rng() - 0.5) * 2400,
    r: rng() < 0.15 ? rng() * 1.2 + 0.8 : rng() * 0.8 + 0.3,
    alpha: rng() * 0.5 + 0.2,
    twinkle: rng() * Math.PI * 2,
  }))
}

// ─── Position helpers (exported for use in update.ts / SolarSystem.tsx) ──────

export function getPlanetPos(node: ThreadNode, anim: AnimState) {
  const r = planetOrbitR(node.centrality)
  const theta = anim.angles[node.id] ?? 0
  return ellipsePos(0, 0, r, 0.04, theta, 0)
}

export function getMoonPos(nodeId: string, parentPos: { x: number; y: number }, anim: AnimState) {
  const ring = anim.moonRings[nodeId] ?? 0
  const r = ring === 0 ? MOON_ORBIT_R : MOON_ORBIT_R2
  const theta = anim.moonAngles[nodeId] ?? 0
  return ellipsePos(parentPos.x, parentPos.y, r, 0.05, theta, 0)
}

export function getAsteroidPos(node: ThreadNode, parentPos: { x: number; y: number }, anim: AnimState) {
  const theta = anim.asteroidAngles[node.id] ?? 0
  return ellipsePos(parentPos.x, parentPos.y, ASTEROID_ORBIT_R, 0.2, theta, 0)
}

export function getCometPos(nodeId: string, anim: AnimState) {
  const slot = anim.cometSlots[nodeId] ?? 0
  const { a, phi } = cometOrbitParams(slot)
  const theta = anim.cometAngles[nodeId] ?? 0
  return ellipsePos(0, 0, a, COMET_E, theta, phi)
}

function getStarPos(node: ThreadNode) {
  let h = 0
  for (let i = 0; i < node.id.length; i++) h = (Math.imul(31, h) + node.id.charCodeAt(i)) | 0
  const angle = ((h & 0xffff) / 0xffff) * Math.PI * 2
  const dist = 420 + ((h >>> 16) / 0xffff) * 340
  return { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist }
}

// Deterministic per-id phase in [0, 2π) - desynchronizes per-node animation
function idPhase(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0
  return ((h >>> 0) % 6283) / 1000
}

// Spawn scale: 0 → 1 with a soft overshoot, driven by birth stamps.
// Nodes with a future birth (staggered bloom) stay hidden until their turn.
function spawnScale(anim: AnimState, id: string): number {
  const b = anim.births[id]
  if (b === undefined) return 1
  const t = (anim.time - b) / 450
  if (t <= 0) return 0
  if (t >= 1) return 1
  const c1 = 1.70158, c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

// ─── Main draw ────────────────────────────────────────────────────────────────

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  nodes: ThreadNode[],
  edges: ThreadEdge[],
  anim: AnimState,
  starfield: StarDot[],
  renderStates: Record<string, RenderState>,
  focusMode: boolean,
  selectedId: string | null,
) {
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = '#08090A'
  ctx.fillRect(0, 0, w, h)

  const cam = anim.camera
  anim.screenPositions = []

  // Categorise by render state
  const planets   = nodes.filter(n => renderStates[n.id] === 'planet')
  const moons     = nodes.filter(n => renderStates[n.id] === 'moon')
  const asteroids = nodes.filter(n => renderStates[n.id] === 'asteroid')
  const stars     = nodes.filter(n => renderStates[n.id] === 'star')
  const comets    = nodes.filter(n => renderStates[n.id] === 'comet')

  // Compute world positions
  const planetPos: Record<string, { x: number; y: number }> = {}
  for (const p of planets) planetPos[p.id] = getPlanetPos(p, anim)

  const moonPos: Record<string, { x: number; y: number }> = {}
  for (const m of moons) {
    const pid = getMoonParentId(m.id, nodes, edges)
    const pp = pid ? planetPos[pid] : null
    if (pp) moonPos[m.id] = getMoonPos(m.id, pp, anim)
  }

  const asteroidPos: Record<string, { x: number; y: number }> = {}
  for (const a of asteroids) {
    const pp = a.parent_id ? (planetPos[a.parent_id] ?? null) : null
    if (pp) {
      // Attached tension: orbit around its parent planet
      asteroidPos[a.id] = getAsteroidPos(a, pp, anim)
    } else {
      // Unattached tension: orbit the sun at a mid-range belt radius
      const theta = anim.asteroidAngles[a.id] ?? 0
      const beltR = (MIN_ORBIT + MAX_ORBIT) / 2
      asteroidPos[a.id] = ellipsePos(0, 0, beltR, 0.15, theta, 0)
    }
  }

  const cometPos: Record<string, { x: number; y: number }> = {}
  for (const c of comets) cometPos[c.id] = getCometPos(c.id, anim)

  // Focus node (any organizer)
  const focusNode = nodes.find(n => n.current_focus)
  const focusPos = focusNode
    ? (planetPos[focusNode.id] ?? moonPos[focusNode.id] ?? asteroidPos[focusNode.id] ?? cometPos[focusNode.id] ?? null)
    : null

  // Lit ids for focus-mode dimming
  const litIds = focusMode && focusPos
    ? buildLitSet(focusNode!, nodes, edges, planetPos, moonPos, asteroidPos, cometPos, renderStates)
    : null

  // ── World-space draw ──────────────────────────────────────────────────────
  ctx.save()
  ctx.translate(w / 2, h / 2)
  ctx.scale(cam.zoom, cam.zoom)
  ctx.translate(-cam.x, -cam.y)

  drawStarfield(ctx, starfield, anim.time)
  drawOrbitPaths(ctx, planets, asteroids, anim, asteroidPos)

  // Labels stay readable at normal zoom, drop away when zoomed far out
  const showLabels = cam.zoom >= 0.55

  // Stars - gentle float around their base position, plus spawn scale
  for (const n of stars) {
    const base = getStarPos(n)
    const ph = idPhase(n.id)
    const pos = {
      x: base.x + 7 * Math.sin(anim.time * 0.00035 + ph),
      y: base.y + 7 * Math.cos(anim.time * 0.0003 + ph * 1.7),
    }
    const dim = litIds && !litIds.has(n.id) ? 0.12 : 1
    const s = spawnScale(anim, n.id)
    if (s > 0) {
      if (s < 1) {
        ctx.save(); ctx.translate(pos.x, pos.y); ctx.scale(s, s)
        drawStar(ctx, 0, 0, anim.time, dim, selectedId === n.id)
        ctx.restore()
      } else {
        drawStar(ctx, pos.x, pos.y, anim.time, dim, selectedId === n.id)
      }
    }
    anim.screenPositions.push({ x: pos.x, y: pos.y, r: 5, nodeId: n.id })
  }

  // Moons
  for (const n of moons) {
    const pos = moonPos[n.id]; if (!pos) continue
    const dim = litIds && !litIds.has(n.id) ? 0.15 : 1
    const s = spawnScale(anim, n.id)
    if (s > 0) {
      if (s < 1) {
        ctx.save(); ctx.translate(pos.x, pos.y); ctx.scale(s, s)
        drawMoon(ctx, 0, 0, n, dim, selectedId === n.id)
        ctx.restore()
      } else {
        drawMoon(ctx, pos.x, pos.y, n, dim, selectedId === n.id)
      }
    }
    anim.screenPositions.push({ x: pos.x, y: pos.y, r: 8, nodeId: n.id })
  }

  // Asteroids
  for (const n of asteroids) {
    const pos = asteroidPos[n.id]; if (!pos) continue
    const dim = litIds && !litIds.has(n.id) ? 0.15 : 1
    const isFocus = n.current_focus
    const s = spawnScale(anim, n.id)
    if (s > 0) {
      if (s < 1) {
        ctx.save(); ctx.translate(pos.x, pos.y); ctx.scale(s, s)
        drawAsteroid(ctx, 0, 0, n, dim, selectedId === n.id, isFocus, anim.time)
        ctx.restore()
      } else {
        drawAsteroid(ctx, pos.x, pos.y, n, dim, selectedId === n.id, isFocus, anim.time)
      }
      if (showLabels) drawNodeLabel(ctx, pos.x, pos.y, n.label, dim * s * 0.9, 32, selectedId === n.id)
    }
    anim.screenPositions.push({ x: pos.x, y: pos.y, r: 14, nodeId: n.id })
  }

  // Planets
  for (const n of planets) {
    const pos = planetPos[n.id]
    const dim = litIds && !litIds.has(n.id) ? 0.18 : 1
    const s = spawnScale(anim, n.id)
    if (s > 0) {
      if (s < 1) {
        ctx.save(); ctx.translate(pos.x, pos.y); ctx.scale(s, s)
        drawPlanet(ctx, 0, 0, n, dim, selectedId === n.id, anim.time)
        ctx.restore()
      } else {
        drawPlanet(ctx, pos.x, pos.y, n, dim, selectedId === n.id, anim.time)
      }
      if (showLabels) drawNodeLabel(ctx, pos.x, pos.y, n.label, dim * s, 34, selectedId === n.id || n.current_focus)
    }
    anim.screenPositions.push({ x: pos.x, y: pos.y, r: 14, nodeId: n.id })
  }

  // Comets
  for (const n of comets) {
    const pos = cometPos[n.id]; if (!pos) continue
    const slot = anim.cometSlots[n.id] ?? 0
    const { phi } = cometOrbitParams(slot)
    const s = spawnScale(anim, n.id)
    if (s > 0) {
      if (s < 1) {
        ctx.save(); ctx.translate(pos.x, pos.y); ctx.scale(s, s)
        drawComet(ctx, 0, 0, anim.cometAngles[n.id] ?? 0, phi, n, 1, selectedId === n.id, anim.time)
        ctx.restore()
      } else {
        drawComet(ctx, pos.x, pos.y, anim.cometAngles[n.id] ?? 0, phi, n, 1, selectedId === n.id, anim.time)
      }
      if (showLabels) drawNodeLabel(ctx, pos.x, pos.y, n.label, s * 0.9, 30, selectedId === n.id || n.current_focus)
    }
    anim.screenPositions.push({ x: pos.x, y: pos.y, r: 14, nodeId: n.id })
  }

  drawSun(ctx, 0, 0, anim.time)

  // Focus-mode overlay
  if (focusMode && litIds) {
    ctx.restore()
    ctx.save()
    ctx.fillStyle = 'rgba(8,9,10,0.72)'
    ctx.fillRect(0, 0, w, h)
    ctx.translate(w / 2, h / 2)
    ctx.scale(cam.zoom, cam.zoom)
    ctx.translate(-cam.x, -cam.y)

    for (const n of planets) {
      if (!litIds.has(n.id)) continue
      drawPlanet(ctx, planetPos[n.id].x, planetPos[n.id].y, n, 1, selectedId === n.id, anim.time)
      if (showLabels) drawNodeLabel(ctx, planetPos[n.id].x, planetPos[n.id].y, n.label, 1, 34, true)
    }
    for (const n of moons) {
      const pos = moonPos[n.id]; if (!pos || !litIds.has(n.id)) continue
      drawMoon(ctx, pos.x, pos.y, n, 1, selectedId === n.id)
    }
    for (const n of asteroids) {
      const pos = asteroidPos[n.id]; if (!pos || !litIds.has(n.id)) continue
      drawAsteroid(ctx, pos.x, pos.y, n, 1, selectedId === n.id, n.current_focus, anim.time)
      if (showLabels) drawNodeLabel(ctx, pos.x, pos.y, n.label, 0.9, 32, n.current_focus)
    }
    for (const n of comets) {
      const pos = cometPos[n.id]; if (!pos) continue
      const slot = anim.cometSlots[n.id] ?? 0
      const { phi } = cometOrbitParams(slot)
      drawComet(ctx, pos.x, pos.y, anim.cometAngles[n.id] ?? 0, phi, n, 1, selectedId === n.id, anim.time)
      if (showLabels) drawNodeLabel(ctx, pos.x, pos.y, n.label, 0.9, 30, n.current_focus)
    }
    drawSun(ctx, 0, 0, anim.time)
  }

  ctx.restore()

  // Screen-space: focus label
  if (focusMode && focusNode && focusPos) {
    drawFocusLabel(ctx, focusPos, cam, w, h, focusNode)
  }
}

// ─── Lit set for focus mode ────────────────────────────────────────────────────

function buildLitSet(
  focusNode: ThreadNode,
  nodes: ThreadNode[],
  edges: ThreadEdge[],
  planetPos: Record<string, { x: number; y: number }>,
  moonPos: Record<string, { x: number; y: number }>,
  asteroidPos: Record<string, { x: number; y: number }>,
  cometPos: Record<string, { x: number; y: number }>,
  renderStates: Record<string, RenderState>,
): Set<string> {
  const lit = new Set<string>()
  lit.add(focusNode.id)

  const focusPos =
    planetPos[focusNode.id] ??
    moonPos[focusNode.id] ??
    asteroidPos[focusNode.id] ??
    cometPos[focusNode.id]
  if (!focusPos) return lit

  // Nearest planet
  let minD = Infinity, nearestId = ''
  for (const [id, pos] of Object.entries(planetPos)) {
    const d = Math.hypot(focusPos.x - pos.x, focusPos.y - pos.y)
    if (d < minD) { minD = d; nearestId = id }
  }
  if (nearestId) {
    lit.add(nearestId)
    // Its moons and asteroids
    nodes.forEach(n => {
      if (renderStates[n.id] === 'moon' && moonPos[n.id]) {
        // Check if this moon's parent is the nearest planet
        const isChild = edges.some(e =>
          e.from_id === n.id && e.to_id === nearestId && e.relationship === 'supports'
        )
        if (isChild) lit.add(n.id)
      }
      if (renderStates[n.id] === 'asteroid' && n.parent_id === nearestId) lit.add(n.id)
    })
  }
  return lit
}

// ─── Draw primitives ─────────────────────────────────────────────────────────

// Liquid sun (design E, canvas port): the body is a slowly morphing blob -
// multi-harmonic radial wobble - while the fill breathes across the app's
// liquid-hue palette (#F5B944 → #F5902A → #F5D84A) and the glow pulses.
function drawSun(ctx: CanvasRenderingContext2D, x: number, y: number, time: number) {
  const t = time * 0.001
  const warm = (Math.sin(t * 0.45 + 2.1) + 1) / 2
  const bright = (Math.sin(t * 0.7) + 1) / 2
  const body = mixHex(mixHex('#F5B944', '#F5902A', warm * 0.55), '#F5D84A', bright * 0.35)
  const glowPulse = 1 + 0.06 * Math.sin(t * 0.9)
  for (const [r, a] of [[SUN_R * 3.5, 0.06], [SUN_R * 2.5, 0.10], [SUN_R * 1.8, 0.14]] as [number, number][]) {
    ctx.beginPath(); ctx.arc(x, y, r * glowPulse, 0, Math.PI * 2)
    ctx.fillStyle = hexA(body, a); ctx.fill()
  }
  ctx.beginPath()
  const N = 48
  for (let i = 0; i <= N; i++) {
    const th = (i / N) * Math.PI * 2
    const r = SUN_R * (1
      + 0.045 * Math.sin(3 * th + t * 0.8)
      + 0.030 * Math.sin(5 * th - t * 0.6)
      + 0.020 * Math.sin(7 * th + t * 1.3))
    const px = x + Math.cos(th) * r, py = y + Math.sin(th) * r
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
  }
  ctx.closePath()
  ctx.fillStyle = body
  ctx.fill()
}

// Always-on node label - Geist, centered under the node, dark halo for
// contrast where it crosses orbit rings.
function drawNodeLabel(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  label: string, alpha: number, offsetY: number, bright = false,
) {
  if (alpha <= 0.02) return
  const line = label.length > 26 ? label.slice(0, 25).trimEnd() + '…' : label
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.font = "400 11px 'Geist', sans-serif"
  ctx.textAlign = 'center'
  ctx.lineJoin = 'round'
  ctx.lineWidth = 3
  ctx.strokeStyle = 'rgba(8,9,10,0.8)'
  ctx.strokeText(line, x, y + offsetY)
  ctx.fillStyle = bright ? '#E8E6DC' : '#9A9893'
  ctx.fillText(line, x, y + offsetY)
  ctx.restore()
}

// Returns hex so results can be re-mixed and fed to hexA()
function mixHex(a: string, b: string, t: number): string {
  const ch = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16)
  const m = (i: number) =>
    Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t).toString(16).padStart(2, '0')
  return '#' + m(1) + m(3) + m(5)
}

function drawPlanet(ctx: CanvasRenderingContext2D, x: number, y: number, n: ThreadNode, alpha: number, selected: boolean, time = 0) {
  const color = nodeColor(n)
  const phase = idPhase(n.id)
  ctx.save(); ctx.globalAlpha = alpha
  if (selected) {
    ctx.beginPath(); ctx.arc(x, y, 20, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.5; ctx.stroke()
  }
  // Halo breathes gently, desynchronized per node
  const breathe = Math.sin(time * 0.0012 + phase)
  ctx.beginPath(); ctx.arc(x, y, 22 + 1.5 * breathe, 0, Math.PI * 2)
  ctx.fillStyle = hexA(color, 0.1 + 0.03 * breathe); ctx.fill()
  const g = ctx.createRadialGradient(x - 4, y - 4, 0, x, y, 13)
  g.addColorStop(0, lighten(color, 0.4)); g.addColorStop(1, color)
  ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill()
  ctx.restore()
}

function drawMoon(ctx: CanvasRenderingContext2D, x: number, y: number, n: ThreadNode, alpha: number, selected: boolean) {
  const color = nodeColor(n)
  ctx.save(); ctx.globalAlpha = alpha * 0.85
  if (selected) {
    ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1; ctx.stroke()
  }
  ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.fillStyle = hexA(color, 0.1); ctx.fill()
  ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill()
  ctx.restore()
}

function drawAsteroid(
  ctx: CanvasRenderingContext2D, x: number, y: number,
  n: ThreadNode, alpha: number, selected: boolean, isFocus: boolean, time: number,
) {
  const color = nodeColor(n)
  const verts = asteroidVerts(n.id, 14)
  ctx.save(); ctx.globalAlpha = alpha
  ctx.translate(x, y)

  // Focus pulse ring
  if (isFocus) {
    const pulse = 0.4 + 0.3 * Math.sin(time * 0.002)
    ctx.beginPath(); ctx.arc(0, 0, 22 + pulse * 6, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(251,161,133,${pulse * 0.6})`; ctx.lineWidth = 2; ctx.stroke()
  }

  if (selected) {
    ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1.5; ctx.stroke()
  }

  // Glow
  ctx.beginPath(); ctx.arc(0, 0, 20, 0, Math.PI * 2); ctx.fillStyle = hexA(color, 0.12); ctx.fill()

  // Irregular polygon body
  ctx.beginPath()
  ctx.moveTo(verts[0].x, verts[0].y)
  for (let i = 1; i < verts.length; i++) ctx.lineTo(verts[i].x, verts[i].y)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.strokeStyle = lighten(color, 0.3); ctx.lineWidth = 1.2; ctx.stroke()
  ctx.fill()

  ctx.restore()
}

function drawComet(
  ctx: CanvasRenderingContext2D, x: number, y: number,
  theta: number, phi: number,
  n: ThreadNode, alpha: number, selected: boolean, time = 0,
) {
  // --open = #E8A84A
  const OPEN = '#E8A84A'
  ctx.save(); ctx.globalAlpha = alpha
  const tailAngle = cometTailDir(theta, COMET_E, phi)
  // Tail length shimmers slightly - reads as motion, not decoration
  const tailLen = 52 + 6 * Math.sin(time * 0.0025 + idPhase(n.id))
  const tx = x + Math.cos(tailAngle) * tailLen
  const ty = y + Math.sin(tailAngle) * tailLen
  const grad = ctx.createLinearGradient(x, y, tx, ty)
  grad.addColorStop(0, 'rgba(232,168,74,0.6)'); grad.addColorStop(0.4, 'rgba(232,168,74,0.25)'); grad.addColorStop(1, 'rgba(232,168,74,0)')
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tx, ty)
  ctx.strokeStyle = grad; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.stroke()
  const tx2 = x + Math.cos(tailAngle + 0.15) * tailLen * 0.7
  const ty2 = y + Math.sin(tailAngle + 0.15) * tailLen * 0.7
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tx2, ty2)
  ctx.strokeStyle = 'rgba(232,168,74,0.15)'; ctx.lineWidth = 2.5; ctx.stroke()
  if (selected) {
    ctx.beginPath(); ctx.arc(x, y, 20, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(232,168,74,0.5)'; ctx.lineWidth = 1.5; ctx.stroke()
  }
  ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.fillStyle = 'rgba(232,168,74,0.08)'; ctx.fill()
  // Nucleus - flat fill of --open
  ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fillStyle = OPEN; ctx.fill()
  // Focus pulse (current_focus comet)
  if (n.current_focus) {
    const pulse = 0.4 + 0.4 * Math.sin(time * 0.002)
    ctx.beginPath(); ctx.arc(x, y, 14 + pulse * 4, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(232,168,74,${pulse * 0.8})`; ctx.lineWidth = 1.5; ctx.stroke()
  } else {
    ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(232,168,74,0.3)'; ctx.lineWidth = 1; ctx.stroke()
  }
  ctx.restore()
}

function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, alpha: number, selected: boolean) {
  const twinkle = 0.7 + 0.3 * Math.sin(time * 0.001 + x)
  ctx.save(); ctx.globalAlpha = alpha * twinkle
  if (selected) {
    ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(255,255,200,0.5)'; ctx.lineWidth = 1; ctx.stroke()
  }
  ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,220,0.08)'; ctx.fill()
  ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fillStyle = '#fffde7'; ctx.fill()
  ctx.restore()
}

function drawOrbitPaths(
  ctx: CanvasRenderingContext2D,
  planets: ThreadNode[],
  asteroids: ThreadNode[],
  _anim: AnimState,
  asteroidPos: Record<string, { x: number; y: number }>,
) {
  // Planet orbits - one stroke per occupied ring (radii are quantized now),
  // slightly stronger so the ring structure reads as deliberate
  const seenR = new Set<number>()
  for (const p of planets) {
    const r = Math.round(planetOrbitR(p.centrality))
    if (seenR.has(r)) continue
    seenR.add(r)
    ctx.save(); ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.98, 0, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(35,36,37,0.9)'; ctx.lineWidth = 0.75; ctx.stroke(); ctx.restore()
  }
  // Asteroid orbit circles (around parent planets)
  const seen = new Set<string>()
  for (const a of asteroids) {
    if (!a.parent_id || seen.has(a.parent_id)) continue
    seen.add(a.parent_id)
    const pp = asteroidPos[a.id]
    if (!pp) continue
    // Draw around the planet, not at the asteroid pos
    // (asteroid pos changes frame-to-frame, so use the planet pos directly)
  }
}

function drawStarfield(ctx: CanvasRenderingContext2D, stars: StarDot[], _time: number) {
  for (const s of stars) {
    // Static opacity - no twinkling animation per design spec
    ctx.beginPath(); ctx.arc(s.x, s.y, Math.min(s.r, 1), 0, Math.PI * 2)
    ctx.fillStyle = `rgba(255,255,255,${Math.min(0.35, Math.max(0.15, s.alpha))})`;
    ctx.fill()
  }
}

function drawFocusLabel(
  ctx: CanvasRenderingContext2D,
  focusPos: { x: number; y: number },
  cam: Camera, w: number, h: number,
  node: ThreadNode,
) {
  const sx = (focusPos.x - cam.x) * cam.zoom + w / 2
  const sy = (focusPos.y - cam.y) * cam.zoom + h / 2
  ctx.save()
  const line = node.label.length > 52 ? node.label.slice(0, 52) + '…' : node.label
  ctx.font = "500 11px 'Geist', sans-serif"
  const tw = ctx.measureText(line).width
  const bx = sx + 18, by = sy - 36, bw = tw + 20, bh = 28
  ctx.fillStyle = 'rgba(8,9,10,0.82)'
  rr(ctx, bx, by, bw, bh, 3); ctx.fill()
  ctx.strokeStyle = 'rgba(35,36,37,0.9)'; ctx.lineWidth = 1
  rr(ctx, bx, by, bw, bh, 3); ctx.stroke()
  ctx.fillStyle = '#9A9893'
  ctx.fillText(line, bx + 10, by + 18)
  ctx.restore()
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r); ctx.closePath()
}

function hexA(hex: string, alpha: number) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}
function lighten(hex: string, amt: number) {
  return `rgb(${Math.min(255, parseInt(hex.slice(1, 3), 16) + Math.round(255 * amt))},${Math.min(255, parseInt(hex.slice(3, 5), 16) + Math.round(255 * amt))},${Math.min(255, parseInt(hex.slice(5, 7), 16) + Math.round(255 * amt))})`
}
