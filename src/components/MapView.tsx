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
import type { ThreadNode } from '../types'
import { SidePanel } from './SidePanel'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface GraphNode extends SimulationNodeDatum {
  id: string
  label: string
  organizer: ThreadNode['organizer']
  sessionId: number
}

interface GraphLink extends SimulationLinkDatum<GraphNode> {
  id: string
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

// ─── Graph Canvas ───────────────────────────────────────────────────────────────

function GraphCanvas({
  nodes,
  links,
  onNodeClick,
  onCreateEdge,
  hoveredId,
  setHoveredId,
  selectedId,
  currentSession,
}: {
  nodes: GraphNode[]
  links: GraphLink[]
  onNodeClick: (id: string) => void
  onCreateEdge: (fromId: string, toId: string) => void
  hoveredId: string | null
  setHoveredId: (id: string | null) => void
  selectedId: string | null
  currentSession: number
}) {
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

  // Build connected sets for hover highlighting
  const connectedTo = useCallback((id: string): Set<string> => {
    const s = new Set<string>()
    links.forEach(l => {
      const src = typeof l.source === 'object' ? (l.source as GraphNode).id : l.source as string
      const tgt = typeof l.target === 'object' ? (l.target as GraphNode).id : l.target as string
      if (src === id) s.add(tgt)
      if (tgt === id) s.add(src)
    })
    return s
  }, [links])

  // Per-node connection counts
  const connectionCounts = useMemo(() => {
    const counts = new Map<string, number>()
    links.forEach(l => {
      const src = typeof l.source === 'object' ? (l.source as GraphNode).id : l.source as string
      const tgt = typeof l.target === 'object' ? (l.target as GraphNode).id : l.target as string
      counts.set(src, (counts.get(src) ?? 0) + 1)
      counts.set(tgt, (counts.get(tgt) ?? 0) + 1)
    })
    return counts
  }, [links])

  // Track shift key and handle Escape
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') isShiftHeldRef.current = true
      if (e.key === 'Escape') {
        setConnectingFrom(null)
        setCursorPos(null)
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
      source: simNodes.find(n => n.id === (typeof l.source === 'object' ? (l.source as GraphNode).id : l.source))!,
      target: simNodes.find(n => n.id === (typeof l.target === 'object' ? (l.target as GraphNode).id : l.target))!,
    })).filter(l => l.source && l.target)

    if (simRef.current) {
      simRef.current.stop()
      cancelAnimationFrame(frameRef.current)
    }

    const sim = forceSimulation<GraphNode, GraphLink>(simNodes)
      .force('link', simLinks.length > 0
        ? forceLink<GraphNode, GraphLink>(simLinks)
            .id(d => d.id)
            .distance(80)
            .strength(0.5)
        : null
      )
      .force('charge', forceManyBody<GraphNode>().strength(-120).distanceMax(300))
      .force('center', forceCenter(width / 2, height / 2).strength(0.25))
      .force('collision', forceCollide<GraphNode>()
        .radius(d => (d.label.length * 3.8) + 18)
        .strength(0.9)
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
    if ((e.target as Element).tagName === 'text') return
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
    if ((e.target as Element).tagName === 'text') return
    setResetTransition(true)
    transformRef.current = { x: 0, y: 0, k: 1 }
    setTransform({ x: 0, y: 0, k: 1 })
    setTimeout(() => setResetTransition(false), 320)
  }

  const handleNodeMouseDown = (e: React.MouseEvent, node: GraphNode) => {
    e.stopPropagation()

    // Shift held: connection mode only, no drag
    if (isShiftHeldRef.current || e.shiftKey) {
      if (!connectingFrom) {
        setConnectingFrom(node.id)
        setCursorPos(toGraphCoords(e.clientX, e.clientY))
      } else if (connectingFrom === node.id) {
        // Same node: cancel
        setConnectingFrom(null)
        setCursorPos(null)
      } else {
        onCreateEdge(connectingFrom, node.id)
        setConnectingFrom(null)
        setCursorPos(null)
      }
      return
    }

    if (connectingFrom && connectingFrom !== node.id) {
      // Second click without shift still completes the connection
      onCreateEdge(connectingFrom, node.id)
      setConnectingFrom(null)
      setCursorPos(null)
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

  return (
    <svg
      ref={svgRef}
      style={{
        width: '100%',
        height: '100%',
        cursor: connectingFrom ? 'crosshair' : 'default',
        userSelect: 'none',
        background: '#08090A',
      }}
      onMouseDown={onMouseDownCanvas}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onWheel={onWheel}
      onDoubleClick={onDoubleClick}
    >
      <g
        transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}
        style={resetTransition ? { transition: 'transform 300ms ease' } : undefined}
      >
        {/* Edges — rendered first, under nodes */}
        {links.map(link => {
          const src = typeof link.source === 'object' ? (link.source as GraphNode).id : link.source as string
          const tgt = typeof link.target === 'object' ? (link.target as GraphNode).id : link.target as string
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
          const cx = mx + nx * (dist * 0.2)
          const cy = my + ny * (dist * 0.2)

          const isHighlighted = hoveredId && (src === hoveredId || tgt === hoveredId)
          const isDimmed = hoveredId && !isHighlighted

          return (
            <path
              key={link.id}
              d={`M ${posA.x} ${posA.y} Q ${cx} ${cy} ${posB.x} ${posB.y}`}
              stroke={
                isHighlighted
                  ? 'rgba(255,255,255,0.5)'
                  : isDimmed
                  ? 'rgba(255,255,255,0.03)'
                  : 'rgba(255,255,255,0.18)'
              }
              strokeWidth={isHighlighted ? 1.0 : 0.7}
              fill="none"
              strokeLinecap="round"
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

        {/* Nodes — rendered on top */}
        {nodes.map(node => {
          const pos = positions.get(node.id)
          if (!pos) return null

          const count = connectionCounts.get(node.id) ?? 0
          const fontSize = Math.min(12 + count * 1.2, 20)
          const fontWeight = count > 5 ? 500 : 400
          const isDimmed = hoveredId && hoveredId !== node.id && !neighbors?.has(node.id)
          const isHovered = hoveredId === node.id
          const isSelected = selectedId === node.id
          const isConnectingSource = connectingFrom === node.id
          const opacity = isDimmed ? 0.15 : recencyOpacity(node.sessionId, currentSession)

          let fill: string
          if (isConnectingSource || isSelected) {
            fill = '#FFFFFF'
          } else if (isHovered) {
            fill = '#FFFFFF'
          } else if (node.organizer === 'point_of_tension') {
            fill = 'rgba(224, 107, 90, 0.85)'
          } else if (node.organizer === 'core_idea') {
            fill = 'rgba(232, 230, 220, 0.85)'
          } else {
            fill = 'rgba(232, 230, 220, 0.65)'
          }

          return (
            <text
              key={node.id}
              data-node={node.id}
              x={pos.x}
              y={pos.y}
              textAnchor="middle"
              dominantBaseline="middle"
              style={{
                fontFamily: 'var(--font-sans, Geist, sans-serif)',
                fontSize: `${fontSize}px`,
                fontWeight,
                fill,
                opacity,
                transition: 'fill 150ms ease, opacity 0.35s ease',
                cursor: connectingFrom && connectingFrom !== node.id ? 'crosshair' : 'pointer',
                pointerEvents: 'all',
              }}
              onMouseEnter={() => setHoveredId(node.id)}
              onMouseLeave={() => setHoveredId(null)}
              onMouseDown={e => handleNodeMouseDown(e, node)}
              onMouseUp={e => handleNodeMouseUp(e, node)}
              onClick={e => e.stopPropagation()}
            >
              {node.label}
            </text>
          )
        })}
      </g>
    </svg>
  )
}

// ─── Main MapView ──────────────────────────────────────────────────────────────

export function MapView() {
  const { nodes, edges, addEdge, removeEdge, setSelected, selectedId, currentSession } = useStore()
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const activeNodes = nodes.filter(n => !n.resolved && !n.superseded_by)

  const graphNodes: GraphNode[] = useMemo(() => activeNodes.map(n => ({
    id: n.id,
    label: n.label,
    organizer: n.organizer,
    sessionId: n.session_id,
  })), [activeNodes.map(n => `${n.id}:${n.session_id}`).join(',')])

  // Only manually-stored edges (no auto-generation)
  const graphLinks: GraphLink[] = useMemo(() =>
    edges
      .filter(e =>
        activeNodes.some(n => n.id === e.from_id) &&
        activeNodes.some(n => n.id === e.to_id)
      )
      .map(e => ({ id: e.id, source: e.from_id, target: e.to_id })),
    [edges, activeNodes.map(n => n.id).join(',')]
  )

  function handleNodeClick(id: string) {
    setSelected(selectedId === id ? null : id)
  }

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
          onNodeClick={handleNodeClick}
          onCreateEdge={handleCreateEdge}
          hoveredId={hoveredId}
          setHoveredId={setHoveredId}
          selectedId={selectedId}
          currentSession={currentSession}
        />

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

      {selectedId && (
        <div style={{ width: '320px', flexShrink: 0, borderLeft: '1px solid var(--border)', position: 'relative' }}>
          <SidePanel
            showConnect
            allNodes={activeNodes}
            onCreateEdge={handleCreateEdge}
            onRemoveEdge={removeEdge}
          />
        </div>
      )}
    </div>
  )
}
