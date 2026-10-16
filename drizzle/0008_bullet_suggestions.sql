-- Bullet suggestions: the agent's proposed edits and additions to bullets,
-- held beside an application until Chris applies or rejects them (D-045).
--
-- The agent never writes to the library (D11, R2). What it would change is a
-- row here instead, in plain text, and only Chris's click in review turns it
-- into a library edit, a new bullet or a selection change. A row is never
-- deleted: once resolved it keeps its status as the record of what he did.
--
-- Additive only: one new table and three new types, none of which existing
-- code reads.
--
-- No begin/commit here: scripts/migrate.ts wraps each file in a transaction.
-- Using the new types in this same file is safe; the "unsafe use of new
-- value" error is about `alter type … add value`, not `create type`.

create type bullet_suggestion_kind as enum ('edit', 'add');
create type bullet_kind as enum ('experience', 'project');
create type bullet_suggestion_status as enum ('pending', 'applied', 'copied', 'rejected');

-- ---------------------------------------------------------------------------
-- bullet_suggestion
--
-- No `user_id`: the owner is inherited through `application_id`, like every
-- other non-root table (D-018).
--
-- `bullet_id` and `parent_id` have no foreign keys because each points at one
-- of two tables, chosen by `bullet_kind`: an edit's bullet is an
-- `experience_bullet` or a `project_bullet`, an addition's parent an
-- `experience` or a `project`. Content is never deleted (D-011), so the
-- target cannot vanish, and the query layer re-checks ownership through it
-- every time a suggestion is used.
--
-- `position` is where an addition goes among the parent's bullets that this
-- resume shows: 0 is first, and one past the last is last.
-- ---------------------------------------------------------------------------

create table bullet_suggestion (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references application (id) on delete cascade,
  kind           bullet_suggestion_kind not null,
  bullet_kind    bullet_kind not null,
  bullet_id      uuid,
  parent_id      uuid,
  position       integer,
  -- Plain text, one line, escaped only when it reaches LaTeX (R3).
  proposed_text  text not null,
  rationale      text not null,
  status         bullet_suggestion_status not null default 'pending',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- An edit names the bullet it changes; an addition names its parent and
  -- its slot. Never both. `position is not null` is spelled out because a
  -- null `position >= 0` is null, and a CHECK lets null through.
  constraint ck_bullet_suggestion_target check (
    (kind = 'edit' and bullet_id is not null and parent_id is null and position is null)
    or (kind = 'add' and bullet_id is null and parent_id is not null
        and position is not null and position >= 0)
  ),
  constraint ck_bullet_suggestion_text check (
    btrim(proposed_text) <> '' and btrim(rationale) <> ''
  )
);

create index ix_bullet_suggestion_application_id
  on bullet_suggestion (application_id, created_at);

-- One pending edit per bullet per application: a second one replaces the
-- first. Additions have a null `bullet_id`, and nulls never collide.
create unique index ux_bullet_suggestion_pending_edit
  on bullet_suggestion (application_id, bullet_id)
  where status = 'pending';

create trigger set_updated_at before update on bullet_suggestion
for each row execute function set_updated_at();
