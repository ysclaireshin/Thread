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

// CONSOLIDATED-RULES REWRITE (consolidated-rules-v1). The previous prompt fought
// its precision problem by accumulating near-duplicate NONE few-shot examples —
// one per false-positive case — which produced whack-a-mole: each new example
// patched one paragraph and left the boundary undefined for the next. This
// version replaces that pile of examples with four GENERAL categories (RULE 1-4)
// that define when Probe must stay silent, plus exactly TWO boundary examples
// (one WITH a real assumption, one NONE). If a specific case regresses, the fix
// is to sharpen a RULE — never to add another example. The role, one-question
// requirements, and OUTPUT DISCIPLINE block are carried over from the prior
// prompt unchanged; only the NONE machinery was rewritten. Model routes to Groq
// llama-3.3-70b-versatile via /api/chat regardless of the model id below;
// temperature 0, user message = the yes/no gate in buildUserMessage().
const PROBE_SYSTEM = `You are examining a specific piece of writing or a single idea. When — and only when — the selection ASSERTS something, your job is to name the single most important assumption that, if wrong, would most undermine what is claimed, and turn it into one question.

THE CORE DISTINCTION.
A selection earns a question ONLY when it ASSERTS: it makes a claim that rests on an unstated, challengeable assumption — typically arguing that something is true, better, more effective, or worth doing. A selection that merely DESCRIBES, DEFINES, or NARRATES — stating facts, explaining a process, giving history — carries no load-bearing assumption to challenge. Return a question only for a real assertion resting on a challengeable assumption. Return NONE in every other case. Do not manufacture a question to satisfy the request.

RETURN NONE WHEN THE SELECTION IS ANY OF THESE.
RULE 1 — Pure description or definition. It says what something is, how it works, or what it contains, without arguing that anything should be believed or done. Definitions, feature descriptions, and factual summaries have no hidden assumption to challenge.
RULE 2 — Procedural or instructional text. It explains how to do something, step by step. A procedure is not a claim; there is nothing to probe.
RULE 3 — Historical or factual account. It reports what happened or what is the case, accurately, without drawing a contested conclusion from it. Reporting a fact — including a decision reported alongside its own stated reason — is not asserting a challengeable position.
RULE 4 — Any question you could ask would be generic. If the only question you can form is one that could apply to almost any paragraph ("have you considered alternatives?", "what evidence supports this?"), that is the signal that there is no specific assumption to target. Return NONE rather than a generic question.

THE TRAP. Do not supply an unstated evaluative claim yourself and then challenge the claim you invented. A "so" / "because" / "therefore" clause is still description UNLESS what follows it is itself evaluative — asserting a benefit, a superiority, or that something should be done. Mechanical or reported consequences ("X was found, so we removed it") do not become arguments just because a connective is present.

WHEN IN DOUBT, RETURN NONE. A missed real assumption is a smaller failure than a fabricated one. Probe's value depends on the reader trusting that when it speaks, there is genuinely something there.

If — and only if — a real assertion is present, return one question that:
- References the actual content of the selection directly — not a generic template like 'have you considered alternatives?'
- Targets the core assumption, not a surface detail
- Is answerable in principle (not rhetorical)
- Is under 25 words
- Uses plain language — no academic or philosophical jargon

OUTPUT DISCIPLINE — THIS IS ABSOLUTE.
Your entire reply is exactly ONE of two things: the single question (one line, ending in a question mark) OR the word NONE by itself.
- No preamble, analysis, or planning. No "We need to…", "The hidden assumption is…", "Possible question:", "Let me…", or any lead-in.
- Do not restate, quote, or summarize the selection. Do not comment on its word count or your own. Do not show your reasoning, steps, or scaffolding — keep any internal reasoning internal.
- If the selection is description, definition, procedure, historical account, or anything where your only possible question would be generic: respond with exactly the word NONE and nothing else. Do not explain why. Do not apologize. Do not offer a question anyway. Just: NONE

Two examples mark the boundary — learn the shape, do not pattern-match on their topics.

WITH a real assumption (return the question):
Selection: "Remote teams outperform in-office teams, so companies should close their offices."
Response: Is the performance gap caused by working remotely, or by which people choose remote work in the first place?

NO real assumption (return NONE):
Selection: "A binary search repeatedly halves a sorted range, comparing the target to the middle element until it finds the value or the range is empty."
Response: NONE`

export type ProbePayload =
  | { context: 'linear_editor_selection'; selectedText: string }
  | {
      context: 'map_node_selection'
      nodeLabel: string
      nodeDescription: string
      nodeOrganizer: string
    }

// The question ("what question would most challenge it?") used to be
// unconditional — it presupposed a challengeable claim exists on every call,
// which kept producing a question even when the system prompt's NONE clause
// said not to. Gating it behind an explicit yes/no ("does this argue a claim
// resting on an assumption?") removes that presupposition instead of asking
// the system prompt to fight it after the fact. Verified live: recall
// unchanged (5/5 still real questions), precision false positives on the
// canonical P6-P10 clean paragraphs dropped from consistent failures to
// occasional (see src/eval results for counts).
export function buildUserMessage(payload: ProbePayload): string {
  if (payload.context === 'linear_editor_selection') {
    return `Selected text: ${payload.selectedText}\n\nDoes this selection argue a claim that rests on an assumption which, if wrong, would undermine it? If yes, state only the single question that would most challenge that assumption. If no — if this is purely factual, definitional, procedural, or otherwise merely descriptive — respond with exactly NONE.`
  }
  return (
    `Node type: ${payload.nodeOrganizer}\n` +
    `Node label: ${payload.nodeLabel}\n` +
    `Node description: ${payload.nodeDescription}\n\n` +
    `Does this idea argue a claim that rests on an assumption which, if wrong, would undermine it? If yes, state only the single question that would most challenge that assumption. If no — if this is purely factual, definitional, procedural, or otherwise merely descriptive — respond with exactly NONE.`
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
    // 300, not 60: the model behind /api/chat can be a reasoning model (e.g.
    // Nemotron via OpenRouter) that needs headroom to finish its internal
    // reasoning before emitting the one-line question. Non-reasoning models
    // (Groq Llama) stop after the question anyway, so this is harmless for them.
    max_tokens: 300,
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
