import { createClient } from '@supabase/supabase-js'

// Optional chaining so this module is importable outside Vite too (e.g. the
// tsx eval harness, where import.meta.env is undefined) — it just yields null.
const supabaseUrl = import.meta.env?.VITE_SUPABASE_URL
const supabaseKey = import.meta.env?.VITE_SUPABASE_ANON_KEY

// Supabase cloud sync is optional. Without VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
// in .env.local, `supabase` is null and project sync is skipped - the app still runs
// fully on local state. Supply both vars to enable syncing to a Supabase project.
//
// The anon key is PUBLIC by design (it ships in the browser bundle). It is only
// safe because row level security is enabled on every table and each policy is
// scoped to auth.uid() - see supabase/migrations/0001_init.sql. Never put a
// service-role key here.
export const supabase =
  supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null

if (!supabase) {
  console.info('[supabase] No credentials set - cloud sync disabled (running local-only).')
}

// ─── Anonymous auth ───────────────────────────────────────────────────────────
// Every visitor silently gets a real auth user, so RLS can scope their rows to
// them without a signup step. The session persists in localStorage, so the same
// browser keeps the same identity across reloads. Upgrading to email later
// (supabase.auth.updateUser) keeps the same user id, so no data is orphaned.
let sessionPromise: Promise<string | null> | null = null

export function ensureSession(): Promise<string | null> {
  if (!supabase) return Promise.resolve(null)
  // Cache in-flight/resolved result so concurrent callers share one sign-in.
  if (sessionPromise) return sessionPromise

  sessionPromise = (async () => {
    try {
      const { data: { session } } = await supabase!.auth.getSession()
      if (session?.user) return session.user.id

      const { data, error } = await supabase!.auth.signInAnonymously()
      if (error) {
        // Most common cause: anonymous sign-ins are disabled in the Supabase
        // dashboard (Authentication → Providers → Anonymous). Degrade to
        // local-only rather than breaking the app.
        console.warn('[supabase] anonymous sign-in failed - running local-only:', error.message)
        return null
      }
      return data.user?.id ?? null
    } catch (err) {
      console.warn('[supabase] auth unavailable - running local-only:', (err as Error).message)
      return null
    }
  })()

  return sessionPromise
}
