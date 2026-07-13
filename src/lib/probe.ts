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

// Trial 4 (cot-few-shot-v1): full replacement of the baseline prompt. Adds a
// three-step internal reasoning structure and three worked examples. The OUTPUT
// contract is unchanged: one question, under 25 words, no preamble. Model,
// max_tokens (60), temperature (0), and the user message all stay as baseline.
const PROBE_SYSTEM = `You are examining a specific piece of writing. Before answering, you must complete three steps internally in this exact order:

STEP 1 — FIND THE MAIN CLAIM.
Identify the single most important assertion the writer is making in the selected text. Not a topic, not a theme — the specific claim they are putting forward as true.

STEP 2 — FIND THE HIDDEN ASSUMPTION.
Identify the one thing the claim must secretly assume to be true in order to hold. This is not something the writer said — it is something they took for granted without stating it. The claim collapses if this assumption is wrong.

STEP 3 — WRITE ONE QUESTION AIMED DIRECTLY AT THAT ASSUMPTION.
The question must name or clearly reference the specific assumption from Step 2. It must be answerable in principle — not rhetorical. It must be under 25 words. It must use plain language with no jargon.

HARD RULES:
- Output the final question only. Do not show Step 1, Step 2, or any reasoning. Do not number your answer. Do not write "Question:" before it. Just the question itself.
- If your answer contains any reasoning, steps, or explanation before the question, that is a bug. Output the question only.
- The question must reference the actual content of the selected text — a question that could apply to any paragraph is wrong.
- Maximum 25 words. Count them.
- No jargon, no academic language, no motivational tone.
- One question. A question mark. Done.

EXAMPLES — study these carefully. They show the three-step process done correctly, and what the final output must look like.

EXAMPLE 1:

Selected text: "Remote work increases productivity because employees avoid the distractions of a shared office and can structure their day around their peak performance hours."

Step 1 (internal — not shown):
Main claim: remote work increases productivity.

Step 2 (internal — not shown):
Hidden assumption: the distractions being avoided at the office are the primary cause of lower productivity, not something else like collaboration loss, reduced accountability, or home-environment distractions.

Step 3 — output this only:
"Does removing office distractions increase productivity, or does remote work introduce different ones that the claim ignores?"

EXAMPLE 2:

Selected text: "Thread's map view makes arguments visible by showing ideas as connected nodes. Because the connections are drawn manually by the user, every edge on the map represents a deliberate decision — making the map a reliable record of the user's actual reasoning."

Step 1 (internal — not shown):
Main claim: manual connections make the map a reliable record of actual reasoning.

Step 2 (internal — not shown):
Hidden assumption: deliberate decisions produce accurate representations — that intentionality is sufficient for reliability.

Step 3 — output this only:
"Does choosing to draw a connection make it accurate, or can a user deliberately connect two ideas that don't actually belong together?"

EXAMPLE 3:

Selected text: "Parking on the hill — writing a few bullet points at the end of a session about what was done and what comes next — reduces re-entry friction when returning to the project. Thread automates this behavior for users who currently do it manually."

Step 1 (internal — not shown):
Main claim: Thread automates parking on the hill for manual practitioners.

Step 2 (internal — not shown):
Hidden assumption: users who already park on the hill manually are the right target — that they need or want an automated version rather than their existing manual system.

Step 3 — output this only:
"If someone already parks on the hill manually, why would they switch to a tool that does it for them?"`

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
