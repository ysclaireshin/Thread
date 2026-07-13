// ═══════════════════════════════════════════════════════════════════════════
// PROBE BASELINE EVALUATION — FIXED CONTROL DATASET
// ═══════════════════════════════════════════════════════════════════════════
// Trial 2 of 5. This file is the CONTROL: the 10 fixed inputs Probe is scored
// against. It does NOT change between trials. Never edit a paragraph, planted
// flaw, or scoring rubric to make a later prompt version "pass" better — that
// would invalidate the comparison. Later trials (e.g. CoT + few-shot) run the
// SAME inputs and their numbers are compared against Trial 2's results.
//
// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — WHAT PROBE ACTUALLY DOES RIGHT NOW (read before writing test code)
// Verified by reading the live source on the date this file was created; file
// refs are src/-relative.
//
// 1. TEXT-SELECTION TRIGGER — lib/probe is fired from the Linear editor.
//    Eligibility gate: components/LinearView.tsx `isProbeEligible(text)` (line ~17):
//        const t = text.trim(); return t.length >= 20 && /[.!?]/.test(t)
//    So the MINIMUM CHARACTER COUNT currently enforced is 20 (trimmed) AND the
//    selection must contain at least one sentence-ending mark (. ! or ?). The
//    same gate controls both the pill "Probe" button (showProbe, ~line 1070) and
//    the Cmd+Shift+A shortcut (~line 864). All 10 eval paragraphs clear this gate.
//
// 2. API CALL SITE — lib/probe.ts `runProbe()`:
//      endpoint : POST /api/chat  (same-origin Vite middleware proxy → Anthropic
//                 /v1/messages; key server-side only, never shipped to browser)
//      model    : 'claude-haiku-4-5-20251001'   (const PROBE_MODEL, line 30)
//                 ⚠ NOTE: the model swap Sonnet→Haiku from an earlier trial IS
//                 already in place. The baseline is being measured on HAIKU 4.5,
//                 not Sonnet. Record this in the results `model` field.
//      max_tokens  : 60
//      temperature : 0
//      system   : PROBE_SYSTEM (lines 32–41), sent as a single cache_control'd
//                 text block (semantically identical to the plain string). Exact
//                 text is reproduced verbatim below as PROBE_SYSTEM_VERBATIM so
//                 the runner uses byte-identical instructions.
//      user msg : for a text selection —
//                 `Selected text: ${selectedText}\n\nWhat is the core assumption
//                  here, and what question would most challenge it?`
//
// 3. RESULT CARD — components/ProbeCard.tsx. The returned question renders
//    verbatim in "Row 2 — the AI-returned question" (`{question}`, ~line 96).
//    The "Spawn Tension Node" button is Row 3 (~line 117); "✕ dismiss" sits
//    beside it (~line 120). The card is placed by LinearView (floating, fixed at
//    the selection point) and by SidePanel (inside the node panel).
//
// 4. SPAWN LOGIC — LinearView.tsx `handleSpawnFromProbe()` (and the mirror in
//    SidePanel.tsx). addNode() is called with:
//        organizer: 'point_of_tension'   (schema value for a tension node —
//                                          NOT the literal 'tension')
//        label: probe.question           (the AI question, verbatim)
//        description: ''
//        provenance: 'ai_proposed_confirmed'   ← CONFIRMED: not 'human'
//        centrality: 0.5, parent_id: null, current_focus: false, confidence: 2,
//        last_reinforced_at: now  (session_id + createdWithFocus auto-stamped by
//                                  store.addNode)
//    From a text selection it ALSO writes a TextAnchor tether over the span.
//    Spawn is out of scope for scoring here (this eval never clicks Spawn) but is
//    documented as required.
//
// 5. DISMISS LOGIC — ProbeCard "✕ dismiss" calls onDismiss, which in both
//    LinearView (line ~1091) and SidePanel (line ~329) is `() => setProbe(null)`.
//    That clears the in-memory React state and the card disappears. NOTHING is
//    persisted: no node, no anchor, no localStorage write, no API call. A
//    dismissed Probe leaves zero trace.
//
// ─────────────────────────────────────────────────────────────────────────────
// RATE-LIMIT NOTE (relevant to running the eval): an earlier trial added a
// shared per-device daily AI cap of 50 calls (lib/aiLimit.ts, key
// 'thread_ai_usage'). 10 eval calls are well under it, but if the runner reuses
// a browser that has already spent today's budget, clear that key first.
// ═══════════════════════════════════════════════════════════════════════════

// The Probe system prompt, copied VERBATIM from lib/probe.ts (PROBE_SYSTEM) so
// the runner sends byte-identical instructions without importing/mutating the
// production module. If lib/probe.ts ever changes, this is intentionally NOT
// auto-synced — the baseline must reflect the prompt as it was at Trial 2.
export const PROBE_SYSTEM_VERBATIM = `You are examining a specific piece of writing or a single idea. Your job is to identify the single most important assumption that, if wrong, would most significantly undermine what is being claimed.

Return one question only. The question must:
- Reference the actual content of the selection directly — not a generic template like 'have you considered alternatives?'
- Target the core assumption, not a surface detail
- Be answerable in principle (not rhetorical)
- Be under 25 words
- Use plain language — no academic or philosophical jargon

Return only the question. No preamble, no explanation, no follow-up. One question, a question mark, done.`

export const PROBE_MODEL_AT_BASELINE = 'claude-haiku-4-5-20251001'
export const PROBE_MAX_TOKENS = 60
export const PROBE_TEMPERATURE = 0

// User-message builder — identical shape to lib/probe.ts buildUserMessage() for
// the linear_editor_selection context.
export function buildProbeUserMessage(selectedText: string): string {
  return `Selected text: ${selectedText}\n\nWhat is the core assumption here, and what question would most challenge it?`
}

// ─── RECALL SET — 5 paragraphs, each with one deliberately planted flaw ──────
// A HIT = the returned question directly targets the planted assumption (not a
// different real flaw, not a surface detail, not a generic template).

export interface RecallCase {
  id: number
  text: string
  plantedFlaw: string
  specificHitLooksLike: string
  genericFluffLooksLike: string
}

export const RECALL_CASES: RecallCase[] = [
  {
    id: 1,
    text:
      "Thread solves re-entry friction by keeping a visual map of the user's ideas across sessions. Because the map persists, users can return to a project and immediately understand where they left off, eliminating the hour of re-reading that currently costs them productive time.",
    plantedFlaw:
      'Assumes the map accurately represents where the user left off — but it only reflects what the user manually tagged, which may be incomplete, incorrect, or stale. A map that misrepresents session state could be worse than no map.',
    specificHitLooksLike:
      'A question targeting whether the map accurately captures session state, or whether manual tagging produces a reliable representation.',
    genericFluffLooksLike:
      '"Have you considered whether users will actually use this?" / "What evidence supports this claim?" — applies to any product paragraph.',
  },
  {
    id: 2,
    text:
      "Students who struggle with re-entry friction are the primary target for Thread. These students independently discover workarounds like 'parking on the hill' — writing session-end bullet points about what was done and what comes next. Thread automates and improves this existing behavior.",
    plantedFlaw:
      'Assumes students who already park on the hill are the right target — but they already have a working workaround. The students with the most acute friction may be the ones who do NOTHING at session end. Thread may be selling a premium version of a solution to people who already solved the problem for free.',
    specificHitLooksLike:
      'A question about whether students who already park on the hill need Thread, or whether the real target is the student who does NOT park on the hill.',
    genericFluffLooksLike:
      '"Does this apply to all students?" / "Have you validated the target market?" — topic-adjacent but misses the self-selection flaw.',
  },
  {
    id: 3,
    text:
      'The Tab-to-tag hotkey solves the interruption problem. Instead of stopping to open a modal and categorize an idea, users press Tab on selected text, the node is created instantly, and focus returns to the editor. The cognitive cost of tagging drops to near zero.',
    plantedFlaw:
      'Assumes the cognitive cost of tagging is the hotkey mechanics — but the real cost may be the DECISION of what to tag and when. Tab speeds the mechanical action but not the mid-paragraph judgment call "is this worth tagging right now?", which may be the actual interruption.',
    specificHitLooksLike:
      'A question about whether the decision to tag — not the mechanical act — is where the interruption actually lives.',
    genericFluffLooksLike:
      '"Is Tab the right hotkey?" / "Have you tested this with users?" — surface detail or generic.',
  },
  {
    id: 4,
    text:
      "Thread's map view shows ideas as a force-directed graph with manual connections only. Because every connection requires a deliberate Shift-click from the user, every edge on the map is semantically meaningful — the graph represents the user's actual thinking, not an algorithmic inference.",
    plantedFlaw:
      'Assumes manual connections are semantically meaningful BY VIRTUE of being deliberate — but users may Shift-click connections that feel meaningful in the moment and later prove accidental, redundant, or wrong. Deliberateness is not accuracy; a graph of deliberate-but-incorrect edges may mislead more than no graph.',
    specificHitLooksLike:
      'A question about whether deliberate connections are necessarily accurate, or whether intentionality guarantees semantic validity.',
    genericFluffLooksLike:
      '"Is a force-directed graph the right visualization?" / "Will users make connections?" — misses the deliberate≠accurate gap.',
  },
  {
    id: 5,
    text:
      "The greeting band shows the user's exact commitment sentence from their last session, verbatim and unmodified. Because this is the user's own words rather than an AI summary, it is more trustworthy and more psychologically binding — research on implementation intentions confirms that specific, self-authored plans reduce procrastination more effectively than externally generated ones.",
    plantedFlaw:
      'Assumes the session-end commitment sentence is specific and well-formed — but session-end is exactly when users are most fatigued and most likely to write something vague ("work on the argument section"). A vague sentence shown verbatim is no better than a generic AI summary, and the implementation-intention research only holds for SPECIFIC plans.',
    specificHitLooksLike:
      'A question about whether session-end commitment sentences are actually specific enough for the implementation-intention effect to apply.',
    genericFluffLooksLike:
      '"Does the research generalize?" / "Is verbatim always better?" — gestures at the claim but not the fatigue/specificity gap.',
  },
]

// ─── PRECISION SET — 5 paragraphs with NO real logical flaw ──────────────────
// Expected: Probe should NOT return a question that reads as a genuine critique.
// A FALSE POSITIVE is either (a) an invented specific flaw that isn't there, or
// (b) generic noise that could apply to any paragraph.

export interface PrecisionCase {
  id: number
  text: string
  whyClean: string
}

export const PRECISION_CASES: PrecisionCase[] = [
  {
    id: 6,
    text:
      'Thread is deployed on Vercel. The frontend is built with React and TypeScript using Vite as the build tool. Node data is persisted to local JSON storage. There is no backend database at this stage — all state is client-side.',
    whyClean: 'Pure technical description; no argument or claim requiring an assumption. Any "flaw" found is invented.',
  },
  {
    id: 7,
    text:
      'The confidence dot feature was removed from Thread after it was identified as unintuitive. The feature added a three-state indicator (rough / fine / confirmed) to each node. User testing and internal critique identified the overhead as disproportionate to the value returned, and it was deleted from the codebase.',
    whyClean: 'Describes a decision and its rationale accurately; the action matches the stated reason. No logical gap.',
  },
  {
    id: 8,
    text:
      'To create a manual connection in the Map view, hold Shift and click the source node, then click the target node. A dashed preview line follows the cursor between clicks. If you change your mind, press Escape to cancel without creating an edge.',
    whyClean: 'Procedural instruction; no argument or claim, so no assumption to probe.',
  },
  {
    id: 9,
    text:
      'A tension node represents an unresolved complication, objection, or contradiction in the user\'s thinking. It is distinct from a core idea (a settled claim) and an open thought (an active question still being worked out). Tension nodes render in coral in both the Linear outline and the Map view.',
    whyClean: 'Definitional content; no argument or logical structure to probe.',
  },
  {
    id: 10,
    text:
      "Obsidian's graph view shows every note and every link between notes, treating all nodes as equally weighted. Thread's map view uses node size to encode connection count, so more-connected ideas render visually larger than isolated ones.",
    whyClean: 'Accurate comparative description of two systems; a factual distinction, not an argument requiring an assumption.',
  },
]
