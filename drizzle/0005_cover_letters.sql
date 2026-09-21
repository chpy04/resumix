-- Cover letters: raw LaTeX documents, one per application.
--
-- Deliberately *not* modelled the way a resume is. A resume stores no text
-- at all — it is a selection of globally-shared content substituted into a
-- template at render time (D-007) — because the same bullet belongs on
-- twenty resumes and must be edited in one place. A cover letter has no
-- such reuse: it is one prose document written for one company, so the
-- document *is* the row. `content` is the whole thing, verbatim, and there
-- are no tokens, no bridge tables and no library of shared paragraphs
-- (D-035).
--
-- That also removes the reason `resume_pdf` exists. A resume's saved bytes
-- have to be frozen because editing a shared bullet silently changes every
-- resume that selected it; a cover letter can only change if you edit that
-- one letter, so there is no snapshot table here and downloads compile the
-- stored text on demand.
--
-- No begin/commit here: scripts/migrate.ts wraps each file in a transaction.

-- ---------------------------------------------------------------------------
-- cover_letter
--
-- A seventh root table: it carries `user_id` like every other root (D-018),
-- with `on delete restrict` for the same reason the others have it (D-011).
--
-- `is_default` marks the one this user's new letters are copied from, with
-- the same partial unique index `template` and `resume` use. `is_archived`
-- rather than a delete, because with no PDF snapshot the text of a letter is
-- the only record of what was sent (D-011, D-035).
-- ---------------------------------------------------------------------------

create table cover_letter (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users (id) on delete restrict,
  name        text not null,
  -- Raw, unescaped LaTeX — a complete document, not a fragment (D-008).
  content     text not null,
  is_default  boolean not null default false,
  is_archived boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index ux_cover_letter_one_default_per_user
  on cover_letter (user_id) where is_default;

create index ix_cover_letter_user_id on cover_letter (user_id);

create trigger set_updated_at before update on cover_letter
for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- application.cover_letter_id
--
-- One column, where the resume needed two. `resume_id` has a `resume_pdf_id`
-- beside it because the live resume keeps changing after it is sent and the
-- snapshot is the only evidence of what went out; a cover letter is a
-- private copy that nothing else can edit, so the link *is* the record.
--
-- `set null` for the same reason `resume_id` is: an application that has
-- lost its letter is still a true row about a job.
-- ---------------------------------------------------------------------------

alter table application
  add column cover_letter_id uuid references cover_letter (id) on delete set null;

create index ix_application_cover_letter_id on application (cover_letter_id);
