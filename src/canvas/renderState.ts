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
