import { useRef, useState, useEffect } from 'react'
import { Pin } from 'lucide-react'
import { InView } from './core/in-view'
import { useStore } from '../store'
import { ORGANIZER_META, type ThreadNode } from '../types'
import { OrganizerIcon } from './organizerIcon'
import { OrganizerLegend } from './OrganizerLegend'
import { ReentryCard } from './ReentryCard'

// ─── Nodes view ───────────────────────────────────────────────────────────────
// An independently mountable workspace view (Step 3 of the workspace/
// view-slot redesign): the outline/node-list half of what used to be the
// single Linear view - the category legend, re-entry card, session dividers,
// and the node rows themselves. highlightedNodeId lives in the shared store
// (not local/prop state) so this component and TextView can cross-reference
// each other whenever both happen to be mounted, without requiring a common
// parent to broker it - see TextView.tsx for the other half. Internally it's
// still threaded down through OutlinePanel/NodeRow as a plain prop, same as
// before.

// ─── Single node row ──────────────────────────────────────────────────────────

interface NodeRowProps {
  id: string
  highlightedNodeId: string | null
  onHighlight: (id: string | null) => void
  parentLabel?: string
}

// Ambient re-entry glow - a background-color warmth (distinct from the
// opacity-with-age effect), radiating from the row's left edge in the node's
// organizer color at 8% opacity.
const FLOW_GLOW_GRADIENT: Record<ThreadNode['organizer'], string> = {
  core_idea: 'radial-gradient(ellipse at left, rgba(135, 154, 120, 0.1) 0%, transparent 70%)',
  point_of_tension: 'radial-gradient(ellipse at left, rgba(169, 111, 124, 0.1) 0%, transparent 70%)',
  open_thought: 'radial-gradient(ellipse at left, rgba(222, 166, 75, 0.1) 0%, transparent 70%)',
}

function NodeRow({ id, highlightedNodeId, onHighlight, parentLabel }: NodeRowProps) {
  const { nodes, setSelected, updateNode, flowGlowIds, flowGlowVisible } = useStore()
  const node = nodes.find(n => n.id === id)
  const [hovered, setHovered] = useState(false)
  if (!node) return null

  const meta = ORGANIZER_META[node.organizer]
  const isCurrentFocus = node.current_focus
  const isHighlighted = highlightedNodeId === id
  const isTension = node.organizer === 'point_of_tension'
  const isGlow = flowGlowIds.includes(id)
  const isPinned = !!node.pinned
  const rowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isHighlighted && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [isHighlighted])

  return (
    <InView
      variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      viewOptions={{ margin: '0px 0px -20px 0px' }}
    >
    <div
      ref={rowRef}
      onClick={() => { setSelected(id); onHighlight(id) }}
      style={{ padding: '0 var(--sp-3) var(--sp-2)', cursor: 'pointer' }}
    >
      <div style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 'var(--outline-row-min)',
        padding: 'var(--sp-3) var(--sp-4)',
        background: isHighlighted ? 'var(--surface-4)' : 'var(--surface-2)',
        borderRadius: '20px',
        overflow: 'hidden',
        transition: 'background var(--transition-fast)',
      }}
        onMouseEnter={e => { setHovered(true); if (!isHighlighted) (e.currentTarget as HTMLDivElement).style.background = 'var(--surface-3)' }}
        onMouseLeave={e => { setHovered(false); if (!isHighlighted) (e.currentTarget as HTMLDivElement).style.background = 'var(--surface-2)' }}
      >
        {/* Flow re-entry glow - one-time fade (not a keyframe loop). Sits under
            the content; background goes transparent after the 8s window. */}
        {isGlow && (
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
            borderRadius: 'inherit',
            background: flowGlowVisible ? FLOW_GLOW_GRADIENT[node.organizer] : 'transparent',
            transition: 'background 2s ease-out',
          }} />
        )}

        {/* Line 1: type icon · title · pin */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-1)' }}>
          <OrganizerIcon organizer={node.organizer} size={17} color="var(--text-primary)" />
          <span style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '14px',
            fontWeight: 400,
            color: meta.cssVar,
            lineHeight: 1.2,
            flex: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {node.label}
          </span>
          {/* Priority pin - the first (and here, only) hover-revealed action.
              Hidden until hover UNLESS pinned, in which case it stays visible in
              amber as the persistent "matters right now" marker. Toggling never
              touches the organizer/accent color - category identity is additive,
              not replaced. */}
          {(hovered || isPinned) && (
            <button
              onClick={e => { e.stopPropagation(); updateNode(id, { pinned: !isPinned }) }}
              title={isPinned ? 'Unpin' : 'Pin as most important right now'}
              aria-pressed={isPinned}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, padding: 0, border: 'none', background: 'none', cursor: 'pointer',
                color: isPinned ? 'var(--open)' : 'var(--text-tertiary)',
              }}
            >
              <Pin size={14} fill={isPinned ? 'var(--open)' : 'none'} />
            </button>
          )}
        </div>

        {/* Line 2: description preview */}
        {node.description && (
          <p style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '12px',
            fontWeight: 400,
            color: 'var(--text-secondary)',
            lineHeight: 1.5,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {node.description}
          </p>
        )}

        {/* Line 3: focus · parent linkage only - the type-label chip and
            timestamp/staleness text were dropped to match the Penpot card
            (icon + title + optional subtitle, nothing else). The underlying
            last_reinforced_at/staleness data isn't deleted, just not shown
            here by default. */}
        {(isCurrentFocus || (isTension && parentLabel)) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginTop: 'var(--sp-1)' }}>
            {isCurrentFocus && (
              <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-10)', color: 'var(--open)' }}>
                focus
              </span>
            )}
            {isTension && parentLabel && (
              <span style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--text-11)',
                color: 'var(--text-tertiary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                complicates: {parentLabel}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
    </InView>
  )
}

// ─── Outline panel ────────────────────────────────────────────────────────────

interface OutlinePanelProps {
  highlightedNodeId: string | null
  onHighlight: (id: string | null) => void
}

function OutlinePanel({ highlightedNodeId, onHighlight }: OutlinePanelProps) {
  const { nodes } = useStore()

  // Step 5 redesign: a flat, ungrouped list - no session dividers, section
  // headers, or an archive toggle. None of those appeared anywhere in the
  // Penpot design (just a plain sequence of cards), so the visual grouping
  // is dropped; the underlying session_id/resolved data isn't touched, it
  // just isn't used to partition the list anymore. Pinned nodes rise to the
  // top, then most-recent session first.
  const activeNodes = nodes
    .filter(n => !n.resolved && !n.superseded_by)
    .sort((a, b) => {
      const p = (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)
      if (p !== 0) return p
      return (b.session_id ?? 1) - (a.session_id ?? 1)
    })

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: 'var(--canvas)' }}>

      {/* Flow re-entry card - above the node list */}
      <ReentryCard />

      {activeNodes.map(n => {
        // Tensions still surface "complicates: X" - that's real relationship
        // data, not a decorative grouping, so it survives the flattening.
        const parent = n.organizer === 'point_of_tension' && n.parent_id
          ? nodes.find(p => p.id === n.parent_id)
          : undefined
        return (
          <NodeRow key={n.id} id={n.id} parentLabel={parent?.label}
            highlightedNodeId={highlightedNodeId} onHighlight={onHighlight} />
        )
      })}

      {activeNodes.length === 0 && (
        <div style={{ padding: 'var(--sp-10) var(--sp-4)', textAlign: 'center' }}>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-13)', color: 'var(--text-tertiary)' }}>
            No nodes yet.
          </p>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-11)', color: 'var(--text-disabled)', marginTop: 'var(--sp-1)' }}>
            Select a span of text in the editor to tag it.
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Main NodesView ───────────────────────────────────────────────────────────

export function NodesView() {
  const { nodes, highlightedNodeId, setHighlightedNodeId } = useStore()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
      {/* Header: the persistent Idea/Problem/Question color key sits here,
          front and center, matching the Penpot design - counts are still
          shown (nothing is removed), just de-emphasized on the right. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 'var(--subheader-height)', boxSizing: 'border-box', padding: '0 var(--sp-4)', background: 'var(--surface-1)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <OrganizerLegend />
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
          {/* Passive, display-only count of unresolved tensions - never gates anything. */}
          {(() => {
            const openTensions = nodes.filter(n => n.organizer === 'point_of_tension' && !n.resolved && !n.superseded_by).length
            return (
              <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-10)', color: openTensions > 0 ? 'var(--tension)' : 'var(--text-disabled)' }}>
                Tensions · {openTensions} open
              </span>
            )
          })()}
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-10)', color: 'var(--text-disabled)' }}>{nodes.filter(n => !n.resolved && !n.superseded_by).length} nodes</span>
        </span>
      </div>
      <OutlinePanel highlightedNodeId={highlightedNodeId} onHighlight={setHighlightedNodeId} />
    </div>
  )
}
