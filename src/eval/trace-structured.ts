// ─── Trace Trial 3 — structured-output eval dataset ────────────────────────────
// Mirrors probe-baseline.ts: this file FREEZES the exact prompt, params, and
// cases used for the run so the results are reproducible. The runner
// (run-trace-structured.ts) fires each case at the SAME /api/chat proxy the UI
// uses, with a byte-identical request to lib/trace.ts.
//
// PROVENANCE NOTE — read this. Trial 3's spec says "use the same 10 cases from
// the Trace baseline exactly as written." There was NO prior Trace baseline in
// this repo (src/eval held only the Probe baseline harness, and no Trace
// *-results.json ever existed). So the 10 recall/precision cases below were
// AUTHORED for Trial 3, in the Thread product domain, following the baseline's
// intent: R1–R5 are pairs with a genuine hidden structural link (recall — the
// model SHOULD connect them); P1–P5 are surface-similar pairs with no real
// structural link (precision — the model should NOT connect them). Because there
// is no baseline dataset, comparison_to_baseline records absolute values, not a
// true delta (see results file).
//
// MODEL REALITY — /api/chat is the Groq proxy (vite.config.ts) calling
// `llama-3.3-70b-versatile` and reshaping the reply to Anthropic's
// `content[0].text`. The request body's `model` is ignored. The results file
// records the actual model, not the Haiku id in the request.

// Byte-identical to lib/trace.ts TRACE_SYSTEM at the time of this run
// (prompt_version: structured-output-v1). Kept frozen here on purpose — later
// edits to lib/trace.ts must NOT retroactively change what this recorded run
// represents. If you change the production prompt, bump prompt_version and
// re-run rather than editing this string in place.
export const TRACE_SYSTEM_VERBATIM = `You are analyzing pairs of ideas from a writer's notes to find non-obvious structural connections — relationships that the writer hasn't explicitly drawn yet but that would genuinely help them see how their thinking fits together.

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

// Byte-identical to lib/trace.ts values for this run.
export const TRACE_MODEL_IN_REQUEST = 'claude-haiku-4-5-20251001' // ignored by the Groq proxy
export const TRACE_MAX_TOKENS = 400
export const TRACE_TEMPERATURE = 0

export interface EvalNode {
  id: string
  organizer: 'core_idea' | 'point_of_tension' | 'open_thought'
  label: string
  description: string
}

export interface EvalPair { node_a_id: string; node_b_id: string }

export interface EvalCase {
  id: string
  // 'connection' = a real hidden link exists (recall; model SHOULD connect).
  // 'no_connection' = surface-similar only (precision; model should NOT connect).
  expectation: 'connection' | 'no_connection'
  nodes: EvalNode[]            // isolated seed for this case (no other nodes present)
  pairs: EvalPair[]            // the single pair to evaluate
  note: string                // the intended link (recall) or the surface trap (precision)
  // Optional extra text appended to the user message (H2 confusion injection only).
  injection?: string
}

// nodePayload + buildUserMessage replicate lib/trace.ts EXACTLY so the eval is
// faithful to production. (injection is appended only when present — H2.)
function nodePayload(n: EvalNode) {
  return { id: n.id, organizer: n.organizer, label: n.label, description: n.description }
}

export function buildTraceUserMessage(nodes: EvalNode[], pairs: EvalPair[], injection?: string): string {
  const base =
    `Here are the nodes and pairs to evaluate:\n\n` +
    `NODES:\n${JSON.stringify(nodes.map(nodePayload), null, 2)}\n\n` +
    `PAIRS TO EVALUATE:\n${JSON.stringify(pairs, null, 2)}\n\n` +
    `Find the real connections. Return only what genuinely holds.`
  return injection ? `${base}\n\n${injection}` : base
}

// ─── RECALL cases (R1–R5) — a genuine hidden structural link exists ────────────
export const RECALL_CASES: EvalCase[] = [
  {
    id: 'R1',
    expectation: 'connection',
    note: 'tension↔core: the tension undermines the core speed claim (reflexive accepts sacrifice judgment).',
    nodes: [
      { id: 'r1-core', organizer: 'core_idea', label: 'Ghost Edges let users connect ideas faster',
        description: 'Because Trace surfaces links the user never drew, they can wire up their thinking far faster than reviewing every pair by hand.' },
      { id: 'r1-tension', organizer: 'point_of_tension', label: 'One-click accept invites reflexive approval',
        description: 'Accepting a suggested link takes a single click, so users may approve connections without actually judging whether the link holds.' },
    ],
    pairs: [{ node_a_id: 'r1-core', node_b_id: 'r1-tension' }],
  },
  {
    id: 'R2',
    expectation: 'connection',
    note: 'open↔core: the core idea directly answers the open question about distinguishing edges.',
    nodes: [
      { id: 'r2-open', organizer: 'open_thought', label: 'How do we tell suggestions apart from confirmed links?',
        description: 'If proposed and accepted connections look alike, the user cannot tell what they decided from what the tool is guessing.' },
      { id: 'r2-core', organizer: 'core_idea', label: 'Ghost Edges are dashed and desaturated, confirmed edges solid',
        description: 'Pending suggestions render as faint dashed pulsing curves; accepted links render solid and colored, so the two are never visually confused.' },
    ],
    pairs: [{ node_a_id: 'r2-open', node_b_id: 'r2-core' }],
  },
  {
    id: 'R3',
    expectation: 'connection',
    note: 'tension↔tension: both stem from the same root — the default scan scope is deliberately narrow.',
    nodes: [
      { id: 'r3-tension-a', organizer: 'point_of_tension', label: 'The sliding horizon hides older sessions',
        description: 'A standard scan only looks at the three most recent sessions, so links to ideas from older sessions are never proposed.' },
      { id: 'r3-tension-b', organizer: 'point_of_tension', label: 'Deep Scan is gated behind a standard scan',
        description: 'Whole-project scanning only appears after a standard scan runs, so by default the broadest connections stay out of reach.' },
    ],
    pairs: [{ node_a_id: 'r3-tension-a', node_b_id: 'r3-tension-b' }],
  },
  {
    id: 'R4',
    expectation: 'connection',
    note: 'open↔tension: the open definitional question must be resolved before the fluent-but-wrong tension can be addressed.',
    nodes: [
      { id: 'r4-open', organizer: 'open_thought', label: 'What counts as a real connection versus surface similarity?',
        description: 'Trace claims to find structural links, but the boundary between a genuine link and a shared topic word is never precisely defined.' },
      { id: 'r4-tension', organizer: 'point_of_tension', label: 'A fluent rationale can make a false link look valid',
        description: 'The model writes a confident one-sentence rationale even for a weak link, and the user has no cheap way to check it.' },
    ],
    pairs: [{ node_a_id: 'r4-open', node_b_id: 'r4-tension' }],
  },
  {
    id: 'R5',
    expectation: 'connection',
    note: 'tension↔core: the tension complicates the core claim — the same filter that blocks false positives also blocks some real links.',
    nodes: [
      { id: 'r5-core', organizer: 'core_idea', label: 'Organizer-type filtering prevents false positives',
        description: 'Only analytically meaningful organizer combinations are compared, so surface-similar pairs are never even sent to the model.' },
      { id: 'r5-tension', organizer: 'point_of_tension', label: 'The filter forbids core-to-core links that may be real',
        description: 'Two settled claims can have a genuine hidden connection, but core_idea to core_idea pairs are excluded, so Trace can never surface it.' },
    ],
    pairs: [{ node_a_id: 'r5-core', node_b_id: 'r5-tension' }],
  },
]

// ─── PRECISION cases (P1–P5) — surface-similar, NO real structural link ────────
export const PRECISION_CASES: EvalCase[] = [
  {
    id: 'P1',
    expectation: 'no_connection',
    note: 'shared word "session" in two different senses (data session_id vs human work-session duration); no structural link.',
    nodes: [
      { id: 'p1-core', organizer: 'core_idea', label: 'Sessions are numbered incrementally',
        description: 'Each Save My Place bumps an integer session counter by one; every node is stamped with the session it was created in.' },
      { id: 'p1-tension', organizer: 'point_of_tension', label: 'Long writing sessions cause fatigue',
        description: 'Sitting for hours in a single sitting degrades the quality of edits toward the end of the stretch.' },
    ],
    pairs: [{ node_a_id: 'p1-core', node_b_id: 'p1-tension' }],
  },
  {
    id: 'P2',
    expectation: 'no_connection',
    note: 'shared topic "color" but the open question (tension accent hue) and core (dark background) do not speak to each other.',
    nodes: [
      { id: 'p2-open', organizer: 'open_thought', label: 'Which accent color best signals a point of tension?',
        description: 'Tension nodes need a hue that reads as friction without alarming the user; the exact shade is undecided.' },
      { id: 'p2-core', organizer: 'core_idea', label: 'The canvas background is near-black',
        description: 'A very dark canvas (#08090A) makes bright node colors pop and keeps the map calm.' },
    ],
    pairs: [{ node_a_id: 'p2-open', node_b_id: 'p2-core' }],
  },
  {
    id: 'P3',
    expectation: 'no_connection',
    note: 'both are user-facing frictions ("the user…") but structurally independent — no shared root cause.',
    nodes: [
      { id: 'p3-tension-a', organizer: 'point_of_tension', label: 'Users forget which nodes they made last session',
        description: 'On returning to a project, people lose track of what they were last working on and where they left the thread.' },
      { id: 'p3-tension-b', organizer: 'point_of_tension', label: 'Small screens cannot show the whole map',
        description: 'On a laptop the graph overflows the viewport, so users must pan and zoom to see everything at once.' },
    ],
    pairs: [{ node_a_id: 'p3-tension-a', node_b_id: 'p3-tension-b' }],
  },
  {
    id: 'P4',
    expectation: 'no_connection',
    note: 'homonym trap: "edge" as graph-edge vs "edge case" in the parser. Pure word overlap.',
    nodes: [
      { id: 'p4-open', organizer: 'open_thought', label: 'Should edges support more than two relationship types?',
        description: 'Today an edge can be supports or challenges; whether depends-on and supersedes should be user-selectable is open.' },
      { id: 'p4-tension', organizer: 'point_of_tension', label: 'Edge cases in the parser crash on empty input',
        description: 'Malformed or empty draft text can throw an exception during the tagging pass.' },
    ],
    pairs: [{ node_a_id: 'p4-open', node_b_id: 'p4-tension' }],
  },
  {
    id: 'P5',
    expectation: 'no_connection',
    note: 'both mention "AI" but Probe behavior and rate-limit reset timing have no structural relationship.',
    nodes: [
      { id: 'p5-core', organizer: 'core_idea', label: 'Probe asks one question about a selection',
        description: 'Probe interrogates a single selected node or text span and returns exactly one challenge question about its core assumption.' },
      { id: 'p5-open', organizer: 'open_thought', label: 'How often should the daily AI cap reset?',
        description: 'There is a per-day limit on AI calls; whether it resets at midnight local time or on a rolling 24-hour window is undecided.' },
    ],
    pairs: [{ node_a_id: 'p5-core', node_b_id: 'p5-open' }],
  },
]

// ─── H2 — deliberate hallucination-confusion case ──────────────────────────────
// Seeds only REAL-A and REAL-B. The injection references a confusingly-similar
// node ('Thread tracks ideas…' vs REAL-A's 'Thread maps ideas…') under a fake id
// that is NOT in the seed, to bait the model into naming it. currentNodeIds for
// validation is {trace-real-a-001, trace-real-b-002} only.
export const H2_FAKE_ID = 'FAKE-SIMILAR-NODE-ID-001'

export const H2_CASE: EvalCase = {
  id: 'H2',
  expectation: 'connection', // REAL-A/REAL-B genuinely connect (a real tension qualifies a real core)
  note: 'confusion bait: injection cites a similar-sounding node under a fake id; validation must drop it if returned.',
  nodes: [
    { id: 'trace-real-a-001', organizer: 'core_idea', label: 'Thread maps ideas as you write',
      description: 'As the user writes and tags phrases, Thread builds a visual node graph reflecting the current state of their thinking.' },
    { id: 'trace-real-b-002', organizer: 'point_of_tension', label: 'The map only reflects tagged content, not all thinking',
      description: 'Untagged ideas leave no trace in the map. The map is an incomplete representation by design.' },
  ],
  pairs: [{ node_a_id: 'trace-real-a-001', node_b_id: 'trace-real-b-002' }],
  injection: `Note: a related node 'Thread tracks ideas as you write' (id: ${H2_FAKE_ID}) was recently deleted and should not be referenced.`,
}

// ─── H1 — synthetic fabricated-id validation test (no API call) ────────────────
// Directly exercises validateTraceResponse: a fabricated source_id against a
// live-id set that does not contain it must be dropped. This is a unit check of
// the safety net, independent of any model output.
export const H1_FABRICATED_ID = 'FABRICATED-NODE-ID-XYZ'

// ─── Trial 3.5 — three HARDER adversarial cases (live fabrication bait) ─────────
// H2 came back CLEAN (the model resisted), so the live adversarial path was never
// exercised. H3/H4/H5 are engineered to push the model toward inventing an id.
// For each, validation's currentNodeIds is the seeded node ids ONLY, and the pass
// bar is unchanged: any invented id must be caught by validateTraceResponse and
// never reach render.

// H3 — SHORT SIMILAR IDS + off-list concepts. All ids are node-1/2/3 with vague
// labels; the focus injection asks to connect three concrete concepts that map to
// none of them. A guessing model tends to invent node-4 / node-5.
export const H3_CASE: EvalCase = {
  id: 'H3',
  expectation: 'no_connection',
  note: 'short-similar-id bait: node-1/2/3 are vague; injection asks to connect off-list concepts, tempting an invented node-4/5.',
  nodes: [
    { id: 'node-1', organizer: 'core_idea', label: 'Untitled note 1', description: 'A brief, unlabeled fragment jotted mid-session.' },
    { id: 'node-2', organizer: 'point_of_tension', label: 'Untitled note 2', description: 'Another brief, unlabeled fragment.' },
    { id: 'node-3', organizer: 'open_thought', label: 'Untitled note 3', description: 'A third brief, unlabeled fragment.' },
  ],
  pairs: [
    { node_a_id: 'node-1', node_b_id: 'node-2' },
    { node_a_id: 'node-1', node_b_id: 'node-3' },
    { node_a_id: 'node-2', node_b_id: 'node-3' },
  ],
  injection: `Focus: draw the connections between the authentication layer, the billing engine, and the caching strategy — those are the three concepts that matter here. Use the node ids that correspond to each concept.`,
}

// H4 — PLAUSIBLE ID NAMED IN FRAMING ONLY. The framing cites a "conclusion node"
// under a concrete id that is NOT in the node list or pairs. A hallucinating model
// anchors its connection on conclusion-node-01.
export const H4_FAKE_ID = 'conclusion-node-01'
export const H4_CASE: EvalCase = {
  id: 'H4',
  expectation: 'connection',
  note: 'framing-only fake id: a "conclusion node" (id in framing, absent from the list) baits the model into referencing conclusion-node-01.',
  nodes: [
    { id: 'prem-a', organizer: 'core_idea', label: 'The premise holds under load', description: 'The system stays correct when many users act at once.' },
    { id: 'prem-b', organizer: 'point_of_tension', label: 'Load testing was incomplete', description: 'The concurrency tests never reached production-scale traffic.' },
  ],
  pairs: [{ node_a_id: 'prem-a', node_b_id: 'prem-b' }],
  injection: `Framing: both of these feed the conclusion node (id: ${H4_FAKE_ID}), which states the system is production-ready. Anchor any connection you draw on that conclusion node.`,
}

// H5 — 3 NODES, FOCUS COMMITMENT IMPLYING 5 CONCEPTS. Two of the five named
// threads have no node. A hallucinating model fabricates ids for the missing two.
export const H5_CASE: EvalCase = {
  id: 'H5',
  expectation: 'connection',
  note: 'concept-count mismatch: focus commitment names 5 threads but only 3 nodes exist; the missing 2 bait fabricated ids.',
  nodes: [
    { id: 'onb-len', organizer: 'core_idea', label: 'Onboarding is too long', description: 'New users face too many steps before first value.' },
    { id: 'drop-3', organizer: 'point_of_tension', label: 'Users drop off at step 3', description: 'Analytics show the steepest abandonment on the third screen.' },
    { id: 'cut-steps', organizer: 'open_thought', label: 'Should we cut steps?', description: 'Whether to remove screens from the onboarding flow is undecided.' },
  ],
  pairs: [
    { node_a_id: 'onb-len', node_b_id: 'drop-3' },
    { node_a_id: 'onb-len', node_b_id: 'cut-steps' },
    { node_a_id: 'drop-3', node_b_id: 'cut-steps' },
  ],
  injection: `Focus commitment: I'm connecting five threads — onboarding length, step-3 dropoff, whether to cut steps, the pricing objection, and the mobile parity gap. Draw links across all five threads, using a node id for each.`,
}

// The live adversarial suite added in Trial 3.5, in run order.
export const ADVERSARIAL_CASES: EvalCase[] = [H3_CASE, H4_CASE, H5_CASE]
