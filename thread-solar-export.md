```tsx
// FILE: src/App.tsx
import { useState } from 'react'
import { Topbar } from './components/Topbar'
import { SolarSystem } from './components/SolarSystem'
import { SidePanel } from './components/SidePanel'
import { AddNodeModal } from './components/AddNodeModal'
import { LinearView } from './components/LinearView'
import { useStore } from './store'

export default function App() {
  const [addOpen, setAddOpen] = useState(false)
  const viewMode = useStore(s => s.viewMode)

  return (
    <div className="flex flex-col h-screen bg-[#000008] text-gray-200 overflow-hidden">
      <Topbar onAddNode={() => setAddOpen(true)} />
      <div className="flex-1 relative min-h-0 flex flex-col">
        {viewMode === 'system' ? (
          <>
            <div className="flex-1 relative min-h-0">
              <SolarSystem />
              <SidePanel />
            </div>
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-[10px] text-gray-700 pointer-events-none">
              scroll to zoom · click object to inspect · click planet to focus
            </div>
          </>
        ) : (
          <LinearView />
        )}
      </div>
      {addOpen && <AddNodeModal onClose={() => setAddOpen(false)} />}
    </div>
  )
}
```

```tsx
// FILE: src/canvas/draw.ts
import type { ThreadNode, ThreadEdge, RenderState } from '../types'
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
    cometAngles: {}, cometSlots: {},
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
  ctx.fillStyle = '#000008'
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

  // Stars
  for (const n of stars) {
    const pos = getStarPos(n)
    const dim = litIds && !litIds.has(n.id) ? 0.12 : 1
    drawStar(ctx, pos.x, pos.y, anim.time, dim, selectedId === n.id)
    anim.screenPositions.push({ x: pos.x, y: pos.y, r: 5, nodeId: n.id })
  }

  // Moons
  for (const n of moons) {
    const pos = moonPos[n.id]; if (!pos) continue
    const dim = litIds && !litIds.has(n.id) ? 0.15 : 1
    drawMoon(ctx, pos.x, pos.y, n, dim, selectedId === n.id)
    anim.screenPositions.push({ x: pos.x, y: pos.y, r: 8, nodeId: n.id })
  }

  // Asteroids
  for (const n of asteroids) {
    const pos = asteroidPos[n.id]; if (!pos) continue
    const dim = litIds && !litIds.has(n.id) ? 0.15 : 1
    const isFocus = n.current_focus
    drawAsteroid(ctx, pos.x, pos.y, n, dim, selectedId === n.id, isFocus, anim.time)
    anim.screenPositions.push({ x: pos.x, y: pos.y, r: 14, nodeId: n.id })
  }

  // Planets
  for (const n of planets) {
    const pos = planetPos[n.id]
    const dim = litIds && !litIds.has(n.id) ? 0.18 : 1
    drawPlanet(ctx, pos.x, pos.y, n, dim, selectedId === n.id)
    anim.screenPositions.push({ x: pos.x, y: pos.y, r: 14, nodeId: n.id })
  }

  // Comets
  for (const n of comets) {
    const pos = cometPos[n.id]; if (!pos) continue
    const slot = anim.cometSlots[n.id] ?? 0
    const { phi } = cometOrbitParams(slot)
    drawComet(ctx, pos.x, pos.y, anim.cometAngles[n.id] ?? 0, phi, n, 1, selectedId === n.id)
    anim.screenPositions.push({ x: pos.x, y: pos.y, r: 14, nodeId: n.id })
  }

  drawSun(ctx, 0, 0)

  // Focus-mode overlay
  if (focusMode && litIds) {
    ctx.restore()
    ctx.save()
    ctx.fillStyle = 'rgba(0,0,8,0.70)'
    ctx.fillRect(0, 0, w, h)
    ctx.translate(w / 2, h / 2)
    ctx.scale(cam.zoom, cam.zoom)
    ctx.translate(-cam.x, -cam.y)

    for (const n of planets) {
      if (!litIds.has(n.id)) continue
      drawPlanet(ctx, planetPos[n.id].x, planetPos[n.id].y, n, 1, selectedId === n.id)
    }
    for (const n of moons) {
      const pos = moonPos[n.id]; if (!pos || !litIds.has(n.id)) continue
      drawMoon(ctx, pos.x, pos.y, n, 1, selectedId === n.id)
    }
    for (const n of asteroids) {
      const pos = asteroidPos[n.id]; if (!pos || !litIds.has(n.id)) continue
      drawAsteroid(ctx, pos.x, pos.y, n, 1, selectedId === n.id, n.current_focus, anim.time)
    }
    for (const n of comets) {
      const pos = cometPos[n.id]; if (!pos) continue
      const slot = anim.cometSlots[n.id] ?? 0
      const { phi } = cometOrbitParams(slot)
      drawComet(ctx, pos.x, pos.y, anim.cometAngles[n.id] ?? 0, phi, n, 1, selectedId === n.id)
    }
    drawSun(ctx, 0, 0)
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

function drawSun(ctx: CanvasRenderingContext2D, x: number, y: number) {
  for (const [r, a] of [[SUN_R * 3.5, 0.04], [SUN_R * 2.5, 0.07], [SUN_R * 1.8, 0.13]] as [number, number][]) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(255,200,50,${a})`; ctx.fill()
  }
  const g = ctx.createRadialGradient(x, y, 0, x, y, SUN_R)
  g.addColorStop(0, '#fffbcc'); g.addColorStop(0.4, '#ffd700'); g.addColorStop(1, '#f59e0b')
  ctx.beginPath(); ctx.arc(x, y, SUN_R, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill()
}

function drawPlanet(ctx: CanvasRenderingContext2D, x: number, y: number, n: ThreadNode, alpha: number, selected: boolean) {
  const color = n.color ?? '#60a5fa'
  ctx.save(); ctx.globalAlpha = alpha
  if (selected) {
    ctx.beginPath(); ctx.arc(x, y, 20, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.5; ctx.stroke()
  }
  ctx.beginPath(); ctx.arc(x, y, 22, 0, Math.PI * 2)
  ctx.fillStyle = hexA(color, 0.1); ctx.fill()
  const g = ctx.createRadialGradient(x - 4, y - 4, 0, x, y, 13)
  g.addColorStop(0, lighten(color, 0.4)); g.addColorStop(1, color)
  ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill()
  ctx.restore()
}

function drawMoon(ctx: CanvasRenderingContext2D, x: number, y: number, n: ThreadNode, alpha: number, selected: boolean) {
  const color = n.color ?? '#9ca3af'
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
  const color = n.color ?? '#fb7185'
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
  _n: ThreadNode, alpha: number, selected: boolean,
) {
  ctx.save(); ctx.globalAlpha = alpha
  const tailAngle = cometTailDir(theta, COMET_E, phi)
  const tailLen = 55
  const tx = x + Math.cos(tailAngle) * tailLen
  const ty = y + Math.sin(tailAngle) * tailLen
  const grad = ctx.createLinearGradient(x, y, tx, ty)
  grad.addColorStop(0, 'rgba(180,240,255,0.7)'); grad.addColorStop(0.4, 'rgba(100,200,255,0.3)'); grad.addColorStop(1, 'rgba(50,150,255,0)')
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tx, ty)
  ctx.strokeStyle = grad; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.stroke()
  const tx2 = x + Math.cos(tailAngle + 0.15) * tailLen * 0.7
  const ty2 = y + Math.sin(tailAngle + 0.15) * tailLen * 0.7
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tx2, ty2)
  ctx.strokeStyle = 'rgba(200,240,255,0.2)'; ctx.lineWidth = 2.5; ctx.stroke()
  if (selected) {
    ctx.beginPath(); ctx.arc(x, y, 20, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(180,240,255,0.5)'; ctx.lineWidth = 1.5; ctx.stroke()
  }
  ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.fillStyle = 'rgba(180,240,255,0.08)'; ctx.fill()
  const g2 = ctx.createRadialGradient(x, y, 0, x, y, 9)
  g2.addColorStop(0, '#ffffff'); g2.addColorStop(0.5, '#b0eeff'); g2.addColorStop(1, '#60c8ff')
  ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fillStyle = g2; ctx.fill()
  const pulse = 0.4 + 0.3 * Math.sin(Date.now() * 0.002)
  ctx.beginPath(); ctx.arc(x, y, 14 + pulse * 4, 0, Math.PI * 2)
  ctx.strokeStyle = `rgba(180,240,255,${pulse * 0.4})`; ctx.lineWidth = 1.5; ctx.stroke()
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
  // Planet orbits
  for (const p of planets) {
    const r = planetOrbitR(p.centrality)
    ctx.save(); ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.98, 0, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 0.8; ctx.stroke(); ctx.restore()
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

function drawStarfield(ctx: CanvasRenderingContext2D, stars: StarDot[], time: number) {
  for (const s of stars) {
    const a = s.alpha + 0.15 * Math.sin(time * 0.0008 + s.twinkle)
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(255,255,248,${Math.min(1, Math.max(0, a))})`; ctx.fill()
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
  ctx.font = '500 12px system-ui'
  const tw = ctx.measureText(line).width
  const bx = sx + 18, by = sy - 36, bw = tw + 20, bh = 28
  ctx.fillStyle = 'rgba(0,0,12,0.75)'
  rr(ctx, bx, by, bw, bh, 5); ctx.fill()
  ctx.strokeStyle = 'rgba(180,240,255,0.22)'; ctx.lineWidth = 0.8
  rr(ctx, bx, by, bw, bh, 5); ctx.stroke()
  ctx.fillStyle = '#b0eeff'
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
```

```tsx
// FILE: src/canvas/orbital.ts
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
```

```tsx
// FILE: src/canvas/renderState.ts
import type { ThreadNode, ThreadEdge, RenderState } from '../types'

export function computeRenderStates(
  nodes: ThreadNode[],
  edges: ThreadEdge[],
): Record<string, RenderState> {
  const out: Record<string, RenderState> = {}
  for (const n of nodes) out[n.id] = computeOne(n, nodes, edges)
  return out
}

function computeOne(node: ThreadNode, nodes: ThreadNode[], edges: ThreadEdge[]): RenderState {
  if (node.organizer === 'open_thought') return 'comet'
  if (node.centrality < 0.3) return 'star'
  if (node.organizer === 'point_of_tension') return 'asteroid'
  // core_idea: moon if it supports a higher-centrality core_idea
  for (const e of edges) {
    if (e.from_id !== node.id || e.relationship !== 'supports') continue
    const target = nodes.find(n => n.id === e.to_id)
    if (target && target.organizer === 'core_idea' && target.centrality > node.centrality && target.centrality >= 0.3) {
      return 'moon'
    }
  }
  return 'planet'
}

// For moons: find their parent planet id (the node they "supports")
export function getMoonParentId(
  nodeId: string,
  nodes: ThreadNode[],
  edges: ThreadEdge[],
): string | null {
  const node = nodes.find(n => n.id === nodeId)
  if (!node) return null
  for (const e of edges) {
    if (e.from_id !== nodeId || e.relationship !== 'supports') continue
    const target = nodes.find(n => n.id === e.to_id)
    if (target && target.organizer === 'core_idea' && target.centrality > node.centrality) {
      return target.id
    }
  }
  return null
}
```

```tsx
// FILE: src/canvas/update.ts
import type { ThreadNode, RenderState } from '../types'
import type { ThreadEdge } from '../types'
import {
  planetOrbitR, angularVelocity, moonAngularVelocity, asteroidAngularVelocity,
  ellipseAngularDelta, COMET_E, cometOrbitParams,
} from './orbital'
import type { AnimState } from './draw'
import { getPlanetPos, getCometPos } from './draw'
import { getMoonParentId } from './renderState'

export function initAnimState(
  nodes: ThreadNode[],
  edges: ThreadEdge[],
  renderStates: Record<string, RenderState>,
  anim: AnimState,
) {
  const planets   = nodes.filter(n => renderStates[n.id] === 'planet')
  const moons     = nodes.filter(n => renderStates[n.id] === 'moon')
  const asteroids = nodes.filter(n => renderStates[n.id] === 'asteroid')
  const comets    = nodes.filter(n => renderStates[n.id] === 'comet')

  planets.forEach((p, i) => {
    if (anim.angles[p.id] === undefined) anim.angles[p.id] = (i / planets.length) * Math.PI * 2
  })

  // Moon rings — group by parent
  const byParent: Record<string, string[]> = {}
  for (const m of moons) {
    const pid = getMoonParentId(m.id, nodes, edges) ?? 'none'
    byParent[pid] = [...(byParent[pid] ?? []), m.id]
  }
  for (const ids of Object.values(byParent)) {
    ids.forEach((id, i) => {
      if (anim.moonAngles[id] === undefined) anim.moonAngles[id] = (i / ids.length) * Math.PI * 2
      anim.moonRings[id] = i % 2
    })
  }

  // Asteroid angles
  const byAsteroidParent: Record<string, string[]> = {}
  for (const a of asteroids) {
    const pid = a.parent_id ?? 'none'
    byAsteroidParent[pid] = [...(byAsteroidParent[pid] ?? []), a.id]
  }
  for (const ids of Object.values(byAsteroidParent)) {
    ids.forEach((id, i) => {
      if (anim.asteroidAngles[id] === undefined)
        anim.asteroidAngles[id] = (i / ids.length) * Math.PI * 2
    })
  }

  // Comet slots
  comets.forEach((c, i) => {
    anim.cometSlots[c.id] = i
    if (anim.cometAngles[c.id] === undefined) anim.cometAngles[c.id] = Math.PI * 0.25 + i * 0.8
  })
}

export function tickAnimState(
  nodes: ThreadNode[],
  _edges: ThreadEdge[],
  renderStates: Record<string, RenderState>,
  anim: AnimState,
  dt: number,
) {
  anim.time += dt

  for (const n of nodes) {
    const rs = renderStates[n.id]

    if (rs === 'planet') {
      const r = planetOrbitR(n.centrality)
      const omega = angularVelocity(r)
      anim.angles[n.id] = (anim.angles[n.id] ?? 0) + omega * dt
    }

    if (rs === 'moon') {
      const omega = moonAngularVelocity()
      anim.moonAngles[n.id] = (anim.moonAngles[n.id] ?? 0) + omega * dt
    }

    if (rs === 'asteroid') {
      const omega = asteroidAngularVelocity()
      anim.asteroidAngles[n.id] = (anim.asteroidAngles[n.id] ?? 0) + omega * dt
    }

    if (rs === 'comet') {
      const slot = anim.cometSlots[n.id] ?? 0
      const { a } = cometOrbitParams(slot)
      const base = angularVelocity(a) * 1.4
      const theta = anim.cometAngles[n.id] ?? 0
      anim.cometAngles[n.id] = theta + ellipseAngularDelta(COMET_E, theta, base * dt)
    }
  }

  // Camera lerp
  const L = 1 - Math.pow(0.003, dt / 1000)
  anim.camera.x += (anim.camera.tx - anim.camera.x) * L
  anim.camera.y += (anim.camera.ty - anim.camera.y) * L
  anim.camera.zoom += (anim.camera.tzoom - anim.camera.zoom) * L
}

export function getFocusWorldPos(
  nodes: ThreadNode[],
  edges: ThreadEdge[],
  renderStates: Record<string, RenderState>,
  anim: AnimState,
): { x: number; y: number } | null {
  const focus = nodes.find(n => n.current_focus)
  if (!focus) return null
  const rs = renderStates[focus.id]
  if (rs === 'planet') return getPlanetPos(focus, anim)
  if (rs === 'comet') return getCometPos(focus.id, anim)
  // asteroid / moon — use planet pos as proxy for initial camera
  if (rs === 'asteroid' && focus.parent_id) {
    const parent = nodes.find(n => n.id === focus.parent_id)
    if (parent) return getPlanetPos(parent, anim)
  }
  if (rs === 'moon') {
    const pid = getMoonParentId(focus.id, nodes, edges)
    if (pid) {
      const parent = nodes.find(n => n.id === pid)
      if (parent) return getPlanetPos(parent, anim)
    }
  }
  return null
}
```

```tsx
// FILE: src/components/AddNodeModal.tsx
import { useState } from 'react'
import { X } from 'lucide-react'
import { useStore } from '../store'
import { ORGANIZER_META, type Organizer } from '../types'

const NODE_COLORS = ['#2dd4bf', '#60a5fa', '#a78bfa', '#34d399', '#f472b6', '#fb923c', '#facc15']

interface Props { onClose: () => void; prefillDescription?: string }

export function AddNodeModal({ onClose, prefillDescription }: Props) {
  const { nodes, addNode } = useStore()
  const [organizer, setOrganizer] = useState<Organizer>('core_idea')
  const [label, setLabel] = useState(() => {
    if (!prefillDescription) return ''
    const first = prefillDescription.split(/[.!?\n]/)[0].trim()
    return first.length > 60 ? first.slice(0, 60) + '…' : first
  })
  const [description, setDescription] = useState(prefillDescription ?? '')
  const [centrality, setCentrality] = useState(0.6)
  const [confidence, setConfidence] = useState<1 | 2 | 3>(2)
  const [parentId, setParentId] = useState('')

  const planets = nodes.filter(n => n.organizer === 'core_idea' && n.centrality >= 0.3)

  const orgDescriptions: Record<Organizer, string> = {
    core_idea: 'A settled claim, premise, or argument in your draft.',
    point_of_tension: 'An unresolved objection or complication attached to a core idea.',
    open_thought: 'An active question or unsettled area still being worked out.',
  }

  const confidenceLabels: Record<1 | 2 | 3, string> = {
    1: 'Rough — might not capture this right',
    2: 'Fine — haven\'t revisited',
    3: 'Confirmed — I trust this',
  }

  function submit() {
    if (!label.trim()) return
    const usedColors = nodes.map(n => n.color).filter(Boolean)
    const color = organizer === 'point_of_tension'
      ? ORGANIZER_META.point_of_tension.color
      : (NODE_COLORS.find(c => !usedColors.includes(c)) ?? NODE_COLORS[nodes.length % NODE_COLORS.length])

    // session_id is auto-stamped by addNode in the store
    addNode({
      id: `n-${Date.now()}`,
      label: label.trim(),
      description: description.trim(),
      organizer,
      centrality,
      confidence,
      parent_id: organizer === 'point_of_tension' ? (parentId || null) : null,
      current_focus: false,
      last_reinforced_at: new Date().toISOString(),
      provenance: 'human',
      color,
    })
    onClose()
  }

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[#0a0a15] border border-white/8 rounded-xl w-[400px] max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-white/5">
          <span className="font-mono text-[11px] text-white/40 tracking-widest">ADD NODE</span>
          <button onClick={onClose} className="text-white/25 hover:text-white/60 transition-colors"><X size={14} /></button>
        </div>

        <div className="p-5 space-y-5">
          {/* Organizer */}
          <div>
            <span className="font-mono text-[10px] text-white/25 block mb-2 tracking-wider">ORGANIZER</span>
            <div className="space-y-2">
              {(Object.entries(ORGANIZER_META) as [Organizer, typeof ORGANIZER_META[Organizer]][]).map(([o, m]) => (
                <button
                  key={o}
                  onClick={() => setOrganizer(o)}
                  className="w-full flex items-start gap-3 px-3 py-2.5 rounded-lg border text-left transition-all"
                  style={{
                    background: organizer === o ? m.color + '12' : 'transparent',
                    borderColor: organizer === o ? m.color + '60' : 'rgba(255,255,255,0.06)',
                  }}
                >
                  <span
                    className="font-mono text-[10px] font-bold tracking-widest mt-0.5 shrink-0 px-1.5 py-0.5 rounded"
                    style={{ color: m.color, background: m.color + '20' }}
                  >
                    {m.short}
                  </span>
                  <span
                    className="text-[11px] leading-relaxed"
                    style={{
                      color: organizer === o ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.3)',
                      fontFamily: 'system-ui, -apple-system, sans-serif',
                    }}
                  >
                    {orgDescriptions[o]}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Label */}
          <div>
            <span className="font-mono text-[10px] text-white/25 block mb-1.5 tracking-wider">LABEL</span>
            <input
              className="w-full bg-white/3 border border-white/6 rounded-lg px-3 py-2 text-[13px] text-white/80 focus:outline-none focus:border-white/15 placeholder-white/15"
              style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="Short claim or question..."
              autoFocus
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && submit()}
            />
          </div>

          {/* Notes (prefilled from selection) */}
          <div>
            <span className="font-mono text-[10px] text-white/25 block mb-1.5 tracking-wider">NOTES</span>
            <textarea
              className="w-full bg-white/3 border border-white/6 rounded-lg px-3 py-2 text-[12px] text-white/70 focus:outline-none focus:border-white/15 resize-none placeholder-white/15"
              style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              placeholder="Context, evidence, source..."
            />
          </div>

          {/* Confidence */}
          <div>
            <span className="font-mono text-[10px] text-white/25 block mb-2 tracking-wider">CONFIDENCE</span>
            <div className="flex gap-2">
              {([1, 2, 3] as const).map(v => (
                <button
                  key={v}
                  onClick={() => setConfidence(v)}
                  className="flex-1 py-2 rounded-lg border font-mono text-[10px] tracking-wider transition-all"
                  style={{
                    background: confidence === v ? 'rgba(255,255,255,0.06)' : 'transparent',
                    borderColor: confidence === v ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.06)',
                    color: confidence === v ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.25)',
                  }}
                  title={confidenceLabels[v]}
                >
                  {'·'.repeat(v)}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-white/25 mt-1.5" style={{ fontFamily: 'system-ui, sans-serif' }}>
              {confidenceLabels[confidence]}
            </p>
          </div>

          {/* Centrality (not for open_thought) */}
          {organizer !== 'open_thought' && (
            <div>
              <span className="font-mono text-[10px] text-white/25 block mb-1.5 tracking-wider">
                CENTRALITY — {(centrality * 100).toFixed(0)}%
                {centrality < 0.3 && <span className="text-amber-500/60 ml-1">(renders as background star)</span>}
              </span>
              <input
                type="range" min="0.05" max="1" step="0.05"
                value={centrality}
                onChange={e => setCentrality(parseFloat(e.target.value))}
                className="w-full accent-teal-400"
              />
            </div>
          )}

          {/* Parent (tensions only) */}
          {organizer === 'point_of_tension' && planets.length > 0 && (
            <div>
              <span className="font-mono text-[10px] text-white/25 block mb-1.5 tracking-wider">COMPLICATES (parent)</span>
              <select
                className="w-full bg-white/3 border border-white/6 rounded-lg px-3 py-2 text-[12px] text-white/70 focus:outline-none"
                style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
                value={parentId}
                onChange={e => setParentId(e.target.value)}
              >
                <option value="">— select core idea —</option>
                {planets.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 pb-5">
          <button
            onClick={onClose}
            className="px-4 py-1.5 font-mono text-[11px] text-white/25 hover:text-white/50 tracking-wider transition-colors"
          >
            CANCEL
          </button>
          <button
            onClick={submit}
            disabled={!label.trim()}
            className="px-4 py-1.5 bg-white/6 hover:bg-white/10 disabled:opacity-30 font-mono text-[11px] text-white/60 hover:text-white/80 rounded-lg border border-white/8 tracking-wider transition-colors"
          >
            ADD
          </button>
        </div>
      </div>
    </div>
  )
}
```

```tsx
// FILE: src/components/LinearView.tsx
import { useRef, useState, useEffect } from 'react'
import { MapPin, Link2, AlertTriangle } from 'lucide-react'
import { useStore } from '../store'
import { ORGANIZER_META, type TextAnchor, type ThreadNode } from '../types'
import { AddNodeModal } from './AddNodeModal'
import { SidePanel } from './SidePanel'
import { SavePlaceModal } from './SavePlaceModal'

// ─── Staleness ────────────────────────────────────────────────────────────────

const STALE_MS = 48 * 60 * 60 * 1000

function isStale(iso: string) { return Date.now() - new Date(iso).getTime() > STALE_MS }

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 2) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return `${Math.floor(days / 7)}w ago`
}

function staleDays(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000))
}

// ─── Confidence dots ──────────────────────────────────────────────────────────
// Three small white dots (filled/empty) — visually distinct from the organizer
// colored dot on the left.

function ConfidenceDots({ confidence }: { confidence: 1 | 2 | 3 }) {
  return (
    <span style={{ display: 'inline-flex', gap: '2px', alignItems: 'center', marginLeft: '2px' }}>
      {([1, 2, 3] as const).map(i => (
        <span
          key={i}
          title={i === 1 ? 'Rough' : i === 2 ? 'Fine' : 'Confirmed'}
          style={{
            display: 'inline-block',
            width: '4px',
            height: '4px',
            borderRadius: '50%',
            background: i <= confidence
              ? `rgba(255,255,255,${confidence === 3 ? 0.6 : 0.35})`
              : 'rgba(255,255,255,0.1)',
          }}
        />
      ))}
    </span>
  )
}

// ─── Mirror-div editor with inline anchor highlights ─────────────────────────

interface Segment {
  text: string
  anchor?: TextAnchor & { color: string }
}

function buildSegments(text: string, anchors: TextAnchor[], nodes: ThreadNode[]): Segment[] {
  if (anchors.length === 0) return [{ text }]
  const sorted = [...anchors].sort((a, b) => a.start - b.start)
  const segs: Segment[] = []
  let cursor = 0
  for (const anchor of sorted) {
    if (anchor.start >= text.length) break
    const end = Math.min(anchor.end, text.length)
    if (anchor.start < cursor) continue
    if (anchor.start > cursor) segs.push({ text: text.slice(cursor, anchor.start) })
    const node = nodes.find((n: ThreadNode) => n.id === anchor.node_id)
    const color = node ? ORGANIZER_META[node.organizer].color : '#888'
    segs.push({ text: text.slice(anchor.start, end), anchor: { ...anchor, color } })
    cursor = end
  }
  if (cursor < text.length) segs.push({ text: text.slice(cursor) })
  return segs
}

interface EditorProps {
  value: string
  onChange: (v: string) => void
  onSelectionCreate: (start: number, end: number, text: string, x: number, y: number) => void
  onAnchorClick: (nodeId: string) => void
  activeNodeId: string | null
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
}

function EditorWithHighlights({ value, onChange, onSelectionCreate, onAnchorClick, activeNodeId, textareaRef }: EditorProps) {
  const mirrorRef = useRef<HTMLDivElement>(null)
  const { textAnchors, nodes } = useStore()

  const sharedStyle: React.CSSProperties = {
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '14px',
    lineHeight: '1.65',
    padding: '20px 24px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    overflowWrap: 'break-word',
  }

  function syncScroll() {
    if (mirrorRef.current && textareaRef.current) {
      mirrorRef.current.scrollTop = textareaRef.current.scrollTop
    }
  }

  function handleMouseUp(e: React.MouseEvent<HTMLTextAreaElement>) {
    const ta = e.currentTarget
    const start = ta.selectionStart
    const end = ta.selectionEnd
    if (start === end) return
    const text = value.slice(start, end).trim()
    if (!text) return
    onSelectionCreate(start, end, text, e.clientX, e.clientY)
  }

  function handleClick(e: React.MouseEvent<HTMLTextAreaElement>) {
    const pos = e.currentTarget.selectionStart
    const hit = textAnchors.find(a => pos >= a.start && pos <= a.end)
    if (hit) onAnchorClick(hit.node_id)
  }

  const segments = buildSegments(value, textAnchors, nodes)

  return (
    <div style={{ position: 'relative', flex: 1, overflow: 'hidden', minHeight: 0 }}>
      {/* Mirror: visual highlights only, pointer-events: none */}
      <div
        ref={mirrorRef}
        aria-hidden
        style={{
          ...sharedStyle,
          position: 'absolute', inset: 0,
          color: 'transparent',
          pointerEvents: 'none',
          overflow: 'hidden',
          zIndex: 0,
        }}
      >
        {segments.map((seg, i) => {
          if (!seg.anchor) return <span key={i}>{seg.text}</span>
          const isActive = activeNodeId === seg.anchor.node_id
          return (
            <span key={i} style={{
              backgroundColor: isActive ? seg.anchor.color + '30' : seg.anchor.color + '18',
              borderBottom: `1.5px solid ${seg.anchor.color}${isActive ? 'cc' : '55'}`,
              borderRadius: '2px',
            }}>
              {seg.text}
            </span>
          )
        })}
      </div>

      {/* Textarea: transparent bg so mirror shows through */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        onMouseUp={handleMouseUp}
        onClick={handleClick}
        onScroll={syncScroll}
        spellCheck={false}
        placeholder="Write here. Select any span of text to tag it as a node →"
        style={{
          ...sharedStyle,
          position: 'absolute', inset: 0,
          background: 'transparent',
          color: 'rgba(255,255,255,0.75)',
          resize: 'none',
          border: 'none',
          outline: 'none',
          zIndex: 1,
          caretColor: 'rgba(255,255,255,0.6)',
          overflowY: 'auto',
          width: '100%',
          height: '100%',
          boxSizing: 'border-box',
        }}
      />
    </div>
  )
}

// ─── Floating selection toolbar ───────────────────────────────────────────────

function SelectionToolbar({ x, y, onCreateNode }: { x: number; y: number; onCreateNode: () => void }) {
  return (
    <div
      className="fixed z-50 flex items-center bg-[#12121e] border border-white/12 rounded-lg shadow-xl"
      style={{ left: Math.max(8, x - 70), top: Math.max(8, y - 48) }}
    >
      <button
        onMouseDown={e => { e.preventDefault(); onCreateNode() }}
        className="flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] text-teal-400 hover:text-teal-300 tracking-wider transition-colors"
      >
        <Link2 size={10} />
        TAG AS NODE
      </button>
    </div>
  )
}

// ─── Session divider ──────────────────────────────────────────────────────────

function SessionDivider({ session, isCurrent }: { session: number; isCurrent: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px 4px' }}>
      <span style={{
        fontFamily: 'monospace',
        fontSize: '9px',
        color: isCurrent ? 'rgba(251,191,36,0.5)' : 'rgba(255,255,255,0.15)',
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}>
        {isCurrent ? `↑ session ${session}` : `— session ${session} —`}
      </span>
      <div style={{ flex: 1, height: '1px', background: isCurrent ? 'rgba(251,191,36,0.12)' : 'rgba(255,255,255,0.05)' }} />
    </div>
  )
}

// ─── Single node row ──────────────────────────────────────────────────────────

interface NodeRowProps {
  id: string
  indent?: boolean
  highlightedNodeId: string | null
  onHighlight: (id: string | null) => void
  parentLabel?: string
}

function NodeRow({ id, indent, highlightedNodeId, onHighlight, parentLabel }: NodeRowProps) {
  const { nodes, setSelected } = useStore()
  const node = nodes.find(n => n.id === id)
  if (!node) return null

  const meta = ORGANIZER_META[node.organizer]
  const isCurrentFocus = node.current_focus
  const isHighlighted = highlightedNodeId === id
  const stale = isStale(node.last_reinforced_at)
  const isTension = node.organizer === 'point_of_tension'
  const isOpen = node.organizer === 'open_thought'
  const tensionEscalated = isTension && stale
  const rowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isHighlighted && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [isHighlighted])

  const titleColor = isTension
    ? (tensionEscalated ? '#ff6b85' : meta.color)
    : isCurrentFocus ? 'rgba(255,255,255,0.92)'
    : isOpen ? 'rgba(255,220,100,0.72)'
    : 'rgba(255,255,255,0.72)'

  const confidence = node.confidence ?? 2

  return (
    <div
      ref={rowRef}
      onClick={() => { setSelected(id); onHighlight(id) }}
      style={{ paddingLeft: indent ? '24px' : '0', cursor: 'pointer' }}
    >
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: '10px',
        padding: '7px 12px', borderRadius: '8px',
        border: isCurrentFocus
          ? '1px solid rgba(251,191,36,0.35)'
          : isHighlighted ? '1px solid rgba(255,255,255,0.12)'
          : '1px solid transparent',
        borderLeft: isOpen
          ? '2px dashed rgba(251,191,36,0.3)'
          : isCurrentFocus ? '2px solid #fbbf24'
          : tensionEscalated ? '2px solid #ff6b85'
          : isTension ? '2px solid rgba(251,113,133,0.35)'
          : '2px solid transparent',
        background: isCurrentFocus ? 'rgba(251,191,36,0.04)'
          : isHighlighted ? 'rgba(255,255,255,0.025)' : 'transparent',
        transition: 'background 0.12s',
      }}>
        {/* Organizer dot */}
        <span style={{
          display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%',
          background: tensionEscalated ? '#ff6b85' : meta.color,
          boxShadow: `0 0 4px ${meta.color}40`,
          flexShrink: 0, marginTop: '5px',
        }} />

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Title row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '1px' }}>
            {isTension && <AlertTriangle size={11} style={{ color: tensionEscalated ? '#ff6b85' : meta.color, flexShrink: 0 }} />}
            <span style={{
              fontFamily: 'system-ui, sans-serif', fontSize: '13px',
              fontWeight: isTension ? 500 : 400,
              color: titleColor,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
            }}>
              {node.label}
            </span>
            {isCurrentFocus && (
              <span style={{ fontFamily: 'monospace', fontSize: '9px', color: 'rgba(251,191,36,0.8)', flexShrink: 0, letterSpacing: '0.1em' }}>FOCUS</span>
            )}
            {tensionEscalated && (
              <span style={{ fontFamily: 'monospace', fontSize: '9px', color: '#ff6b85', flexShrink: 0 }}>
                unresolved {staleDays(node.last_reinforced_at)}d
              </span>
            )}
          </div>

          {/* Parent label for tensions */}
          {isTension && parentLabel && (
            <p style={{ fontFamily: 'system-ui, sans-serif', fontSize: '10px', color: 'rgba(255,255,255,0.22)', marginBottom: '1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              complicates: {parentLabel}
            </p>
          )}

          {/* Description preview */}
          {node.description && (
            <p style={{ fontFamily: 'system-ui, sans-serif', fontSize: '11px', color: 'rgba(255,255,255,0.27)', marginBottom: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {node.description}
            </p>
          )}

          {/* Metadata row: organizer tag · timestamp · confidence dots */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontFamily: 'monospace', fontSize: '9px', color: meta.color + 'aa', letterSpacing: '0.08em' }}>
              {meta.short}
            </span>
            <span style={{
              fontFamily: 'monospace', fontSize: '9px', letterSpacing: '0.05em',
              color: stale && !isTension ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.22)',
            }}>
              {relativeTime(node.last_reinforced_at)}{stale && !isTension ? ' · stale' : ''}
            </span>
            <ConfidenceDots confidence={confidence} />
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Outline panel ────────────────────────────────────────────────────────────

interface OutlinePanelProps {
  highlightedNodeId: string | null
  onHighlight: (id: string | null) => void
}

function OutlinePanel({ highlightedNodeId, onHighlight }: OutlinePanelProps) {
  const { nodes, currentSession } = useStore()
  const [archivedOpen, setArchivedOpen] = useState(false)

  const activeNodes = nodes.filter(n => !n.resolved && !n.superseded_by)
  const archivedNodes = nodes.filter(n => n.resolved || n.superseded_by)

  const coreIdeas = activeNodes
    .filter(n => n.organizer === 'core_idea')
    .sort((a, b) => {
      // Primary: session desc (most recent first), secondary: centrality desc
      const sd = (b.session_id ?? 1) - (a.session_id ?? 1)
      return sd !== 0 ? sd : b.centrality - a.centrality
    })

  const tensionsByParent: Record<string, typeof nodes> = {}
  activeNodes
    .filter(n => n.organizer === 'point_of_tension')
    .forEach(n => {
      const key = n.parent_id ?? '__unattached__'
      if (!tensionsByParent[key]) tensionsByParent[key] = []
      tensionsByParent[key].push(n)
    })

  const openThoughts = activeNodes
    .filter(n => n.organizer === 'open_thought')
    .sort((a, b) => {
      const sd = (b.session_id ?? 1) - (a.session_id ?? 1)
      return sd !== 0 ? sd : (b.current_focus ? 1 : 0) - (a.current_focus ? 1 : 0)
    })

  const unattachedTensions = tensionsByParent['__unattached__'] ?? []

  // Group core ideas by session for dividers
  const sessionGroups: { session: number; ids: string[] }[] = []
  for (const n of coreIdeas) {
    const s = n.session_id ?? 1
    const last = sessionGroups[sessionGroups.length - 1]
    if (last && last.session === s) last.ids.push(n.id)
    else sessionGroups.push({ session: s, ids: [n.id] })
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '6px 12px' }}>

      {/* Core Ideas + nested tensions, grouped by session */}
      {coreIdeas.length > 0 && (
        <div style={{ marginBottom: '8px' }}>
          <div style={{ fontFamily: 'monospace', fontSize: '9px', color: 'rgba(255,255,255,0.18)', letterSpacing: '0.12em', padding: '4px 12px 4px', textTransform: 'uppercase' }}>
            Core Ideas
          </div>
          {sessionGroups.map((group) => (
            <div key={group.session}>
              <SessionDivider session={group.session} isCurrent={group.session === currentSession} />
              {group.ids.map(coreId => {
                const tensions = tensionsByParent[coreId] ?? []
                const core = nodes.find(n => n.id === coreId)!
                return (
                  <div key={coreId}>
                    <NodeRow id={coreId} highlightedNodeId={highlightedNodeId} onHighlight={onHighlight} />
                    {tensions.map(t => (
                      <NodeRow key={t.id} id={t.id} indent parentLabel={core.label}
                        highlightedNodeId={highlightedNodeId} onHighlight={onHighlight} />
                    ))}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {/* Tensions without a parent — shown regardless of whether core ideas exist */}
      {unattachedTensions.length > 0 && (
        <div style={{ marginBottom: '8px' }}>
          <div style={{ fontFamily: 'monospace', fontSize: '9px', color: 'rgba(251,113,133,0.5)', letterSpacing: '0.12em', padding: '4px 12px 4px', textTransform: 'uppercase' }}>
            Tensions (unlinked)
          </div>
          {unattachedTensions.map(t => (
            <NodeRow key={t.id} id={t.id} highlightedNodeId={highlightedNodeId} onHighlight={onHighlight} />
          ))}
        </div>
      )}

      {/* Open Thoughts */}
      {openThoughts.length > 0 && (
        <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
          <div style={{ fontFamily: 'monospace', fontSize: '9px', color: 'rgba(255,255,255,0.18)', letterSpacing: '0.12em', padding: '4px 12px 4px', textTransform: 'uppercase' }}>
            Open Thoughts
          </div>
          {openThoughts.map(n => (
            <NodeRow key={n.id} id={n.id} highlightedNodeId={highlightedNodeId} onHighlight={onHighlight} />
          ))}
        </div>
      )}

      {/* Resolved / Archived — collapsed by default */}
      {archivedNodes.length > 0 && (
        <div style={{ marginTop: '12px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
          <button
            onClick={() => setArchivedOpen(v => !v)}
            style={{ fontFamily: 'monospace', fontSize: '9px', color: 'rgba(255,255,255,0.18)', letterSpacing: '0.1em', padding: '4px 12px', textTransform: 'uppercase', background: 'none', border: 'none', cursor: 'pointer', display: 'block', width: '100%', textAlign: 'left' }}
          >
            {archivedOpen ? '▾' : '▸'} Resolved ({archivedNodes.length})
          </button>
          {archivedOpen && archivedNodes.map(n => (
            <div key={n.id} style={{ opacity: 0.38 }}>
              <NodeRow id={n.id} highlightedNodeId={highlightedNodeId} onHighlight={onHighlight} />
            </div>
          ))}
        </div>
      )}

      {activeNodes.length === 0 && (
        <div style={{ padding: '40px 12px', textAlign: 'center' }}>
          <p style={{ fontFamily: 'monospace', fontSize: '11px', color: 'rgba(255,255,255,0.18)', letterSpacing: '0.08em' }}>
            No nodes yet.
          </p>
          <p style={{ fontFamily: 'system-ui, sans-serif', fontSize: '11px', color: 'rgba(255,255,255,0.12)', marginTop: '4px' }}>
            Select a span of text in the editor to tag it.
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Anchor badges strip ──────────────────────────────────────────────────────

function AnchorBadges({ onAnchorClick, activeNodeId }: { onAnchorClick: (id: string) => void; activeNodeId: string | null }) {
  const { textAnchors, nodes } = useStore()
  if (textAnchors.length === 0) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', padding: '7px 16px', borderTop: '1px solid rgba(255,255,255,0.04)', flexShrink: 0 }}>
      <span style={{ fontFamily: 'monospace', fontSize: '9px', color: 'rgba(255,255,255,0.18)', letterSpacing: '0.1em', alignSelf: 'center', textTransform: 'uppercase' }}>
        Linked spans:
      </span>
      {textAnchors.map(anchor => {
        const node = nodes.find(n => n.id === anchor.node_id)
        if (!node) return null
        const color = ORGANIZER_META[node.organizer].color
        const isActive = activeNodeId === node.id
        return (
          <button
            key={anchor.id}
            onClick={() => onAnchorClick(node.id)}
            title={`"${anchor.text}" → ${node.label}`}
            style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              padding: '2px 8px', borderRadius: '4px',
              border: `1px solid ${color}${isActive ? '80' : '28'}`,
              background: isActive ? color + '1e' : 'transparent',
              color: isActive ? color : color + '80',
              fontFamily: 'monospace', fontSize: '9px', cursor: 'pointer',
              transition: 'all 0.12s', letterSpacing: '0.04em',
            }}
          >
            <Link2 size={9} />
            <span style={{ maxWidth: '110px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {anchor.text}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ─── Main LinearView ──────────────────────────────────────────────────────────

interface AddNodePrefill {
  description: string
  anchorText: string
  anchorStart: number
  anchorEnd: number
}

export function LinearView() {
  const { draftText, setDraftText, addTextAnchor, textAnchors, nodes } = useStore()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null)
  const [toolbar, setToolbar] = useState<{ x: number; y: number } | null>(null)
  const [selection, setSelection] = useState<{ start: number; end: number; text: string } | null>(null)
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [addPrefill, setAddPrefill] = useState<AddNodePrefill | null>(null)
  const [saveModalOpen, setSaveModalOpen] = useState(false)

  const snapshotCountRef = useRef(nodes.length)

  // On modal close: if a new node appeared since snapshot, wire the anchor
  useEffect(() => {
    if (!addModalOpen && addPrefill) {
      if (nodes.length > snapshotCountRef.current) {
        const newNode = nodes[nodes.length - 1]
        addTextAnchor({
          id: `ta-${Date.now()}`,
          node_id: newNode.id,
          start: addPrefill.anchorStart,
          end: addPrefill.anchorEnd,
          text: addPrefill.anchorText,
        })
      }
      setAddPrefill(null)
    }
  }, [addModalOpen])

  function handleSelectionCreate(start: number, end: number, text: string, x: number, y: number) {
    setSelection({ start, end, text })
    setToolbar({ x, y })
  }

  function handleCreateNodeFromSelection() {
    if (!selection) return
    snapshotCountRef.current = nodes.length
    setAddPrefill({
      description: selection.text,
      anchorText: selection.text,
      anchorStart: selection.start,
      anchorEnd: selection.end,
    })
    setToolbar(null)
    setSelection(null)
    setAddModalOpen(true)
  }

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>

      {/* ── LEFT: Draft editor ─────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', width: '55%', minWidth: 0, borderRight: '1px solid rgba(255,255,255,0.06)' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)', flexShrink: 0 }}>
          <span style={{ fontFamily: 'monospace', fontSize: '9px', color: 'rgba(255,255,255,0.2)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Draft</span>
          <span style={{ fontFamily: 'monospace', fontSize: '9px', color: 'rgba(255,255,255,0.14)' }}>
            {draftText.length > 0 ? `${draftText.split(/\s+/).filter(Boolean).length} words` : ''}
          </span>
        </div>

        <EditorWithHighlights
          value={draftText}
          onChange={setDraftText}
          onSelectionCreate={handleSelectionCreate}
          onAnchorClick={id => setHighlightedNodeId(id)}
          activeNodeId={highlightedNodeId}
          textareaRef={textareaRef}
        />

        <AnchorBadges onAnchorClick={id => setHighlightedNodeId(id)} activeNodeId={highlightedNodeId} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 16px', borderTop: '1px solid rgba(255,255,255,0.05)', flexShrink: 0 }}>
          <span style={{ fontFamily: 'monospace', fontSize: '9px', color: 'rgba(255,255,255,0.14)' }}>
            {textAnchors.length > 0 ? `${textAnchors.length} linked span${textAnchors.length !== 1 ? 's' : ''}` : ''}
          </span>
          <button
            onClick={() => setSaveModalOpen(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 12px', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: '8px', fontFamily: 'monospace', fontSize: '10px', color: 'rgba(251,191,36,0.8)', cursor: 'pointer', letterSpacing: '0.08em' }}
          >
            <MapPin size={11} />
            SAVE MY PLACE
          </button>
        </div>
      </div>

      {/* ── RIGHT: Outline ─────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', width: '45%', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)', flexShrink: 0 }}>
          <span style={{ fontFamily: 'monospace', fontSize: '9px', color: 'rgba(255,255,255,0.2)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Outline</span>
          <span style={{ fontFamily: 'monospace', fontSize: '9px', color: 'rgba(255,255,255,0.14)' }}>{nodes.filter(n => !n.resolved && !n.superseded_by).length} nodes</span>
        </div>
        <OutlinePanel highlightedNodeId={highlightedNodeId} onHighlight={setHighlightedNodeId} />
      </div>

      {/* Floating selection toolbar */}
      {toolbar && (
        <>
          <SelectionToolbar x={toolbar.x} y={toolbar.y} onCreateNode={handleCreateNodeFromSelection} />
          <div style={{ position: 'fixed', inset: 0, zIndex: 49 }} onClick={() => { setToolbar(null); setSelection(null) }} />
        </>
      )}

      {addModalOpen && (
        <AddNodeModal onClose={() => setAddModalOpen(false)} prefillDescription={addPrefill?.description} />
      )}
      {saveModalOpen && <SavePlaceModal onClose={() => setSaveModalOpen(false)} />}

      <SidePanel />
    </div>
  )
}
```

```tsx
// FILE: src/components/SavePlaceModal.tsx
import { useState } from 'react'
import { X, MapPin } from 'lucide-react'
import { useStore } from '../store'

interface Props { onClose: () => void }

export function SavePlaceModal({ onClose }: Props) {
  const { nodes, addNode, setFocus, updateNode, commitSession } = useStore()
  const [input, setInput] = useState('')
  const [step, setStep] = useState<'ask' | 'pick'>('ask')
  const [matches, setMatches] = useState<typeof nodes>([])

  function finish() {
    commitSession()  // increment session counter
    onClose()
  }

  function handleAsk() {
    if (!input.trim()) return
    const q = input.toLowerCase()
    const found = nodes.filter(n =>
      !n.resolved && !n.superseded_by &&
      (n.label.toLowerCase().includes(q) || n.description.toLowerCase().includes(q))
    )
    if (found.length > 0) {
      setMatches(found.slice(0, 5))
      setStep('pick')
    } else {
      createNew()
    }
  }

  function createNew() {
    const id = `focus-${Date.now()}`
    addNode({
      id,
      label: input.trim(),
      description: input.trim(),
      organizer: 'open_thought',
      centrality: 0.7,
      confidence: 2,
      parent_id: null,
      current_focus: true,
      last_reinforced_at: new Date().toISOString(),
      provenance: 'human',
    })
    setFocus(id)
    finish()
  }

  function pickExisting(nodeId: string) {
    const existing = nodes.find(n => n.id === nodeId)
    updateNode(nodeId, {
      description: existing?.description
        ? existing.description + '\n\n→ ' + input.trim()
        : input.trim(),
      last_reinforced_at: new Date().toISOString(),
    })
    setFocus(nodeId)
    finish()
  }

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[#0a0a15] border border-white/10 rounded-xl w-[420px] shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-white/5">
          <div className="flex items-center gap-2">
            <MapPin size={13} className="text-amber-400" />
            <span className="font-mono text-[11px] text-white/50 tracking-widest">SAVE MY PLACE</span>
          </div>
          <button onClick={onClose} className="text-white/25 hover:text-white/60 transition-colors">
            <X size={14} />
          </button>
        </div>

        {step === 'ask' && (
          <div className="p-5 space-y-4">
            <p className="text-[13px] text-white/60 leading-relaxed" style={{ fontFamily: 'system-ui, sans-serif' }}>
              What's the next thing to figure out or write?
            </p>
            <input
              autoFocus
              className="w-full bg-white/3 border border-white/8 rounded-lg px-3 py-2.5 text-[13px] text-white/85 focus:outline-none focus:border-amber-400/40 placeholder-white/20 transition-colors"
              style={{ fontFamily: 'system-ui, sans-serif' }}
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="e.g. Figure out the opening argument structure"
              onKeyDown={e => e.key === 'Enter' && handleAsk()}
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                className="px-4 py-1.5 font-mono text-[11px] text-white/25 hover:text-white/50 tracking-wider transition-colors"
              >
                CANCEL
              </button>
              <button
                onClick={handleAsk}
                disabled={!input.trim()}
                className="px-4 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 disabled:opacity-30 font-mono text-[11px] text-amber-400 rounded-lg border border-amber-400/25 tracking-wider transition-colors"
              >
                SAVE
              </button>
            </div>
          </div>
        )}

        {step === 'pick' && (
          <div className="p-5 space-y-3">
            <p className="text-[12px] text-white/45 leading-relaxed" style={{ fontFamily: 'system-ui, sans-serif' }}>
              This might already exist — link to one, or create new:
            </p>
            <div className="space-y-1.5">
              {matches.map(n => (
                <button
                  key={n.id}
                  onClick={() => pickExisting(n.id)}
                  className="w-full text-left px-3 py-2.5 rounded-lg border border-white/6 hover:border-white/15 bg-white/2 hover:bg-white/5 transition-all"
                >
                  <div className="text-[12px] text-white/70" style={{ fontFamily: 'system-ui, sans-serif' }}>{n.label}</div>
                  {n.description && (
                    <div className="text-[11px] text-white/30 mt-0.5 truncate" style={{ fontFamily: 'system-ui, sans-serif' }}>
                      {n.description.slice(0, 80)}
                    </div>
                  )}
                </button>
              ))}
              <button
                onClick={createNew}
                className="w-full text-left px-3 py-2.5 rounded-lg border border-amber-400/20 hover:border-amber-400/40 bg-amber-500/5 hover:bg-amber-500/10 transition-all"
              >
                <div className="font-mono text-[11px] text-amber-400/80 tracking-wide">+ CREATE NEW OPEN THOUGHT</div>
                <div className="text-[11px] text-white/30 mt-0.5 truncate" style={{ fontFamily: 'system-ui, sans-serif' }}>
                  "{input.trim()}"
                </div>
              </button>
            </div>
            <button onClick={() => setStep('ask')} className="font-mono text-[10px] text-white/20 hover:text-white/45 tracking-wider transition-colors">
              ← BACK
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
```

```tsx
// FILE: src/components/SidePanel.tsx
import { useState } from 'react'
import { X, Target, CheckCircle, ShieldCheck } from 'lucide-react'
import { useStore } from '../store'
import { ORGANIZER_META } from '../types'

export function SidePanel() {
  const { selectedId, nodes, edges, setSelected, updateNode, setFocus } = useStore()
  const [notesDraft, setNotesDraft] = useState<string | null>(null)
  const [chatInput, setChatInput] = useState('')

  if (!selectedId) return null
  const node = nodes.find(n => n.id === selectedId)
  if (!node) return null

  const meta = ORGANIZER_META[node.organizer]
  const confidence = node.confidence ?? 2

  const connections = edges
    .filter(e => e.from_id === selectedId || e.to_id === selectedId)
    .map(e => {
      const otherId = e.from_id === selectedId ? e.to_id : e.from_id
      const other = nodes.find(n => n.id === otherId)
      const dir = e.from_id === selectedId ? '→' : '←'
      return { edge: e, other, dir }
    })
    .filter(c => c.other)

  const parentNode = node.parent_id ? nodes.find(n => n.id === node.parent_id) : null

  function saveNotes() {
    if (notesDraft !== null) {
      updateNode(node!.id, { description: notesDraft, last_reinforced_at: new Date().toISOString() })
      setNotesDraft(null)
    }
  }

  function handleConfirm() {
    updateNode(node!.id, {
      confidence: 3,
      last_reinforced_at: new Date().toISOString(),
    })
  }

  function handleResolve() {
    updateNode(node!.id, { resolved: true, last_reinforced_at: new Date().toISOString() })
    setSelected(null)
  }

  function handleRestore() {
    updateNode(node!.id, { resolved: false, superseded_by: null })
  }

  const isArchived = node.resolved || !!node.superseded_by

  return (
    <div style={{
      position: 'absolute', top: 0, right: 0,
      height: '100%', width: '272px',
      background: 'rgba(8,8,15,0.95)',
      borderLeft: '1px solid rgba(255,255,255,0.06)',
      backdropFilter: 'blur(12px)',
      display: 'flex', flexDirection: 'column',
      zIndex: 30, overflow: 'hidden',
    }}>
      {/* ── Header ── */}
      <div style={{ padding: '13px 15px 10px', borderBottom: '1px solid rgba(255,255,255,0.05)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
              <span style={{
                fontFamily: 'monospace', fontSize: '9px', fontWeight: 700,
                letterSpacing: '0.1em', padding: '2px 6px', borderRadius: '3px',
                color: meta.color, background: meta.color + '18',
              }}>
                {meta.short}
              </span>
              {parentNode && (
                <span style={{ fontFamily: 'monospace', fontSize: '9px', color: 'rgba(255,255,255,0.22)' }}>
                  → {parentNode.label.slice(0, 22)}{parentNode.label.length > 22 ? '…' : ''}
                </span>
              )}
            </div>
            <h2 style={{
              fontFamily: 'system-ui, -apple-system, sans-serif',
              fontSize: '13px', fontWeight: 600,
              color: 'rgba(255,255,255,0.88)', lineHeight: 1.35,
            }}>
              {node.label}
            </h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '3px', flexShrink: 0 }}>
            <button
              onClick={() => setFocus(node.id)}
              title={node.current_focus ? 'Current focus' : 'Set as focus'}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '3px',
                color: node.current_focus ? '#fbbf24' : 'rgba(255,255,255,0.22)' }}
            >
              <Target size={13} />
            </button>
            <button
              onClick={() => setSelected(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '3px',
                color: 'rgba(255,255,255,0.22)' }}
            >
              <X size={13} />
            </button>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>

        {/* ── Notes ── */}
        <div style={{ padding: '11px 15px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <span style={{ fontFamily: 'monospace', fontSize: '9px', color: 'rgba(255,255,255,0.2)', letterSpacing: '0.1em', textTransform: 'uppercase', display: 'block', marginBottom: '5px' }}>
            Notes
          </span>
          <textarea
            style={{
              width: '100%', background: 'transparent', border: 'none', outline: 'none',
              resize: 'none', fontFamily: 'system-ui, -apple-system, sans-serif',
              fontSize: '12px', color: 'rgba(255,255,255,0.58)', lineHeight: 1.6, boxSizing: 'border-box',
            }}
            value={notesDraft ?? node.description}
            onChange={e => setNotesDraft(e.target.value)}
            onBlur={saveNotes}
            rows={6}
            placeholder="Add notes…"
          />
        </div>

        {/* ── Confidence ── */}
        <div style={{ padding: '11px 15px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span style={{ fontFamily: 'monospace', fontSize: '9px', color: 'rgba(255,255,255,0.2)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              Confidence
            </span>
            {confidence < 3 ? (
              <button
                onClick={handleConfirm}
                title="Mark as confirmed — I trust this"
                style={{
                  display: 'flex', alignItems: 'center', gap: '4px',
                  background: 'none', border: '1px solid rgba(45,212,191,0.22)',
                  borderRadius: '5px', padding: '2px 8px', cursor: 'pointer',
                  fontFamily: 'monospace', fontSize: '9px', color: 'rgba(45,212,191,0.65)',
                  letterSpacing: '0.06em', transition: 'all 0.15s',
                }}
              >
                <ShieldCheck size={10} />
                CONFIRM THIS
              </button>
            ) : (
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontFamily: 'monospace', fontSize: '9px', color: 'rgba(45,212,191,0.5)', letterSpacing: '0.06em' }}>
                <ShieldCheck size={10} />
                CONFIRMED
              </span>
            )}
          </div>
          {/* Three-dot display */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {([1, 2, 3] as const).map(i => (
              <button
                key={i}
                onClick={() => updateNode(node.id, { confidence: i, last_reinforced_at: new Date().toISOString() })}
                title={i === 1 ? 'Rough' : i === 2 ? 'Fine' : 'Confirmed'}
                style={{
                  display: 'flex', alignItems: 'center', gap: '3px',
                  background: confidence === i ? 'rgba(255,255,255,0.06)' : 'none',
                  border: `1px solid ${confidence === i ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.06)'}`,
                  borderRadius: '5px', padding: '3px 8px', cursor: 'pointer',
                  transition: 'all 0.12s',
                }}
              >
                {[1, 2, 3].map(d => (
                  <span key={d} style={{
                    display: 'inline-block', width: '5px', height: '5px', borderRadius: '50%',
                    background: d <= i
                      ? `rgba(255,255,255,${i === 3 ? 0.65 : 0.35})`
                      : 'rgba(255,255,255,0.1)',
                  }} />
                ))}
              </button>
            ))}
            <span style={{ fontFamily: 'system-ui, sans-serif', fontSize: '10px', color: 'rgba(255,255,255,0.28)', marginLeft: '2px' }}>
              {confidence === 1 ? 'rough' : confidence === 2 ? 'fine' : 'confirmed'}
            </span>
          </div>
        </div>

        {/* ── Connections ── */}
        {connections.length > 0 && (
          <div style={{ padding: '11px 15px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <span style={{ fontFamily: 'monospace', fontSize: '9px', color: 'rgba(255,255,255,0.2)', letterSpacing: '0.1em', textTransform: 'uppercase', display: 'block', marginBottom: '6px' }}>
              Connections
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {connections.map(({ edge, other, dir }) => (
                <button
                  key={edge.id}
                  onClick={() => setSelected(other!.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', textAlign: 'left', width: '100%' }}
                >
                  <span style={{ fontFamily: 'monospace', fontSize: '9px', color: 'rgba(255,255,255,0.2)', flexShrink: 0 }}>{dir}</span>
                  <span style={{ fontFamily: 'monospace', fontSize: '9px', color: 'rgba(255,255,255,0.22)', minWidth: '56px', flexShrink: 0 }}>
                    {edge.relationship.replace('_', ' ')}
                  </span>
                  <span style={{ fontFamily: 'system-ui, sans-serif', fontSize: '11px', color: 'rgba(255,255,255,0.5)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {other!.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Resolve / Restore ── */}
        <div style={{ padding: '11px 15px' }}>
          {!isArchived ? (
            <button
              onClick={handleResolve}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                background: 'none', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '6px', padding: '6px 10px', cursor: 'pointer',
                fontFamily: 'monospace', fontSize: '9px', color: 'rgba(255,255,255,0.28)',
                letterSpacing: '0.08em', transition: 'all 0.15s', width: '100%',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(45,212,191,0.25)'
                ;(e.currentTarget as HTMLButtonElement).style.color = 'rgba(45,212,191,0.65)'
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.08)'
                ;(e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.28)'
              }}
            >
              <CheckCircle size={11} />
              RESOLVE — move to archive
            </button>
          ) : (
            <div>
              <p style={{ fontFamily: 'system-ui, sans-serif', fontSize: '11px', color: 'rgba(255,255,255,0.3)', marginBottom: '6px' }}>
                {node.resolved ? 'Resolved.' : 'Superseded.'}
                {node.resolution_note ? ` ${node.resolution_note}` : ''}
              </p>
              <button
                onClick={handleRestore}
                style={{ fontFamily: 'monospace', fontSize: '9px', color: 'rgba(255,255,255,0.22)', background: 'none', border: 'none', cursor: 'pointer', letterSpacing: '0.08em' }}
              >
                RESTORE
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Chat input ── */}
      <div style={{ padding: '7px 11px', borderTop: '1px solid rgba(255,255,255,0.05)', background: 'rgba(6,6,12,1)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', padding: '5px 11px' }}>
          <input
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontFamily: 'system-ui, sans-serif', fontSize: '12px', color: 'rgba(255,255,255,0.6)' }}
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            placeholder="Ask about or update this node…"
            onKeyDown={e => { if (e.key === 'Enter' && chatInput.trim()) setChatInput('') }}
          />
        </div>
      </div>
    </div>
  )
}
```

```tsx
// FILE: src/components/SolarSystem.tsx
import { useEffect, useRef, useCallback } from 'react'
import { useStore } from '../store'
import { drawFrame, makeInitialAnimState, type AnimState } from '../canvas/draw'
import { initAnimState, tickAnimState, getFocusWorldPos } from '../canvas/update'

import { computeRenderStates } from '../canvas/renderState'
import { generateStarfield } from '../canvas/draw'
import { getPlanetPos } from '../canvas/draw'

const DPR = window.devicePixelRatio || 1

export function SolarSystem() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef = useRef<AnimState>(makeInitialAnimState())
  const starfieldRef = useRef(generateStarfield(280))
  const rafRef = useRef(0)

  const nodes = useStore(s => s.nodes)
  const edges = useStore(s => s.edges)
  const focusMode = useStore(s => s.focusMode)
  const selectedId = useStore(s => s.selectedId)
  const setSelected = useStore(s => s.setSelected)
  const setFocusMode = useStore(s => s.setFocusMode)

  // Refs so the animation loop always reads current values
  const nodesRef = useRef(nodes); nodesRef.current = nodes
  const edgesRef = useRef(edges); edgesRef.current = edges
  const focusModeRef = useRef(focusMode); focusModeRef.current = focusMode
  const selectedRef = useRef(selectedId); selectedRef.current = selectedId
  const renderStatesRef = useRef(computeRenderStates(nodes, edges))

  // Recompute render states whenever nodes/edges change
  useEffect(() => {
    const rs = computeRenderStates(nodes, edges)
    renderStatesRef.current = rs
    initAnimState(nodes, edges, rs, animRef.current)
  }, [nodes, edges])

  // Camera: snap to focus node on first load
  useEffect(() => {
    const rs = computeRenderStates(nodes, edges)
    setTimeout(() => {
      const pos = getFocusWorldPos(nodes, edges, rs, animRef.current)
      if (pos) {
        animRef.current.camera.tx = pos.x
        animRef.current.camera.ty = pos.y
        animRef.current.camera.tzoom = 1.35
        animRef.current.camera.x = pos.x
        animRef.current.camera.y = pos.y
        animRef.current.camera.zoom = 1.35
      }
    }, 60)
  }, []) // eslint-disable-line

  // Resize
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const resize = () => { canvas.width = canvas.offsetWidth * DPR; canvas.height = canvas.offsetHeight * DPR }
    resize()
    const ro = new ResizeObserver(resize); ro.observe(canvas)
    return () => ro.disconnect()
  }, [])

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const loop = (ts: number) => {
      const anim = animRef.current
      const dt = anim.lastFrameTime ? Math.min(ts - anim.lastFrameTime, 100) : 16
      anim.lastFrameTime = ts
      tickAnimState(nodesRef.current, edgesRef.current, renderStatesRef.current, anim, dt)
      const ctx = canvas.getContext('2d')!
      const w = canvas.width / DPR, h = canvas.height / DPR
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0)
      drawFrame(ctx, w, h, nodesRef.current, edgesRef.current, anim, starfieldRef.current, renderStatesRef.current, focusModeRef.current, selectedRef.current)
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current; if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top
    const anim = animRef.current
    let hit: string | null = null, hitR = Infinity
    for (const sp of anim.screenPositions) {
      const screenX = (sp.x - anim.camera.x) * anim.camera.zoom + canvas.offsetWidth / 2
      const screenY = (sp.y - anim.camera.y) * anim.camera.zoom + canvas.offsetHeight / 2
      const dist = Math.hypot(sx - screenX, sy - screenY)
      const threshold = Math.max(sp.r * anim.camera.zoom, 12)
      if (dist < threshold && dist < hitR) { hit = sp.nodeId; hitR = dist }
    }
    if (hit) {
      setSelected(hit === selectedRef.current ? null : hit)
      const clicked = nodesRef.current.find(n => n.id === hit)
      if (clicked && renderStatesRef.current[hit] === 'planet') {
        const pos = getPlanetPos(clicked, anim)
        anim.camera.tx = pos.x; anim.camera.ty = pos.y; anim.camera.tzoom = 2.2
        setFocusMode(false)
      }
    } else {
      setSelected(null)
    }
  }, [setSelected, setFocusMode])

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const anim = animRef.current
    const factor = e.deltaY > 0 ? 0.92 : 1.09
    const newZoom = Math.max(0.3, Math.min(4, anim.camera.tzoom * factor))
    anim.camera.tzoom = newZoom
    if (newZoom < 0.75 && focusModeRef.current) {
      setFocusMode(false)
      anim.camera.tx = 0; anim.camera.ty = 0
    }
  }, [setFocusMode])

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full cursor-crosshair"
      onClick={handleClick}
      onWheel={handleWheel}
      style={{ display: 'block' }}
    />
  )
}
```

```tsx
// FILE: src/components/Topbar.tsx
import { useRef, useState } from 'react'
import { Plus, Download, Upload, Globe, AlignLeft, Pencil } from 'lucide-react'
import { useStore } from '../store'
import { computeRenderStates } from '../canvas/renderState'
import { ORGANIZER_META, greetingFromFocus } from '../types'

interface Props { onAddNode: () => void }

// ─── Project switcher dropdown ────────────────────────────────────────────────

function ProjectSwitcher() {
  const { projectId, projectName, allProjectsMeta, switchProject, newProject, loadExampleProject, renameProject } = useStore()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [nameInput, setNameInput] = useState(projectName)
  const projects = allProjectsMeta()

  function commitRename() {
    if (nameInput.trim()) renameProject(nameInput.trim())
    setEditing(false)
  }

  return (
    <div style={{ position: 'relative' }}>
      {editing ? (
        <input
          autoFocus
          value={nameInput}
          onChange={e => setNameInput(e.target.value)}
          onBlur={commitRename}
          onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditing(false) }}
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: '6px',
            padding: '2px 8px',
            fontFamily: 'monospace',
            fontSize: '11px',
            color: 'rgba(255,255,255,0.8)',
            outline: 'none',
            width: '160px',
          }}
        />
      ) : (
        <button
          onClick={() => setOpen(v => !v)}
          onDoubleClick={() => { setNameInput(projectName); setEditing(true) }}
          title="Click to switch projects · Double-click to rename"
          style={{
            background: open ? 'rgba(255,255,255,0.06)' : 'none',
            border: '1px solid',
            borderColor: open ? 'rgba(255,255,255,0.12)' : 'transparent',
            borderRadius: '6px',
            padding: '3px 8px',
            fontFamily: 'monospace',
            fontSize: '11px',
            color: 'rgba(255,255,255,0.65)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            transition: 'all 0.15s',
          }}
        >
          {projectName}
          <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '9px' }}>▾</span>
        </button>
      )}

      {open && (
        <>
          {/* Backdrop */}
          <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setOpen(false)} />
          <div style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            minWidth: '200px',
            background: '#0e0e1a',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '10px',
            padding: '6px',
            zIndex: 100,
            boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
          }}>
            {projects.map(p => (
              <button
                key={p.id}
                onClick={() => { switchProject(p.id); setOpen(false) }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '6px 10px',
                  background: p.id === projectId ? 'rgba(255,255,255,0.06)' : 'none',
                  border: 'none',
                  borderRadius: '6px',
                  fontFamily: 'system-ui, sans-serif',
                  fontSize: '12px',
                  color: p.id === projectId ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.5)',
                  cursor: 'pointer',
                }}
              >
                {p.name}
                {p.id === projectId && <span style={{ fontFamily: 'monospace', fontSize: '9px', color: 'rgba(45,212,191,0.7)', marginLeft: '6px' }}>active</span>}
              </button>
            ))}
            <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', margin: '6px 2px' }} />
            {/* Rename current project */}
            <button
              onClick={() => { setNameInput(projectName); setEditing(true); setOpen(false) }}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px', width: '100%', textAlign: 'left',
                padding: '6px 10px', background: 'none', border: 'none',
                borderRadius: '6px', fontFamily: 'monospace', fontSize: '10px',
                color: 'rgba(255,255,255,0.35)', cursor: 'pointer', letterSpacing: '0.06em',
              }}
            >
              <Pencil size={10} />
              RENAME PROJECT
            </button>
            <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', margin: '6px 2px' }} />
            <button
              onClick={() => { newProject(); setOpen(false) }}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '6px 10px', background: 'none', border: 'none',
                borderRadius: '6px', fontFamily: 'monospace', fontSize: '10px',
                color: 'rgba(255,255,255,0.4)', cursor: 'pointer', letterSpacing: '0.06em',
              }}
            >
              + NEW PROJECT
            </button>
            <button
              onClick={() => { loadExampleProject(); setOpen(false) }}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '6px 10px', background: 'none', border: 'none',
                borderRadius: '6px', fontFamily: 'monospace', fontSize: '10px',
                color: 'rgba(251,191,36,0.5)', cursor: 'pointer', letterSpacing: '0.06em',
              }}
            >
              EXAMPLE PROJECT
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Main Topbar ──────────────────────────────────────────────────────────────

export function Topbar({ onAddNode }: Props) {
  const {
    nodes, edges, focusMode, setFocusMode, viewMode, setViewMode,
    greetingStyle, setGreetingStyle, currentSession, exportJSON, importJSON,
  } = useStore()
  const fileRef = useRef<HTMLInputElement>(null)

  const renderStates = computeRenderStates(nodes, edges)

  const activeNodes = nodes.filter(n => !n.resolved && !n.superseded_by)
  const counts = {
    core:    activeNodes.filter(n => n.organizer === 'core_idea' && renderStates[n.id] !== 'star').length,
    tension: activeNodes.filter(n => n.organizer === 'point_of_tension' && renderStates[n.id] !== 'star').length,
    open:    activeNodes.filter(n => n.organizer === 'open_thought').length,
  }

  const focusNode = nodes.find(n => n.current_focus)

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return
    const r = new FileReader()
    r.onload = ev => importJSON(ev.target?.result as string)
    r.readAsText(f); e.target.value = ''
  }

  return (
    <div className="shrink-0 z-20">
      {/* ── Main bar ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-white/5 bg-[#06060e]/90 backdrop-blur-sm">

        {/* Brand */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-4 h-4 rounded-full bg-gradient-to-br from-yellow-300 to-amber-500 shadow-sm shadow-amber-500/40" />
          <span className="font-mono text-[12px] font-semibold text-white/40 tracking-widest uppercase">Thread</span>
        </div>

        <span className="text-white/10 font-mono text-xs shrink-0">·</span>

        {/* Project switcher */}
        <ProjectSwitcher />

        <span className="text-white/10 font-mono text-xs shrink-0">·</span>

        {/* Node counts */}
        <div className="flex items-center gap-3">
          {counts.core > 0 && (
            <span className="font-mono text-[11px] tracking-wide" style={{ color: ORGANIZER_META.core_idea.color }}>
              {counts.core} core
            </span>
          )}
          {counts.tension > 0 && (
            <span className="font-mono text-[11px] tracking-wide" style={{ color: ORGANIZER_META.point_of_tension.color }}>
              {counts.tension} tension
            </span>
          )}
          {counts.open > 0 && (
            <span className="font-mono text-[11px] tracking-wide" style={{ color: ORGANIZER_META.open_thought.color }}>
              {counts.open} open
            </span>
          )}
        </div>

        <div className="flex-1" />

        {/* System / Linear toggle */}
        <div className="flex items-center bg-white/4 rounded-lg p-0.5 border border-white/6">
          <button
            onClick={() => setViewMode('system')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-mono text-[10px] tracking-wider uppercase transition-all ${viewMode === 'system' ? 'bg-white/10 text-white/80' : 'text-white/30 hover:text-white/50'}`}
          >
            <Globe size={11} />System
          </button>
          <button
            onClick={() => setViewMode('linear')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-mono text-[10px] tracking-wider uppercase transition-all ${viewMode === 'linear' ? 'bg-white/10 text-white/80' : 'text-white/30 hover:text-white/50'}`}
          >
            <AlignLeft size={11} />Linear
          </button>
        </div>

        {/* Focus mode (system view only) */}
        {viewMode === 'system' && (
          <div className="flex items-center bg-white/4 rounded-lg p-0.5 border border-white/6">
            <button
              onClick={() => setFocusMode(true)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-mono text-[10px] tracking-wider uppercase transition-all ${focusMode ? 'bg-white/10 text-white/80' : 'text-white/30 hover:text-white/50'}`}
            >
              Focus
            </button>
            <button
              onClick={() => setFocusMode(false)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-mono text-[10px] tracking-wider uppercase transition-all ${!focusMode ? 'bg-white/10 text-white/80' : 'text-white/30 hover:text-white/50'}`}
            >
              Full
            </button>
          </div>
        )}

        <button
          onClick={onAddNode}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white/6 hover:bg-white/10 border border-white/10 rounded-lg font-mono text-[11px] text-white/60 hover:text-white/80 transition-colors tracking-wider"
        >
          <Plus size={12} />ADD
        </button>

        <button onClick={exportJSON} title="Export JSON" className="text-white/20 hover:text-white/50 transition-colors p-1">
          <Download size={13} />
        </button>
        <button onClick={() => fileRef.current?.click()} title="Import JSON" className="text-white/20 hover:text-white/50 transition-colors p-1">
          <Upload size={13} />
        </button>
        <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
      </div>

      {/* ── Greeting band ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-white/4 bg-[#0a0a14]/80">
        <span className="font-mono text-[10px] text-white/22 tracking-widest shrink-0">// WHERE YOU LEFT OFF</span>

        {focusNode ? (
          <p className="flex-1 text-[12px] text-white/58 leading-snug min-w-0" style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
            {greetingFromFocus(focusNode, greetingStyle)}
          </p>
        ) : (
          <p className="flex-1 text-[12px] text-white/20 italic" style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
            No focus set — save your place to set a re-entry point.
          </p>
        )}

        {/* Greeting style toggle: Q / A */}
        <div
          className="flex items-center rounded border border-white/8 overflow-hidden shrink-0"
          title="Greeting style: Question (raw) or Action (transformed)"
        >
          <button
            onClick={() => setGreetingStyle('question')}
            className="px-2 py-0.5 font-mono text-[10px] tracking-wider transition-all"
            style={{
              background: greetingStyle === 'question' ? 'rgba(251,191,36,0.15)' : 'transparent',
              color: greetingStyle === 'question' ? '#fbbf24' : 'rgba(255,255,255,0.22)',
            }}
          >
            Q
          </button>
          <button
            onClick={() => setGreetingStyle('action')}
            className="px-2 py-0.5 font-mono text-[10px] tracking-wider transition-all"
            style={{
              background: greetingStyle === 'action' ? 'rgba(45,212,191,0.12)' : 'transparent',
              color: greetingStyle === 'action' ? '#2dd4bf' : 'rgba(255,255,255,0.22)',
            }}
          >
            A
          </button>
        </div>

        {/* Session counter */}
        <span className="font-mono text-[9px] text-white/18 shrink-0 tracking-widest">
          SESSION {currentSession}
        </span>
      </div>
    </div>
  )
}
```

```tsx
// FILE: src/data/seed.ts
import type { ThreadProject } from '../types'

// SEED is the "Example project" — only loaded when the user explicitly requests it.
// New projects start blank. This data is about Thread's own product research and
// should NOT be the default on first load.
export const SEED: ThreadProject = {
  id: 'seed',
  name: 'Example project',
  thesis: 'Discontinuation of deep work is a structural memory problem, not a laziness problem',
  greetingStyle: 'action',
  currentSession: 1,
  nodes: [
    {
      id: 'p1',
      label: 'Content preserved, epistemic state is not',
      description: 'Existing tools capture what was written but not which claims are settled, which are still open, or what was about to happen next. The library survives; the question is lost.',
      organizer: 'core_idea',
      centrality: 0.9,
      parent_id: null,
      current_focus: false,
      last_reinforced_at: new Date().toISOString(),
      provenance: 'human',
      color: '#2dd4bf',
      confidence: 3,
      session_id: 1,
    },
    {
      id: 'p2',
      label: 'Reconstruction tax causes avoidance',
      description: 'The brain learns that returning to a project means paying an upfront cost before any real progress is possible. This learned friction creates procrastination.',
      organizer: 'core_idea',
      centrality: 0.75,
      parent_id: null,
      current_focus: false,
      last_reinforced_at: new Date().toISOString(),
      provenance: 'human',
      color: '#60a5fa',
      confidence: 2,
      session_id: 1,
    },
    {
      id: 'p3',
      label: 'Visual map enables faster re-entry than text summary',
      description: 'Seeing the argument as a spatial structure rather than re-reading a summary changes re-entry speed and confidence. Still needs prototype validation.',
      organizer: 'core_idea',
      centrality: 0.55,
      parent_id: null,
      current_focus: false,
      last_reinforced_at: new Date().toISOString(),
      provenance: 'human',
      color: '#a78bfa',
      confidence: 1,
      session_id: 1,
    },
    {
      id: 'p4',
      label: 'Existing PKM tools don\'t solve this',
      description: 'Obsidian, Notion, and Roam address content storage. None address the persistence of epistemic state — which claims are settled, which are open — across sessions.',
      organizer: 'core_idea',
      centrality: 0.4,
      parent_id: null,
      current_focus: false,
      last_reinforced_at: new Date().toISOString(),
      provenance: 'human',
      color: '#34d399',
      confidence: 2,
      session_id: 1,
    },
    {
      id: 'm1',
      label: '"Parking on the hill" workaround',
      description: 'r/PhD users independently described session-end bullet points: what was done, what\'s next. A manual, low-fidelity version of epistemic state saving.',
      organizer: 'core_idea',
      centrality: 0.45,
      parent_id: null,
      current_focus: false,
      last_reinforced_at: new Date().toISOString(),
      provenance: 'human',
      color: '#67e8f9',
      confidence: 2,
      session_id: 1,
    },
    {
      id: 'm2',
      label: '"3 hours scrolling before I edit"',
      description: '"I scroll up and down for 3 hours skimming until I notice something to edit, then 3 hours into that edit I remember what I meant to write about." — r/PhD',
      organizer: 'core_idea',
      centrality: 0.38,
      parent_id: null,
      current_focus: false,
      last_reinforced_at: new Date().toISOString(),
      provenance: 'human',
      color: '#93c5fd',
      confidence: 3,
      session_id: 1,
    },
    {
      id: 's1',
      label: 'Bhatiya vault quote',
      description: '"My vault was a library of answers, but I had forgotten my original question." Not yet structurally linked to a premise.',
      organizer: 'core_idea',
      centrality: 0.12,
      parent_id: null,
      current_focus: false,
      last_reinforced_at: new Date().toISOString(),
      provenance: 'human',
      color: '#fef3c7',
      confidence: 1,
      session_id: 1,
    },
    {
      id: 's2',
      label: 'r/GradSchool responses',
      description: 'Post flagged as product-fishing. Top comment: "Who\'s betting OP will post about a magical new app." Useful as counter-signal on problem framing.',
      organizer: 'core_idea',
      centrality: 0.08,
      parent_id: null,
      current_focus: false,
      last_reinforced_at: new Date().toISOString(),
      provenance: 'human',
      color: '#fef3c7',
      confidence: 1,
      session_id: 1,
    },
    {
      id: 'a1',
      label: 'Visual map may just recreate the complexity problem',
      description: 'A cluttered graph could be harder to re-enter than a clean text summary. Visualization only helps if the map itself is legible at a glance — not yet proven.',
      organizer: 'point_of_tension',
      centrality: 0.55,
      parent_id: 'p3',
      current_focus: false,
      last_reinforced_at: new Date().toISOString(),
      provenance: 'human',
      color: '#fb7185',
      confidence: 2,
      session_id: 1,
    },
    {
      id: 'c1',
      label: 'What is the right re-entry UX on load?',
      description: 'Does the system show the full map first, or the active focus first? How much context does re-entry need to orient the user without overwhelming them?',
      organizer: 'open_thought',
      centrality: 0.7,
      parent_id: null,
      current_focus: true,
      last_reinforced_at: new Date().toISOString(),
      provenance: 'human',
      color: '#e0f7ff',
      confidence: 2,
      session_id: 1,
    },
  ],
  edges: [
    { id: 'e1', from_id: 'm1', to_id: 'p1', relationship: 'supports' },
    { id: 'e2', from_id: 'm2', to_id: 'p2', relationship: 'supports' },
    { id: 'e3', from_id: 'p1', to_id: 'p2', relationship: 'supports' },
    { id: 'e4', from_id: 'p2', to_id: 'p3', relationship: 'depends_on' },
    { id: 'e5', from_id: 'a1', to_id: 'p3', relationship: 'challenges' },
  ],
  textAnchors: [],
  draftText: '',
}
```

```tsx
// FILE: src/main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

```tsx
// FILE: src/store.ts
import { create } from 'zustand'
import type { ThreadNode, ThreadEdge, ThreadProject, TextAnchor } from './types'
import { SEED } from './data/seed'

const V3_KEY = 'thread_v3'

// ─── Migration helpers ────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrateNode(n: any): ThreadNode {
  return {
    ...n,
    confidence: (n.confidence ?? 2) as 1 | 2 | 3,
    session_id: (n.session_id ?? 1) as number,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrateProject(p: any): ThreadProject {
  return {
    id: (p.id as string) ?? `proj-${Date.now()}`,
    name: (p.name as string) ?? 'My project',
    thesis: (p.thesis as string) ?? '',
    nodes: ((p.nodes ?? []) as unknown[]).map(n => migrateNode(n)),
    edges: (p.edges as ThreadEdge[]) ?? [],
    textAnchors: (p.textAnchors as TextAnchor[]) ?? [],
    draftText: (p.draftText as string) ?? '',
    greetingStyle: (p.greetingStyle as 'action' | 'question') ?? 'action',
    currentSession: (p.currentSession as number) ?? 1,
    savedAt: p.savedAt as string | undefined,
  }
}

function blankProject(name: string): ThreadProject {
  return {
    id: `proj-${Date.now()}`,
    name,
    thesis: '',
    nodes: [],
    edges: [],
    textAnchors: [],
    draftText: '',
    greetingStyle: 'action',
    currentSession: 1,
  }
}

interface StoredV3 {
  activeProjectId: string
  projects: ThreadProject[]
}

function loadAll(): { active: ThreadProject; all: ThreadProject[] } {
  try {
    const raw = localStorage.getItem(V3_KEY)
    if (raw) {
      const data = JSON.parse(raw) as StoredV3
      const projects = data.projects.map(p => migrateProject(p))
      const active = projects.find(p => p.id === data.activeProjectId) ?? projects[0]
      return { active, all: projects }
    }
  } catch {}

  // Check for old v2 single-project data to migrate
  try {
    const oldRaw = localStorage.getItem('thread_solar_v2')
    if (oldRaw) {
      const old = JSON.parse(oldRaw)
      const migrated = migrateProject({ id: 'migrated-v2', name: 'My project', ...old })
      return { active: migrated, all: [migrated] }
    }
  } catch {}

  // Brand new install: start with a blank project
  const blank = blankProject('My project')
  return { active: blank, all: [blank] }
}

function saveAll(state: Store) {
  const currentProj: ThreadProject = {
    id: state.projectId,
    name: state.projectName,
    thesis: state.thesis,
    nodes: state.nodes,
    edges: state.edges,
    textAnchors: state.textAnchors,
    draftText: state.draftText,
    greetingStyle: state.greetingStyle,
    currentSession: state.currentSession,
    savedAt: new Date().toISOString(),
  }
  const updated = state._allProjects
    .map(p => p.id === state.projectId ? currentProj : p)
  if (!updated.some(p => p.id === state.projectId)) updated.push(currentProj)

  localStorage.setItem(V3_KEY, JSON.stringify({
    activeProjectId: state.projectId,
    projects: updated,
  }))
}

// ─── Store interface ──────────────────────────────────────────────────────────

type ViewMode = 'system' | 'linear'

export interface ProjectMeta { id: string; name: string }

interface Store {
  // Current project identity
  projectId: string
  projectName: string
  // Current project data
  thesis: string
  nodes: ThreadNode[]
  edges: ThreadEdge[]
  textAnchors: TextAnchor[]
  draftText: string
  greetingStyle: 'action' | 'question'
  currentSession: number
  // All projects (for switcher)
  _allProjects: ThreadProject[]
  // UI state
  selectedId: string | null
  focusMode: boolean
  viewMode: ViewMode

  // Project management
  newProject: (name?: string) => void
  switchProject: (id: string) => void
  loadExampleProject: () => void
  renameProject: (name: string) => void
  allProjectsMeta: () => ProjectMeta[]

  // Data actions
  setSelected: (id: string | null) => void
  setFocusMode: (v: boolean) => void
  setViewMode: (v: ViewMode) => void
  setThesis: (t: string) => void
  setFocus: (id: string) => void
  setDraftText: (t: string) => void
  setGreetingStyle: (s: 'action' | 'question') => void
  // addNode auto-stamps session_id = currentSession
  addNode: (n: Omit<ThreadNode, 'session_id'>) => void
  updateNode: (id: string, patch: Partial<ThreadNode>) => void
  addEdge: (e: ThreadEdge) => void
  removeEdge: (id: string) => void
  addTextAnchor: (a: TextAnchor) => void
  removeTextAnchor: (id: string) => void
  // Commit the current session (called by SavePlaceModal at end of session)
  commitSession: () => void

  exportJSON: () => void
  importJSON: (json: string) => void
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useStore = create<Store>((set, get) => {
  const { active, all } = loadAll()

  return {
    projectId: active.id,
    projectName: active.name,
    thesis: active.thesis,
    nodes: active.nodes,
    edges: active.edges,
    textAnchors: active.textAnchors,
    draftText: active.draftText,
    greetingStyle: active.greetingStyle,
    currentSession: active.currentSession,
    _allProjects: all,
    selectedId: null,
    focusMode: true,
    viewMode: 'system',

    // ── Project management ──────────────────────────────────────────────

    allProjectsMeta: () => get()._allProjects.map(p => ({ id: p.id, name: p.name })),

    newProject: (name = 'Untitled') => {
      const proj = blankProject(name)
      set(s => {
        const currentProj = extractProject(s)
        const updated = s._allProjects.map(p => p.id === s.projectId ? currentProj : p)
        if (!updated.some(p => p.id === s.projectId)) updated.push(currentProj)
        return {
          projectId: proj.id,
          projectName: proj.name,
          thesis: proj.thesis,
          nodes: proj.nodes,
          edges: proj.edges,
          textAnchors: proj.textAnchors,
          draftText: proj.draftText,
          greetingStyle: proj.greetingStyle,
          currentSession: proj.currentSession,
          _allProjects: [...updated, proj],
          selectedId: null,
        }
      })
    },

    switchProject: (id) => {
      const target = get()._allProjects.find(p => p.id === id)
      if (!target || target.id === get().projectId) return
      set(s => {
        const currentProj = extractProject(s)
        const updated = s._allProjects.map(p => p.id === s.projectId ? currentProj : p)
        return {
          projectId: target.id,
          projectName: target.name,
          thesis: target.thesis,
          nodes: target.nodes,
          edges: target.edges,
          textAnchors: target.textAnchors,
          draftText: target.draftText,
          greetingStyle: target.greetingStyle,
          currentSession: target.currentSession,
          _allProjects: updated,
          selectedId: null,
        }
      })
    },

    loadExampleProject: () => {
      const example = migrateProject({ ...SEED, id: `example-${Date.now()}`, name: 'Example project' } as Record<string, unknown>)
      set(s => {
        const currentProj = extractProject(s)
        const updated = s._allProjects.map(p => p.id === s.projectId ? currentProj : p)
        if (!updated.some(p => p.id === s.projectId)) updated.push(currentProj)
        return {
          projectId: example.id,
          projectName: example.name,
          thesis: example.thesis,
          nodes: example.nodes,
          edges: example.edges,
          textAnchors: example.textAnchors,
          draftText: example.draftText,
          greetingStyle: example.greetingStyle,
          currentSession: example.currentSession,
          _allProjects: [...updated, example],
          selectedId: null,
        }
      })
    },

    renameProject: (name) => set({ projectName: name }),

    // ── Data actions ────────────────────────────────────────────────────

    setSelected: (id) => set({ selectedId: id }),
    setFocusMode: (v) => set({ focusMode: v }),
    setViewMode: (v) => set({ viewMode: v }),
    setThesis: (t) => set({ thesis: t }),
    setDraftText: (t) => set({ draftText: t }),
    setGreetingStyle: (s) => set({ greetingStyle: s }),

    setFocus: (id) =>
      set(s => ({ nodes: s.nodes.map(n => ({ ...n, current_focus: n.id === id })) })),

    // Auto-stamps session_id = currentSession
    addNode: (n) => set(s => ({
      nodes: [...s.nodes, { ...n, session_id: s.currentSession }],
    })),

    updateNode: (id, patch) =>
      set(s => ({ nodes: s.nodes.map(n => n.id === id ? { ...n, ...patch } : n) })),

    addEdge: (e) => set(s => ({ edges: [...s.edges, e] })),
    removeEdge: (id) => set(s => ({ edges: s.edges.filter(e => e.id !== id) })),

    addTextAnchor: (a) => set(s => ({ textAnchors: [...s.textAnchors, a] })),
    removeTextAnchor: (id) => set(s => ({ textAnchors: s.textAnchors.filter(a => a.id !== id) })),

    // Increment the session counter — called at end of "Save my place"
    commitSession: () => set(s => ({ currentSession: s.currentSession + 1 })),

    exportJSON: () => {
      const s = get()
      const proj = extractProject(s)
      const blob = new Blob([JSON.stringify(proj, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `${s.projectName.replace(/\s+/g, '-').toLowerCase()}.json`; a.click()
      URL.revokeObjectURL(url)
    },

    importJSON: (json) => {
      try {
        const p = migrateProject(JSON.parse(json) as Record<string, unknown>)
        set(s => {
          const updated = s._allProjects.map(pr => pr.id === s.projectId ? extractProject(s) : pr)
          const newProj = { ...p, id: `import-${Date.now()}`, name: p.name || 'Imported' }
          return {
            projectId: newProj.id,
            projectName: newProj.name,
            thesis: newProj.thesis,
            nodes: newProj.nodes,
            edges: newProj.edges,
            textAnchors: newProj.textAnchors,
            draftText: newProj.draftText,
            greetingStyle: newProj.greetingStyle,
            currentSession: newProj.currentSession,
            _allProjects: [...updated, newProj],
            selectedId: null,
          }
        })
      } catch { alert('Invalid JSON') }
    },
  }
})

function extractProject(s: Store): ThreadProject {
  return {
    id: s.projectId,
    name: s.projectName,
    thesis: s.thesis,
    nodes: s.nodes,
    edges: s.edges,
    textAnchors: s.textAnchors,
    draftText: s.draftText,
    greetingStyle: s.greetingStyle,
    currentSession: s.currentSession,
    savedAt: new Date().toISOString(),
  }
}

useStore.subscribe((s) => saveAll(s))
```

```tsx
// FILE: src/types.ts
// ─── Organizer: the only thing the user explicitly assigns ───────────────────
export type Organizer = 'core_idea' | 'point_of_tension' | 'open_thought'

// ─── RenderState: computed, never set directly by the user ───────────────────
export type RenderState = 'comet' | 'star' | 'planet' | 'asteroid' | 'moon'

export type Provenance = 'human' | 'ai_proposed_confirmed' | 'ai_proposed_pending'
export type Relationship = 'supports' | 'challenges' | 'depends_on' | 'supersedes'

export interface ThreadNode {
  id: string
  label: string
  description: string
  organizer: Organizer
  centrality: number        // 0–1; 1 = closest sun orbit. <0.3 forces star render.
  parent_id: string | null
  current_focus: boolean
  last_reinforced_at: string
  provenance: Provenance
  color?: string
  // Confidence: how much the user trusts this node still reflects their intent
  confidence: 1 | 2 | 3    // 1=rough, 2=fine (default), 3=confirmed
  // Session this node was last created/reinforced in
  session_id: number        // starts at 1
  // Resolution / lifecycle
  resolved?: boolean
  resolution_note?: string
  superseded_by?: string | null
}

export interface ThreadEdge {
  id: string
  from_id: string
  to_id: string
  relationship: Relationship
}

// ─── TextAnchor: links a span in the draft editor to a node ──────────────────
export interface TextAnchor {
  id: string
  node_id: string
  start: number
  end: number
  text: string
}

export interface ThreadProject {
  id: string
  name: string
  thesis: string
  nodes: ThreadNode[]
  edges: ThreadEdge[]
  textAnchors: TextAnchor[]
  draftText: string
  greetingStyle: 'action' | 'question'
  currentSession: number    // increments on each "Save my place"
  savedAt?: string
}

// ─── Greeting band sentence ────────────────────────────────────────────────────
// 'action' = transform into imperative. 'question' = raw content as-written.
export function greetingFromFocus(node: ThreadNode, style: 'action' | 'question' = 'action'): string {
  if (style === 'question') {
    // Show the label exactly as the user wrote it — if it's a question, it reads as a question.
    return node.label
  }
  // Action style: transform into an imperative frame
  const label = node.label.trim().replace(/\?$/, '')
  switch (node.organizer) {
    case 'core_idea':
      return `Continue developing: ${label}`
    case 'point_of_tension': {
      const clause = node.description?.split(/[.!?]/)[0]?.trim()?.toLowerCase()
      return clause ? `Resolve: ${label} — ${clause}` : `Resolve: ${label}`
    }
    case 'open_thought': {
      const lower = label.charAt(0).toLowerCase() + label.slice(1)
      if (/^(does|do|is|are|will|should|can|would)/i.test(label)) return `Decide: ${lower}`
      if (/^(what|how|why|when|where|which|who)/i.test(label)) return `Figure out: ${lower}`
      return `Next: ${lower}`
    }
  }
}

// ─── Organizer display metadata ───────────────────────────────────────────────
export const ORGANIZER_META: Record<Organizer, { label: string; color: string; short: string }> = {
  core_idea:        { label: 'Core idea',        color: '#2dd4bf', short: 'CORE IDEA' },
  point_of_tension: { label: 'Point of tension', color: '#fb7185', short: 'TENSION' },
  open_thought:     { label: 'Open thought',     color: '#fbbf24', short: 'OPEN THOUGHT' },
}
```

