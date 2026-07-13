// Runner for Probe Trial 4 (CoT + few-shot). Fires the SAME 10 baseline
// paragraphs, in the same order, isolated, at the SAME /api/chat proxy — the
// ONLY difference from run-probe-baseline.ts is the system prompt
// (PROBE_COT_SYSTEM_VERBATIM). Writes OBJECTIVE results to probe-cot-raw.json.
// Sharpness judgment (Step 2) is a manual reviewer pass folded into
// probe-cot-results.json — NOT computed here.
//
// PREREQUISITES: GROQ_API_KEY in .env.local; dev server on :5181.
// RUN:  npx tsx src/eval/run-probe-cot.ts

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  RECALL_CASES,
  PRECISION_CASES,
  PROBE_MODEL_AT_BASELINE,
  PROBE_MAX_TOKENS,
  PROBE_TEMPERATURE,
  buildProbeUserMessage,
} from './probe-baseline'
import { PROBE_COT_SYSTEM_VERBATIM } from './probe-cot'

const BASE_URL = process.env.PROBE_EVAL_BASE_URL ?? 'http://localhost:5181'
const MODEL_RECORDED = 'llama-3.3-70b-versatile via groq'

// Detects reasoning that leaked into the output. Any of the step markers, the
// worked-example labels, or a numbered-step prefix counts as a leak.
function reasoningLeaked(raw: string): boolean {
  return /\bstep\s*[123]\b|main claim\s*:|hidden assumption\s*:/i.test(raw)
}

// Extracts the FINAL question from a response that may (buggily) contain leading
// reasoning. Prefers the last line that ends in '?'; strips a leading label and
// wrapping quotes. Falls back to the whole trimmed string.
function extractFinalQuestion(raw: string): string {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean)
  const qLines = lines.filter(l => l.includes('?'))
  let q = (qLines.length ? qLines[qLines.length - 1] : (lines[lines.length - 1] ?? raw)).trim()
  q = q.replace(/^(step\s*3[^:]*:|question\s*:|answer\s*:)\s*/i, '').trim()
  q = q.replace(/^["'“”]+|["'“”]+$/g, '').trim()
  return q
}

// True if there is any non-question text before the final question (a preamble).
function preamblePresent(raw: string, finalQuestion: string): boolean {
  const trimmed = raw.trim().replace(/^["'“”]+|["'“”]+$/g, '').trim()
  return trimmed !== finalQuestion
}

function wordCount(s: string): number {
  const t = s.trim()
  return t ? t.split(/\s+/).length : 0
}

async function callProbe(selectedText: string): Promise<{ ok: boolean; raw: string; note: string }> {
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: PROBE_MODEL_AT_BASELINE,
      max_tokens: PROBE_MAX_TOKENS,
      temperature: PROBE_TEMPERATURE,
      system: [{ type: 'text', text: PROBE_COT_SYSTEM_VERBATIM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: buildProbeUserMessage(selectedText) }],
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return { ok: false, raw: '', note: `HTTP ${res.status}: ${body.slice(0, 200)}` }
  }
  const data = (await res.json()) as { content?: { type: string; text?: string }[] }
  const raw = (data.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('').trim()
  return { ok: raw.length > 0, raw, note: raw ? '' : 'empty content' }
}

interface Rec {
  paragraph_id: number
  ok: boolean
  cot_answer: string
  final_question: string
  reasoning_leaked: boolean
  preamble_present: boolean
  word_count: number
  note: string
}

function record(id: number, r: { ok: boolean; raw: string; note: string }): Rec {
  const finalQ = extractFinalQuestion(r.raw)
  return {
    paragraph_id: id,
    ok: r.ok,
    cot_answer: r.raw,
    final_question: finalQ,
    reasoning_leaked: reasoningLeaked(r.raw),
    preamble_present: preamblePresent(r.raw, finalQ),
    word_count: wordCount(finalQ),
    note: r.note,
  }
}

async function main() {
  const out = {
    run_date: new Date().toISOString(),
    model: MODEL_RECORDED,
    base_url: BASE_URL,
    prompt_version: 'cot-few-shot-v1 — three-step internal reasoning + three worked examples',
    total_api_calls: 0,
    recall: [] as Rec[],
    precision: [] as Rec[],
  }

  for (const c of RECALL_CASES) {
    const r = await callProbe(c.text)
    out.total_api_calls++
    const rec = record(c.id, r)
    out.recall.push(rec)
    console.log(`[recall ${c.id}] leaked=${rec.reasoning_leaked} preamble=${rec.preamble_present} wc=${rec.word_count} :: ${rec.final_question || r.note}`)
  }
  for (const c of PRECISION_CASES) {
    const r = await callProbe(c.text)
    out.total_api_calls++
    const rec = record(c.id, r)
    out.precision.push(rec)
    console.log(`[precision ${c.id}] leaked=${rec.reasoning_leaked} preamble=${rec.preamble_present} wc=${rec.word_count} :: ${rec.final_question || r.note}`)
  }

  const file = join(dirname(fileURLToPath(import.meta.url)), 'probe-cot-raw.json')
  writeFileSync(file, JSON.stringify(out, null, 2))
  console.log(`\nWrote ${file} — ${out.total_api_calls} calls. Now do the manual sharpness pass → probe-cot-results.json`)
}

main().catch(e => { console.error(e); process.exit(1) })
