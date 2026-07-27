import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force'
import { useStore } from '../store'
import type { ThreadNode, Relationship } from '../types'
import { SidePanel } from './SidePanel'
import { runTraceScan, getScopedNodes, type TraceConnection } from '../lib/trace'
import { TextShimmerWave } from './core/text-shimmer-wave'

// ─── Trace: Ghost Edge (client-side render model) ────────────────────────────
// A validated, still-pending connection. source_id/target_id are always real,
// in-scope node ids (trace.ts validateConnections guarantees it). rationale is
// the verbatim model sentence shown in the resolution popover.
type GhostEdge = TraceConnection

// Trace never fires on its own. It is wired to exactly two button clicks
// (handleScan / handleDeepScan). No effect, no timer, no subscription triggers
// it — not page load, session change, node creation, or tab switch.

// ─── Types ─────────────────────────────────────────────────────────────────────

interface GraphNode extends SimulationNodeDatum {
  id: string
  label: string
  organizer: ThreadNode['organizer']
  sessionId: number
  currentFocus: boolean
}

interface GraphLink extends SimulationLinkDatum<GraphNode> {
  id: string
  relationship: Relationship | null
}

// Flow re-entry glow for Map view — organizer color at 40% for the text-shadow.
const FLOW_GLOW_SHADOW: Record<ThreadNode['organizer'], string> = {
  core_idea: 'rgba(76, 201, 160, 0.4)',
  point_of_tension: 'rgba(224, 107, 90, 0.4)',
  open_thought: 'rgba(232, 168, 74, 0.4)',
}

// Relationships exposed in the connect picker today. depends_on / supersedes
// exist in the type and are handled fine if present in data, but are
// available-but-unshipped — no UI offers them yet (open product decision).
type PickableRelationship = 'supports' | 'challenges'

// ─── Cluster palette ───────────────────────────────────────────────────────────
// Communities are colored like Infranodus topical clusters: bright distinct
// hues on the dark canvas, assigned largest-cluster-first. Gray = unclustered.

const CLUSTER_COLORS = [
  '#E8C547', // yellow
  '#4CC9A0', // green
  '#6B9AE8', // blue
  '#C77DDA', // purple
  '#E06B5A', // coral
  '#4ACFE8', // cyan
  '#E88A4A', // orange
  '#9AE84A', // lime
]
const UNCLUSTERED_COLOR = '#5C5B58'

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

const linkEndpointId = (v: string | number | GraphNode): string =>
  typeof v === 'object' ? v.id : String(v)

// Node radius scales with connection count — hubs read as gravity wells.
function nodeRadius(degree: number): number {
  return Math.min(4.5 + Math.sqrt(degree) * 2.5, 14)
}

function truncate(label: string, max = 26): string {
  return label.length > max ? label.slice(0, max - 1).trimEnd() + '…' : label
}

// True if a Ghost Edge connects the given unordered pair (direction-agnostic).
function samePair(g: { source_id: string; target_id: string }, a: string, b: string): boolean {
  return (g.source_id === a && g.target_id === b) || (g.source_id === b && g.target_id === a)
}

// Opacity falls off with sessions since the node was last touched.
// 0 sessions ago (current) = 1.0, 1 = 0.7, 2 = 0.5, 3+ = floor at 0.3.
function recencyOpacity(sessionId: number, currentSession: number): number {
  const sessionsAgo = Math.max(0, currentSession - sessionId)
  if (sessionsAgo === 0) return 1.0
  if (sessionsAgo === 1) return 0.7
  if (sessionsAgo === 2) return 0.5
  return 0.3
}

// ─── Graph analysis (no AI — pure structure) ───────────────────────────────────

function buildAdjacency(nodes: GraphNode[], links: GraphLink[]): Map<string, string[]> {
  const adjacency = new Map<string, string[]>()
  nodes.forEach(n => adjacency.set(n.id, []))
  links.forEach(l => {
    const src = linkEndpointId(l.source)
    const tgt = linkEndpointId(l.target)
    if (adjacency.has(src) && adjacency.has(tgt)) {
      adjacency.get(src)!.push(tgt)
      adjacency.get(tgt)!.push(src)
    }
  })
  return adjacency
}

// Connected components — used for structural gap detection.
function findComponents(nodes: GraphNode[], adjacency: Map<string, string[]>): GraphNode[][] {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const visited = new Set<string>()
  const components: GraphNode[][] = []
  for (const node of nodes) {
    if (visited.has(node.id)) continue
    const component: GraphNode[] = []
    const queue = [node.id]
    while (queue.length) {
      const id = queue.shift()!
      if (visited.has(id)) continue
      visited.add(id)
      component.push(byId.get(id)!)
      queue.push(...(adjacency.get(id) ?? []))
    }
    components.push(component)
  }
  return components
}

// Label propagation — lightweight community detection. Each node repeatedly
// adopts the most common label among its neighbors; ties keep the current
// label so results are deterministic on small graphs.
function detectCommunities(nodes: GraphNode[], adjacency: Map<string, string[]>): Map<string, string> {
  const labels = new Map<string, string>(nodes.map(n => [n.id, n.id]))
  const order = [...nodes].sort((a, b) => a.id.localeCompare(b.id))
  for (let iteration = 0; iteration < 12; iteration++) {
    let changed = false
    for (const node of order) {
      const neighbors = adjacency.get(node.id) ?? []
      if (neighbors.length === 0) continue
      const counts = new Map<string, number>()
      neighbors.forEach(m => {
        const l = labels.get(m)!
        counts.set(l, (counts.get(l) ?? 0) + 1)
      })
      const current = labels.get(node.id)!
      let best = current
      let bestCount = counts.get(current) ?? 0
      const entries = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      if (entries.length && entries[0][1] > bestCount) {
        best = entries[0][0]
        bestCount = entries[0][1]
      }
      if (best !== current) {
        labels.set(node.id, best)
        changed = true
      }
    }
    if (!changed) break
  }
  return labels
}

interface Community {
  id: string
  color: string
  name: string
  nodes: GraphNode[]
}

interface Broker {
  node: GraphNode
  score: number // neighbor pairs this node is the only bridge between
}

interface MapAnalytics {
  degree: Map<string, number>
  colorOf: Map<string, string> // nodeId -> cluster color
  communities: Community[] // size >= 2, sorted by size desc
  isolated: GraphNode[]
  components: GraphNode[][] // multi-node components (for structural gaps)
  gaps: [GraphNode[], GraphNode[]][]
  brokers: Broker[]
  advice: { title: string; detail: string }
  diversity: 'low' | 'medium' | 'high'
  density: number
  avgDegree: number
  topNodes: GraphNode[]
  sessionCounts: number[] // nodes created per session, index 0 = session 1
}

function computeAnalytics(nodes: GraphNode[], links: GraphLink[], currentSession: number): MapAnalytics {
  const adjacency = buildAdjacency(nodes, links)

  const degree = new Map<string, number>()
  nodes.forEach(n => degree.set(n.id, (adjacency.get(n.id) ?? []).length))

  // Communities
  const labels = detectCommunities(nodes, adjacency)
  const grouped = new Map<string, GraphNode[]>()
  nodes.forEach(n => {
    const l = labels.get(n.id)!
    if (!grouped.has(l)) grouped.set(l, [])
    grouped.get(l)!.push(n)
  })
  const multiGroups = [...grouped.values()]
    .filter(g => g.length > 1)
    .sort((a, b) => b.length - a.length)
  const communities: Community[] = multiGroups.map((group, i) => {
    const top = [...group].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))[0]
    return {
      id: labels.get(group[0].id)!,
      color: CLUSTER_COLORS[i % CLUSTER_COLORS.length],
      name: truncate(top.label, 20),
      nodes: group,
    }
  })
  const colorOf = new Map<string, string>()
  nodes.forEach(n => colorOf.set(n.id, UNCLUSTERED_COLOR))
  communities.forEach(c => c.nodes.forEach(n => colorOf.set(n.id, c.color)))

  const isolated = nodes.filter(n => (degree.get(n.id) ?? 0) === 0)

  // Structural gaps: disconnected multi-node components
  const components = findComponents(nodes, adjacency).filter(c => c.length > 1)
  const gaps: [GraphNode[], GraphNode[]][] = []
  const sortedComponents = [...components].sort((a, b) => b.length - a.length)
  for (let i = 0; i < sortedComponents.length; i++) {
    for (let j = i + 1; j < sortedComponents.length; j++) {
      gaps.push([sortedComponents[i], sortedComponents[j]])
    }
  }

  // Latent brokers: nodes whose neighbors aren't directly connected to each
  // other — remove the broker and those ideas fall apart. Score = number of
  // neighbor pairs bridged only through this node.
  const edgeSet = new Set<string>()
  links.forEach(l => {
    const a = linkEndpointId(l.source)
    const b = linkEndpointId(l.target)
    edgeSet.add(a < b ? `${a}|${b}` : `${b}|${a}`)
  })
  const brokers: Broker[] = nodes
    .map(n => {
      const neighbors = adjacency.get(n.id) ?? []
      let score = 0
      for (let i = 0; i < neighbors.length; i++) {
        for (let j = i + 1; j < neighbors.length; j++) {
          const a = neighbors[i], b = neighbors[j]
          if (!edgeSet.has(a < b ? `${a}|${b}` : `${b}|${a}`)) score++
        }
      }
      return { node: n, score }
    })
    .filter(b => b.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)

  // Action advice — rule-based on structure
  const totalDegree = [...degree.values()].reduce((s, d) => s + d, 0)
  const avgDegree = nodes.length ? totalDegree / nodes.length : 0
  const density = nodes.length > 1 ? links.length / ((nodes.length * (nodes.length - 1)) / 2) : 0
  const biggestShare = communities.length && nodes.length
    ? communities[0].nodes.length / nodes.length
    : 0

  let advice: { title: string; detail: string }
  if (gaps.length > 0) {
    advice = {
      title: 'Bridge the Gap',
      detail: 'Your thinking has separate idea groups with no path between them. Connecting them often produces the newest ideas — or leave the gap if it\'s intentional.',
    }
  } else if (isolated.length >= 3) {
    advice = {
      title: 'Integrate Loose Thoughts',
      detail: `${isolated.length} ideas aren't connected to anything yet. Link them in, or let them go.`,
    }
  } else if (biggestShare > 0.7) {
    advice = {
      title: 'Develop Periphery',
      detail: 'Most of your ideas sit in one cluster. Push on the edges — the periphery is where the thinking is still open.',
    }
  } else if (links.length < nodes.length - 1) {
    advice = {
      title: 'Connect Related Ideas',
      detail: 'The map is sparse. Shift-click pairs of nodes that belong together to reveal the structure of your thinking.',
    }
  } else {
    advice = {
      title: 'Keep Developing',
      detail: 'The structure is balanced — connected but not collapsed into one blob. Keep writing.',
    }
  }

  // Diversity: how evenly thinking is spread across clusters.
  let diversity: 'low' | 'medium' | 'high'
  if (communities.length < 2) diversity = 'low'
  else if (biggestShare > 0.6) diversity = 'medium'
  else diversity = 'high'

  const topNodes = [...nodes]
    .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))
    .slice(0, 3)
    .filter(n => (degree.get(n.id) ?? 0) > 0)

  const sessionCounts: number[] = []
  for (let s = 1; s <= currentSession; s++) {
    sessionCounts.push(nodes.filter(n => n.sessionId === s).length)
  }

  return {
    degree, colorOf, communities, isolated, components, gaps, brokers,
    advice, diversity, density, avgDegree, topNodes, sessionCounts,
  }
}

// Convex hull (Andrew's monotone chain) for cluster halo shapes.
function convexHull(points: { x: number; y: number }[]): { x: number; y: number }[] {
  if (points.length <= 2) return points
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: { x: number; y: number }[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: { x: number; y: number }[] = []
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

// ─── Analytics Panel ───────────────────────────────────────────────────────────

type PanelTab = 'essence' | 'insight' | 'trends' | 'stats'

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: 'var(--font-mono)',
      fontSize: '10px',
      color: 'var(--text-tertiary)',
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      marginBottom: '6px',
    }}>
      {children}
    </div>
  )
}


function ClusterChip({ color, label }: { color: string; label: string }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '5px',
      background: hexToRgba(color, 0.08),
      border: `1px solid ${hexToRgba(color, 0.35)}`,
      color,
      borderRadius: '4px',
      padding: '1px 6px',
      fontSize: '10px',
      maxWidth: '100%',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    }}>
      <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
    </span>
  )
}

function DiversityMeter({ level }: { level: 'low' | 'medium' | 'high' }) {
  const filled = level === 'low' ? 1 : level === 'medium' ? 2 : 3
  const color = level === 'low' ? 'var(--tension)' : level === 'medium' ? 'var(--open)' : 'var(--core)'
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderTop: '1px solid var(--border-subtle)',
      paddingTop: '10px',
      marginTop: '4px',
    }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-tertiary)' }}>
        thought diversity
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ display: 'flex', gap: '2px' }}>
          {[0, 1, 2].map(i => (
            <span key={i} style={{
              width: '14px',
              height: '5px',
              borderRadius: '2px',
              background: i < filled ? color : 'var(--surface-3)',
            }} />
          ))}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color }}>{level}</span>
      </span>
    </div>
  )
}

function AnalyticsPanel({
  analytics,
  nodeCount,
  edgeCount,
  currentSession,
  setHoveredId,
}: {
  analytics: MapAnalytics
  nodeCount: number
  edgeCount: number
  currentSession: number
  setHoveredId: (id: string | null) => void
}) {
  const [tab, setTab] = useState<PanelTab>('insight')
  const a = analytics

  const tabs: { key: PanelTab; label: string }[] = [
    { key: 'essence', label: 'Essence' },
    { key: 'insight', label: 'Insight' },
    { key: 'trends', label: 'Trends' },
    { key: 'stats', label: 'Stats' },
  ]

  const hoverableRow: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '4px 6px',
    margin: '0 -6px',
    borderRadius: '4px',
    cursor: 'default',
  }

  const componentChips = (component: GraphNode[]) => {
    const representatives = [...component]
      .sort((x, y) => (a.degree.get(y.id) ?? 0) - (a.degree.get(x.id) ?? 0))
      .slice(0, 2)
    return representatives.map(n => (
      <span key={n.id} onMouseEnter={() => setHoveredId(n.id)} onMouseLeave={() => setHoveredId(null)}>
        <ClusterChip color={a.colorOf.get(n.id) ?? UNCLUSTERED_COLOR} label={truncate(n.label, 22)} />
      </span>
    ))
  }

  const maxSession = Math.max(...a.sessionCounts, 1)

  return (
    <div style={{
      width: '280px',
      flexShrink: 0,
      borderLeft: '1px solid var(--border)',
      background: 'var(--surface-1)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Tabs */}
      <div style={{ display: 'flex', gap: '2px', padding: '10px 12px 0' }}>
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              flex: 1,
              background: tab === t.key ? 'var(--surface-3)' : 'none',
              border: '1px solid ' + (tab === t.key ? 'var(--border)' : 'transparent'),
              borderRadius: '5px',
              padding: '4px 0',
              cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              color: tab === t.key ? 'var(--text-primary)' : 'var(--text-tertiary)',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '14px 14px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        fontFamily: 'var(--font-sans)',
        fontSize: '11px',
        color: 'var(--text-secondary)',
      }}>

        {tab === 'essence' && (
          <>
            <div>
              <SectionLabel>Main topics</SectionLabel>
              {a.communities.length === 0 && (
                <div style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                  No clusters yet — connect ideas and topics will emerge here.
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {a.communities.slice(0, 5).map(c => (
                  <div key={c.id} style={hoverableRow}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: c.color, flexShrink: 0 }} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>
                      {c.name}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-tertiary)' }}>
                      {c.nodes.length} ideas
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {a.topNodes.length > 0 && (
              <div>
                <SectionLabel>Most influential ideas</SectionLabel>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {a.topNodes.map(n => (
                    <div
                      key={n.id}
                      style={hoverableRow}
                      onMouseEnter={() => setHoveredId(n.id)}
                      onMouseLeave={() => setHoveredId(null)}
                    >
                      <span style={{
                        width: '6px', height: '6px', borderRadius: '50%',
                        background: a.colorOf.get(n.id), flexShrink: 0,
                      }} />
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {n.label}
                      </span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-tertiary)' }}>
                        {a.degree.get(n.id)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {tab === 'insight' && (
          <>
            <div>
              <SectionLabel>Action advice</SectionLabel>
              <div style={{
                display: 'inline-block',
                border: '1px solid var(--border)',
                background: 'var(--surface-2)',
                borderRadius: '5px',
                padding: '3px 10px',
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                color: 'var(--text-primary)',
                marginBottom: '6px',
              }}>
                {a.advice.title}
              </div>
              <div style={{ lineHeight: 1.55, color: 'var(--text-secondary)' }}>
                {a.advice.detail}
              </div>
            </div>

            <div>
              <SectionLabel>Structural gaps</SectionLabel>
              {a.gaps.length === 0 ? (
                <div style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                  No gaps — every idea group is reachable from every other.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {a.gaps.slice(0, 4).map(([ga, gb], i) => (
                    <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
                        {componentChips(ga)}
                        <span style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>↔</span>
                        {componentChips(gb)}
                      </div>
                      <div style={{ color: 'var(--text-tertiary)', fontSize: '10px', fontFamily: 'var(--font-mono)', lineHeight: 1.5 }}>
                        Shift-click between these to connect them, or leave the gap if it's intentional.
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {a.brokers.length > 0 && (
              <div>
                <SectionLabel>Latent topical brokers</SectionLabel>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {a.brokers.map(b => (
                    <div
                      key={b.node.id}
                      style={hoverableRow}
                      onMouseEnter={() => setHoveredId(b.node.id)}
                      onMouseLeave={() => setHoveredId(null)}
                    >
                      <span style={{
                        width: '6px', height: '6px', borderRadius: '50%',
                        background: a.colorOf.get(b.node.id), flexShrink: 0,
                      }} />
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {b.node.label}
                      </span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-tertiary)' }}>
                        ×{b.score}
                      </span>
                    </div>
                  ))}
                </div>
                <div style={{ color: 'var(--text-tertiary)', fontSize: '10px', marginTop: '4px', lineHeight: 1.5 }}>
                  Ideas holding otherwise-unlinked thoughts together.
                </div>
              </div>
            )}
          </>
        )}

        {tab === 'trends' && (
          <>
            <div>
              <SectionLabel>Ideas per session</SectionLabel>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '52px', padding: '4px 0' }}>
                {a.sessionCounts.map((count, i) => (
                  <div key={i} style={{ flex: 1, maxWidth: '28px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px' }}>
                    <div style={{
                      width: '100%',
                      height: `${Math.max(3, (count / maxSession) * 36)}px`,
                      background: i === a.sessionCounts.length - 1 ? 'var(--core)' : 'var(--surface-4)',
                      borderRadius: '2px 2px 0 0',
                    }} />
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-tertiary)' }}>
                      s{i + 1}
                    </span>
                  </div>
                ))}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-tertiary)' }}>
                +{a.sessionCounts[currentSession - 1] ?? 0} ideas this session
              </div>
            </div>

            <div>
              <SectionLabel>Structure over time</SectionLabel>
              <div style={{ lineHeight: 1.55, color: 'var(--text-secondary)' }}>
                {a.isolated.length > 0
                  ? `${a.isolated.length} idea${a.isolated.length === 1 ? '' : 's'} still floating free. `
                  : 'Every idea is anchored to at least one other. '}
                {a.communities.length >= 2
                  ? `Thinking currently splits into ${a.communities.length} topics.`
                  : 'One dominant topic so far.'}
              </div>
            </div>
          </>
        )}

        {tab === 'stats' && (
          <div>
            <SectionLabel>Graph</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
              {[
                ['ideas', String(nodeCount)],
                ['connections', String(edgeCount)],
                ['topics', String(a.communities.length)],
                ['loose thoughts', String(a.isolated.length)],
                ['avg connections', a.avgDegree.toFixed(1)],
                ['density', `${Math.round(a.density * 100)}%`],
                ['session', String(currentSession)],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-tertiary)' }}>{k}</span>
                  <span style={{ color: 'var(--text-primary)' }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: '0 14px 12px' }}>
        <DiversityMeter level={a.diversity} />
      </div>
    </div>
  )
}

// ─── Graph Canvas ───────────────────────────────────────────────────────────────

function GraphCanvas({
  nodes,
  links,
  analytics,
  onNodeClick,
  onCreateEdge,
  hoveredId,
  setHoveredId,
  selectedId,
  currentSession,
  ghostEdges,
  onAcceptGhost,
  onDismissGhost,
}: {
  nodes: GraphNode[]
  links: GraphLink[]
  analytics: MapAnalytics
  onNodeClick: (id: string) => void
  onCreateEdge: (fromId: string, toId: string, relationship: PickableRelationship) => void
  hoveredId: string | null
  setHoveredId: (id: string | null) => void
  selectedId: string | null
  currentSession: number
  ghostEdges: GhostEdge[]
  onAcceptGhost: (sourceId: string, targetId: string) => void
  onDismissGhost: (sourceId: string, targetId: string) => void
}) {
  const { flowGlowIds, flowGlowVisible } = useStore()
  const svgRef = useRef<SVGSVGElement>(null)
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map())
  const simRef = useRef<ReturnType<typeof forceSimulation<GraphNode, GraphLink>> | null>(null)
  const transformRef = useRef({ x: 0, y: 0, k: 1 })
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 })
  const [resetTransition, setResetTransition] = useState(false)
  const draggingNodeRef = useRef<{ id: string; startX: number; startY: number } | null>(null)
  const panStartRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)
  const frameRef = useRef<number>(0)
  const isShiftHeldRef = useRef(false)

  // Shift-click connecting state
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null)
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null)
  // Second node has been picked; relationship picker is open, edge not created yet.
  const [pendingConnection, setPendingConnection] = useState<{ fromId: string; toId: string } | null>(null)
  // Trace: the Ghost Edge whose resolution popover is currently open (null = none).
  const [activeGhost, setActiveGhost] = useState<GhostEdge | null>(null)
  // Connect mode: an explicit, discoverable alternative to Shift-click. When on,
  // a plain click on two nodes links them (no modifier key required).
  const [connectMode, setConnectMode] = useState(false)

  // Build connected sets for hover highlighting
  const connectedTo = useCallback((id: string): Set<string> => {
    const s = new Set<string>()
    links.forEach(l => {
      const src = linkEndpointId(l.source)
      const tgt = linkEndpointId(l.target)
      if (src === id) s.add(tgt)
      if (tgt === id) s.add(src)
    })
    return s
  }, [links])

  // Track shift key and handle Escape
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') isShiftHeldRef.current = true
      if (e.key === 'Escape') {
        setConnectingFrom(null)
        setCursorPos(null)
        setPendingConnection(null)
        setConnectMode(false)
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') isShiftHeldRef.current = false
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  // Initialize / update simulation
  useEffect(() => {
    const rect = svgRef.current?.getBoundingClientRect()
    const width = (rect && rect.width > 0 ? rect.width : svgRef.current?.clientWidth) || 900
    const height = (rect && rect.height > 0 ? rect.height : svgRef.current?.clientHeight) || 600

    const simNodes: GraphNode[] = nodes.map(n => {
      const existing = simRef.current?.nodes().find(s => s.id === n.id)
      return {
        ...n,
        x: existing?.x ?? width / 2 + (Math.random() - 0.5) * 80,
        y: existing?.y ?? height / 2 + (Math.random() - 0.5) * 80,
        fx: existing?.fx,
        fy: existing?.fy,
        vx: existing ? 0 : (Math.random() - 0.5) * 60,
        vy: existing ? 0 : (Math.random() - 0.5) * 60,
      }
    })

    const simLinks: GraphLink[] = links.map(l => ({
      ...l,
      source: simNodes.find(n => n.id === linkEndpointId(l.source))!,
      target: simNodes.find(n => n.id === linkEndpointId(l.target))!,
    })).filter(l => l.source && l.target)

    // Degree from this link set — sizes collision to match rendered radii
    const degreeLocal = new Map<string, number>()
    simLinks.forEach(l => {
      const s = (l.source as GraphNode).id
      const t = (l.target as GraphNode).id
      degreeLocal.set(s, (degreeLocal.get(s) ?? 0) + 1)
      degreeLocal.set(t, (degreeLocal.get(t) ?? 0) + 1)
    })

    if (simRef.current) {
      simRef.current.stop()
      cancelAnimationFrame(frameRef.current)
    }

    const sim = forceSimulation<GraphNode, GraphLink>(simNodes)
      .force('link', simLinks.length > 0
        ? forceLink<GraphNode, GraphLink>(simLinks)
            .id(d => d.id)
            .distance(72)
            .strength(0.55)
        : null
      )
      .force('charge', forceManyBody<GraphNode>().strength(-160).distanceMax(320))
      .force('center', forceCenter(width / 2, height / 2).strength(0.3))
      .force('collision', forceCollide<GraphNode>()
        .radius(d => nodeRadius(degreeLocal.get(d.id) ?? 0) + 16)
        .strength(0.85)
      )
      .alphaDecay(0.015)
      .velocityDecay(0.3)

    sim.tick(500)

    // Center the settled graph on the viewport
    const postNodes = sim.nodes()
    if (postNodes.length > 0) {
      const xs = postNodes.map(n => n.x ?? 0)
      const ys = postNodes.map(n => n.y ?? 0)
      const boundsCenterX = (Math.min(...xs) + Math.max(...xs)) / 2
      const boundsCenterY = (Math.min(...ys) + Math.max(...ys)) / 2
      const offsetX = width / 2 - boundsCenterX
      const offsetY = height / 2 - boundsCenterY
      postNodes.forEach(n => { n.x = (n.x ?? 0) + offsetX; n.y = (n.y ?? 0) + offsetY })
    }

    sim.alpha(0.08).restart()

    const tick = () => {
      const map = new Map<string, { x: number; y: number }>()
      sim.nodes().forEach(n => map.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 }))
      setPositions(new Map(map))
      if (sim.alpha() > 0.001) frameRef.current = requestAnimationFrame(tick)
    }
    frameRef.current = requestAnimationFrame(tick)

    simRef.current = sim

    return () => {
      cancelAnimationFrame(frameRef.current)
      sim.stop()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.length, links.length])

  // Convert screen coords to graph coords
  const toGraphCoords = (clientX: number, clientY: number) => {
    const svgRect = svgRef.current?.getBoundingClientRect()
    if (!svgRect) return { x: 0, y: 0 }
    const { x: tx, y: ty, k } = transformRef.current
    return {
      x: (clientX - svgRect.left - tx) / k,
      y: (clientY - svgRect.top - ty) / k,
    }
  }

  const onMouseDownCanvas = (e: React.MouseEvent<SVGSVGElement>) => {
    if ((e.target as Element).closest?.('[data-node]')) return
    if (pendingConnection) {
      // Click on background cancels the pending relationship pick — no edge created
      setPendingConnection(null)
      return
    }
    if (connectingFrom) {
      // Click on background cancels connecting mode
      setConnectingFrom(null)
      setCursorPos(null)
      return
    }
    panStartRef.current = {
      x: e.clientX, y: e.clientY,
      tx: transformRef.current.x, ty: transformRef.current.y,
    }
  }

  const onMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    // Always track cursor for the connecting preview line
    if (connectingFrom) {
      setCursorPos(toGraphCoords(e.clientX, e.clientY))
    }

    if (draggingNodeRef.current) {
      const { id } = draggingNodeRef.current
      const simNode = simRef.current?.nodes().find(n => n.id === id)
      if (simNode) {
        const k = transformRef.current.k
        const { x: tx, y: ty } = transformRef.current
        const svgRect = svgRef.current?.getBoundingClientRect()
        if (svgRect) {
          simNode.fx = (e.clientX - svgRect.left - tx) / k
          simNode.fy = (e.clientY - svgRect.top - ty) / k
          simRef.current?.alpha(0.1).restart()
        }
      }
      return
    }
    if (panStartRef.current) {
      const dx = e.clientX - panStartRef.current.x
      const dy = e.clientY - panStartRef.current.y
      transformRef.current = {
        ...transformRef.current,
        x: panStartRef.current.tx + dx,
        y: panStartRef.current.ty + dy,
      }
      setTransform({ ...transformRef.current })
    }
  }

  const onMouseUp = (e: React.MouseEvent<SVGSVGElement>) => {
    if (draggingNodeRef.current) {
      const { id, startX, startY } = draggingNodeRef.current
      const simNode = simRef.current?.nodes().find(n => n.id === id)
      if (simNode) {
        const k = transformRef.current.k
        const { x: tx, y: ty } = transformRef.current
        const svgRect = svgRef.current?.getBoundingClientRect()
        if (svgRect) {
          simNode.fx = (e.clientX - svgRect.left - tx) / k
          simNode.fy = (e.clientY - svgRect.top - ty) / k
        }
      }
      if (Math.abs(e.clientX - startX) < 4 && Math.abs(e.clientY - startY) < 4) {
        onNodeClick(id)
      }
      draggingNodeRef.current = null
    }
    panStartRef.current = null
  }

  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const factor = e.deltaY < 0 ? 1.1 : 0.9
    const newK = Math.min(4, Math.max(0.25, transformRef.current.k * factor))
    const svgRect = svgRef.current!.getBoundingClientRect()
    const mx = e.clientX - svgRect.left
    const my = e.clientY - svgRect.top
    const nx = mx - (mx - transformRef.current.x) * (newK / transformRef.current.k)
    const ny = my - (my - transformRef.current.y) * (newK / transformRef.current.k)
    transformRef.current = { x: nx, y: ny, k: newK }
    setTransform({ ...transformRef.current })
  }

  const onDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if ((e.target as Element).closest?.('[data-node]')) return
    setResetTransition(true)
    transformRef.current = { x: 0, y: 0, k: 1 }
    setTransform({ x: 0, y: 0, k: 1 })
    setTimeout(() => setResetTransition(false), 320)
  }

  // A connection already exists between these two nodes (either direction).
  const isAlreadyConnected = useCallback((a: string, b: string): boolean =>
    links.some(l => {
      const src = linkEndpointId(l.source)
      const tgt = linkEndpointId(l.target)
      return (src === a && tgt === b) || (src === b && tgt === a)
    }), [links])

  const handleNodeMouseDown = (e: React.MouseEvent, node: GraphNode) => {
    e.stopPropagation()

    // Relationship picker is open — ignore other node interactions until resolved
    if (pendingConnection) return

    // Connect mode on, OR Shift held: connection flow only, no drag.
    if (connectMode || isShiftHeldRef.current || e.shiftKey) {
      if (!connectingFrom) {
        setConnectingFrom(node.id)
        setCursorPos(toGraphCoords(e.clientX, e.clientY))
      } else if (connectingFrom === node.id) {
        // Same node: cancel
        setConnectingFrom(null)
        setCursorPos(null)
      } else if (isAlreadyConnected(connectingFrom, node.id)) {
        // Nothing to pick a relationship for — cancel, matching prior no-op behavior
        setConnectingFrom(null)
        setCursorPos(null)
      } else {
        // Don't create the edge yet — show the relationship picker first
        setPendingConnection({ fromId: connectingFrom, toId: node.id })
        setConnectingFrom(null)
        setCursorPos(null)
      }
      return
    }

    if (connectingFrom && connectingFrom !== node.id) {
      // Second click without shift still initiates the same picker flow
      if (isAlreadyConnected(connectingFrom, node.id)) {
        setConnectingFrom(null)
        setCursorPos(null)
      } else {
        setPendingConnection({ fromId: connectingFrom, toId: node.id })
        setConnectingFrom(null)
        setCursorPos(null)
      }
      return
    }

    draggingNodeRef.current = { id: node.id, startX: e.clientX, startY: e.clientY }
    const pos = positions.get(node.id)
    const simNode = simRef.current?.nodes().find(n => n.id === node.id)
    if (simNode && pos) {
      simNode.fx = pos.x
      simNode.fy = pos.y
    }
  }

  const handleNodeMouseUp = (e: React.MouseEvent, node: GraphNode) => {
    if (
      draggingNodeRef.current?.id === node.id &&
      Math.abs(e.clientX - draggingNodeRef.current.startX) < 4 &&
      Math.abs(e.clientY - draggingNodeRef.current.startY) < 4
    ) {
      onNodeClick(node.id)
    }
    draggingNodeRef.current = null
  }

  const neighbors = hoveredId ? connectedTo(hoveredId) : null
  const connectingFromPos = connectingFrom ? positions.get(connectingFrom) : null

  const pendingPosA = pendingConnection ? positions.get(pendingConnection.fromId) : null
  const pendingPosB = pendingConnection ? positions.get(pendingConnection.toId) : null

  const choosePending = (relationship: PickableRelationship) => {
    if (!pendingConnection) return
    onCreateEdge(pendingConnection.fromId, pendingConnection.toId, relationship)
    setPendingConnection(null)
  }

  // Cluster halos: convex hull of each community's node positions, drawn as a
  // fat translucent stroke so clusters read as regions of the "brain".
  const hulls = analytics.communities.map(c => {
    const pts = c.nodes
      .map(n => positions.get(n.id))
      .filter((p): p is { x: number; y: number } => !!p)
    if (pts.length < 2) return null
    const hull = convexHull(pts)
    const d = hull.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + (hull.length > 2 ? ' Z' : '')
    return { id: c.id, color: c.color, d }
  }).filter((h): h is { id: string; color: string; d: string } => !!h)

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
    <svg
      ref={svgRef}
      style={{
        width: '100%',
        height: '100%',
        cursor: connectingFrom ? 'crosshair' : 'default',
        userSelect: 'none',
        background: '#08090A',
        backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px)',
        backgroundSize: '28px 28px',
      }}
      onMouseDown={onMouseDownCanvas}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onWheel={onWheel}
      onDoubleClick={onDoubleClick}
    >
      <defs>
        {/* context-stroke makes the arrowhead inherit each edge's stroke color,
            so it tracks cluster color and hover state for free */}
        <marker
          id="arrowhead"
          markerWidth="6"
          markerHeight="6"
          refX="5"
          refY="3"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M0,0 L6,3 L0,6" fill="none" stroke="context-stroke" strokeWidth="1" />
        </marker>
      </defs>
      <g
        transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}
        style={resetTransition ? { transition: 'transform 300ms ease' } : undefined}
      >
        {/* Cluster halos — under everything */}
        {hulls.map(h => (
          <path
            key={h.id}
            d={h.d}
            fill={hexToRgba(h.color, 0.04)}
            stroke={hexToRgba(h.color, 0.05)}
            strokeWidth={44}
            strokeLinejoin="round"
            strokeLinecap="round"
            style={{ pointerEvents: 'none' }}
          />
        ))}

        {/* Trace Ghost Edges — same SVG <g>, rendered BEFORE confirmed edges so
            they sit BELOW them in z-order (a confirmed edge always wins on
            overlap). Same quadratic-Bezier control-point math as confirmed
            edges (perpendicular offset = dist * 0.18); only stroke styling
            differs — desaturated, dashed, softly pulsing. */}
        {ghostEdges.map(ghost => {
          const posA = positions.get(ghost.source_id)
          const posB = positions.get(ghost.target_id)
          if (!posA || !posB) return null

          const dx = posB.x - posA.x
          const dy = posB.y - posA.y
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          const mx = (posA.x + posB.x) / 2
          const my = (posA.y + posB.y) / 2
          const nx = -dy / dist
          const ny = dx / dist
          const cx = mx + nx * (dist * 0.18)
          const cy = my + ny * (dist * 0.18)
          const d = `M ${posA.x} ${posA.y} Q ${cx} ${cy} ${posB.x} ${posB.y}`
          const key = `ghost-${ghost.source_id}-${ghost.target_id}`

          return (
            <g key={key}>
              {/* Wide, invisible hit path — gives ~4px click tolerance. */}
              <path
                d={d}
                stroke="transparent"
                strokeWidth={9}
                fill="none"
                style={{ cursor: 'pointer' }}
                onMouseDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); setActiveGhost(ghost) }}
              />
              {/* Visible Ghost Edge. */}
              <path
                d={d}
                stroke="rgba(255, 255, 255, 0.35)"
                strokeWidth={0.8}
                strokeDasharray="6 4"
                fill="none"
                style={{
                  pointerEvents: 'none',
                  animation: 'ghost-pulse 2.5s ease-in-out infinite',
                }}
              />
            </g>
          )
        })}

        {/* Edges — under nodes */}
        {links.map(link => {
          const src = linkEndpointId(link.source)
          const tgt = linkEndpointId(link.target)
          const posA = positions.get(src)
          const posB = positions.get(tgt)
          if (!posA || !posB) return null

          const dx = posB.x - posA.x
          const dy = posB.y - posA.y
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          const mx = (posA.x + posB.x) / 2
          const my = (posA.y + posB.y) / 2
          const nx = -dy / dist
          const ny = dx / dist
          const cx = mx + nx * (dist * 0.18)
          const cy = my + ny * (dist * 0.18)

          // Trim the curve at the target dot's edge so the arrowhead is
          // visible. Tangent at the end of a quadratic Bezier = end − control.
          const ddx = posB.x - cx
          const ddy = posB.y - cy
          const dlen = Math.sqrt(ddx * ddx + ddy * ddy) || 1
          const ux = ddx / dlen
          const uy = ddy / dlen
          const trim = Math.min(nodeRadius(analytics.degree.get(tgt) ?? 0) + 5, dist * 0.5)
          const endX = posB.x - ux * trim
          const endY = posB.y - uy * trim

          const isHighlighted = hoveredId && (src === hoveredId || tgt === hoveredId)
          const isDimmed = hoveredId && !isHighlighted

          // Same-cluster edges carry the cluster color; bridges stay neutral —
          // the map reads as colored regions joined by gray connective tissue.
          const colorA = analytics.colorOf.get(src) ?? UNCLUSTERED_COLOR
          const colorB = analytics.colorOf.get(tgt) ?? UNCLUSTERED_COLOR
          const sameCluster = colorA === colorB && colorA !== UNCLUSTERED_COLOR
          const isChallenge = link.relationship === 'challenges'
          const stroke = isDimmed
            ? (isChallenge ? 'rgba(224,107,90,0.12)' : 'rgba(255,255,255,0.04)')
            : isChallenge
              ? hexToRgba('#E06B5A', isHighlighted ? 0.9 : 0.55)
              : sameCluster
                ? hexToRgba(colorA, isHighlighted ? 0.85 : 0.35)
                : `rgba(255,255,255,${isHighlighted ? 0.6 : 0.16})`

          return (
            <path
              key={link.id}
              d={`M ${posA.x} ${posA.y} Q ${cx} ${cy} ${endX} ${endY}`}
              stroke={stroke}
              strokeWidth={isHighlighted ? 1.5 : 1}
              strokeDasharray={link.relationship === 'challenges' ? '5 4' : undefined}
              fill="none"
              strokeLinecap="round"
              markerEnd="url(#arrowhead)"
              style={{ transition: 'stroke 150ms ease, stroke-width 150ms ease' }}
            />
          )
        })}

        {/* Connecting preview line (dashed, follows cursor) */}
        {connectingFrom && connectingFromPos && cursorPos && (
          <line
            x1={connectingFromPos.x}
            y1={connectingFromPos.y}
            x2={cursorPos.x}
            y2={cursorPos.y}
            stroke="rgba(255,255,255,0.4)"
            strokeWidth={1}
            strokeDasharray="4 4"
            fill="none"
            style={{ pointerEvents: 'none' }}
          />
        )}

        {/* Nodes — dots sized by connectivity, colored by cluster */}
        {nodes.map(node => {
          const pos = positions.get(node.id)
          if (!pos) return null

          const degree = analytics.degree.get(node.id) ?? 0
          const r = nodeRadius(degree)
          const isHub = degree >= 5
          const isDimmed = hoveredId && hoveredId !== node.id && !neighbors?.has(node.id)
          const isHovered = hoveredId === node.id
          const isSelected = selectedId === node.id
          const isConnectingSource = connectingFrom === node.id
          const opacity = isDimmed ? 0.12 : recencyOpacity(node.sessionId, currentSession)

          const color = analytics.colorOf.get(node.id) ?? UNCLUSTERED_COLOR
          const glow = isConnectingSource
            ? 'drop-shadow(0 0 10px rgba(232,168,74,0.5))'
            : node.currentFocus
              ? 'drop-shadow(0 0 12px rgba(232,168,74,0.35))'
              : isHub
                ? `drop-shadow(0 0 8px ${hexToRgba(color, 0.4)})`
                : undefined

          let ringStroke: string | undefined
          let ringWidth = 0
          if (isConnectingSource) { ringStroke = 'var(--open)'; ringWidth = 2 }
          else if (node.currentFocus) { ringStroke = 'rgba(232,168,74,0.8)'; ringWidth = 1.5 }
          else if (isSelected) { ringStroke = '#E8E6DC'; ringWidth = 1.5 }
          else if (isHovered) { ringStroke = 'rgba(255,255,255,0.6)'; ringWidth = 1 }

          const fontSize = Math.min(9.5 + degree * 0.6, 13)

          return (
            <g
              key={node.id}
              data-node={node.id}
              transform={`translate(${pos.x},${pos.y})`}
              style={{
                opacity,
                transition: 'opacity 0.35s ease',
                cursor: connectMode || (connectingFrom && connectingFrom !== node.id) ? 'crosshair' : 'pointer',
              }}
              onMouseEnter={() => setHoveredId(node.id)}
              onMouseLeave={() => setHoveredId(null)}
              onMouseDown={e => handleNodeMouseDown(e, node)}
              onMouseUp={e => handleNodeMouseUp(e, node)}
              onClick={e => e.stopPropagation()}
            >
              {/* Oversized invisible hit area — small dots are hard to grab */}
              <circle r={Math.max(r + 8, 14)} fill="transparent" />
              <circle
                r={r}
                fill={color}
                stroke={ringStroke}
                strokeWidth={ringWidth}
                style={{
                  filter: glow,
                  animation: node.currentFocus ? 'focus-pulse 2.2s ease-in-out infinite' : undefined,
                  transition: 'stroke 120ms ease, r 200ms ease',
                }}
              />
              <text
                x={r + 6}
                y={0}
                textAnchor="start"
                dominantBaseline="central"
                style={{
                  fontFamily: 'var(--font-sans, Geist, sans-serif)',
                  fontSize: `${fontSize}px`,
                  fontWeight: isHub ? 600 : 400,
                  fill: isHub || isHovered || isSelected ? '#E8E6DC' : '#9A9893',
                  pointerEvents: 'none',
                  paintOrder: 'stroke',
                  stroke: 'rgba(8,9,10,0.75)',
                  strokeWidth: 3,
                  strokeLinejoin: 'round',
                  // Flow re-entry glow — same 8s window as the outline glow.
                  textShadow: flowGlowIds.includes(node.id) && flowGlowVisible
                    ? `0 0 12px ${FLOW_GLOW_SHADOW[node.organizer]}`
                    : undefined,
                  transition: 'text-shadow 2s ease-out',
                }}
              >
                {truncate(node.label)}
              </text>
            </g>
          )
        })}
      </g>
    </svg>

    {/* Connect-mode toggle — an explicit, discoverable way to link nodes without
        the Shift key. Top-left, mirroring the Scan buttons at bottom-left. */}
    <button
      onClick={() => {
        setConnectMode(m => {
          const next = !m
          if (!next) { setConnectingFrom(null); setCursorPos(null); setPendingConnection(null) }
          return next
        })
      }}
      className="trace-scan-btn"
      style={{
        position: 'absolute',
        top: '12px',
        left: '16px',
        fontFamily: 'var(--font-mono)',
        fontSize: '11px',
        background: connectMode ? 'var(--open-dim)' : 'var(--surface-2)',
        border: `1px solid ${connectMode ? 'var(--open)' : 'var(--border)'}`,
        color: connectMode ? 'var(--open)' : 'var(--text-secondary)',
        padding: '6px 14px',
        borderRadius: '20px',
        cursor: 'pointer',
        zIndex: 41,
      }}
    >
      {connectMode ? '✓ Connecting — click two nodes' : '+ Connect nodes'}
    </button>

    {/* Connection-mode indicator — shows guidance during Shift-click OR connect mode */}
    {(connectingFrom || connectMode) && (
      <div
        style={{
          position: 'absolute',
          top: '12px',
          left: '50%',
          transform: 'translateX(-50%)',
          fontFamily: 'var(--font-mono)',
          fontSize: '11px',
          color: 'var(--open)',
          background: 'var(--open-dim)',
          border: '1px solid var(--open-mid)',
          padding: '4px 12px',
          borderRadius: '20px',
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
          zIndex: 40,
        }}
      >
        {connectingFrom ? '→ Click a second node to link them' : 'Click a node, then another, to connect'}
      </div>
    )}

    {/* Inline relationship picker — appears at the connection midpoint after the
        second node is picked. Not a modal: clicking the background or pressing
        Escape cancels with no edge created. */}
    {pendingConnection && pendingPosA && pendingPosB && (() => {
      const midX = ((pendingPosA.x + pendingPosB.x) / 2) * transform.k + transform.x
      const midY = ((pendingPosA.y + pendingPosB.y) / 2) * transform.k + transform.y
      return (
        <div
          style={{
            position: 'absolute',
            left: midX,
            top: midY,
            transform: 'translate(-50%, -50%)',
            display: 'flex',
            gap: '6px',
            background: 'var(--surface-2, #141516)',
            border: '1px solid var(--border, #232425)',
            borderRadius: '8px',
            padding: '5px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.45)',
            zIndex: 50,
          }}
          onMouseDown={e => e.stopPropagation()}
        >
          <button
            onClick={() => choosePending('supports')}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              background: 'none',
              border: '1px solid rgba(76,201,160,0.4)',
              borderRadius: '6px',
              padding: '4px 10px',
              cursor: 'pointer',
              fontFamily: 'var(--font-sans, Geist, sans-serif)',
              fontSize: '11px',
              color: '#4CC9A0',
            }}
          >
            <span style={{ display: 'inline-block', width: '12px', height: 0, borderTop: '1.5px solid #4CC9A0' }} />
            supports
          </button>
          <button
            onClick={() => choosePending('challenges')}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              background: 'none',
              border: '1px solid rgba(224,107,90,0.4)',
              borderRadius: '6px',
              padding: '4px 10px',
              cursor: 'pointer',
              fontFamily: 'var(--font-sans, Geist, sans-serif)',
              fontSize: '11px',
              color: '#E06B5A',
            }}
          >
            <span style={{ display: 'inline-block', width: '12px', height: 0, borderTop: '1.5px dashed #E06B5A' }} />
            challenges
          </button>
        </div>
      )
    })()}

    {/* Trace resolution popover — anchored to the midpoint of the clicked Ghost
        Edge. Clicking the backdrop closes it WITHOUT accept/dismiss: the Ghost
        Edge stays pending and can be re-opened later. */}
    {activeGhost && (() => {
      const posA = positions.get(activeGhost.source_id)
      const posB = positions.get(activeGhost.target_id)
      if (!posA || !posB) return null
      const midX = ((posA.x + posB.x) / 2) * transform.k + transform.x
      const midY = ((posA.y + posB.y) / 2) * transform.k + transform.y
      return (
        <>
          {/* Click-outside backdrop */}
          <div
            style={{ position: 'absolute', inset: 0, zIndex: 60 }}
            onMouseDown={() => setActiveGhost(null)}
          />
          <div
            style={{
              position: 'absolute',
              left: midX,
              top: midY,
              transform: 'translate(-50%, -50%)',
              width: '220px',
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: '10px 12px',
              fontFamily: 'var(--font-sans)',
              zIndex: 61,
              boxShadow: '0 4px 16px rgba(0,0,0,0.45)',
            }}
            onMouseDown={e => e.stopPropagation()}
          >
            {/* Label row */}
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              letterSpacing: '0.04em',
              color: 'var(--core)',
            }}>
              Trace
            </div>

            {/* Rationale */}
            <div style={{
              fontSize: '12px',
              color: 'var(--text-primary)',
              lineHeight: 1.5,
              marginTop: '4px',
            }}>
              {activeGhost.rationale}
            </div>

            {/* Action row */}
            <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
              <button
                className="trace-accept-btn"
                onClick={() => { onAcceptGhost(activeGhost.source_id, activeGhost.target_id); setActiveGhost(null) }}
                style={{
                  background: 'var(--core-dim)',
                  border: '1px solid var(--core)',
                  color: 'var(--core)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  padding: '3px 10px',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                }}
              >
                Accept
              </button>
              <button
                className="trace-dismiss-btn"
                onClick={() => { onDismissGhost(activeGhost.source_id, activeGhost.target_id); setActiveGhost(null) }}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  color: 'var(--text-tertiary)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  padding: '3px 10px',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                }}
              >
                Dismiss
              </button>
            </div>
          </div>
        </>
      )
    })()}
    </div>
  )
}

// ─── Main MapView ──────────────────────────────────────────────────────────────

export function MapView() {
  const {
    nodes, edges, addEdge, removeEdge, setSelected, selectedId, currentSession,
    dismissedPairs, addDismissedPair,
  } = useStore()
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  // ─── Trace state ───────────────────────────────────────────────────────────
  // Ghost Edges surfaced by the last scan (validated, still pending). scanStatus
  // gates the in-flight button label + prevents parallel scans. deepAvailable
  // reveals the Deep Scan button ONLY after a standard scan has completed.
  const [ghostEdges, setGhostEdges] = useState<GhostEdge[]>([])
  const [scanStatus, setScanStatus] = useState<'idle' | 'scanning'>('idle')
  const [deepAvailable, setDeepAvailable] = useState(false)
  // Strong-only mode: raises Trace's bar so it returns fewer, higher-confidence
  // connections (trades coverage for precision). Persisted for the session.
  const [strictMode, setStrictMode] = useState(false)
  const [traceMsg, setTraceMsg] = useState<string | null>(null)
  const traceMsgTimer = useRef<number | null>(null)

  const activeNodes = nodes.filter(n => !n.resolved && !n.superseded_by)

  const graphNodes: GraphNode[] = useMemo(() => activeNodes.map(n => ({
    id: n.id,
    label: n.label,
    organizer: n.organizer,
    sessionId: n.session_id,
    currentFocus: n.current_focus,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [activeNodes.map(n => `${n.id}:${n.session_id}:${n.organizer}:${n.current_focus}:${n.label}`).join(',')])

  // Only manually-stored edges (no auto-generation)
  const graphLinks: GraphLink[] = useMemo(() =>
    edges
      .filter(e =>
        activeNodes.some(n => n.id === e.from_id) &&
        activeNodes.some(n => n.id === e.to_id)
      )
      .map(e => ({ id: e.id, source: e.from_id, target: e.to_id, relationship: e.relationship })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [edges, activeNodes.map(n => n.id).join(',')]
  )

  // Recomputes whenever nodes or edges change — panel and canvas stay in sync
  const analytics = useMemo(
    () => computeAnalytics(graphNodes, graphLinks, currentSession),
    [graphNodes, graphLinks, currentSession]
  )

  function handleNodeClick(id: string) {
    setSelected(selectedId === id ? null : id)
  }

  // Used by the SidePanel's "Connect to…" list — unrelated to the Shift-click
  // picker flow, left as-is: creates an unclassified (null) edge directly.
  function handleCreateEdge(fromId: string, toId: string) {
    // Deduplicate before adding
    const alreadyExists = edges.some(e =>
      (e.from_id === fromId && e.to_id === toId) ||
      (e.from_id === toId && e.to_id === fromId)
    )
    if (alreadyExists) return
    addEdge({
      id: `e-${Date.now()}`,
      from_id: fromId,
      to_id: toId,
      relationship: null,
      provenance: 'human',
    })
  }

  // Used by the Shift-click canvas flow, after the relationship picker resolves.
  function handleCreateEdgeWithRelationship(fromId: string, toId: string, relationship: 'supports' | 'challenges') {
    const alreadyExists = edges.some(e =>
      (e.from_id === fromId && e.to_id === toId) ||
      (e.from_id === toId && e.to_id === fromId)
    )
    if (alreadyExists) return
    addEdge({
      id: `e-${Date.now()}`,
      from_id: fromId,
      to_id: toId,
      relationship,
      provenance: 'human',
    })
  }

  // ─── Trace handlers ────────────────────────────────────────────────────────

  // Show a transient status line near the button; auto-clears after 3s.
  function flashTraceMsg(msg: string) {
    if (traceMsgTimer.current) window.clearTimeout(traceMsgTimer.current)
    setTraceMsg(msg)
    traceMsgTimer.current = window.setTimeout(() => setTraceMsg(null), 3000)
  }

  // Fires exactly one scan per click. `deep` = false → sliding horizon; true →
  // whole project. Both go through the same runTraceScan / render path.
  async function runScan(deep: boolean) {
    if (scanStatus === 'scanning') return   // no parallel scans / double-clicks
    setScanStatus('scanning')
    setTraceMsg(null)
    setGhostEdges([])
    try {
      const result = await runTraceScan({ nodes, edges, dismissedPairs, deep, strict: strictMode })
      if (result.kind === 'empty') {
        setGhostEdges([])
        flashTraceMsg('No hidden connections found in this scope.')
      } else {
        setGhostEdges(result.connections)
        // Deep Scan is revealed ONLY after a STANDARD scan has completed AND
        // returned results (the result state is now populated with Ghost Edges).
        // It never renders before the first scan, on an empty result, or on
        // error — so `deepAvailable` starts false (button not rendered) and only
        // flips true here, in the standard-scan results branch.
        if (!deep) setDeepAvailable(true)
      }
    } catch (err) {
      console.warn('Trace: scan failed', err)
      setGhostEdges([])
      flashTraceMsg('Scan failed — try again.')
    } finally {
      setScanStatus('idle')
    }
  }

  // Accept → a permanent, confirmed edge via the SAME store.addEdge every manual
  // (Shift-click) connection uses. Identical ThreadEdge shape; provenance marks
  // it AI-proposed-then-confirmed. The accepted pair is NOT added to
  // dismissedPairs — being a real edge now, it's excluded from future scans
  // naturally. The Ghost Edge is removed; graphLinks recomputes into a solid edge.
  function handleAcceptGhost(sourceId: string, targetId: string) {
    const alreadyExists = edges.some(e =>
      (e.from_id === sourceId && e.to_id === targetId) ||
      (e.from_id === targetId && e.to_id === sourceId)
    )
    if (!alreadyExists) {
      addEdge({
        id: `e-${Date.now()}`,
        from_id: sourceId,
        to_id: targetId,
        relationship: null,
        provenance: 'ai_proposed_confirmed',
      })
    }
    setGhostEdges(g => g.filter(ge => !samePair(ge, sourceId, targetId)))
  }

  // Dismiss → remove the Ghost Edge and persist the pair (both orderings) so it
  // never returns as a Ghost Edge unless dismissed pairs are cleared manually
  // (clearing UI is a flagged future addition — not built here).
  function handleDismissGhost(sourceId: string, targetId: string) {
    addDismissedPair(sourceId, targetId)
    setGhostEdges(g => g.filter(ge => !samePair(ge, sourceId, targetId)))
  }

  const hasNodes = activeNodes.length > 0
  const hasEdges = graphLinks.length > 0

  if (!hasNodes) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#08090A',
        gap: '8px',
      }}>
        <div style={{ fontFamily: 'var(--font-sans)', fontSize: '15px', color: 'var(--text-secondary)' }}>
          Nothing mapped yet.
        </div>
        <div style={{
          fontFamily: 'var(--font-sans)',
          fontSize: '13px',
          color: 'var(--text-tertiary)',
          textAlign: 'center',
          maxWidth: '320px',
          lineHeight: 1.5,
        }}>
          Add nodes in Linear view — they'll appear here.
        </div>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, position: 'relative', minHeight: 0, display: 'flex', background: '#08090A' }}>
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <GraphCanvas
          nodes={graphNodes}
          links={graphLinks}
          analytics={analytics}
          onNodeClick={handleNodeClick}
          onCreateEdge={handleCreateEdgeWithRelationship}
          hoveredId={hoveredId}
          setHoveredId={setHoveredId}
          selectedId={selectedId}
          currentSession={currentSession}
          ghostEdges={ghostEdges}
          onAcceptGhost={handleAcceptGhost}
          onDismissGhost={handleDismissGhost}
        />

        {/* ─── Trace triggers (bottom-left, floating above the canvas) ─────────
            Rendered only with 2+ nodes in the standard scan scope, so the button
            is absent on page load in a 0- or 1-node project. Trace fires ONLY
            from these clicks. */}
        {getScopedNodes(activeNodes, false).length >= 2 && (
          <div style={{
            position: 'absolute',
            bottom: '16px',
            left: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            zIndex: 30,
          }}>
            <button
              onClick={() => runScan(false)}
              disabled={scanStatus === 'scanning'}
              className="trace-scan-btn"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                color: 'var(--text-secondary)',
                padding: '6px 14px',
                borderRadius: '20px',
                cursor: scanStatus === 'scanning' ? 'default' : 'pointer',
              }}
            >
              {scanStatus === 'scanning'
                ? <TextShimmerWave duration={1.2} style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>Scanning...</TextShimmerWave>
                : 'Scan for Patterns'}
            </button>

            {/* Deep Scan — appears only after a standard scan has completed. */}
            {deepAvailable && (
              <button
                onClick={() => runScan(true)}
                disabled={scanStatus === 'scanning'}
                className="trace-scan-btn"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11px',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-tertiary)',
                  padding: '6px 14px',
                  borderRadius: '20px',
                  cursor: scanStatus === 'scanning' ? 'default' : 'pointer',
                }}
              >
                Deep Scan
              </button>
            )}

            {/* Strong-only toggle — raises Trace's bar (fewer, higher-confidence
                connections). Off by default so scans surface plenty to react to. */}
            <button
              onClick={() => setStrictMode(m => !m)}
              disabled={scanStatus === 'scanning'}
              className="trace-scan-btn"
              title="When on, Trace only suggests connections it's highly confident about."
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                background: strictMode ? 'var(--core-dim)' : 'var(--surface-2)',
                border: `1px solid ${strictMode ? 'var(--core)' : 'var(--border)'}`,
                color: strictMode ? 'var(--core)' : 'var(--text-tertiary)',
                padding: '6px 14px',
                borderRadius: '20px',
                cursor: scanStatus === 'scanning' ? 'default' : 'pointer',
              }}
            >
              {strictMode ? '✓ Strong only' : 'Strong only'}
            </button>

            {/* Transient empty / error status — never a prompt to add content. */}
            {traceMsg && (
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                color: 'var(--text-disabled)',
                animation: 'trace-fade 3s ease-in-out forwards',
                whiteSpace: 'nowrap',
              }}>
                {traceMsg}
              </span>
            )}
          </div>
        )}

        {/* Sparse-state hint */}
        {hasNodes && !hasEdges && (
          <div style={{
            position: 'absolute',
            bottom: '24px',
            left: '50%',
            transform: 'translateX(-50%)',
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            color: 'rgba(255,255,255,0.25)',
            letterSpacing: '0.03em',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}>
            Connect related ideas — click a node, then Shift-click another to link them.
          </div>
        )}
      </div>

      {selectedId ? (
        <div style={{ width: '320px', flexShrink: 0, borderLeft: '1px solid var(--border)', position: 'relative' }}>
          <SidePanel
            showConnect
            allNodes={activeNodes}
            onCreateEdge={handleCreateEdge}
            onRemoveEdge={removeEdge}
          />
        </div>
      ) : (
        <AnalyticsPanel
          analytics={analytics}
          nodeCount={graphNodes.length}
          edgeCount={graphLinks.length}
          currentSession={currentSession}
          setHoveredId={setHoveredId}
        />
      )}
    </div>
  )
}
