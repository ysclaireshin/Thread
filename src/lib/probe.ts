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

import { aiFetch } from './aiFetch'

const PROBE_MODEL = 'claude-haiku-4-5-20251001'

// Reverted to the frozen baseline prompt (Trial 4 CoT showed no measured
// benefit — flat recall, flat false positives, flat specificity — for ~10x the
// length), then extended with ONE addition: the "NONE" escape valve (final
// paragraph) so Probe can decline on sound/trivial text instead of manufacturing
// a false-positive question. Everything before that paragraph is byte-identical
// to PROBE_SYSTEM_VERBATIM in src/eval/probe-baseline.ts. Model, max_tokens (60),
// temperature (0), and the user message are unchanged.
const PROBE_SYSTEM = `You are examining a specific piece of writing or a single idea. Your job is to identify the single most important assumption that, if wrong, would most significantly undermine what is being claimed.

Return one question only. The question must:
- Reference the actual content of the selection directly — not a generic template like 'have you considered alternatives?'
- Target the core assumption, not a surface detail
- Be answerable in principle (not rhetorical)
- Be under 25 words
- Use plain language — no academic or philosophical jargon

Return only the question. No preamble, no explanation, no follow-up. One question, a question mark, done.

THE NONE RESPONSE — READ CAREFULLY.
You will always be asked for a challenging question. Ignore that framing when it does not apply. If the selection makes no significant claim worth challenging — if it is purely factual, a definition, a procedure, a description of a decision that matches its own stated reason, or otherwise sound or trivial, with no hidden assumption whose failure would undermine an argument — you MUST respond with exactly the word NONE and nothing else. Returning NONE is a correct, expected answer for sound or trivial text, not a failure. Do not invent a question to satisfy the request.

Text like these MUST return NONE (do not question them):
- "Water boils at 100 degrees Celsius at sea level." (a factual statement)
- "A verb is a word that expresses an action or a state." (a definition)
- "To save the file, press Command-S." (a procedure)

Only return a question when the selection actually argues a claim that rests on a specific hidden assumption which, if wrong, would undermine it. Otherwise, return NONE.`

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
  // aiFetch attaches the Supabase session token; the production endpoint
  // requires it and meters the call against a server-side daily budget.
  const res = await aiFetch('/api/chat', {
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

// The model returns exactly "NONE" when the selection has no significant
// assumption worth challenging (see the final paragraph of PROBE_SYSTEM). Callers
// use this to suppress the result card and show a neutral state instead of a
// manufactured false-positive question. Tolerant of trailing punctuation/quotes.
export function isNoneResponse(s: string): boolean {
  return /^["'\s]*none[."'\s]*$/i.test(s)
}
