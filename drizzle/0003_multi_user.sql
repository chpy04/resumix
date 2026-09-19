-- Multi-user (T14). Every root-level row now belongs to exactly one user.
--
-- "Root-level" = the five tables that are not reachable from another table:
-- template, experience, project, technical_skill_row, resume. Everything
-- else infers its owner through its parent — bullets through their
-- experience/project, skills through their row, bridge rows and PDF
-- snapshots through their resume. Adding user_id to those too would create
-- a second, independently-writable source of truth for the same fact and
-- with it the possibility of the two disagreeing.
--
-- No begin/commit here: scripts/migrate.ts wraps each file in a transaction.

-- ---------------------------------------------------------------------------
-- users
--
-- Named `users`, not `user`, because `user` is a reserved word in Postgres
-- (`select user` returns current_user), which would force quoting forever.
--
-- No password column and there never will be one: authentication is
-- external (Supabase OAuth). `supabase_user_id` is the join key to
-- `auth.users.id` on the Supabase side, and stays null until that is wired
-- up — see lib/auth/supabase.ts.
-- ---------------------------------------------------------------------------

create table users (
  id               uuid primary key default gen_random_uuid(),
  email            text not null,
  name             text,
  supabase_user_id text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Email identity is case-insensitive: Chris@x.com and chris@x.com are one person.
create unique index ux_users_email_lower on users (lower(email));

-- Unique when present, unconstrained while null (pre-OAuth rows).
create unique index ux_users_supabase_user_id
  on users (supabase_user_id) where supabase_user_id is not null;

create trigger set_updated_at before update on users
for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- user_id on the five root tables
--
-- `on delete restrict`, not cascade: this project never deletes content
-- (D-011), and a cascade would fail anyway — experience_bullet references
-- experience with `on delete restrict`, so the cascade could not reach
-- through. Deleting a user is therefore a deliberate, manual operation, not
-- something a stray query can do.
-- ---------------------------------------------------------------------------

alter table template            add column user_id uuid references users (id) on delete restrict;
alter table experience          add column user_id uuid references users (id) on delete restrict;
alter table project             add column user_id uuid references users (id) on delete restrict;
alter table technical_skill_row add column user_id uuid references users (id) on delete restrict;
alter table resume              add column user_id uuid references users (id) on delete restrict;

-- ---------------------------------------------------------------------------
-- Backfill: adopt any pre-existing single-tenant data.
--
-- Before this migration the database held exactly one person's content with
-- nothing recording who that was. If any such rows exist, they are assigned
-- to a single placeholder user. Rename/re-email that row afterward — or, on
-- a dev box, just re-run `npm run db:seed -- --force`, which wipes and
-- reseeds under a properly-named user.
-- ---------------------------------------------------------------------------

do $$
declare
  legacy_owner_id uuid;
begin
  if exists (select 1 from template)
     or exists (select 1 from experience)
     or exists (select 1 from project)
     or exists (select 1 from technical_skill_row)
     or exists (select 1 from resume)
  then
    insert into users (email, name)
    values ('owner@localhost', 'Owner')
    returning id into legacy_owner_id;

    update template            set user_id = legacy_owner_id where user_id is null;
    update experience          set user_id = legacy_owner_id where user_id is null;
    update project             set user_id = legacy_owner_id where user_id is null;
    update technical_skill_row set user_id = legacy_owner_id where user_id is null;
    update resume              set user_id = legacy_owner_id where user_id is null;
  end if;
end $$;

alter table template            alter column user_id set not null;
alter table experience          alter column user_id set not null;
alter table project             alter column user_id set not null;
alter table technical_skill_row alter column user_id set not null;
alter table resume              alter column user_id set not null;

create index ix_template_user_id            on template (user_id);
create index ix_experience_user_id          on experience (user_id);
create index ix_project_user_id             on project (user_id);
create index ix_technical_skill_row_user_id on technical_skill_row (user_id);
create index ix_resume_user_id              on resume (user_id);

-- ---------------------------------------------------------------------------
-- "Only one default" becomes "only one default per user".
-- ---------------------------------------------------------------------------

drop index ux_template_one_default;
drop index ux_resume_one_default;

create unique index ux_template_one_default_per_user
  on template (user_id) where is_default = true;
create unique index ux_resume_one_default_per_user
  on resume (user_id) where is_default = true;
