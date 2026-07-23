import { supabase, ensureSession } from './supabase'

// ─── Authenticated POST to our own AI proxies ───────────────────────────────
// The production endpoints (api/chat.ts, api/replay.ts) require a valid
// Supabase session and meter each call against a server-side daily budget, so
// every AI request must carry the caller's access token. Without it the
// endpoints correctly answer 401 — that is the guard working, not a bug.
//
// Locally (`vite dev`) the Vite middlewares in vite.config.ts answer instead
// and do not check auth, so development keeps working with or without
// Supabase configured.
export async function aiFetch(path: string, payload: unknown): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }

  if (supabase) {
    // Make sure a session exists (anonymous sign-in on first use), then attach
    // it. getSession() also refreshes an expired token.
    await ensureSession()
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (token) headers.authorization = `Bearer ${token}`
  }

  return fetch(path, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })
}
