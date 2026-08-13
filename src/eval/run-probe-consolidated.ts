// ═══════════════════════════════════════════════════════════════════════════
// PROBE CONSOLIDATED-RULES REGRESSION RUNNER (Step 4)
// ═══════════════════════════════════════════════════════════════════════════
// Re-runs the SAME 10 canonical baseline paragraphs (RECALL_CASES / PRECISION_CASES
// in probe-baseline.ts — ids 1-5 recall = R1-R5, ids 6-10 precision = P1-P5),
// BATCHED, each case N>=5 times, against the live /api/chat proxy (Groq
// llama-3.3-70b-versatile). Purpose: measure the consolidated-rules prompt
// rewrite (general RULE 1-4 + <=2 examples, replacing the accumulated NONE
// few-shot patches).
//
// Two things are read LIVE from src/lib/probe.ts so the eval cannot drift from
// what is deployed:
//   1. PROBE_SYSTEM   — the rewritten system prompt (extracted textually).
//   2. buildUserMessage — the yes/no gate user message (imported).
// The runner aborts if the live prompt is not the consolidated version.
//
// PREREQUISITES: GROQ_API_KEY in .env.local; dev server on :5181.
// RUN:  npx tsx src/eval/run-probe-consolidated.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// STEP 0 — CURRENT-STATE DOCUMENTATION (recorded before the rewrite; the rewrite
// is measured against these specific prior failures).
//
// (1) FEW-SHOT EXAMPLES IN THE PRE-REWRITE PROMPT (the whack-a-mole pile):
//   - "Water boils at 100 degrees Celsius at sea level."            (factual)
//   - "A verb is a word that expresses an action or a state."       (definition)
//   - "To save the file, press Command-S."                          (procedure)
//   - "Obsidian's graph view ... Thread's map view uses node size ..." (comparison;
//     this one is P5/paragraph-10 itself — an example patching a specific eval case)
//   - "The confidence dot feature was removed after user testing ..." (P2/para-7
//     itself — again an example patching a specific eval case)
//   plus two inline illustrations inside the "trap" paragraph ("System B sizes
//   nodes by link count, so ...") which are also paragraph-10 material.
//
// (2) EXPLICIT RULES STATED IN THE PRE-REWRITE PROMPT:
//   - Return one question; reference actual content; target core assumption;
//     answerable; <25 words; plain language.
//   - OUTPUT DISCIPLINE: one line, the question only, no preamble/reasoning.
//   - NONE clause: a selection earns a question only when ARGUING (evaluative
//     language list); purely factual / definition / procedure / neutral
//     description / decision-with-its-own-reason / visual fact => NONE.
//   - "trap to avoid": don't invent an evaluative claim then challenge it; a
//     so/because/therefore clause is description unless what follows is evaluative.
//   - "When unsure ... prefer NONE."
//
// (3) NONE-TRIGGER MECHANISM (pre- and post-rewrite):
//   The model is INSTRUCTED to emit the literal token "NONE" (system prompt) and
//   the user message is a yes/no gate ("... If no ... respond with exactly NONE").
//   The client detects it with isNoneResponse() (tolerant of quotes/punctuation)
//   and suppresses the result card. It is an explicit instruction, not a
//   confidence threshold — without it the model always returns a question.
//
// (4) BASELINE PRECISION FALSE POSITIVES THE REWRITE MUST FIX (exact returned
//     questions), from probe-baseline-results.json (baseline) and
//     probe-cot-results.json (CoT) — all 5/5 clean paragraphs false-positived in
//     both runs:
//   P1 (para 6, client-side storage):
//     baseline: "Is client-side storage sufficient for data persistence?"
//     cot:      "Does client-side storage meet the app's scalability needs?"
//   P2 (para 7, confidence-dot removal):
//     baseline: "Was user testing representative of actual users?"
//     cot:      "Does removing features that are unintuitive always improve the overall user experience?"
//   P3 (para 8, Shift-click procedure):
//     baseline: "Is Shift-clicking the source node a valid action?"
//     cot:      "Does holding Shift simplify the connection process for users?"
//   P4 (para 9, tension-node definition):
//     baseline: "Is a tension node always distinct from a core idea?"
//     cot:      "Does a coral label reliably indicate unresolved thinking?"
//   P5 (para 10, Obsidian/Thread comparison):
//     baseline: "Are all connections equally important?"
//     cot:      "Does a note's importance correlate with the number of connections it has?"
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { isNoneResponse, buildUserMessage } from '../lib/probe'
import {
  RECALL_CASES,
  PRECISION_CASES,
  PROBE_MODEL_AT_BASELINE,
  PROBE_TEMPERATURE,
} from './probe-baseline'

const BASE_URL = process.env.PROBE_EVAL_BASE_URL ?? 'http://localhost:5181'
const MODEL_RECORDED = 'llama-3.3-70b-versatile via groq'
const RUNS_PER_CASE = Number(process.env.PROBE_EVAL_RUNS ?? 5)
// max_tokens matches the live production value (bumped 60 -> 300 in the usermsg fix).
const PROBE_MAX_TOKENS = 300

// Guard: read the ACTUAL production system prompt so the eval can't drift from deploy.
const here = dirname(fileURLToPath(import.meta.url))
const probeSrc = readFileSync(join(here, '..', 'lib', 'probe.ts'), 'utf8')
const sysMatch = probeSrc.match(/const PROBE_SYSTEM = `([\s\S]*?)`\n/)
if (!sysMatch) { console.error('Could not extract PROBE_SYSTEM from lib/probe.ts'); process.exit(1) }
const PROBE_SYSTEM_LIVE = sysMatch[1]
if (!/respond with exactly the word NONE/i.test(PROBE_SYSTEM_LIVE)) {
  console.error('Production prompt does not contain the NONE clause — aborting.'); process.exit(1)
}
if (!/RULE 1|RULE 2|RULE 3|RULE 4/.test(PROBE_SYSTEM_LIVE)) {
  console.error('Production prompt is not the consolidated-rules version (no RULE N categories) — aborting.'); process.exit(1)
}

function wordCount(s: string): number {
  const t = s.trim()
  return t ? t.split(/\s+/).length : 0
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Pacing: Groq's free on_demand tier caps tokens-per-minute, and each call sends
// the full (large) system prompt. Firing 50 calls back-to-back blows the TPM cap
// and returns 429s that masquerade as declines. We pace every call and retry 429s
// with a wait taken from the error's "try again in Xs" hint (fallback 25s).
const BASE_DELAY_MS = Number(process.env.PROBE_EVAL_DELAY_MS ?? 8000)
const MAX_429_RETRIES = 6

async function callProbeOnce(selectedText: string): Promise<{ status: number; raw: string; note: string; retryMs: number }> {
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: PROBE_MODEL_AT_BASELINE,
      max_tokens: PROBE_MAX_TOKENS,
      temperature: PROBE_TEMPERATURE,
      system: [{ type: 'text', text: PROBE_SYSTEM_LIVE, cache_control: { type: 'ephemeral' } }],
      // The LIVE production user message (yes/no gate), not the stale baseline one.
      messages: [{ role: 'user', content: buildUserMessage({ context: 'linear_editor_selection', selectedText }) }],
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const m = body.match(/try again in ([\d.]+)s/i)
    const retryMs = m ? Math.ceil(parseFloat(m[1]) * 1000) + 1500 : 25000
    return { status: res.status, raw: '', note: `HTTP ${res.status}: ${body.slice(0, 160)}`, retryMs }
  }
  const data = (await res.json()) as { content?: { type: string; text?: string }[] }
  const raw = (data.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('').trim()
  return { status: 200, raw, note: raw ? '' : 'empty content', retryMs: 0 }
}

async function callProbe(selectedText: string): Promise<{ ok: boolean; raw: string; note: string }> {
  for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
    const r = await callProbeOnce(selectedText)
    if (r.status === 429 && attempt < MAX_429_RETRIES) {
      process.stdout.write(`(429,wait ${Math.round(r.retryMs / 1000)}s)`)
      await sleep(r.retryMs)
      continue
    }
    if (r.status !== 200) return { ok: false, raw: '', note: r.note }
    return { ok: r.raw.length > 0, raw: r.raw, note: r.note }
  }
  return { ok: false, raw: '', note: 'exhausted 429 retries' }
}

interface RunRec { raw: string; returned_none: boolean; word_count: number; ok: boolean; note: string }
interface CaseRec {
  pair_id: string
  paragraph_id: number
  kind: 'recall' | 'precision'
  runs: RunRec[]
  none_count: number
  question_count: number
}

async function runCase(pairId: string, paragraphId: number, kind: 'recall' | 'precision', text: string): Promise<CaseRec> {
  const runs: RunRec[] = []
  for (let i = 0; i < RUNS_PER_CASE; i++) {
    const r = await callProbe(text)
    const none = isNoneResponse(r.raw)
    runs.push({ raw: r.raw, returned_none: none, word_count: none ? 0 : wordCount(r.raw), ok: r.ok, note: r.note })
    process.stdout.write(none ? 'N' : (r.ok ? 'q' : 'x'))
    await sleep(BASE_DELAY_MS)
  }
  const none_count = runs.filter(r => r.returned_none).length
  const question_count = runs.filter(r => r.ok && !r.returned_none).length
  console.log(`  [${pairId} ${kind}] NONE ${none_count}/${RUNS_PER_CASE}, question ${question_count}/${RUNS_PER_CASE}`)
  return { pair_id: pairId, paragraph_id: paragraphId, kind, runs, none_count, question_count }
}

async function main() {
  console.log(`Running consolidated-rules eval — ${RUNS_PER_CASE} runs/case, base ${BASE_URL}\n`)
  const recall: CaseRec[] = []
  const precision: CaseRec[] = []

  for (const c of RECALL_CASES) {
    recall.push(await runCase(`R${c.id}`, c.id, 'recall', c.text))
  }
  for (const c of PRECISION_CASES) {
    precision.push(await runCase(`P${c.id - 5}`, c.id, 'precision', c.text))
  }

  const out = {
    run_date: new Date().toISOString(),
    model: MODEL_RECORDED,
    base_url: BASE_URL,
    runs_per_case: RUNS_PER_CASE,
    prompt_version: 'consolidated-rules-v1 — general NONE rules, <=2 examples',
    recall,
    precision,
  }
  const file = join(here, 'probe-consolidated-raw.json')
  writeFileSync(file, JSON.stringify(out, null, 2))

  const totalPrecisionRuns = precision.reduce((n, c) => n + c.runs.length, 0)
  const precisionNone = precision.reduce((n, c) => n + c.none_count, 0)
  const recallQuestions = recall.reduce((n, c) => n + c.question_count, 0)
  const recallNone = recall.reduce((n, c) => n + c.none_count, 0)
  console.log(`\n── SUMMARY ──`)
  console.log(`precision correctly returned NONE: ${precisionNone}/${totalPrecisionRuns} runs`)
  console.log(`recall returned a question (not suppressed): ${recallQuestions}/${recall.reduce((n, c) => n + c.runs.length, 0)} runs (recall NONE = ${recallNone})`)
  console.log(`\nWrote ${file}`)
}

main().catch(e => { console.error(e); process.exit(1) })
