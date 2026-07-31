// Runner for Trace Trial 3.5 — re-runs the full structured-output suite plus the
// three new adversarial cases (H3/H4/H5) against the CONFIRMED serving model
// (llama-3.3-70b-versatile via Groq — see trial-3-5-model-identity.json). 14 live
// API calls (R1–R5, P1–P5, H2, H3, H4, H5) + H1 (synthetic, no call). Runs the
// REAL validateTraceResponse and, for every case, records whether console.warn
// actually fired during validation. Writes trace-structured-3-5-output-raw.json.
//
// PREREQUISITES: GROQ_API_KEY in .env.local; dev server on :5181.
// RUN:  npx tsx src/eval/run-trace-structured-3-5.ts

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { validateTraceResponse } from '../lib/trace'
import {
  RECALL_CASES,
  PRECISION_CASES,
  H2_CASE,
  H2_FAKE_ID,
  ADVERSARIAL_CASES,
  H4_FAKE_ID,
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
const MODEL_RECORDED = 'llama-3.3-70b-versatile via groq'

interface RawConn { source_id: string; target_id: string; rationale: string }

// Run a fn while capturing whether console.warn fired (and what it said).
function withWarnSpy<T>(fn: () => T): { result: T; warnFired: boolean; messages: string[] } {
  const orig = console.warn
  const messages: string[] = []
  console.warn = (...args: unknown[]) => { messages.push(args.map(a => String(a)).join(' ')) }
  try {
    const result = fn()
    return { result, warnFired: messages.length > 0, messages }
  } finally {
    console.warn = orig
  }
}

async function callTrace(nodes: EvalNode[], pairs: EvalPair[], injection?: string): Promise<{ ok: boolean; rawText: string; note: string }> {
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      agent: 'trace', // route to the production Trace model (OPENROUTER_TRACE_MODEL)
      model: TRACE_MODEL_IN_REQUEST,
      max_tokens: Math.max(TRACE_MAX_TOKENS, 600), // reasoning models need headroom
      temperature: TRACE_TEMPERATURE,
      system: [{ type: 'text', text: TRACE_SYSTEM_VERBATIM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: buildTraceUserMessage(nodes, pairs, injection) }],
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return { ok: false, rawText: '', note: `HTTP ${res.status}: ${body.slice(0, 200)}` }
  }
  const data = (await res.json()) as { content?: { type: string; text?: string }[] }
  const rawText = (data.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('').trim()
  return { ok: true, rawText, note: '' }
}

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
  hallucinated_ids_produced: string[]
  hallucinated_id_in_response: boolean
  validated_connections: RawConn[]
  caught_by_validateTraceResponse: boolean | 'na'
  warn_fired: boolean
  warn_messages: string[]
  note: string
}

function runCase(c: EvalCase, raw: { rawText: string; ok: boolean }): CaseRecord {
  const seededIds = new Set(c.nodes.map(n => n.id))
  let parseOk = true
  let parsed: unknown = null
  try { parsed = JSON.parse(raw.rawText) } catch { parseOk = false }
  const rawConns = parseOk ? shapeConnections(parsed) : []

  const hallucinated = new Set<string>()
  for (const conn of rawConns) {
    if (!seededIds.has(conn.source_id)) hallucinated.add(conn.source_id)
    if (!seededIds.has(conn.target_id)) hallucinated.add(conn.target_id)
  }

  // Real safety net, with a console.warn spy so we can report warn_fired.
  const { result: validated, warnFired, messages } = withWarnSpy(() => validateTraceResponse(rawConns, seededIds))

  const hallucinatedPresent = hallucinated.size > 0
  const survivorIds = new Set(validated.flatMap(v => [v.source_id, v.target_id]))
  const anySurvived = [...hallucinated].some(id => survivorIds.has(id))
  const caught: boolean | 'na' = hallucinatedPresent ? !anySurvived : 'na'

  return {
    pair_id: c.id,
    expectation: c.expectation,
    http_ok: raw.ok,
    json_parse_ok: parseOk,
    raw_response: raw.rawText,
    seeded_ids: [...seededIds],
    raw_connections: rawConns,
    hallucinated_ids_produced: [...hallucinated],
    hallucinated_id_in_response: hallucinatedPresent,
    validated_connections: validated,
    caught_by_validateTraceResponse: caught,
    warn_fired: warnFired,
    warn_messages: messages,
    note: c.note,
  }
}

async function main() {
  const out = {
    run_date: new Date().toISOString(),
    model: MODEL_RECORDED,
    base_url: BASE_URL,
    prompt_version: 'structured-output-v1 — JSON schema + ID validation (Trial 3.5 adversarial re-run)',
    model_confirmed_by: 'trial-3-5-model-identity.json',
    total_api_calls: 0,
    json_parse_failures: 0,
    recall: [] as CaseRecord[],
    precision: [] as CaseRecord[],
    adversarial: [] as (CaseRecord & { fake_id_baited: string | null; model_returned_fake_id: boolean; result: string })[],
    h1: { fabricated_id_injected: H1_FABRICATED_ID, warn_fired: false, validation_dropped_it: false, result: 'FAIL' },
  }

  for (const c of RECALL_CASES) {
    const raw = await callTrace(c.nodes, c.pairs, c.injection)
    out.total_api_calls++
    const rec = runCase(c, raw)
    if (!rec.json_parse_ok) out.json_parse_failures++
    out.recall.push(rec)
    console.log(`[${c.id}] halluc=${rec.hallucinated_id_in_response} caught=${rec.caught_by_validateTraceResponse} warn=${rec.warn_fired}`)
  }
  for (const c of PRECISION_CASES) {
    const raw = await callTrace(c.nodes, c.pairs, c.injection)
    out.total_api_calls++
    const rec = runCase(c, raw)
    if (!rec.json_parse_ok) out.json_parse_failures++
    out.precision.push(rec)
    console.log(`[${c.id}] halluc=${rec.hallucinated_id_in_response} caught=${rec.caught_by_validateTraceResponse} warn=${rec.warn_fired}`)
  }

  // Adversarial: H2 (original) + H3/H4/H5 (new).
  const fakeBaitById: Record<string, string | null> = { H2: H2_FAKE_ID, H3: null, H4: H4_FAKE_ID, H5: null }
  for (const c of [H2_CASE, ...ADVERSARIAL_CASES]) {
    const raw = await callTrace(c.nodes, c.pairs, c.injection)
    out.total_api_calls++
    const rec = runCase(c, raw)
    if (!rec.json_parse_ok) out.json_parse_failures++
    const modelReturnedFake = rec.hallucinated_id_in_response
    // PASS = fabricated something AND net caught all of it; CLEAN = no fabrication;
    // FAIL = a fabricated id survived validation (would reach render).
    const result = !modelReturnedFake ? 'CLEAN' : (rec.caught_by_validateTraceResponse === true ? 'PASS' : 'FAIL')
    out.adversarial.push({ ...rec, fake_id_baited: fakeBaitById[c.id] ?? null, model_returned_fake_id: modelReturnedFake, result })
    console.log(`[${c.id}] returnedFake=${modelReturnedFake} ids=${JSON.stringify(rec.hallucinated_ids_produced)} caught=${rec.caught_by_validateTraceResponse} warn=${rec.warn_fired} result=${result}`)
  }

  // H1 — synthetic fabricated-id unit check (no API call), with warn spy.
  {
    const liveIds = new Set(['trace-real-a-001', 'trace-real-b-002'])
    const injected = [{ source_id: H1_FABRICATED_ID, target_id: 'trace-real-a-001', rationale: 'synthetic fabricated-id probe' }]
    const { result: survivors, warnFired } = withWarnSpy(() => validateTraceResponse(injected, liveIds))
    const dropped = survivors.length === 0
    out.h1 = { fabricated_id_injected: H1_FABRICATED_ID, warn_fired: warnFired, validation_dropped_it: dropped, result: dropped ? 'PASS' : 'FAIL' }
    console.log(`[H1] dropped=${dropped} warn=${warnFired} result=${out.h1.result}`)
  }

  const file = join(dirname(fileURLToPath(import.meta.url)), 'trace-structured-3-5-output-raw.json')
  writeFileSync(file, JSON.stringify(out, null, 2))
  console.log(`\nWrote ${file} — ${out.total_api_calls} API calls, ${out.json_parse_failures} JSON parse failures.`)
}

main().catch(e => { console.error(e); process.exit(1) })
