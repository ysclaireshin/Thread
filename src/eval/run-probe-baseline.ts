// Runner for the Probe baseline eval (Trial 2). Fires the 10 fixed inputs at
// the SAME endpoint the UI uses (the dev server's /api/chat proxy) with a
// byte-identical request to lib/probe.ts, and writes the OBJECTIVE results to
// probe-baseline-raw.json. Subjective scoring (content specificity 1–3,
// flaw_targeted, false_positive_type) is done by a human reviewer against the
// raw questions and folded into the final probe-baseline-results.json — those
// are judgment calls, deliberately NOT computed here.
//
// PREREQUISITES (all required — the eval is meaningless without live calls):
//   1. A real key in .env.local:  GROQ_API_KEY=gsk_...
//      (/api/chat is now Groq-backed; the request body's `model` is ignored by
//       the proxy, which always uses llama-3.3-70b-versatile.)
//   2. Dev server running:        npm run dev   (serves /api/chat on :5181)
//   3. Today's AI cap not spent (see rate-limit note in probe-baseline.ts).
//
// RUN:  npx tsx src/eval/run-probe-baseline.ts
// (override the target with  PROBE_EVAL_BASE_URL=http://localhost:5181 )

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  RECALL_CASES,
  PRECISION_CASES,
  PROBE_MODEL_AT_BASELINE,
  PROBE_MAX_TOKENS,
  PROBE_TEMPERATURE,
  PROBE_SYSTEM_VERBATIM,
  buildProbeUserMessage,
} from './probe-baseline'

const BASE_URL = process.env.PROBE_EVAL_BASE_URL ?? 'http://localhost:5181'

// What actually produced the numbers now that /api/chat is Groq-backed. The
// request still sends PROBE_MODEL_AT_BASELINE in its body for byte-identical
// parity with lib/probe.ts, but the proxy ignores it and calls Groq's
// llama-3.3-70b-versatile — so the results file must record THIS, not Haiku.
const MODEL_RECORDED = 'llama-3.3-70b-versatile via groq'

// Exact replica of lib/probe.ts runProbe() request, pointed at an absolute URL
// so it works from Node. One call, no retries.
async function callProbe(selectedText: string): Promise<{ ok: boolean; question: string; note: string }> {
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: PROBE_MODEL_AT_BASELINE,
      max_tokens: PROBE_MAX_TOKENS,
      temperature: PROBE_TEMPERATURE,
      system: [{ type: 'text', text: PROBE_SYSTEM_VERBATIM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: buildProbeUserMessage(selectedText) }],
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return { ok: false, question: '', note: `HTTP ${res.status}: ${body.slice(0, 200)}` }
  }
  const data = (await res.json()) as { content?: { type: string; text?: string }[] }
  const question = (data.content ?? [])
    .filter(b => b.type === 'text')
    .map(b => b.text ?? '')
    .join('')
    .trim()
  return { ok: question.length > 0, question, note: question ? '' : 'empty content' }
}

function wordCount(s: string): number {
  const t = s.trim()
  return t ? t.split(/\s+/).length : 0
}

async function main() {
  const raw: {
    run_date: string
    model: string
    base_url: string
    total_api_calls: number
    recall: { paragraph_id: number; ok: boolean; returned_question: string; word_count: number; note: string }[]
    precision: { paragraph_id: number; ok: boolean; returned_question: string; word_count: number; note: string }[]
  } = {
    run_date: new Date().toISOString(),
    model: MODEL_RECORDED,
    base_url: BASE_URL,
    total_api_calls: 0,
    recall: [],
    precision: [],
  }

  for (const c of RECALL_CASES) {
    const r = await callProbe(c.text)
    raw.total_api_calls++
    raw.recall.push({ paragraph_id: c.id, ok: r.ok, returned_question: r.question, word_count: wordCount(r.question), note: r.note })
    console.log(`[recall ${c.id}] ok=${r.ok} wc=${wordCount(r.question)} :: ${r.question || r.note}`)
  }
  for (const c of PRECISION_CASES) {
    const r = await callProbe(c.text)
    raw.total_api_calls++
    raw.precision.push({ paragraph_id: c.id, ok: r.ok, returned_question: r.question, word_count: wordCount(r.question), note: r.note })
    console.log(`[precision ${c.id}] ok=${r.ok} wc=${wordCount(r.question)} :: ${r.question || r.note}`)
  }

  const out = join(dirname(fileURLToPath(import.meta.url)), 'probe-baseline-raw.json')
  writeFileSync(out, JSON.stringify(raw, null, 2))
  console.log(`\nWrote ${out} — ${raw.total_api_calls} calls. Now score subjective fields → probe-baseline-results.json`)
}

main().catch(e => { console.error(e); process.exit(1) })
