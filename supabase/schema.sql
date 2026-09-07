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
-- deleted after 12. Both halves are here now, except the thing that actually
-- puts mail in the air: api/retention-warn.js is written and wired to a daily
-- Vercel Cron, but it no-ops until RESEND_API_KEY and RESEND_FROM exist.
--
-- The deletion is gated on the warning. sweep_inactive() will not touch an
-- account that has no warning on record and thirty days since it, so while the
-- sender is unconfigured the outcome is that nothing is deleted — not that
-- someone is deleted having never heard from us. That is the safe direction to
-- fail in, but it is still a promise unkept, so it is countable rather than
-- silent: retention_status().overdue_unwarned is the number of accounts past
-- the deletion date and alive only because nobody warned them. It should be 0.

create extension if not exists pg_cron;

-- One row per warned account, and a table rather than a column on libraries
-- because an account that signed in and never synced has no libraries row and
-- still has to be warnable. RLS on with no policies, like libraries: nothing
-- reaches this with anything but the service role.

create table if not exists retention_warnings (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  warned_at timestamptz not null default now(),
  email_id  text
);

comment on table retention_warnings is
  'One row per warned account. A separate table rather than a column on libraries because an account that signed in and never synced has no libraries row and still has to be warnable.';

alter table retention_warnings enable row level security;
revoke all on table retention_warnings from anon, authenticated;

-- ONE definition of "inactive", three consumers: the sweep, the status
-- readout, and the endpoint that sends the warning. Two definitions would
-- drift, and drift here means either mailing someone who is active or deleting
-- someone who was never warned. This project has already been bitten twice by
-- a document and a database disagreeing; this is the same class of mistake, so
-- the expression exists exactly once.
--
-- greatest() over both signals rather than last_seen_at alone: last_seen_at is
-- touched on every sync and is the sharper one, but if the sync loop ever
-- stops touching it, an active account would read as silent. coalesce() to
-- created_at because an account with no libraries row still has to be counted
-- — the plan's version joined libraries and would have left those standing
-- forever, holding the one thing the policy promises to remove.

create or replace view retention_accounts as
select
  u.id    as user_id,
  u.email::text as email,
  greatest(coalesce(l.last_seen_at, u.created_at),
           coalesce(u.last_sign_in_at, u.created_at)) as inactive_since,
  w.warned_at as warned_at
from auth.users u
left join libraries l          on l.user_id = u.id
left join retention_warnings w on w.user_id = u.id;

-- The view reads auth.users and carries email addresses. It runs with the
-- owner's rights, so it must not be reachable by anon or authenticated.
revoke all on retention_accounts from public, anon, authenticated;
grant select on retention_accounts to service_role;

-- `warned_at >= inactive_since` is the rule that handles a user who came back.
-- Sign in again and inactive_since jumps forward past the old warning, so the
-- stale warning stops counting and a fresh silence needs a fresh warning. It
-- is also why retention_warnings is never cleaned up on sync: it does not need
-- to be, and a delete inside sync_library would be one more write on the hot
-- path that could fail quietly.
--
-- Thirty days is the gap the policy itself describes — warned at eleven
-- months, deleted at twelve. It is measured from the warning rather than from
-- the eleven-month mark so that an account warned late still gets its month.
--
-- No security definer, unlike sync_library. pg_cron runs the job as postgres,
-- which already has the rights, and a security-definer mass delete reachable
-- over PostgREST is exactly the door the sync_library revoke exists to shut.
-- The revoke below is the second lock, and it includes service_role: Supabase
-- grants it EXECUTE on every new function in public by default, and no
-- endpoint calls this — only cron does.

create or replace function sweep_inactive()
returns void
language plpgsql
set search_path = ''
as $$
begin
  delete from auth.users u
   using public.retention_accounts a
   where a.user_id = u.id
     and a.inactive_since < now() - interval '12 months'
     and a.warned_at is not null
     and a.warned_at >= a.inactive_since
     and a.warned_at <= now() - interval '30 days';
end;
$$;

revoke all on function sweep_inactive() from public, anon, authenticated, service_role;

-- What the sender reads. It deliberately does NOT stop at twelve months: if
-- the sender has been down, accounts drift past the deletion date unwarned,
-- and a window that ended at twelve months would never warn them — so they
-- would live forever and the policy would silently never apply to them. Warn
-- everything quiet for eleven months or more that has no current warning, and
-- let the thirty days run from there.

create or replace function retention_warn_due(p_limit int default 50)
returns table(user_id uuid, email text)
language sql
set search_path = ''
as $$
  select a.user_id, a.email
    from public.retention_accounts a
   where a.inactive_since < now() - interval '11 months'
     and (a.warned_at is null or a.warned_at < a.inactive_since)
   order by a.inactive_since
   limit p_limit;
$$;

revoke all on function retention_warn_due(int) from public, anon, authenticated;
grant execute on function retention_warn_due(int) to service_role;

-- Called by the endpoint only after Resend has accepted the mail, never
-- before. Recording first would let a failed send count as a warning, and
-- thirty days later the account goes without anyone having heard from us.

create or replace function retention_mark_warned(p_user_id uuid, p_email_id text default null)
returns void
language sql
set search_path = ''
as $$
  insert into public.retention_warnings (user_id, warned_at, email_id)
  values (p_user_id, now(), p_email_id)
  on conflict (user_id) do update set warned_at = now(), email_id = excluded.email_id;
$$;

revoke all on function retention_mark_warned(uuid, text) from public, anon, authenticated;
grant execute on function retention_mark_warned(uuid, text) to service_role;

-- The readout that keeps the gap from being silent.
--
--   warn_due          quiet 11 months or more, no current warning -> should get mail
--   warned_waiting    warned, inside the thirty days              -> nothing to do
--   delete_due        past 12 months, warned, thirty days passed   -> next sweep takes these
--   overdue_unwarned  past 12 months, never warned                 -> MUST BE 0
--
-- warn_due and overdue_unwarned overlap on purpose: overdue_unwarned is the
-- subset already past the deletion date, alive only because the gate is
-- holding. A number above zero means the sender is not running.

create or replace function retention_status()
returns table(warn_due bigint, warned_waiting bigint, delete_due bigint, overdue_unwarned bigint)
language sql
set search_path = ''
as $$
  select
    count(*) filter (where a.inactive_since < now() - interval '11 months'
                       and (a.warned_at is null or a.warned_at < a.inactive_since)),
    count(*) filter (where a.warned_at is not null
                       and a.warned_at >= a.inactive_since
                       and a.warned_at > now() - interval '30 days'),
    count(*) filter (where a.inactive_since < now() - interval '12 months'
                       and a.warned_at is not null
                       and a.warned_at >= a.inactive_since
                       and a.warned_at <= now() - interval '30 days'),
    count(*) filter (where a.inactive_since < now() - interval '12 months'
                       and (a.warned_at is null or a.warned_at < a.inactive_since))
  from public.retention_accounts a;
$$;

revoke all on function retention_status() from public, anon, authenticated;
grant execute on function retention_status() to service_role;

-- 03:00 on the first of the month. pg_cron reads cron expressions in UTC, not
-- Europe/Copenhagen — it drifts an hour with daylight saving and that is fine
-- for a monthly sweep. Named schedules upsert, so re-running this file does
-- not stack duplicate jobs. Whether a run happened, and whether it failed, is
-- in cron.job_run_details.
--
-- The warning runs daily from Vercel Cron (see vercel.json), so by the time
-- this monthly sweep fires, anyone due has had their thirty days.
select cron.schedule('sweep-inactive', '0 3 1 * *', 'select public.sweep_inactive()');

-- Verification: supabase/verify-retention.sql — seven accounts, four status
-- counts, one sweep. Applied and verified against the production database
-- 2026-09-07: 7/7 and 4/4.

-- Make PostgREST pick the change up now rather than whenever it next notices.
notify pgrst, 'reload schema';
