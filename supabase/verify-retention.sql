-- Verification for the retention rule — Task 10 of
-- docs/superpowers/plans/2026-09-06-c-cloud-sync.md.
--
-- Run it through the Supabase MCP, not the dashboard SQL editor: the editor
-- mangles dollar-quoted bodies, and this file is one big dollar-quoted block.
--
-- Seven synthetic accounts, one sweep, assertions on all seven plus on the
-- four numbers retention_status() reports:
--
--   A  inactive 13 mdr, warned 40 days ago     -> deleted
--   B  inactive 13 mdr, warned 2 days ago      -> survives, still inside the 30-day grace
--   C  inactive 13 mdr, never warned           -> survives, and shows up as overdue_unwarned
--   D  inactive 11.5 mdr, never warned         -> survives, due a warning
--   E  active, seen yesterday                  -> survives, in no bucket
--   F  no library row, 13 mdr, warned 40 days  -> deleted
--   G  warned 40 days ago, then came back      -> survives, the stale warning does not count
--
-- C is the whole point of the gate: past the deletion date and alive only
-- because nobody warned it. G is the other half — a warning older than the
-- account's last activity is not a warning for this silence.
--
-- It is one statement, so it is one transaction: a failed assertion raises and
-- unwinds the whole thing, test rows and sweep included. On success the block
-- removes the survivors itself, so a pass leaves the database exactly as it
-- was found. Safe to run against a database with real users: the only accounts
-- it can delete are its own and any real account that is genuinely past twelve
-- months AND was warned more than thirty days ago, which is what the sweep is
-- for.

do $verify$
declare
  inst uuid := '00000000-0000-0000-0000-000000000000';
  a uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  b uuid := 'bbbbbbbb-0000-4000-8000-00000000000b';
  c uuid := 'cccccccc-0000-4000-8000-00000000000c';
  d uuid := 'dddddddd-0000-4000-8000-00000000000d';
  e uuid := 'eeeeeeee-0000-4000-8000-00000000000e';
  f uuid := 'ffffffff-0000-4000-8000-00000000000f';
  g uuid := '99999999-0000-4000-8000-000000000009';
  s_warn bigint; s_wait bigint; s_del bigint; s_overdue bigint;
begin
  delete from auth.users where email like 'retention-test-%@example.invalid';

  -- last_sign_in_at carries the inactivity for accounts without a library row,
  -- and has to be old on the rest too: the sweep takes greatest() of both, so a
  -- recent sign-in would keep every one of these alive and the test would pass
  -- for the wrong reason.
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at, last_sign_in_at)
  values
    (a, inst, 'authenticated', 'authenticated', 'retention-test-a@example.invalid',
     now() - interval '20 months', now() - interval '13 months', now() - interval '13 months'),
    (b, inst, 'authenticated', 'authenticated', 'retention-test-b@example.invalid',
     now() - interval '20 months', now() - interval '13 months', now() - interval '13 months'),
    (c, inst, 'authenticated', 'authenticated', 'retention-test-c@example.invalid',
     now() - interval '20 months', now() - interval '13 months', now() - interval '13 months'),
    (d, inst, 'authenticated', 'authenticated', 'retention-test-d@example.invalid',
     now() - interval '20 months', now() - interval '350 days', now() - interval '350 days'),
    (e, inst, 'authenticated', 'authenticated', 'retention-test-e@example.invalid',
     now() - interval '20 months', now() - interval '1 day', now() - interval '1 day'),
    (f, inst, 'authenticated', 'authenticated', 'retention-test-f@example.invalid',
     now() - interval '20 months', now() - interval '13 months', now() - interval '13 months'),
    (g, inst, 'authenticated', 'authenticated', 'retention-test-g@example.invalid',
     now() - interval '20 months', now() - interval '1 day', now() - interval '1 day');

  -- F deliberately gets none: an account that signed in and never synced.
  insert into libraries (user_id, last_seen_at) values
    (a, now() - interval '13 months'),
    (b, now() - interval '13 months'),
    (c, now() - interval '13 months'),
    (d, now() - interval '350 days'),
    (e, now() - interval '1 day'),
    (g, now() - interval '1 day');

  insert into retention_warnings (user_id, warned_at) values
    (a, now() - interval '40 days'),
    (b, now() - interval '2 days'),
    (f, now() - interval '40 days'),
    (g, now() - interval '40 days');

  select * into s_warn, s_wait, s_del, s_overdue from retention_status();

  if s_warn <> 2 then
    raise exception 'warn_due: expected 2 (C and D), got %', s_warn;
  end if;
  if s_wait <> 1 then
    raise exception 'warned_waiting: expected 1 (B), got %', s_wait;
  end if;
  if s_del <> 2 then
    raise exception 'delete_due: expected 2 (A and F), got %', s_del;
  end if;
  if s_overdue <> 1 then
    raise exception 'overdue_unwarned: expected 1 (C), got %', s_overdue;
  end if;

  perform sweep_inactive();

  if exists (select 1 from auth.users where id = a) then
    raise exception 'case A: past twelve months and warned forty days ago, should be gone';
  end if;
  if not exists (select 1 from auth.users where id = b) then
    raise exception 'case B: warned two days ago, must keep the thirty-day grace';
  end if;
  if not exists (select 1 from auth.users where id = c) then
    raise exception 'case C: never warned, must not be deleted — this is the gate';
  end if;
  if not exists (select 1 from auth.users where id = d) then
    raise exception 'case D: eleven and a half months, not due for deletion yet';
  end if;
  if not exists (select 1 from auth.users where id = e) then
    raise exception 'case E: seen yesterday, must survive';
  end if;
  if exists (select 1 from auth.users where id = f) then
    raise exception 'case F: no library row is not a reason to survive';
  end if;
  if not exists (select 1 from auth.users where id = g) then
    raise exception 'case G: came back after the warning, the stale warning must not count';
  end if;

  if exists (select 1 from libraries where user_id = a) then
    raise exception 'cascade: library row outlived its deleted account';
  end if;
  if exists (select 1 from retention_warnings where user_id in (a, f)) then
    raise exception 'cascade: warning row outlived its deleted account';
  end if;

  -- retention_warn_due is what the sender reads. It must offer C and D and
  -- nobody else: not B (warned and waiting), not G (warning is stale but the
  -- account is active), not E.
  if (select count(*) from retention_warn_due(50)) <> 2
     or not exists (select 1 from retention_warn_due(50) where user_id = c)
     or not exists (select 1 from retention_warn_due(50) where user_id = d) then
    raise exception 'retention_warn_due: expected exactly C and D';
  end if;

  delete from auth.users where id in (b, c, d, e, g);

  raise notice 'retention: 7/7 accounts, 4/4 status counts, warn_due correct';
end
$verify$;

-- All four must be 0: the test cleaned up after itself, no library or warning
-- row is left without an account to own it.
select
  (select count(*) from auth.users where email like 'retention-test-%@example.invalid') as test_users_left,
  (select count(*) from libraries l
     where not exists (select 1 from auth.users u where u.id = l.user_id)) as orphaned_libraries,
  (select count(*) from retention_warnings w
     where not exists (select 1 from auth.users u where u.id = w.user_id)) as orphaned_warnings,
  (select warn_due + warned_waiting + delete_due + overdue_unwarned from retention_status()) as status_all_zero;
