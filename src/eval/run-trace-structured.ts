// Runner for the Trace Trial 3 (structured-output) eval. Fires the 11 live calls
// (R1–R5, P1–P5, H2) at the SAME /api/chat proxy the UI uses, with a
// byte-identical request to lib/trace.ts, and runs the REAL validateTraceResponse
// on each reply. Writes OBJECTIVE results to trace-structured-output-raw.json.
// Subjective scoring (rationale_specificity 1–3, flaw_targeted, false_positive_
// type, hit, false_positive) is a human/reviewer judgment against the raw
// rationales and is folded into trace-structured-output-results.json — NOT
// computed here (same convention as the Probe baseline).
//
// H1 is a synthetic unit check of the safety net (no API call): a fabricated id
// against a live-id set that lacks it must be dropped.
//
// PREREQUISITES:
//   1. GROQ_API_KEY=gsk_... in .env.local  (/api/chat is Groq-backed)
//   2. Dev server running: npm run dev  (serves /api/chat on :5181)
//
// RUN:  npx tsx src/eval/run-trace-structured.ts
//   (override target with  TRACE_EVAL_BASE_URL=http://localhost:5181 )

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { validateTraceResponse } from '../lib/trace'
import {
  RECALL_CASES,
  PRECISION_CASES,
  H2_CASE,
  H2_FAKE_ID,
  H1_FABRICATED_ID,
  TRACE_SYSTEM_VERBATIM,
  TRACE_MODEL_IN_REQUEST,
  TRACE_MAX_TOKENS,
  TRACE_TEMPERATURE,
  buildTraceUserMessage,
  type EvalCase,
  type EvalNode,
  type EvalPair,
} from './trace-structured'

const BASE_URL = process.env.TRACE_EVAL_BASE_URL ?? 'http://localhost:5181'

// /api/chat is the Groq proxy calling llama-3.3-70b-versatile and reshaping the
// reply to Anthropic's content[0].text. The request `model` is ignored — record
// what actually produced the numbers.
const MODEL_RECORDED = 'llama-3.3-70b-versatile via groq'

interface RawConn { source_id: string; target_id: string; rationale: string }

function wordCount(s: string): number {
  const t = s.trim()
  return t ? t.split(/\s+/).length : 0
}

// Exact replica of lib/trace.ts runTraceScan()'s request. One call, no retries.
async function callTrace(nodes: EvalNode[], pairs: EvalPair[], injection?: string): Promise<{
  ok: boolean; status: number; rawText: string; note: string
}> {
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: TRACE_MODEL_IN_REQUEST,
      max_tokens: TRACE_MAX_TOKENS,
      temperature: TRACE_TEMPERATURE,
      system: [{ type: 'text', text: TRACE_SYSTEM_VERBATIM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: buildTraceUserMessage(nodes, pairs, injection) }],
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return { ok: false, status: res.status, rawText: '', note: `HTTP ${res.status}: ${body.slice(0, 200)}` }
  }
  const data = (await res.json()) as { content?: { type: string; text?: string }[] }
  const rawText = (data.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('').trim()
  return { ok: true, status: 200, rawText, note: '' }
}

// Shape-coerce parsed JSON into RawConn[] the way trace.ts does before validation.
function shapeConnections(parsed: unknown): RawConn[] {
  const list = (parsed as { connections?: unknown })?.connections
  if (!Array.isArray(list)) return []
  const out: RawConn[] = []
  for (const c of list as RawConn[]) {
    const source = c?.source_id
    const target = c?.target_id
    const rationale = typeof c?.rationale === 'string' ? c.rationale.trim() : ''
    if (!source || !target || !rationale) continue
    out.push({ source_id: source, target_id: target, rationale })
  }
  return out
}

interface CaseRecord {
  pair_id: string
  expectation: 'connection' | 'no_connection'
  http_ok: boolean
  json_parse_ok: boolean
  raw_response: string
  seeded_ids: string[]
  raw_connections: RawConn[]
  hallucinated_ids: string[]
  hallucinated_id_in_response: boolean
  validated_connections: RawConn[]
  validation_caught_it: boolean | 'na'
  connection_suggested: boolean
  source_id_returned: string | null
  target_id_returned: string | null
  rationale_returned: string | null
  rationale_word_count: number
  note: string
}

function runCase(c: EvalCase, raw: { rawText: string; ok: boolean }): CaseRecord {
  const seededIds = new Set(c.nodes.map(n => n.id))
  let parseOk = true
  let parsed: unknown = null
  try {
    parsed = JSON.parse(raw.rawText)
  } catch {
    parseOk = false
  }
  const rawConns = parseOk ? shapeConnections(parsed) : []

  // Every id the model returned that is NOT in the seeded (live) set.
  const hallucinated = new Set<string>()
  for (const conn of rawConns) {
    if (!seededIds.has(conn.source_id)) hallucinated.add(conn.source_id)
    if (!seededIds.has(conn.target_id)) hallucinated.add(conn.target_id)
  }

  // The REAL safety net, exactly as production runs it.
  const validated = validateTraceResponse(rawConns, seededIds)

  const hallucinatedPresent = hallucinated.size > 0
  // Did validation remove every hallucinated id before it could render?
  const survivorIds = new Set(validated.flatMap(v => [v.source_id, v.target_id]))
  const anyHallucinationSurvived = [...hallucinated].some(id => survivorIds.has(id))
  const validationCaughtIt: boolean | 'na' = hallucinatedPresent ? !anyHallucinationSurvived : 'na'

  const first = validated[0] ?? rawConns[0] ?? null
  return {
    pair_id: c.id,
    expectation: c.expectation,
    http_ok: raw.ok,
    json_parse_ok: parseOk,
    raw_response: raw.rawText,
    seeded_ids: [...seededIds],
    raw_connections: rawConns,
    hallucinated_ids: [...hallucinated],
    hallucinated_id_in_response: hallucinatedPresent,
    validated_connections: validated,
    validation_caught_it: validationCaughtIt,
    connection_suggested: validated.length > 0,
    source_id_returned: first ? first.source_id : null,
    target_id_returned: first ? first.target_id : null,
    rationale_returned: first ? first.rationale : null,
    rationale_word_count: first ? wordCount(first.rationale) : 0,
    note: c.note,
  }
}

async function main() {
  const out: {
    run_date: string
    model: string
    base_url: string
    prompt_version: string
    total_api_calls: number
    json_parse_failures: number
    recall: CaseRecord[]
    precision: CaseRecord[]
    h2: (CaseRecord & { model_returned_fake_id: boolean; fake_id_value: string | null; validation_dropped_it: boolean; result: string }) | null
    h1: { fabricated_id_injected: string; validation_dropped_it: boolean; result: string }
  } = {
    run_date: new Date().toISOString(),
    model: MODEL_RECORDED,
    base_url: BASE_URL,
    prompt_version: 'structured-output-v1 — JSON schema + ID validation',
    total_api_calls: 0,
    json_parse_failures: 0,
    recall: [],
    precision: [],
    h2: null,
    h1: { fabricated_id_injected: H1_FABRICATED_ID, validation_dropped_it: false, result: 'FAIL' },
  }

  for (const c of RECALL_CASES) {
    const raw = await callTrace(c.nodes, c.pairs, c.injection)
    out.total_api_calls++
    const rec = runCase(c, raw)
    if (!rec.json_parse_ok) out.json_parse_failures++
    out.recall.push(rec)
    console.log(`[${c.id}] suggested=${rec.connection_suggested} halluc=${rec.hallucinated_id_in_response} caught=${rec.validation_caught_it} :: ${rec.rationale_returned ?? raw.note}`)
  }

  for (const c of PRECISION_CASES) {
    const raw = await callTrace(c.nodes, c.pairs, c.injection)
    out.total_api_calls++
    const rec = runCase(c, raw)
    if (!rec.json_parse_ok) out.json_parse_failures++
    out.precision.push(rec)
    console.log(`[${c.id}] suggested=${rec.connection_suggested} halluc=${rec.hallucinated_id_in_response} caught=${rec.validation_caught_it} :: ${rec.rationale_returned ?? raw.note}`)
  }

  // H2 — confusion case.
  {
    const raw = await callTrace(H2_CASE.nodes, H2_CASE.pairs, H2_CASE.injection)
    out.total_api_calls++
    const rec = runCase(H2_CASE, raw)
    if (!rec.json_parse_ok) out.json_parse_failures++
    const modelReturnedFake = rec.hallucinated_ids.includes(H2_FAKE_ID)
    const survivorIds = new Set(rec.validated_connections.flatMap(v => [v.source_id, v.target_id]))
    const fakeSurvived = survivorIds.has(H2_FAKE_ID)
    const validationDropped = modelReturnedFake && !fakeSurvived
    const result = modelReturnedFake ? (validationDropped ? 'PASS' : 'FAIL') : 'CLEAN'
    out.h2 = {
      ...rec,
      model_returned_fake_id: modelReturnedFake,
      fake_id_value: modelReturnedFake ? H2_FAKE_ID : null,
      validation_dropped_it: validationDropped,
      result,
    }
    console.log(`[H2] returnedFake=${modelReturnedFake} dropped=${validationDropped} result=${result} :: ${rec.rationale_returned ?? raw.note}`)
  }

  // H1 — synthetic fabricated-id unit check (no API call).
  {
    const liveIds = new Set(['trace-real-a-001', 'trace-real-b-002'])
    const injected = [{ source_id: H1_FABRICATED_ID, target_id: 'trace-real-a-001', rationale: 'synthetic fabricated-id probe' }]
    const survivors = validateTraceResponse(injected, liveIds)
    const dropped = survivors.length === 0
    out.h1 = { fabricated_id_injected: H1_FABRICATED_ID, validation_dropped_it: dropped, result: dropped ? 'PASS' : 'FAIL' }
    console.log(`[H1] fabricated='${H1_FABRICATED_ID}' dropped=${dropped} result=${out.h1.result}`)
  }

  const file = join(dirname(fileURLToPath(import.meta.url)), 'trace-structured-output-raw.json')
  writeFileSync(file, JSON.stringify(out, null, 2))
  console.log(`\nWrote ${file} — ${out.total_api_calls} API calls, ${out.json_parse_failures} JSON parse failures.`)
  console.log('Next: reviewer scores subjective fields → trace-structured-output-results.json')
}

main().catch(e => { console.error(e); process.exit(1) })
