import { useRef, useState, useEffect } from 'react'
import { Link2 } from 'lucide-react'
import { InView } from './core/in-view'
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

// ─── Confidence squares ───────────────────────────────────────────────────────

function ConfidenceDots({ confidence }: { confidence: 1 | 2 | 3 }) {
  return (
    <span style={{ display: 'inline-flex', gap: '2px', alignItems: 'center' }}>
      {([1, 2, 3] as const).map(i => (
        <span
          key={i}
          title={i === 1 ? 'Rough' : i === 2 ? 'Fine' : 'Confirmed'}
          style={{
            display: 'inline-block',
            width: '3px',
            height: '3px',
            borderRadius: '1px',
            background: i <= confidence ? 'var(--text-secondary)' : 'var(--surface-4)',
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
    fontFamily: 'var(--font-sans)',
    fontSize: 'var(--text-14)',
    lineHeight: '1.65',
    padding: 'var(--sp-5) var(--sp-6)',
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
          color: 'var(--text-primary)',
          resize: 'none',
          border: 'none',
          outline: 'none',
          zIndex: 1,
          caretColor: 'var(--core)',
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
    <div style={{
      position: 'fixed', zIndex: 50,
      left: Math.max(8, x - 70), top: Math.max(8, y - 48),
      display: 'flex', alignItems: 'center',
      background: 'var(--surface-2)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
    }}>
      <button
        onMouseDown={e => { e.preventDefault(); onCreateNode() }}
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--sp-1)',
          padding: 'var(--sp-1) var(--sp-3)',
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--text-11)',
          color: 'var(--core)',
          background: 'none', border: 'none', cursor: 'pointer',
        }}
      >
        <Link2 size={10} />
        Tag as node
      </button>
    </div>
  )
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

// "// current session" marker — always visible at top of outline
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

// Mini node row used inside expanded session diff — no click, no timestamp
function DiffNodeRow({ node, strikethrough }: { node: ThreadNode; strikethrough?: boolean }) {
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
        {meta.short}
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
          — session {session} —
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

      {/* Expanded diff — past sessions only */}
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

function NodeRow({ id, indent, highlightedNodeId, onHighlight, parentLabel }: NodeRowProps) {
  const { nodes, setSelected } = useStore()
  const node = nodes.find(n => n.id === id)
  if (!node) return null

  const meta = ORGANIZER_META[node.organizer]
  const isCurrentFocus = node.current_focus
  const isHighlighted = highlightedNodeId === id
  const stale = isStale(node.last_reinforced_at)
  const isTension = node.organizer === 'point_of_tension'
  const confidence = node.confidence ?? 2
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
      style={{ paddingLeft: indent ? '24px' : '0', cursor: 'pointer' }}
    >
      <div style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 'var(--outline-row-min)',
        padding: 'var(--sp-3) var(--sp-4) var(--sp-3) 20px',
        background: isHighlighted ? 'var(--surface-2)' : 'transparent',
        transition: 'background var(--transition-fast)',
      }}
        onMouseEnter={e => { if (!isHighlighted) (e.currentTarget as HTMLDivElement).style.background = 'var(--surface-1)' }}
        onMouseLeave={e => { if (!isHighlighted) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
      >
        {/* 2px left accent bar */}
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: 'var(--accent-bar-width)',
          background: meta.cssVar,
          animation: isCurrentFocus ? 'pulse-accent 2s ease-in-out infinite' : 'none',
        }} />

        {/* Line 1: dot · title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-1)' }}>
          <span style={{
            display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%',
            background: meta.cssVar, flexShrink: 0,
          }} />
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
          <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 'var(--text-10)', color: meta.cssVar }}>
            {meta.short.toLowerCase()}{isCurrentFocus ? ' · focus' : ''}
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
          <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 'var(--text-10)', color: stale ? 'var(--tension)' : 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
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

// ─── Anchor badges strip ──────────────────────────────────────────────────────

function AnchorBadges({ onAnchorClick, activeNodeId }: { onAnchorClick: (id: string) => void; activeNodeId: string | null }) {
  const { textAnchors, nodes } = useStore()
  if (textAnchors.length === 0) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-1)', padding: 'var(--sp-1) var(--sp-4)', borderTop: '1px solid var(--border-subtle)', flexShrink: 0 }}>
      <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-11)', color: 'var(--text-tertiary)', alignSelf: 'center' }}>
        Linked spans:
      </span>
      {textAnchors.map(anchor => {
        const node = nodes.find(n => n.id === anchor.node_id)
        if (!node) return null
        const meta = ORGANIZER_META[node.organizer]
        const isActive = activeNodeId === node.id
        return (
          <button
            key={anchor.id}
            onClick={() => onAnchorClick(node.id)}
            title={`"${anchor.text}" → ${node.label}`}
            style={{
              display: 'flex', alignItems: 'center', gap: 'var(--sp-1)',
              padding: '2px var(--sp-2)', borderRadius: 'var(--radius-sm)',
              border: `1px solid ${isActive ? meta.cssVar : 'var(--border)'}`,
              background: isActive ? meta.cssDim : 'transparent',
              color: isActive ? meta.cssVar : 'var(--text-tertiary)',
              fontFamily: 'var(--font-sans)', fontSize: 'var(--text-10)', cursor: 'pointer',
              transition: 'all var(--transition-fast)',
            }}
          >
            <Link2 size={10} />
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
  const saveButtonRef = useRef<HTMLDivElement>(null)
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null)
  const [toolbar, setToolbar] = useState<{ x: number; y: number } | null>(null)
  const [selection, setSelection] = useState<{ start: number; end: number; text: string } | null>(null)
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [addPrefill, setAddPrefill] = useState<AddNodePrefill | null>(null)
  const [saveModalOpen, setSaveModalOpen] = useState(false)

  function handleSaveMyPlace() { setSaveModalOpen(true) }

  useEffect(() => {
    if (!saveButtonRef.current) return
    const wrapper = saveButtonRef.current

    const timer = setTimeout(() => {
      const Button = (window as unknown as Record<string, unknown>).Button as (new (opts: Record<string, unknown>) => { element: HTMLElement; textElement: HTMLElement | null; canvas: HTMLCanvasElement | null }) | undefined
      if (!Button) {
        renderFallback(wrapper)
        return
      }

      const glassBtn = new Button({
        text: '⊙ Save my place',
        fontSize: 13,
        type: 'pill',
        tintOpacity: 0.35,
        warp: false,
      })

      if (glassBtn.textElement) {
        glassBtn.textElement.style.fontFamily = "'Geist', -apple-system, sans-serif"
        glassBtn.textElement.style.fontSize = '11px'
        glassBtn.textElement.style.letterSpacing = '0.03em'
        glassBtn.textElement.style.color = '#E8E6DC'
      }

      glassBtn.element.style.cursor = 'pointer'
      glassBtn.element.addEventListener('click', handleSaveMyPlace)

      wrapper.innerHTML = ''
      wrapper.appendChild(glassBtn.element)

      setTimeout(() => {
        const canvas = glassBtn.canvas
        if (!canvas) { renderFallback(wrapper); return }
        const ctx = canvas.getContext('2d')
        if (!ctx) { renderFallback(wrapper); return }
        const imageData = ctx.getImageData(0, 0, 1, 1)
        if (imageData.data[3] === 0) renderFallback(wrapper)
      }, 800)
    }, 300)

    function renderFallback(wrapper: HTMLDivElement) {
      wrapper.innerHTML = ''
      const btn = document.createElement('button')
      btn.textContent = '⊙ Save my place'
      btn.style.cssText = `
        background: rgba(76, 201, 160, 0.08);
        backdrop-filter: blur(16px) saturate(1.6);
        -webkit-backdrop-filter: blur(16px) saturate(1.6);
        border: 1px solid rgba(76, 201, 160, 0.15);
        border-top: 1px solid rgba(76, 201, 160, 0.25);
        box-shadow: 0 1px 0 rgba(255,255,255,0.06) inset, 0 8px 32px rgba(0,0,0,0.5);
        color: #E8E6DC;
        font-family: 'Geist', -apple-system, sans-serif;
        font-size: 11px;
        font-weight: 500;
        letter-spacing: 0.03em;
        padding: 8px 20px;
        border-radius: 20px;
        cursor: pointer;
      `
      btn.onclick = handleSaveMyPlace
      wrapper.appendChild(btn)
    }

    return () => clearTimeout(timer)
  }, [])

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
      <div className="draft-editor-container" style={{ display: 'flex', flexDirection: 'column', width: '55%', minWidth: 0, borderRight: '1px solid var(--border)', position: 'relative' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--sp-1) var(--sp-4)', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-11)', color: 'var(--text-tertiary)' }}>Draft</span>
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-10)', color: 'var(--text-disabled)' }}>
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

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--sp-2) var(--sp-4)', borderTop: '1px solid var(--border-subtle)', flexShrink: 0 }}>
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-10)', color: 'var(--text-disabled)' }}>
            {textAnchors.length > 0 ? `${textAnchors.length} linked span${textAnchors.length !== 1 ? 's' : ''}` : ''}
          </span>
          <div ref={saveButtonRef} />
        </div>
      </div>

      {/* ── RIGHT: Outline ─────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', width: '45%', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--sp-1) var(--sp-4)', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-11)', color: 'var(--text-tertiary)' }}>Outline</span>
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-10)', color: 'var(--text-disabled)' }}>{nodes.filter(n => !n.resolved && !n.superseded_by).length} nodes</span>
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
