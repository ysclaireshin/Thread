// Runner for the Probe false-positive fix (NONE escape valve). Re-runs the SAME
// 10 baseline paragraphs, same order, isolated, at the SAME /api/chat proxy.
// Two differences from baseline: (1) prompt reverted to baseline THEN extended
// with the NONE clause; (2) responses of "NONE" are recorded as a decline, not a
// question.
//
// The system prompt is read LIVE from src/lib/probe.ts at startup (not a frozen
// copy) so this tests exactly what is deployed. Model, max_tokens, temperature,
// and the user message are the frozen baseline values.
//
// PREREQUISITES: GROQ_API_KEY in .env.local; dev server on :5181.
// RUN:  npx tsx src/eval/run-probe-fp-fix.ts

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { isNoneResponse } from '../lib/probe'
import {
  RECALL_CASES,
  PRECISION_CASES,
  PROBE_MODEL_AT_BASELINE,
  PROBE_MAX_TOKENS,
  PROBE_TEMPERATURE,
  buildProbeUserMessage,
} from './probe-baseline'

const BASE_URL = process.env.PROBE_EVAL_BASE_URL ?? 'http://localhost:5181'
const MODEL_RECORDED = 'llama-3.3-70b-versatile via groq'

// Read the ACTUAL production system prompt so the eval can't drift from deploy.
const here = dirname(fileURLToPath(import.meta.url))
const probeSrc = readFileSync(join(here, '..', 'lib', 'probe.ts'), 'utf8')
const sysMatch = probeSrc.match(/const PROBE_SYSTEM = `([\s\S]*?)`\n/)
if (!sysMatch) { console.error('Could not extract PROBE_SYSTEM from lib/probe.ts'); process.exit(1) }
const PROBE_SYSTEM_LIVE = sysMatch[1]
if (!/respond with exactly the word NONE/i.test(PROBE_SYSTEM_LIVE)) {
  console.error('Production prompt does not contain the NONE clause — aborting.'); process.exit(1)
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
      system: [{ type: 'text', text: PROBE_SYSTEM_LIVE, cache_control: { type: 'ephemeral' } }],
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

interface Rec { paragraph_id: number; ok: boolean; answer: string; returned_none: boolean; word_count: number; note: string }

function record(id: number, r: { ok: boolean; raw: string; note: string }): Rec {
  const none = isNoneResponse(r.raw)
  return { paragraph_id: id, ok: r.ok, answer: r.raw, returned_none: none, word_count: none ? 0 : wordCount(r.raw), note: r.note }
}

async function main() {
  const out = {
    run_date: new Date().toISOString(),
    model: MODEL_RECORDED,
    base_url: BASE_URL,
    prompt_version: 'baseline-v1 + none-escape-valve (read live from lib/probe.ts)',
    prompt_has_none_clause: true,
    total_api_calls: 0,
    recall: [] as Rec[],
    precision: [] as Rec[],
  }

  for (const c of RECALL_CASES) {
    const r = await callProbe(c.text)
    out.total_api_calls++
    const rec = record(c.id, r)
    out.recall.push(rec)
    console.log(`[recall ${c.id}] none=${rec.returned_none} wc=${rec.word_count} :: ${rec.answer || r.note}`)
  }
  for (const c of PRECISION_CASES) {
    const r = await callProbe(c.text)
    out.total_api_calls++
    const rec = record(c.id, r)
    out.precision.push(rec)
    console.log(`[precision ${c.id}] none=${rec.returned_none} wc=${rec.word_count} :: ${rec.answer || r.note}`)
  }

  const recallNone = out.recall.filter(r => r.returned_none).length
  const precisionNone = out.precision.filter(r => r.returned_none).length
  console.log(`\nrecall returned NONE: ${recallNone}/5 (should be 0 — real flaws must still get questions)`)
  console.log(`precision returned NONE: ${precisionNone}/5 (higher is better — clean paragraphs correctly declined)`)

  const file = join(here, 'probe-fp-fix-raw.json')
  writeFileSync(file, JSON.stringify(out, null, 2))
  console.log(`\nWrote ${file} — ${out.total_api_calls} calls.`)
}

main().catch(e => { console.error(e); process.exit(1) })
