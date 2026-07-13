import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Supabase cloud sync is optional. Without VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
// in .env.local, `supabase` is null and project sync is skipped — the app still runs
// fully on local state. Supply both vars to enable syncing to a Supabase project.
export const supabase =
  supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null

if (!supabase) {
  console.info('[supabase] No credentials set — cloud sync disabled (running local-only).')
}
