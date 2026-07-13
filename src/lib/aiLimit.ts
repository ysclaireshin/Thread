// ─── AI daily call cap ─────────────────────────────────────────────────────────
// A single daily budget shared across every AI call site in the app (Probe +
// Flow's Replay). Enforced client-side in localStorage.
//
// NOTE ON "per user": this app has no authentication — all state lives in
// localStorage, one bucket per browser — so the cap is enforced per device,
// not per account. If real auth is added later, key this by user id instead.
// 50/day comfortably covers deliberate, human-paced use of two rarely-fired
// features while capping runaway/automated usage.

const KEY = 'thread_ai_usage'
export const AI_DAILY_LIMIT = 50
export const AI_LIMIT_MESSAGE = 'Daily limit reached — resets tomorrow'

interface Usage { date: string; count: number }

// Local calendar day (so "resets tomorrow" matches the user's own midnight).
function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

function read(): Usage {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const u = JSON.parse(raw) as Usage
      if (u.date === today()) return u
    }
  } catch { /* fall through to a fresh bucket */ }
  return { date: today(), count: 0 }
}

// Atomically check the daily cap and, if under it, record one call. Returns
// true if the call is permitted (and was just counted), false if the daily
// limit is already reached. Only AI calls consult this — no other feature does,
// so hitting the cap never blocks the rest of the app.
export function tryConsumeAiCall(): boolean {
  const u = read()
  if (u.count >= AI_DAILY_LIMIT) return false
  localStorage.setItem(KEY, JSON.stringify({ date: u.date, count: u.count + 1 }))
  return true
}
