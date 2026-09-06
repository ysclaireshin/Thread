// ─── Stage B Step 3: acceptance-rate instrumentation ─────────────────────────
// MANDATORY measurement before anyone claims extraction works. One record per
// Save-My-Place extraction, stored locally (a plain localStorage array — NOT a
// backend). The acceptance rate is nodes_kept / nodes_proposed; the edit rate is
// nodes_edited / nodes_kept.
//
// The first numbers must be honest. Do NOT tune the extraction prompt to inflate
// acceptance before the first real measurement — run it against real draft text
// (Claire's own writing) across at least 5 real extractions, read the raw rate,
// and only then decide whether extraction earns its place or should be cut.
//
// Read the log from the browser console any time:
//   JSON.parse(localStorage.getItem('thread_stage_b_extraction_metrics') || '[]')
// or call summarizeExtractionMetrics() (exported below).

const KEY = 'thread_stage_b_extraction_metrics'

export interface ExtractionMetric {
  at: string                        // ISO timestamp
  session_id: number                // the session whose writing was extracted
  nodes_proposed: number
  nodes_kept: number
  nodes_edited_before_keeping: number   // label or type changed before keeping
  nodes_skipped: number
}

function readAll(): ExtractionMetric[] {
  try {
    const raw = localStorage.getItem(KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? (arr as ExtractionMetric[]) : []
  } catch {
    return []
  }
}

// Append one extraction's outcome. Best-effort: a storage failure must never
// break Save My Place, so it is swallowed.
export function recordExtractionMetric(m: Omit<ExtractionMetric, 'at'>): void {
  try {
    const all = readAll()
    all.push({ at: new Date().toISOString(), ...m })
    localStorage.setItem(KEY, JSON.stringify(all))
    // Permanent audit line (not debug-only) proving the measurement ran.
    console.log('Extraction measured:', {
      proposed: m.nodes_proposed,
      kept: m.nodes_kept,
      edited: m.nodes_edited_before_keeping,
      skipped: m.nodes_skipped,
    })
  } catch (err) {
    console.warn('Extract: failed to record metric (non-fatal):', err)
  }
}

// Aggregate over all recorded extractions. Returns null until there is at least
// one, so callers can distinguish "no data yet" from "rate is 0".
export function summarizeExtractionMetrics(): {
  extractions: number
  totalProposed: number
  totalKept: number
  totalEdited: number
  acceptanceRate: number   // kept / proposed
  editRate: number         // edited / kept
} | null {
  const all = readAll()
  if (all.length === 0) return null
  const totalProposed = all.reduce((s, m) => s + m.nodes_proposed, 0)
  const totalKept = all.reduce((s, m) => s + m.nodes_kept, 0)
  const totalEdited = all.reduce((s, m) => s + m.nodes_edited_before_keeping, 0)
  return {
    extractions: all.length,
    totalProposed,
    totalKept,
    totalEdited,
    acceptanceRate: totalProposed === 0 ? 0 : totalKept / totalProposed,
    editRate: totalKept === 0 ? 0 : totalEdited / totalKept,
  }
}
