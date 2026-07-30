import { supabase, ensureSession } from './supabase'
import type { ThreadProject } from '../types'

// ─── Cloud sync ───────────────────────────────────────────────────────────────
// One row per project; the whole ThreadProject lives in a JSONB `data` column
// (see supabase/migrations/0001_init.sql for why). Every call is a no-op when
// Supabase isn't configured or anonymous auth is unavailable, so the app always
// works local-only as a fallback.
//
// Writes are DEBOUNCED. The store's subscribe fires on every keystroke; syncing
// on each one would mean dozens of writes per second. We coalesce to one write
// per project per SAVE_DEBOUNCE_MS, trailing edge.

const SAVE_DEBOUNCE_MS = 1500

const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>()
const pendingProjects = new Map<string, ThreadProject>()

async function writeProject(project: ThreadProject): Promise<void> {
  if (!supabase) return
  const userId = await ensureSession()
  if (!userId) return

  const { error } = await supabase
    .from('projects')
    .upsert({
      id: project.id,
      user_id: userId,
      name: project.name,
      data: project,
      updated_at: new Date().toISOString(),
    })

  if (error) {
    console.warn('[supabase] project save failed:', error.message, error.hint ?? '')
  }
}

/** Queue a debounced cloud save. Safe to call on every store change. */
export function saveProject(project: ThreadProject): void {
  if (!supabase || !project?.id) return

  pendingProjects.set(project.id, project)

  const existing = pendingTimers.get(project.id)
  if (existing) clearTimeout(existing)

  pendingTimers.set(
    project.id,
    setTimeout(() => {
      pendingTimers.delete(project.id)
      const latest = pendingProjects.get(project.id)
      pendingProjects.delete(project.id)
      if (latest) void writeProject(latest)
    }, SAVE_DEBOUNCE_MS),
  )
}

/** Flush any queued save immediately (used on tab hide / before unload). */
export function flushPendingSaves(): void {
  for (const [id, timer] of pendingTimers) {
    clearTimeout(timer)
    const latest = pendingProjects.get(id)
    pendingProjects.delete(id)
    if (latest) void writeProject(latest)
  }
  pendingTimers.clear()
}

/**
 * Read every project belonging to the current (anonymous) user.
 * Returns null when cloud sync is unavailable - callers should then stay local.
 * This is the read path the previous write-only sync was missing entirely.
 */
export async function loadProjects(): Promise<ThreadProject[] | null> {
  if (!supabase) return null
  const userId = await ensureSession()
  if (!userId) return null

  const { data, error } = await supabase
    .from('projects')
    .select('id, data, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })

  if (error) {
    console.warn('[supabase] project load failed:', error.message)
    return null
  }

  return (data ?? [])
    .map(row => row.data as ThreadProject)
    .filter((p): p is ThreadProject => !!p && typeof p === 'object' && !!p.id)
}

/** Fire-and-forget feedback from the in-app widget. */
export async function submitFeedback(message: string, context?: unknown): Promise<boolean> {
  if (!supabase) return false
  const userId = await ensureSession()
  const { error } = await supabase
    .from('feedback')
    .insert({ user_id: userId, message, context: context ?? null })
  if (error) {
    console.warn('[supabase] feedback submit failed:', error.message)
    return false
  }
  return true
}
