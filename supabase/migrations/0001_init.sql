-- ═══════════════════════════════════════════════════════════════════════════
-- Thread — initial schema (run this in the Supabase SQL Editor)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- DESIGN: one row per project, with the whole ThreadProject stored in a JSONB
-- `data` column. Deliberate choice over relational node/edge tables because:
--   * it covers EVERY field automatically — the previous relational sync silently
--     dropped edges, textAnchors, draftText, dismissedPairs, greetingStyle and
--     the focus/cursor fields
--   * no delete-then-insert race on every save
--   * it mirrors exactly what the app already serialises to localStorage
-- At MVP scale (hundreds of nodes per project) this is more than adequate. If you
-- later need server-side queries across nodes, add projected tables then.
--
-- SECURITY: row level security is ON and every policy is scoped to auth.uid().
-- The browser holds only the anon key, so without these policies any visitor
-- could read/overwrite everyone's projects. Do not skip this section.
--
-- NOTE: if you previously created `projects` / `nodes` tables from the earlier
-- write-only sync, drop them first (they were never populated — no credentials
-- were ever set). Uncomment only if you are sure they hold nothing you want:
--   drop table if exists public.nodes;
--   drop table if exists public.projects;

create table if not exists public.projects (
  -- text, not uuid: older project ids use a 'proj-<timestamp>' form.
  id          text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null default 'Untitled',
  -- The full ThreadProject object (nodes, edges, textAnchors, draftText,
  -- dismissedPairs, focus/cursor state, currentSession, ...).
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

create index if not exists projects_user_id_idx on public.projects (user_id);
create index if not exists projects_updated_at_idx on public.projects (updated_at desc);

-- ─── Row level security ─────────────────────────────────────────────────────
alter table public.projects enable row level security;

drop policy if exists "projects_select_own" on public.projects;
create policy "projects_select_own"
  on public.projects for select
  using (auth.uid() = user_id);

drop policy if exists "projects_insert_own" on public.projects;
create policy "projects_insert_own"
  on public.projects for insert
  with check (auth.uid() = user_id);

drop policy if exists "projects_update_own" on public.projects;
create policy "projects_update_own"
  on public.projects for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "projects_delete_own" on public.projects;
create policy "projects_delete_own"
  on public.projects for delete
  using (auth.uid() = user_id);

-- ─── Feedback (early-access MVP) ────────────────────────────────────────────
-- Anyone signed in (including anonymous users) may submit feedback; nobody can
-- read it back from the client. Read it in the Supabase dashboard.
create table if not exists public.feedback (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users (id) on delete set null,
  message     text not null,
  context     jsonb,
  created_at  timestamptz not null default now()
);

alter table public.feedback enable row level security;

drop policy if exists "feedback_insert_any_authed" on public.feedback;
create policy "feedback_insert_any_authed"
  on public.feedback for insert
  with check (auth.uid() is not null);
