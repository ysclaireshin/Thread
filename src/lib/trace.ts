// ─── Trace ───────────────────────────────────────────────────────────────────
// A pattern finder, not a note-taker and not an AI writer. Trace fires ONLY on an
// explicit button click (never on load / session change / node creation / tab
// switch / any background process — see Part 1 and MapView's scan handlers). It
// hands the model a client-filtered list of node pairs and surfaces the 2–3
// strongest hidden connections as Ghost Edges the user accepts or dismisses.
//
// ── Step 0: six checks against the existing codebase (verified before building) ─
//
// 1. SESSION STRUCTURE — Sessions are integers. Every node carries
//    `session_id: number` (types.ts; starts at 1, auto-stamped in store.addNode
//    from `currentSession`). The project's live counter is `currentSession`,
//    bumped by store.commitSession() on "Save my place". Order is fully
//    deterministic by the integer. The "sliding horizon" = the 3 most-recent
//    DISTINCT session_ids present among live nodes (current + 2 prior). When only
//    1 session exists, that's the whole scope. See getScopedNodes() below.
//
// 2. EXISTING EDGE SCHEMA — A confirmed edge is ThreadEdge (types.ts):
//    { id, from_id, to_id, relationship: Relationship|null, provenance }.
//    Trace's Accept builds this exact shape; nothing new is invented.
//
// 3. MANUAL CONNECTION MECHANISM — Shift-click on the canvas ends in
//    MapView.handleCreateEdgeWithRelationship(), which dedupes then calls the
//    store's `addEdge`. Every edge in the app is born through that one store
//    action. Trace's Accept (MapView.handleAcceptGhost) routes through the SAME
//    `addEdge` with the identical ThreadEdge shape — same schema, same storage,
//    same rendering path (graphLinks recompute → normal solid edge).
//
// 4. MAP VIEW RENDERING — Confirmed edges are drawn in MapView's GraphCanvas as
//    <path> elements inside the transformed <g> (the "Edges — under nodes" block),
//    one quadratic Bezier per link: control point offset = perpendicular * dist*0.18.
//    Ghost Edges render in that SAME <g>, in a block placed BEFORE (below in
//    z-order) the confirmed-edge block, reusing the identical control-point math.
//
// 5. API PROXY — There is NO serverless /api/chat.ts (this is a Vite dev/preview
//    app). The app's secure key-server-side proxy is the `anthropicReplayProxy`
//    Vite middleware, mounted at BOTH /api/replay and /api/chat (vite.config.ts).
//    Probe already calls /api/chat through it; Trace reuses that exact endpoint —
//    no new endpoint, key never reaches the browser.
//
// 6. DISMISSED PAIR PERSISTENCE — The persisted JSON project state (localStorage
//    key `thread_v3`, one entry per ThreadProject) now holds `dismissedPairs:
//    string[]` (types.ts + store migrate/blank/save/extract). Both orderings
//    ("A|B" and "B|A") are stored via store.addDismissedPair so scan direction
//    never matters. This is the storage location for dismissed pairs.

import type { ThreadNode, ThreadEdge, Organizer } from '../types'

// ── Trial 3 (structured-output) Step 0 findings — verified before writing code ──
// 1. REAL OUTPUT, NOT PLACEHOLDER. Trace has no "result card"; it renders Ghost
//    Edges from live model output. The string "will propose a question that links
//    your two most distant clusters" is the AnalyticsPanel Insight-tab AI teaser
//    (a different, unrelated feature) — NOT Trace. Trace's API call is wired and
//    fires one live POST /api/chat per scan (confirmed by network capture).
// 2. RESPONSE SHAPE. Trace reads `data.content[0].text` (Anthropic block shape).
//    IMPORTANT: /api/chat is mounted to the Groq proxy (vite.config.ts), which
//    calls `llama-3.3-70b-versatile` and RESHAPES the reply into
//    `{ content: [{ type:'text', text }] }`. So the `model` in the request body
//    (claude-haiku…) is IGNORED; the real model is Llama 3.3 70B via Groq. The
//    eval results file records that actual model, not Haiku.
// 3. PRIOR ID VALIDATION. Yes — Trial 2 already added ID validation in
//    validateConnections (dropped ids not in the SCOPED node set + dismissed +
//    already-edged). Trial 3 makes it an explicit, standalone, always-on function
//    (validateTraceResponse) that checks against the LIVE node list (not the
//    scoped/sent list) and console.warns every drop. See below.
const TRACE_MODEL = 'claude-haiku-4-5-20251001'
// 400 (up from 300) to absorb the JSON-schema structure overhead without
// truncating rationale sentences (Trial 3 Part 1).
const TRACE_MAX_TOKENS = 400
const TRACE_TEMPERATURE = 0

// Static on every call — only the node/pair payload varies — so it carries the
// prompt-cache marker (Part 8). Same pattern as Probe.
const TRACE_SYSTEM = `You are analyzing pairs of ideas from a writer's notes to find non-obvious structural connections — relationships that the writer hasn't explicitly drawn yet but that would genuinely help them see how their thinking fits together.

You will receive a list of node pairs to evaluate. Each node has a label, a description, and an organizer type (tension, core_idea, or open_thought).

For each pair, decide whether there is a real, specific connection between the two ideas — not a surface similarity, not a shared topic word, not a thematic resemblance, but a structural relationship where one idea directly speaks to, challenges, resolves, or depends on the other in a way that would change how the writer thinks about their argument.

Rules:
1. Return only the 2-3 strongest connections across all pairs. If fewer than 2 pairs have real connections, return only those. If none do, return an empty array.
2. Do not stretch to fill a quota. An empty result is correct if nothing meets the bar.
3. For every connection you return, write one rationale sentence (under 20 words) that states specifically why these two ideas connect — not what they both are about, but what one does to the other.
4. The rationale must be specific enough that a reader could verify it is true or false by reading the two nodes. 'Both relate to user behavior' is not a valid rationale. 'This tension directly undermines the core claim by showing the mechanism fails at low detection probability' is valid.
5. Use only the exact node IDs provided. Never invent, infer, or approximate an ID.

Return valid JSON only. No preamble, no explanation, no markdown. Exactly this schema:
{
  "connections": [
    {
      "source_id": "exact node id string",
      "target_id": "exact node id string",
      "rationale": "one sentence under 20 words"
    }
  ]
}

YOU MUST RESPOND WITH VALID JSON ONLY.
No preamble. No explanation. No markdown code fences. Raw JSON exactly matching this schema:

{
  "connections": [
    {
      "source_id": "exact node id string",
      "target_id": "exact node id string",
      "rationale": "one sentence under 20 words stating what one node does to the other"
    }
  ]
}

If no connections meet the bar, return:
{"connections": []}

Use only the exact node IDs provided in the pairs_to_evaluate list. Do not infer, approximate, or generate any ID not explicitly given to you.`

// ─── Public shapes ────────────────────────────────────────────────────────────

export interface TracePair { node_a_id: string; node_b_id: string }

export interface TraceConnection {
  source_id: string
  target_id: string
  rationale: string
}

// Result of a scan. 'empty' covers every non-error zero-render outcome (0 nodes
// in scope, 0 eligible pairs, 0 model results, 0 survivors after validation).
// Network / HTTP failure throws — the caller renders the error state.
export type TraceScanResult =
  | { kind: 'empty' }
  | { kind: 'results'; connections: TraceConnection[] }

// ─── Scope + eligibility (Part 2) ─────────────────────────────────────────────

function isLive(n: ThreadNode): boolean {
  return !n.resolved && !n.superseded_by
}

// Standard scan → the sliding horizon: live nodes from the 3 most-recent distinct
// sessions (current + 2 prior). Deep scan → every live node in the project.
export function getScopedNodes(nodes: ThreadNode[], deep: boolean): ThreadNode[] {
  const live = nodes.filter(isLive)
  if (deep) return live
  const sessions = [...new Set(live.map(n => n.session_id))].sort((a, b) => b - a)
  const horizon = new Set(sessions.slice(0, 3))
  return live.filter(n => horizon.has(n.session_id))
}

// The unordered organizer combination decides eligibility. This is the accuracy
// mechanism: it stops surface-similarity false positives by only ever comparing
// pairs whose combination is analytically meaningful (Part 2).
//   ELIGIBLE:  tension↔core_idea, tension↔tension, open_thought↔core_idea,
//              open_thought↔tension
//   INELIGIBLE: core_idea↔core_idea (user's job via Shift-click), open_thought↔
//              open_thought, and any self-pair.
// NOTE: the schema's tension value is 'point_of_tension', not the literal
// 'tension' used in the prose spec (types.ts Organizer).
function eligibleOrganizerPair(a: Organizer, b: Organizer): boolean {
  const key = [a, b].sort().join('+')
  const ELIGIBLE = new Set([
    ['point_of_tension', 'core_idea'].sort().join('+'),
    ['point_of_tension', 'point_of_tension'].sort().join('+'),
    ['open_thought', 'core_idea'].sort().join('+'),
    ['open_thought', 'point_of_tension'].sort().join('+'),
  ])
  return ELIGIBLE.has(key)
}

function pairIsDismissed(aId: string, bId: string, dismissedPairs: string[]): boolean {
  return dismissedPairs.includes(`${aId}|${bId}`) || dismissedPairs.includes(`${bId}|${aId}`)
}

function pairHasEdge(aId: string, bId: string, edges: ThreadEdge[]): boolean {
  return edges.some(e =>
    (e.from_id === aId && e.to_id === bId) ||
    (e.from_id === bId && e.to_id === aId)
  )
}

// Build the eligible pair list CLIENT-SIDE before any API call. The model never
// selects pairs — it only evaluates the ones handed to it.
export function buildEligiblePairs(
  scopedNodes: ThreadNode[],
  edges: ThreadEdge[],
  dismissedPairs: string[],
): TracePair[] {
  const pairs: TracePair[] = []
  for (let i = 0; i < scopedNodes.length; i++) {
    for (let j = i + 1; j < scopedNodes.length; j++) {
      const a = scopedNodes[i]
      const b = scopedNodes[j]
      if (!eligibleOrganizerPair(a.organizer, b.organizer)) continue   // ineligible combo
      if (pairIsDismissed(a.id, b.id, dismissedPairs)) continue        // user already said no
      if (pairHasEdge(a.id, b.id, edges)) continue                     // already connected
      pairs.push({ node_a_id: a.id, node_b_id: b.id })
    }
  }
  return pairs
}

// ─── API payload ──────────────────────────────────────────────────────────────

function nodePayload(n: ThreadNode) {
  return { id: n.id, organizer: n.organizer, label: n.label, description: n.description ?? '' }
}

function buildUserMessage(scopedNodes: ThreadNode[], pairs: TracePair[]): string {
  return (
    `Here are the nodes and pairs to evaluate:\n\n` +
    `NODES:\n${JSON.stringify(scopedNodes.map(nodePayload), null, 2)}\n\n` +
    `PAIRS TO EVALUATE:\n${JSON.stringify(pairs, null, 2)}\n\n` +
    `Find the real connections. Return only what genuinely holds.`
  )
}

// ─── Backend ID validation (Trial 3 Part 2) ───────────────────────────────────
// The hard, unconditional guarantee that a hallucinated node id can never render
// a Ghost Edge. Runs after JSON parsing, before ANY render, on EVERY scan, with
// zero exceptions. Every returned id is checked against `currentNodeIds` — which
// the caller MUST build from the LIVE node list at scan time, not from the nodes
// sent to the model (the two differ if a node was deleted mid-flight). Any id not
// in that set is dropped and console.warn'd. The warns are a PERMANENT audit
// trail (not debug-only) proving the layer ran. Exact signature per Trial 3 spec.
export function validateTraceResponse(
  connections: Array<{ source_id: string; target_id: string; rationale: string }>,
  currentNodeIds: Set<string>,
): Array<{ source_id: string; target_id: string; rationale: string }> {
  return connections.filter(conn => {
    const sourceValid = currentNodeIds.has(conn.source_id)
    const targetValid = currentNodeIds.has(conn.target_id)

    if (!sourceValid) {
      console.warn('Trace: dropped hallucinated source_id:', conn.source_id)
    }
    if (!targetValid) {
      console.warn('Trace: dropped hallucinated target_id:', conn.target_id)
    }

    return sourceValid && targetValid
  })
}

// ─── Shaping + product-rule filtering ─────────────────────────────────────────
// Coerces the raw parsed body into well-formed connections, runs the mandatory
// backend ID validation (validateTraceResponse) against the LIVE node ids, then
// applies Trace's product rules: drop self-pairs, dismissed pairs, already-edged
// pairs, and duplicate pairs. ID validation is first and unconditional.
function validateConnections(
  raw: unknown,
  currentNodeIds: Set<string>,
  edges: ThreadEdge[],
  dismissedPairs: string[],
): TraceConnection[] {
  const list = (raw as { connections?: unknown })?.connections
  if (!Array.isArray(list)) return []

  // Shape-coerce: keep only entries with two ids and a non-empty rationale.
  const shaped: TraceConnection[] = []
  for (const c of list as TraceConnection[]) {
    const source = c?.source_id
    const target = c?.target_id
    const rationale = typeof c?.rationale === 'string' ? c.rationale.trim() : ''
    if (!source || !target || !rationale) continue
    shaped.push({ source_id: source, target_id: target, rationale })
  }

  // Mandatory backend ID validation — drops any hallucinated id (live-list check).
  const idValid = validateTraceResponse(shaped, currentNodeIds)

  // Product rules on the survivors.
  const out: TraceConnection[] = []
  const seen = new Set<string>()
  for (const c of idValid) {
    if (c.source_id === c.target_id) continue
    if (pairIsDismissed(c.source_id, c.target_id, dismissedPairs)) continue   // user already said no
    if (pairHasEdge(c.source_id, c.target_id, edges)) continue                // already connected
    const key = [c.source_id, c.target_id].sort().join('|')
    if (seen.has(key)) continue                                               // de-dupe repeated pair
    seen.add(key)
    out.push(c)
  }
  return out
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

interface RunTraceArgs {
  nodes: ThreadNode[]
  edges: ThreadEdge[]
  dismissedPairs: string[]
  deep: boolean
}

// Runs one scan. Returns 'empty' for every legitimate zero-result outcome (no
// API call is made when there are no eligible pairs). Throws only on network /
// HTTP failure so the caller can show the distinct error state.
export async function runTraceScan(args: RunTraceArgs): Promise<TraceScanResult> {
  const { nodes, edges, dismissedPairs, deep } = args

  const scopedNodes = getScopedNodes(nodes, deep)
  const pairs = buildEligiblePairs(scopedNodes, edges, dismissedPairs)
  console.log(`Trace: ${pairs.length} eligible pairs found before API call`)

  // No eligible pairs (or nothing in scope) → empty state immediately, no call.
  if (pairs.length === 0) return { kind: 'empty' }

  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: TRACE_MODEL,
      max_tokens: TRACE_MAX_TOKENS,
      temperature: TRACE_TEMPERATURE,
      system: [{ type: 'text', text: TRACE_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: buildUserMessage(scopedNodes, pairs) }],
    }),
  })
  if (!res.ok) throw new Error(`http-${res.status}`)

  const data = await res.json()
  const text = ((data?.content ?? []) as { type: string; text?: string }[])
    .filter(b => b.type === 'text')
    .map(b => b.text ?? '')
    .join('')
    .trim()

  // Parse the model's JSON body. Per Trial 3 Part 1, a parse failure is NOT a
  // crash and NOT an error state — log the RAW response for debugging and fall
  // through to the empty result state.
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    console.warn('Trace: JSON.parse failed — treating as empty result. Raw response:', text, err)
    return { kind: 'empty' }
  }

  // currentNodeIds is built from the LIVE node list at scan time (not the scoped
  // nodes sent to the model) — Trial 3 Part 2 requires the live list so a node
  // deleted mid-flight can't slip a stale id through validation.
  const currentNodeIds = new Set(nodes.filter(isLive).map(n => n.id))
  const connections = validateConnections(parsed, currentNodeIds, edges, dismissedPairs)
  if (connections.length === 0) return { kind: 'empty' }
  return { kind: 'results', connections }
}
