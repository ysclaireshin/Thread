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
  // Flow: when the node's label / description / organizer was last edited.
  // Distinct from last_reinforced_at (which also bumps on non-edit reinforcement).
  lastEditedAt?: string
  // Focus node that was active when this node was created
  createdWithFocus?: string | null
  // Resolution / lifecycle
  resolved?: boolean
  resolution_note?: string
  superseded_by?: string | null
}

export interface ThreadEdge {
  id: string
  from_id: string
  to_id: string
  // Semantic relationship type — null until classified by a user-facing picker.
  relationship: Relationship | null
  // How this edge was created, mirrors ThreadNode.provenance.
  provenance: Provenance
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
  // ─── Flow (re-entry) ──────────────────────────────────────────────────────
  // The user's own typed commitment sentence from the last "Save my place".
  focusCommitment?: string
  // The session that was active when focusCommitment was written (the session
  // that ended with the last Save My Place). Previous-session lookups key off this.
  focusCommitmentSession?: number
  // Snapshot of the draft (last ~200 words) at the moment Save My Place ran —
  // used only as context for the Replay AI summary.
  focusDraftSnapshot?: string
  // Cursor position to restore on re-entry (0-indexed line + char offset in line).
  lastCursorLine?: number | null
  lastCursorOffset?: number | null
  // ─── Trace (dismissed Ghost Edge pairs) ────────────────────────────────────
  // Node-id pairs the user has dismissed from Trace. Stored in BOTH orderings
  // ("A|B" and "B|A") so a scan's direction never matters. A pair listed here is
  // permanently excluded from future Ghost Edge suggestions.
  dismissedPairs?: string[]
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
// hex values match CSS vars: --core, --tension, --open
export const ORGANIZER_META: Record<Organizer, {
  label: string; short: string;
  color: string;    // full accent hex  (= CSS var full)
  colorDim: string; // dim bg hex       (= CSS var -dim)
  colorMid: string; // mid border hex   (= CSS var -mid)
  cssVar: string;   // CSS var reference for inline styles
  cssDim: string;
  cssMid: string;
}> = {
  core_idea: {
    label: 'Core idea', short: 'Core idea',
    color: '#4CC9A0', colorDim: '#0D2B22', colorMid: '#1A4A3A',
    cssVar: 'var(--core)', cssDim: 'var(--core-dim)', cssMid: 'var(--core-mid)',
  },
  point_of_tension: {
    label: 'Point of tension', short: 'Tension',
    color: '#E06B5A', colorDim: '#2A100D', colorMid: '#4A1F1A',
    cssVar: 'var(--tension)', cssDim: 'var(--tension-dim)', cssMid: 'var(--tension-mid)',
  },
  open_thought: {
    label: 'Open thought', short: 'Open thought',
    color: '#E8A84A', colorDim: '#2A1D08', colorMid: '#4A3010',
    cssVar: 'var(--open)', cssDim: 'var(--open-dim)', cssMid: 'var(--open-mid)',
  },
}
