-- Cloud sync for Range Finder — one row per user, the whole plan library as
-- one jsonb document.
--
-- Design: docs/superpowers/specs/2026-09-06-c-cloud-sync-design.md
-- Plan:   docs/superpowers/plans/2026-09-06-c-cloud-sync.md
--
-- Applied by hand in the Supabase SQL editor. This file is the record of what
-- was applied — keep them in step, there is no migration tooling here.
--
-- Two things arrive in later tasks and are deliberately not in this file yet:
--   Task 5  sync_library()  — read, merge and write in one locked transaction
--   Task 10 sweep_inactive() + pg_cron — the 12-month retention rule
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
create policy "own row read"   on libraries for select using (auth.uid() = user_id);
create policy "own row update" on libraries for update using (auth.uid() = user_id);
create policy "own row insert" on libraries for insert with check (auth.uid() = user_id);

-- Retention sweeps scan by last_seen_at.
create index if not exists libraries_last_seen_idx on libraries (last_seen_at);
