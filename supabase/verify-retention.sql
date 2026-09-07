-- Verification for sweep_inactive() — Task 10, Step 3 of
-- docs/superpowers/plans/2026-09-06-c-cloud-sync.md.
--
-- Run it through the Supabase MCP, not the dashboard SQL editor: the editor
-- mangles dollar-quoted bodies, and this file is one big dollar-quoted block.
--
-- The plan said to age one real user by 13 months and call the sweep. That
-- deletes a real account to prove a function works, and it only tests the one
-- case that is easy. This instead builds four synthetic accounts, sweeps once
-- and asserts on all four:
--
--   A  stale library, stale sign-in        -> deleted
--   B  stale library, signed in yesterday  -> survives   (greatest() works)
--   C  no library at all, stale sign-in    -> deleted     (the plan's join missed these)
--   D  no library, created yesterday       -> survives
--
-- It is one statement, so it is one transaction: a failed assertion raises and
-- unwinds the whole thing, test rows and sweep included. On success the block
-- removes the survivors itself, so a pass leaves the database exactly as it
-- was found. Safe to run against a database with real users in it — the only
-- accounts it can delete are its own and any real account that genuinely has
-- not been seen for twelve months, which is what the sweep is for.

do $verify$
declare
  inst uuid := '00000000-0000-0000-0000-000000000000';
  a uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  b uuid := 'bbbbbbbb-0000-4000-8000-00000000000b';
  c uuid := 'cccccccc-0000-4000-8000-00000000000c';
  d uuid := 'dddddddd-0000-4000-8000-00000000000d';
begin
  delete from auth.users where email like 'retention-test-%@example.invalid';

  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at, last_sign_in_at)
  values
    (a, inst, 'authenticated', 'authenticated', 'retention-test-a@example.invalid',
     now() - interval '14 months', now() - interval '13 months', now() - interval '13 months'),
    (b, inst, 'authenticated', 'authenticated', 'retention-test-b@example.invalid',
     now() - interval '14 months', now() - interval '1 day',    now() - interval '1 day'),
    (c, inst, 'authenticated', 'authenticated', 'retention-test-c@example.invalid',
     now() - interval '14 months', now() - interval '13 months', now() - interval '13 months'),
    (d, inst, 'authenticated', 'authenticated', 'retention-test-d@example.invalid',
     now() - interval '1 day',    now() - interval '1 day',      null);

  -- A and B get a library row that has not been synced for 13 months. C and D
  -- get none, which is the state of any account that signed in and never made
  -- a plan.
  insert into libraries (user_id, last_seen_at) values
    (a, now() - interval '13 months'),
    (b, now() - interval '13 months');

  perform sweep_inactive();

  if exists (select 1 from auth.users where id = a) then
    raise exception 'case A: stale library and stale sign-in should have been deleted';
  end if;

  if not exists (select 1 from auth.users where id = b) then
    raise exception 'case B: signed in yesterday, must survive a stale library row';
  end if;

  if exists (select 1 from auth.users where id = c) then
    raise exception 'case C: no library row and a stale sign-in should have been deleted';
  end if;

  if not exists (select 1 from auth.users where id = d) then
    raise exception 'case D: created yesterday, must survive';
  end if;

  -- The cascade is the other half of the promise: no orphaned library rows.
  if exists (select 1 from libraries where user_id in (a, c)) then
    raise exception 'cascade: library rows outlived their deleted accounts';
  end if;

  delete from auth.users where id in (b, d);

  raise notice 'sweep_inactive: 4/4';
end
$verify$;

-- Both numbers must be 0. The first says the test cleaned up after itself, the
-- second that no library row is left without an account to own it.
select
  (select count(*) from auth.users where email like 'retention-test-%@example.invalid') as test_rows_left,
  (select count(*) from libraries l
     where not exists (select 1 from auth.users u where u.id = l.user_id)) as orphaned_libraries;
