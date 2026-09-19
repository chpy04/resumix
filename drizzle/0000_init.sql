-- Resumix initial schema. Hand-written (not drizzle-kit generate) so it stays
-- reviewable. Must match lib/db/schema.ts exactly. See docs/SCHEMA.md.
--
-- gen_random_uuid() has been built into Postgres core since PG13, so no
-- extension (pgcrypto) is required on our PG17 target.
--
-- No begin/commit here: scripts/migrate.ts wraps each file in a transaction.

-- ---------------------------------------------------------------------------
-- Shared trigger: every table's updated_at is bumped to now() on any UPDATE.
-- ---------------------------------------------------------------------------

create function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- Content tables (global, shared by every resume)
-- ---------------------------------------------------------------------------

create table template (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  content     text not null,
  is_default  boolean not null default false,
  is_archived boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- At most one default template.
create unique index ux_template_one_default on template (is_default) where is_default = true;

create trigger set_updated_at before update on template
for each row execute function set_updated_at();

create table experience (
  id          uuid primary key default gen_random_uuid(),
  company     text not null,
  title       text not null,
  date_range  text not null,
  location    text not null,
  is_archived boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger set_updated_at before update on experience
for each row execute function set_updated_at();

create table experience_bullet (
  id            uuid primary key default gen_random_uuid(),
  experience_id uuid not null references experience (id) on delete restrict,
  content       text not null,
  is_archived   boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index ix_experience_bullet_experience_id on experience_bullet (experience_id);

create trigger set_updated_at before update on experience_bullet
for each row execute function set_updated_at();

create table project (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  technologies text not null,
  date_range  text not null,
  is_archived boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger set_updated_at before update on project
for each row execute function set_updated_at();

create table project_bullet (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references project (id) on delete restrict,
  content     text not null,
  is_archived boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index ix_project_bullet_project_id on project_bullet (project_id);

create trigger set_updated_at before update on project_bullet
for each row execute function set_updated_at();

create table technical_skill_row (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  top         boolean not null default true,
  is_archived boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger set_updated_at before update on technical_skill_row
for each row execute function set_updated_at();

create table technical_skill (
  id                     uuid primary key default gen_random_uuid(),
  technical_skill_row_id uuid not null references technical_skill_row (id) on delete restrict,
  name                   text not null,
  is_archived            boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index ix_technical_skill_technical_skill_row_id on technical_skill (technical_skill_row_id);

create trigger set_updated_at before update on technical_skill
for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Resume
-- ---------------------------------------------------------------------------

create table resume (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  is_default  boolean not null default false,
  template_id uuid not null references template (id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- At most one default resume.
create unique index ux_resume_one_default on resume (is_default) where is_default = true;
create index ix_resume_template_id on resume (template_id);

create trigger set_updated_at before update on resume
for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Bridge tables — selection *and* ordering. Presence of a row means
-- "selected". Composite PK of the two FKs, plus sort_order. All bridge FKs
-- are on delete cascade so deleting a resume cleans up; content is never
-- deleted so the content-side cascade never fires in practice. Timestamps
-- included on bridge tables too, for consistency with every other table.
-- ---------------------------------------------------------------------------

create table resume_experience (
  resume_id     uuid not null references resume (id) on delete cascade,
  experience_id uuid not null references experience (id) on delete cascade,
  sort_order    integer not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (resume_id, experience_id)
);

create trigger set_updated_at before update on resume_experience
for each row execute function set_updated_at();

create table resume_experience_bullet (
  resume_id            uuid not null references resume (id) on delete cascade,
  experience_bullet_id uuid not null references experience_bullet (id) on delete cascade,
  sort_order           integer not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  primary key (resume_id, experience_bullet_id)
);

create trigger set_updated_at before update on resume_experience_bullet
for each row execute function set_updated_at();

create table resume_project (
  resume_id  uuid not null references resume (id) on delete cascade,
  project_id uuid not null references project (id) on delete cascade,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (resume_id, project_id)
);

create trigger set_updated_at before update on resume_project
for each row execute function set_updated_at();

create table resume_project_bullet (
  resume_id         uuid not null references resume (id) on delete cascade,
  project_bullet_id uuid not null references project_bullet (id) on delete cascade,
  sort_order        integer not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (resume_id, project_bullet_id)
);

create trigger set_updated_at before update on resume_project_bullet
for each row execute function set_updated_at();

create table resume_technical_skill_row (
  resume_id              uuid not null references resume (id) on delete cascade,
  technical_skill_row_id uuid not null references technical_skill_row (id) on delete cascade,
  sort_order             integer not null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  primary key (resume_id, technical_skill_row_id)
);

create trigger set_updated_at before update on resume_technical_skill_row
for each row execute function set_updated_at();

create table resume_technical_skill (
  resume_id          uuid not null references resume (id) on delete cascade,
  technical_skill_id uuid not null references technical_skill (id) on delete cascade,
  sort_order         integer not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  primary key (resume_id, technical_skill_id)
);

create trigger set_updated_at before update on resume_technical_skill
for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- PDF snapshots. History is kept — one row per save. "Most recent PDF" =
-- order by created_at desc limit 1.
-- ---------------------------------------------------------------------------

create table resume_pdf (
  id         uuid primary key default gen_random_uuid(),
  resume_id  uuid not null references resume (id) on delete cascade,
  filename   text not null,
  bytes      bytea not null,
  byte_size  integer not null,
  tex        text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ix_resume_pdf_resume_id_created_at on resume_pdf (resume_id, created_at desc);

create trigger set_updated_at before update on resume_pdf
for each row execute function set_updated_at();
