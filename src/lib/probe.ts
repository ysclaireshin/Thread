// ─── Probe ─────────────────────────────────────────────────────────────────────
// A scalpel, not a scanner. Probe looks at exactly one selection — a run of text
// or a single node — and returns ONE question challenging its core assumption.
// It never runs automatically, never reads outside the selection, and fires
// exactly one API call per explicit click.
//
// ── Five-check log (existing codebase, verified before building) ──────────────
// 1. TEXT SELECTION STATE — reused. LinearView tracks selected text in
//    `selection {start,end,text}` + `toolbar {x,y}` (see LinearView.handleSelectionCreate,
//    set from EditorWithHighlights.onMouseUp). Probe adds itself to that same
//    SelectionToolbar pill; no new text-selection tracking was built.
// 2. NODE SELECTION STATE — reused. A single node click sets `selectedId` via
//    store.setSelected (MapView.handleNodeClick); SidePanel renders off selectedId.
//    Probe's node trigger lives inside that same SidePanel; no new tracking.
// 3. API PROXY — /api/chat.ts does NOT exist (this is a Vite app, not a Vercel
//    deployment, so a serverless function would never run). The app's existing
//    secure server-side Anthropic proxy is the `/api/replay` Vite middleware in
//    vite.config.ts (key read server-side via loadEnv, never VITE_-prefixed,
//    never shipped to the browser). We registered the SAME handler at `/api/chat`
//    and call it here. The API key is never exposed to the client.
// 4. TETHER/ANCHOR — reused. Tagged spans link to nodes via TextAnchor
//    (store.addTextAnchor); the mirror div in LinearView underlines them. A
//    Probe-spawned tension node from a text selection reuses that exact anchor.
// 5. PROVENANCE — confirmed. types.ts Provenance = 'human' |
//    'ai_proposed_confirmed' | 'ai_proposed_pending'. Probe spawns with
//    'ai_proposed_confirmed'. NOTE: the tension organizer value in this schema is
//    'point_of_tension' (types.ts Organizer), NOT the literal 'tension' — the
//    spawned node uses 'point_of_tension'.

const PROBE_MODEL = 'claude-haiku-4-5-20251001'

const PROBE_SYSTEM = `You are examining a specific piece of writing or a single idea. Your job is to identify the single most important assumption that, if wrong, would most significantly undermine what is being claimed.

Return one question only. The question must:
- Reference the actual content of the selection directly — not a generic template like 'have you considered alternatives?'
- Target the core assumption, not a surface detail
- Be answerable in principle (not rhetorical)
- Be under 25 words
- Use plain language — no academic or philosophical jargon

Return only the question. No preamble, no explanation, no follow-up. One question, a question mark, done.`

export type ProbePayload =
  | { context: 'linear_editor_selection'; selectedText: string }
  | {
      context: 'map_node_selection'
      nodeLabel: string
      nodeDescription: string
      nodeOrganizer: string
    }

function buildUserMessage(payload: ProbePayload): string {
  if (payload.context === 'linear_editor_selection') {
    return `Selected text: ${payload.selectedText}\n\nWhat is the core assumption here, and what question would most challenge it?`
  }
  return (
    `Node type: ${payload.nodeOrganizer}\n` +
    `Node label: ${payload.nodeLabel}\n` +
    `Node description: ${payload.nodeDescription}\n\n` +
    `What is the core assumption in this idea, and what question would most challenge it?`
  )
}

// Fires exactly one request to the same-origin proxy (key stays server-side).
// Returns the verbatim question text, or throws on any failure — the caller
// decides how to surface it inline. The payload carries ONLY the selection;
// no draft, no other nodes, no session state.
export async function runProbe(payload: ProbePayload): Promise<string> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: PROBE_MODEL,
      max_tokens: 60,
      temperature: 0,
      // Static system prompt (identical on every call) marked for prompt
      // caching — only the user message varies. Block-array form is
      // semantically identical to the plain-string form; it just carries the
      // cache_control marker. See note in the caller-facing summary: at this
      // prompt size the cache does not actually engage.
      system: [{ type: 'text', text: PROBE_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: buildUserMessage(payload) }],
    }),
  })
  if (!res.ok) throw new Error(`http-${res.status}`)
  const data = await res.json()
  const text = ((data?.content ?? []) as { type: string; text?: string }[])
    .filter(b => b.type === 'text')
    .map(b => b.text ?? '')
    .join('')
    .trim()
  if (!text) throw new Error('empty')
  return text
}
