import { useRef, useState, useEffect } from 'react'
import { Pin } from 'lucide-react'
import { InView } from './core/in-view'
import { useStore } from '../store'
import { ORGANIZER_META, organizerLabel, type ThreadNode } from '../types'
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

// ─── Session divider ──────────────────────────────────────────────────────────

const COLOR_TEAL   = 'var(--core)'
const COLOR_CORAL  = 'var(--tension)'
const COLOR_MUTED  = 'var(--text-tertiary)'

interface SessionStats {
  added: number
  resolved: number
  tensionsAdded: number
  tensionsOpen: number   // tensions with session_id <= N that are currently unresolved
  addedNodes: ThreadNode[]
  resolvedNodes: ThreadNode[]
  openTensionNodes: ThreadNode[]
}

function computeSessionStats(allNodes: ThreadNode[], session: number): SessionStats {
  const addedNodes   = allNodes.filter(n => (n.session_id ?? 0) === session)
  const resolvedNodes = allNodes.filter(n => (n.session_id ?? 0) === session && (n.resolved || !!n.superseded_by))
  const tensionsAdded = addedNodes.filter(n => n.organizer === 'point_of_tension').length
  const openTensionNodes = allNodes.filter(n =>
    n.organizer === 'point_of_tension' &&
    (n.session_id ?? 0) <= session &&
    !n.resolved && !n.superseded_by
  )
  return {
    added: addedNodes.length,
    resolved: resolvedNodes.length,
    tensionsAdded,
    tensionsOpen: openTensionNodes.length,
    addedNodes,
    resolvedNodes,
    openTensionNodes,
  }
}

function sessionLabelColor(stats: SessionStats): string {
  if (stats.tensionsAdded === 0 && stats.resolved === 0) return COLOR_MUTED
  if (stats.tensionsAdded > stats.resolved) return COLOR_CORAL
  return COLOR_TEAL
}

// "// current session" marker - always visible at top of outline
function CurrentSessionMarker() {
  return (
    <div style={{ height: 'var(--session-divider-h)', display: 'flex', alignItems: 'center', padding: '0 var(--sp-4)', background: 'var(--canvas)' }}>
      <span style={{
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-11)',
        color: 'var(--open)',
      }}>
        // current session
      </span>
    </div>
  )
}

// Mini node row used inside expanded session diff - no click, no timestamp
function DiffNodeRow({ node, strikethrough }: { node: ThreadNode; strikethrough?: boolean }) {
  const organizerLabels = useStore(s => s.organizerLabels)
  const meta = ORGANIZER_META[node.organizer]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', padding: '3px var(--sp-3) 3px var(--sp-5)' }}>
      <span style={{ display: 'inline-block', width: '5px', height: '5px', borderRadius: '50%', background: meta.cssVar, flexShrink: 0 }} />
      <span style={{
        fontFamily: 'var(--font-sans)', fontSize: 'var(--text-11)',
        color: strikethrough ? 'var(--text-disabled)' : 'var(--text-secondary)',
        textDecoration: strikethrough ? 'line-through' : 'none',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
      }}>
        {node.label}
      </span>
      <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-10)', color: 'var(--text-tertiary)', flexShrink: 0 }}>
        {organizerLabel(node.organizer, { organizerLabels })}
      </span>
    </div>
  )
}

interface SessionDividerProps {
  session: number
  allNodes: ThreadNode[]
  isPast: boolean   // false = current session (no diff, no click)
}

function SessionDivider({ session, allNodes, isPast }: SessionDividerProps) {
  const [expanded, setExpanded] = useState(false)

  const stats = computeSessionStats(allNodes, session)
  const labelColor = isPast ? sessionLabelColor(stats) : 'rgba(255,255,255,0.15)'

  const hasActivity = stats.added > 0 || stats.resolved > 0
  const summaryParts: string[] = []
  if (stats.added > 0)    summaryParts.push(`${stats.added} added`)
  if (stats.resolved > 0) summaryParts.push(`${stats.resolved} resolved`)
  summaryParts.push(`${stats.tensionsOpen} tension${stats.tensionsOpen !== 1 ? 's' : ''} open`)
  const summary = hasActivity ? summaryParts.join(' · ') : 'no changes this session'

  // Diff: split addedNodes into non-resolved and resolved for clarity
  const addedActive   = stats.addedNodes.filter(n => !n.resolved && !n.superseded_by)
  const addedResolved = stats.resolvedNodes

  return (
    <div>
      {/* Divider row */}
      <div
        onClick={isPast ? () => setExpanded(v => !v) : undefined}
        style={{
          height: 'var(--session-divider-h)',
          display: 'flex', alignItems: 'center', gap: 'var(--sp-3)',
          padding: '0 var(--sp-4)',
          background: 'var(--canvas)',
          cursor: isPast ? 'pointer' : 'default',
          userSelect: 'none',
        }}
      >
        <div style={{ width: '1px', height: '100%', background: 'var(--border)', flexShrink: 0 }} />
        <span style={{
          fontFamily: 'var(--font-sans)', fontSize: 'var(--text-11)', fontWeight: 500,
          color: labelColor,
          whiteSpace: 'nowrap',
        }}>
          - session {session} -
        </span>
        {isPast && (
          <span style={{
            fontFamily: 'var(--font-sans)', fontSize: 'var(--text-11)',
            color: 'var(--text-tertiary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
          }}>
            {summary}
          </span>
        )}
        {isPast && (
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-11)', color: 'var(--text-tertiary)', marginLeft: 'auto', flexShrink: 0, transition: 'transform var(--transition-fast)', display: 'inline-block', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>
            ▾
          </span>
        )}
      </div>

      {/* Expanded diff - past sessions only */}
      {isPast && expanded && (
        <div style={{ borderLeft: '1px solid var(--border)', marginLeft: 'var(--sp-4)', marginBottom: 'var(--sp-1)', paddingBottom: 'var(--sp-1)', background: 'var(--canvas)' }}>
          {addedActive.length > 0 && (
            <>
              <div style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-11)', color: 'var(--text-tertiary)', padding: 'var(--sp-1) var(--sp-3) 2px' }}>Added</div>
              {addedActive.map(n => <DiffNodeRow key={n.id} node={n} />)}
            </>
          )}
          {addedResolved.length > 0 && (
            <>
              <div style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-11)', color: 'var(--text-tertiary)', padding: 'var(--sp-1) var(--sp-3) 2px' }}>Resolved</div>
              {addedResolved.map(n => <DiffNodeRow key={n.id} node={n} strikethrough />)}
            </>
          )}
          {stats.openTensionNodes.length > 0 && (
            <>
              <div style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-11)', color: 'var(--text-tertiary)', padding: 'var(--sp-1) var(--sp-3) 2px' }}>Tensions open</div>
              {stats.openTensionNodes.map(n => {
                const resolvedLater = n.resolved || !!n.superseded_by
                return (
                  <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', padding: '3px var(--sp-3) 3px var(--sp-5)' }}>
                    <span style={{ display: 'inline-block', width: '5px', height: '5px', borderRadius: '50%', background: 'var(--tension)', flexShrink: 0 }} />
                    <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-11)', color: resolvedLater ? 'var(--text-disabled)' : 'var(--tension)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.label}</span>
                    <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-10)', color: 'var(--text-tertiary)', flexShrink: 0 }}>{resolvedLater ? 'later resolved' : 'still open'}</span>
                  </div>
                )
              })}
            </>
          )}
          {addedActive.length === 0 && addedResolved.length === 0 && stats.openTensionNodes.length === 0 && (
            <div style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-11)', color: 'var(--text-tertiary)', padding: 'var(--sp-1) var(--sp-3)' }}>no node activity this session</div>
          )}
        </div>
      )}
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

// Ambient re-entry glow - a background-color warmth (distinct from the
// opacity-with-age effect), radiating from the row's left edge in the node's
// organizer color at 8% opacity.
const FLOW_GLOW_GRADIENT: Record<ThreadNode['organizer'], string> = {
  core_idea: 'radial-gradient(ellipse at left, rgba(135, 154, 120, 0.1) 0%, transparent 70%)',
  point_of_tension: 'radial-gradient(ellipse at left, rgba(169, 111, 124, 0.1) 0%, transparent 70%)',
  open_thought: 'radial-gradient(ellipse at left, rgba(222, 166, 75, 0.1) 0%, transparent 70%)',
}

function NodeRow({ id, indent, highlightedNodeId, onHighlight, parentLabel }: NodeRowProps) {
  const { nodes, setSelected, updateNode, flowGlowIds, flowGlowVisible, organizerLabels } = useStore()
  const node = nodes.find(n => n.id === id)
  const [hovered, setHovered] = useState(false)
  if (!node) return null

  const meta = ORGANIZER_META[node.organizer]
  const isCurrentFocus = node.current_focus
  const isHighlighted = highlightedNodeId === id
  const stale = isStale(node.last_reinforced_at)
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
      style={{ padding: indent ? '0 var(--sp-3) var(--sp-2) 24px' : '0 var(--sp-3) var(--sp-2)', cursor: 'pointer' }}
    >
      <div style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 'var(--outline-row-min)',
        padding: 'var(--sp-3) var(--sp-4) var(--sp-3) 22px',
        background: isHighlighted ? 'var(--surface-3)' : 'var(--surface-1)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        transition: 'background var(--transition-fast)',
      }}
        onMouseEnter={e => { setHovered(true); if (!isHighlighted) (e.currentTarget as HTMLDivElement).style.background = 'var(--surface-2)' }}
        onMouseLeave={e => { setHovered(false); if (!isHighlighted) (e.currentTarget as HTMLDivElement).style.background = 'var(--surface-1)' }}
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

        {/* 2px left accent bar */}
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: 'var(--accent-bar-width)',
          background: meta.cssVar,
          animation: isCurrentFocus ? 'pulse-accent 2s ease-in-out infinite' : 'none',
        }} />

        {/* Line 1: type icon · title · pin */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-1)' }}>
          <OrganizerIcon organizer={node.organizer} size={14} color="var(--text-primary)" />
          <span style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-15)',
            fontWeight: 500,
            color: 'var(--text-primary)',
            lineHeight: 1.3,
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
            fontSize: 'var(--text-13)',
            color: 'var(--text-secondary)',
            lineHeight: 1.4,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            marginBottom: 'var(--sp-1)',
          }}>
            {node.description}
          </p>
        )}

        {/* Line 3: type label · focus · parent · timestamp */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginTop: 'auto' }}>
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-10)', color: meta.cssVar }}>
            {organizerLabel(node.organizer, { organizerLabels }).toLowerCase()}{isCurrentFocus ? ' · focus' : ''}
          </span>
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
          <span style={{ flex: 1 }} />
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-10)', color: stale ? 'var(--tension)' : 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
            {relativeTime(node.last_reinforced_at)}{stale && isTension ? ` · ${staleDays(node.last_reinforced_at)}d unresolved` : stale ? ' stale' : ''}
          </span>
        </div>
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
  // Pinned tensions rise to the top of their group (under a parent, or the
  // unlinked list) - stable, so the pre-existing insertion order is otherwise kept.
  for (const key of Object.keys(tensionsByParent)) {
    tensionsByParent[key].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
  }

  const openThoughts = activeNodes
    .filter(n => n.organizer === 'open_thought')
    .sort((a, b) => {
      // Pinned nodes rise to the top of the section; the existing secondary
      // sort (session desc, then focus) is preserved within each group.
      const p = (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)
      if (p !== 0) return p
      const sd = (b.session_id ?? 1) - (a.session_id ?? 1)
      return sd !== 0 ? sd : (b.current_focus ? 1 : 0) - (a.current_focus ? 1 : 0)
    })

  const unattachedTensions = tensionsByParent['__unattached__'] ?? []

  // Group core ideas by session for dividers. Core ideas keep their session
  // grouping (pinning across session boundaries would fragment the dividers),
  // so pinned core ideas instead rise to the top WITHIN their own session group.
  const sessionGroups: { session: number; ids: string[] }[] = []
  for (const n of coreIdeas) {
    const s = n.session_id ?? 1
    const last = sessionGroups[sessionGroups.length - 1]
    if (last && last.session === s) last.ids.push(n.id)
    else sessionGroups.push({ session: s, ids: [n.id] })
  }
  const pinnedById = (nid: string) => !!nodes.find(n => n.id === nid)?.pinned
  for (const group of sessionGroups) {
    group.ids.sort((a, b) => (pinnedById(b) ? 1 : 0) - (pinnedById(a) ? 1 : 0))
  }

  const sectionHeader: React.CSSProperties = {
    fontFamily: 'var(--font-sans)',
    fontSize: 'var(--text-11)',
    fontWeight: 500,
    color: 'var(--text-tertiary)',
    letterSpacing: '0.01em',
    padding: 'var(--sp-6) var(--sp-4) var(--sp-2)',
    background: 'var(--canvas)',
    borderBottom: '1px solid var(--border-subtle)',
    display: 'block',
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: 'var(--canvas)' }}>

      {/* Flow re-entry card - above the node list and the session divider */}
      <ReentryCard />

      {/* Always-visible current session anchor */}
      <CurrentSessionMarker />

      {/* Core Ideas + nested tensions, grouped by session */}
      {coreIdeas.length > 0 && (
        <div>
          <span style={sectionHeader}>Core Ideas</span>
          {sessionGroups.map((group) => (
            <div key={group.session}>
              <SessionDivider session={group.session} allNodes={nodes} isPast={group.session < currentSession} />
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

      {/* Tensions without a parent */}
      {unattachedTensions.length > 0 && (
        <div>
          <span style={{ ...sectionHeader, color: 'var(--tension)' }}>Tensions (unlinked)</span>
          {unattachedTensions.map(t => (
            <NodeRow key={t.id} id={t.id} highlightedNodeId={highlightedNodeId} onHighlight={onHighlight} />
          ))}
        </div>
      )}

      {/* Open Thoughts */}
      {openThoughts.length > 0 && (
        <div>
          <span style={sectionHeader}>Open Thoughts</span>
          {openThoughts.map(n => (
            <NodeRow key={n.id} id={n.id} highlightedNodeId={highlightedNodeId} onHighlight={onHighlight} />
          ))}
        </div>
      )}

      {/* Resolved / Archived */}
      {archivedNodes.length > 0 && (
        <div>
          <button
            onClick={() => setArchivedOpen(v => !v)}
            style={{ ...sectionHeader, background: 'var(--canvas)', border: 'none', cursor: 'pointer', width: '100%', textAlign: 'left', display: 'block' }}
          >
            {archivedOpen ? '▾' : '▸'} Resolved ({archivedNodes.length})
          </button>
          {archivedOpen && archivedNodes.map(n => (
            <div key={n.id} style={{ opacity: 0.4 }}>
              <NodeRow id={n.id} highlightedNodeId={highlightedNodeId} onHighlight={onHighlight} />
            </div>
          ))}
        </div>
      )}

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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--sp-2) var(--sp-4)', background: 'var(--surface-1)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
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
