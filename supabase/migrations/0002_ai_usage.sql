-- ═══════════════════════════════════════════════════════════════════════════
-- Thread — server-side AI budget (run this in the Supabase SQL Editor)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHY: src/lib/aiLimit.ts caps AI calls at 50/day, but it does so in
-- localStorage — a user can clear it, or skip the UI entirely and POST
-- straight at /api/chat. That makes the proxy an unauthenticated relay to a
-- PAID API. This table + function move the budget server-side, where the
-- client cannot reach it. The localStorage cap stays as a UX affordance (it
-- shows "limit reached" without a round-trip); this is the real enforcement.

create table if not exists public.ai_usage (
  user_id  uuid not null references auth.users (id) on delete cascade,
  day      date not null,
  count    int  not null default 0,
  primary key (user_id, day)
);

-- Global daily counter. This is the DENIAL-OF-WALLET BACKSTOP: the per-user cap
-- above is defeatable because supabase.auth.signInAnonymously() lets anyone mint
-- unlimited fresh identities, each with its own clean per-user budget. A global
-- ceiling bounds total spend for the whole project per day regardless of how
-- many identities an attacker farms. Tune global_daily_limit to your budget.
create table if not exists public.ai_usage_global (
  day    date primary key,
  count  int not null default 0
);

alter table public.ai_usage enable row level security;
alter table public.ai_usage_global enable row level security;

-- Deliberately NO policies on either table: the browser must never read or write
-- them directly. With RLS on and no policy, every client request is denied. The
-- only access path is the SECURITY DEFINER function below.

-- Atomically consume one unit of BOTH today's per-user budget and the global
-- daily budget. Returns true only if both are under their caps. Each upsert is a
-- single statement, so concurrent calls cannot race past either cap.
create or replace function public.consume_ai_call(
  daily_limit        int default 50,
  global_daily_limit int default 5000
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid         uuid := auth.uid();
  d           date := (now() at time zone 'utc')::date;
  user_count  int;
  total_count int;
begin
  -- No session → no budget. Blocks unauthenticated callers outright.
  if uid is null then
    return false;
  end if;

  -- Global ceiling first: this is the hard wallet bound.
  insert into public.ai_usage_global as g (day, count)
  values (d, 1)
  on conflict (day)
  do update set count = g.count + 1
  returning g.count into total_count;
  if total_count > global_daily_limit then
    return false;
  end if;

  -- Per-user budget.
  insert into public.ai_usage as u (user_id, day, count)
  values (uid, d, 1)
  on conflict (user_id, day)
  do update set count = u.count + 1
  returning u.count into user_count;

  return user_count <= daily_limit;
end;
$$;

-- Only signed-in callers may invoke it; anon callers hit the auth.uid() guard
-- above and are refused anyway.
revoke all on function public.consume_ai_call(int, int) from public;
grant execute on function public.consume_ai_call(int, int) to authenticated;
