// ─── Shared guards for the PRODUCTION AI proxies ────────────────────────────
// api/chat.ts and api/replay.ts run on the public internet the moment a domain
// is attached. Without these guards they are an unauthenticated relay to a
// paid API: anyone who finds the URL can spend the project's credits, and the
// 50/day cap in src/lib/aiLimit.ts cannot stop them (it lives in localStorage,
// so it is trivially cleared or skipped entirely by calling the endpoint
// directly).
//
// Everything here FAILS CLOSED: missing config or a failed check refuses the
// request rather than relaying it.
//
// Files in api/ beginning with "_" are not routed by Vercel — helper only.

export interface Req {
  method?: string
  body?: unknown
  headers?: Record<string, string | string[] | undefined>
}

export interface Res {
  statusCode: number
  setHeader(name: string, value: string): void
  end(chunk?: string): void
}

export function send(res: Res, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(payload))
}

export const MAX_BODY_BYTES = 128 * 1024

function header(req: Req, name: string): string {
  const v = req.headers?.[name] ?? req.headers?.[name.toLowerCase()]
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '')
}

// Oversized payloads are a denial-of-wallet vector (they get forwarded to a
// metered API). 128KB is far above any legitimate Probe/Trace/Replay call.
export function bodyTooLarge(req: Req): boolean {
  const declared = Number(header(req, 'content-length') || '0')
  if (declared > MAX_BODY_BYTES) return true
  if (typeof req.body === 'string') {
    return req.body.length > MAX_BODY_BYTES
  }
  return false
}

// max_tokens is a direct cost lever, so it is never taken from the client
// verbatim.
export function clampMaxTokens(v: unknown, fallback: number, hard = 2000): number {
  const n = Number(v)
  const wanted = Number.isFinite(n) && n > 0 ? n : fallback
  return Math.min(Math.max(1, Math.floor(wanted)), hard)
}

// ─── LLM provider resolution (prod) ─────────────────────────────────────────
// Mirrors resolveLlmProvider() in vite.config.ts so dev and prod pick the same
// upstream from the same env vars. OPENROUTER_API_KEY wins if present (routing,
// fallbacks, model choice via OPENROUTER_MODEL); otherwise Groq's free model.
// Set these in the Vercel project's Environment Variables.
export interface LlmProvider { name: string; apiKey: string; baseUrl: string; model: string; headers: Record<string, string> }

// PER-TASK ROUTING: Trace needs a strong reasoning model (structured JSON, real
// connections); Probe/Replay need a clean NON-reasoning model that honours a
// terse "output only X" contract (reasoning models leak their chain-of-thought
// into the answer). `agent` selects which. Defaults suit the OpenRouter free
// tier (Gemma = clean/short; Nemotron = strong reasoning).
export function resolveLlmProvider(agent?: 'trace' | 'probe' | 'replay'): LlmProvider {
  const orKey = process.env.OPENROUTER_API_KEY
  if (orKey) {
    const base = process.env.OPENROUTER_MODEL || 'google/gemma-4-26b-a4b-it:free'
    const trace = process.env.OPENROUTER_TRACE_MODEL || base
    return {
      name: 'openrouter',
      apiKey: orKey,
      baseUrl: 'https://openrouter.ai/api/v1',
      model: agent === 'trace' ? trace : base,
      headers: { 'HTTP-Referer': process.env.PUBLIC_APP_URL || 'https://thread.app', 'X-Title': 'Thread' },
    }
  }
  return {
    name: 'groq',
    apiKey: process.env.GROQ_API_KEY ?? '',
    baseUrl: 'https://api.groq.com/openai/v1',
    // llama-3.3-70b-versatile was decommissioned by Groq (returns model_not_found)
    model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
    headers: {},
  }
}

export type Gate =
  | { ok: true }
  | { ok: false; status: number; error: string }

// Verify the caller's Supabase session, then atomically spend one unit of
// their server-side daily budget (see supabase/migrations/0002_ai_usage.sql).
// Both steps are mandatory — this is what makes the endpoint safe to expose.
export async function authorizeAndMeter(req: Req): Promise<Gate> {
  const url = process.env.SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY

  // Fail closed: never serve an unauthenticated, unmetered relay just because
  // the auth backend is unconfigured.
  if (!url || !anon) return { ok: false, status: 503, error: 'auth_not_configured' }

  const auth = header(req, 'authorization')
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!token) return { ok: false, status: 401, error: 'missing_token' }

  // 1. Is this a real, unexpired Supabase session?
  try {
    const r = await fetch(`${url}/auth/v1/user`, {
      headers: { authorization: `Bearer ${token}`, apikey: anon },
    })
    if (!r.ok) return { ok: false, status: 401, error: 'invalid_token' }
  } catch {
    return { ok: false, status: 503, error: 'auth_unreachable' }
  }

  // 2. Spend one call from today's budget. Enforced in Postgres, so clearing
  //    localStorage or POSTing here directly cannot get past it.
  try {
    const r = await fetch(`${url}/rest/v1/rpc/consume_ai_call`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        apikey: anon,
      },
      body: '{}',
    })
    if (!r.ok) return { ok: false, status: 503, error: 'budget_unavailable' }
    if ((await r.json()) !== true) {
      return { ok: false, status: 429, error: 'daily_limit_reached' }
    }
  } catch {
    return { ok: false, status: 503, error: 'budget_unavailable' }
  }

  return { ok: true }
}
