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
