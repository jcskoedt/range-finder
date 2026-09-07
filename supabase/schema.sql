-- Cloud sync for Range Finder — one row per user, the whole plan library as
-- one jsonb document.
--
-- Design: docs/superpowers/specs/2026-09-06-c-cloud-sync-design.md
-- Plan:   docs/superpowers/plans/2026-09-06-c-cloud-sync.md
--
-- Applied by hand in the Supabase SQL editor. This file is the record of what
-- was applied — keep them in step, there is no migration tooling here.
--
-- Order in this file follows the plan: the table, sync_library() (Task 5), and
-- the retention rule (Task 10) last.
--
-- Why one table and no relations: nothing is ever queried across plans or
-- across users. A relational schema would buy nothing and cost a migration
-- every time the plan shape changes, and the plan shape changed three times in
-- two days. A 100-session plan is 6,917 bytes of JSON; ten plans is ~70 KB.

create table if not exists libraries (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  doc          jsonb       not null default '{"v":1,"plans":{},"tombstones":{}}'::jsonb,
  version      bigint      not null default 1,
  updated_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

comment on column libraries.version is
  'Bumped on every write. The client sends the version it last saw as baseVersion; a mismatch means someone else wrote and the document must be merged rather than replaced.';
comment on column libraries.last_seen_at is
  'Touched on every sync. Drives the retention sweep — 12 months of silence and the account goes.';

alter table libraries enable row level security;

-- The endpoint talks to this table with the service role and bypasses RLS, so
-- these policies are not what makes the feature work. They exist so that a
-- mistake elsewhere — an anon key used directly, a future client-side query —
-- cannot read or write another user's library.
--
-- >>> THESE THREE ARE NOT IN THE DATABASE. <<<
--
-- Found 2026-09-07 by Supabase's own advisor while Task 10 was being applied,
-- then confirmed in pg_policies: RLS is on, policy_count is 0. They were never
-- applied, and this file said otherwise for a day — the same failure the
-- handoff already records about the merge gate, a document describing a shape
-- nobody has.
--
-- Left unapplied on purpose rather than run in a hurry. RLS with no policies
-- denies anon and authenticated everything, which is stricter than these
-- policies, and nothing needs them yet: no code path touches this table with
-- anything but the service role. Apply them the day something does — the
-- profile page is the likely first — and not before, because a policy with no
-- consumer is access granted to nobody's benefit.
--
-- If a client-side query ever fails here with a permission error, this is why,
-- and the fix is to run these three, never to turn RLS off.

-- create policy "own row read"   on libraries for select using (auth.uid() = user_id);
-- create policy "own row update" on libraries for update using (auth.uid() = user_id);
-- create policy "own row insert" on libraries for insert with check (auth.uid() = user_id);

-- Retention sweeps scan by last_seen_at.
create index if not exists libraries_last_seen_idx on libraries (last_seen_at);

-- ---------------------------------------------------------------------------
-- Task 5: read, compare and write in one locked transaction.
--
-- The row lock is the point. Without `for update`, two devices syncing in the
-- same moment each read the pre-write state, and the second write discards the
-- first one's work with no error anywhere.
--
-- This function does NOT merge. Merging lives in api/sync.js so that
-- scripts/validate-sync.mjs can test it without a database. On a conflict this
-- returns the server's document untouched and says so; the endpoint merges and
-- calls again.

create or replace function sync_library(p_user_id uuid, p_doc jsonb, p_base_version bigint)
returns table(doc jsonb, version bigint, conflict boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  cur_doc jsonb;
  cur_ver bigint;
begin
  select l.doc, l.version into cur_doc, cur_ver
    from libraries l where l.user_id = p_user_id for update;

  if not found then
    insert into libraries (user_id, doc, version) values (p_user_id, p_doc, 1);
    return query select p_doc, 1::bigint, false;
    return;
  end if;

  -- Equal versions mean the client had already seen everything on the server,
  -- so its document is authoritative and no merge is needed.
  if cur_ver = p_base_version then
    update libraries set doc = p_doc, version = cur_ver + 1,
                         updated_at = now(), last_seen_at = now()
      where user_id = p_user_id;
    return query select p_doc, cur_ver + 1, false;
  else
    -- conflict is a separate column on purpose. Both outcomes come back with a
    -- version different from p_base_version — one because it was bumped, one
    -- because the server was ahead — so the caller cannot tell them apart from
    -- the number alone.
    return query select cur_doc, cur_ver, true;
  end if;
end;
$$;

-- Shut the door on the anon key: without this, anyone holding it could call the
-- function directly with someone else's p_user_id, and security definer means
-- RLS would not stop them.
revoke all on function sync_library(uuid, jsonb, bigint) from public, anon, authenticated;

-- And open it again for the endpoint. Postgres grants EXECUTE to PUBLIC by
-- default and service_role inherits that rather than being a superuser, so the
-- revoke above takes it away too. PostgREST then reports the function as
-- "not found in schema cache" rather than as a permission error, which reads
-- like the function is missing from a database where it plainly exists.
grant execute on function sync_library(uuid, jsonb, bigint) to service_role;

-- ---------------------------------------------------------------------------
-- Task 10: the retention rule.
--
-- /privacy promises that an inactive account is warned after 11 months and
-- deleted after 12. Only the deletion half is here. The warning is an Edge
-- Function that needs Resend, so until that exists the page promises a mail
-- nobody sends. Nothing is at risk yet — the sweep cannot reach an account
-- until 12 months after its last sign-in and the database has no users — but
-- the warning has to exist before the first account gets that old.

create extension if not exists pg_cron;

-- Two deliberate departures from the plan's version of this function.
--
-- The plan wrote `delete from auth.users u using libraries l where
-- l.user_id = u.id and l.last_seen_at < ...`. A user who signs in and never
-- makes a plan has no libraries row, so that join never matches them and the
-- account stands forever holding an email address — the one thing the policy
-- promises to get rid of. coalesce() falls back to the account's own dates.
--
-- And greatest() over both signals, not last_seen_at alone: last_seen_at is
-- touched on every sync and is the sharper signal, but if the sync loop ever
-- stops touching it, an active account would look silent. An account survives
-- if either signal is recent. Deleting someone's data by accident is the
-- failure that cannot be undone, so the rule leans that way on purpose.
--
-- No security definer, unlike sync_library. pg_cron runs the job as postgres,
-- which already has the rights, and a security-definer mass-delete reachable
-- over PostgREST is exactly the door the sync_library revoke exists to shut.
-- The revoke below is the second lock: without it PUBLIC keeps the EXECUTE
-- that Postgres grants by default.

create or replace function sweep_inactive()
returns void
language plpgsql
set search_path = ''
as $$
begin
  delete from auth.users u
   where greatest(
           coalesce((select l.last_seen_at from public.libraries l
                      where l.user_id = u.id), u.created_at),
           coalesce(u.last_sign_in_at, u.created_at)
         ) < now() - interval '12 months';
end;
$$;

revoke all on function sweep_inactive() from public, anon, authenticated;

-- And from service_role, unlike sync_library. Supabase's default privileges
-- hand service_role EXECUTE on every new function in public, so the revoke
-- above left it holding a mass delete it has no use for — no endpoint calls
-- this, only cron does, as postgres. The service key can already delete rows
-- directly, so this is not a hole being closed; it is one fewer thing a leaked
-- key can reach in a single call. Verified in pg_proc.proacl afterwards:
-- {postgres=X/postgres}, nothing else.
revoke all on function sweep_inactive() from service_role;

-- 03:00 on the first of the month. pg_cron reads cron expressions in UTC, not
-- Europe/Copenhagen — it drifts an hour with daylight saving and that is fine
-- for a monthly sweep. Named schedules upsert, so re-running this file does
-- not stack duplicate jobs. Whether a run happened, and whether it failed,
-- is in cron.job_run_details.
select cron.schedule('sweep-inactive', '0 3 1 * *', 'select public.sweep_inactive()');

-- Verification: supabase/verify-retention.sql, four cases, run by hand.
-- Applied and verified against the production database 2026-09-07: 4/4.

-- Make PostgREST pick the change up now rather than whenever it next notices.
notify pgrst, 'reload schema';
