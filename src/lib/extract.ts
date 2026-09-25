// ─── Stage B: extraction-at-Save-My-Place ────────────────────────────────────
// Reads the section of draft the writer added this session and proposes distinct
// ideas as candidate nodes. It is the propose half of Trace's propose-then-confirm
// pattern applied to NODE creation: the model proposes, the user confirms/rejects
// in SavePlaceModal, and only confirmed ideas become permanent nodes
// (provenance 'ai_proposed_confirmed'). Nothing here writes to the store — the
// caller (SavePlaceModal) does that on confirm, reusing the exact addNode +
// addTextAnchor path that Tab-to-tag and Probe already use.
//
// Fires ONLY from Save My Place (never ambient, never on a timer). Same /api/chat
// proxy, same Groq/Llama model as Trace and Probe. Reuses trace.ts's response
// shape (data.content[].text) and JSON extraction approach.

import type { Organizer } from '../types'
import { aiFetch } from './aiFetch'

// Placeholder model id — the Groq proxy (vite.config.ts) ignores it and runs
// llama-3.3-70b-versatile, reshaping the reply into { content: [{ type:'text' }] }.
// Kept identical to Trace/Probe so all three route through the same proxy path.
const EXTRACT_MODEL = 'claude-haiku-4-5-20251001'
const EXTRACT_MAX_TOKENS = 800
const EXTRACT_TEMPERATURE = 0

// Verbatim from the Stage B spec. Static on every call (only the draft section
// varies) so it carries the prompt-cache marker, same as Trace/Probe.
const EXTRACT_SYSTEM = `You are reading a section of someone's draft to identify the distinct ideas in it. Extract only ideas that are clearly present - specific claims, unresolved tensions, or open questions the writer actually wrote. Do not invent, infer beyond the text, or add ideas that aren't there.

For each idea, classify it as one of exactly three types:
- core_idea: a claim or point the writer is asserting
- point_of_tension: an unresolved problem, objection, or complication the writer raised
- open_thought: a question or undecided area the writer left open

Rules:
- Extract at most 6 ideas. Fewer is fine. If the section contains no clear distinct ideas, return an empty array.
- Each idea's label must be under 10 words, in the writer's own framing, not yours.
- Do not extract transitions, descriptions, or scaffolding ('this section will argue...').
- Return valid JSON only, no preamble:
{
  "proposed_nodes": [
    { "label": "...", "type": "core_idea|point_of_tension|open_thought", "source_quote": "the phrase in the draft this came from" }
  ]
}`

// ─── Public shapes ───────────────────────────────────────────────────────────

export interface ProposedNode {
  label: string
  type: Organizer
  source_quote: string
}

const VALID_TYPES: ReadonlySet<string> = new Set<Organizer>([
  'core_idea',
  'point_of_tension',
  'open_thought',
])

// Some models wrap JSON in ```json fences or add stray prose. Strip fences and,
// failing that, take the outermost {...} block. (Same approach as trace.ts —
// duplicated rather than exported from trace.ts to keep the two features
// independent.)
function extractJson(text: string): string {
  let t = text.trim()
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fence) t = fence[1].trim()
  if (t.startsWith('{') || t.startsWith('[')) return t
  const first = t.indexOf('{')
  const last = t.lastIndexOf('}')
  if (first !== -1 && last > first) return t.slice(first, last + 1)
  return t
}

// Coerce the raw parsed body into well-formed proposals: keep only entries with a
// non-empty label, a valid organizer type, and a source_quote string. Cap at 6.
// Anything malformed is dropped silently — an empty result is a correct outcome.
function validateProposals(raw: unknown): ProposedNode[] {
  const list = (raw as { proposed_nodes?: unknown })?.proposed_nodes
  if (!Array.isArray(list)) return []
  const out: ProposedNode[] = []
  for (const p of list as ProposedNode[]) {
    const label = typeof p?.label === 'string' ? p.label.trim() : ''
    const type = p?.type
    const source_quote = typeof p?.source_quote === 'string' ? p.source_quote.trim() : ''
    if (!label) continue
    if (!VALID_TYPES.has(type)) continue
    out.push({ label, type: type as Organizer, source_quote })
    if (out.length >= 6) break
  }
  return out
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

// Runs one extraction over the given draft section. Returns [] for every legitimate
// zero-result outcome (empty section, no ideas, parse failure). Throws only on
// network / HTTP failure so the caller can decide whether to surface it — but note
// Save My Place must never be BLOCKED by extraction: the caller swallows the throw
// and completes the save regardless.
export async function runExtraction(sectionText: string): Promise<ProposedNode[]> {
  const section = sectionText.trim()
  // Nothing meaningful written → no call, empty result.
  if (section.length < 40) return []

  const res = await aiFetch('/api/chat', {
    // No `agent` → the clean model, same as Probe (Trace uses agent:'trace' for
    // its heavier reasoning model; extraction is a scoped read, not reasoning).
    model: EXTRACT_MODEL,
    max_tokens: EXTRACT_MAX_TOKENS,
    temperature: EXTRACT_TEMPERATURE,
    system: [{ type: 'text', text: EXTRACT_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: `Here is the section of draft to read:\n\n${section}` }],
  })
  if (!res.ok) throw new Error(`http-${res.status}`)

  const data = await res.json()
  const text = ((data?.content ?? []) as { type: string; text?: string }[])
    .filter(b => b.type === 'text')
    .map(b => b.text ?? '')
    .join('')
    .trim()

  // Parse failure is not a crash and not an error state — log the raw body for
  // debugging and fall through to an empty result (same posture as trace.ts).
  let parsed: unknown
  try {
    parsed = JSON.parse(extractJson(text))
  } catch (err) {
    console.warn('Extract: JSON.parse failed — treating as no proposals. Raw response:', text, err)
    return []
  }
  return validateProposals(parsed)
}
