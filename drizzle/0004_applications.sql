-- Job applications: log every application and see where each one stands.
--
-- Deliberately two tables. An application is one row of free text plus a
-- status; there is no company table (applying to the same place twice is two
-- rows, and that is fine), no event log (the status *is* the state), no
-- tasks and no contacts. Applications differ enough from each other that
-- structure gets in the way — hence one `notes` column and untyped
-- attachments (D-031).
--
-- No begin/commit here: scripts/migrate.ts wraps each file in a transaction.

create type application_status as enum (
  'draft',        -- being put together; nothing has been sent
  'applied',
  'interviewing',
  'offered',
  'rejected'
);

-- ---------------------------------------------------------------------------
-- application
--
-- A sixth root table: it carries `user_id` like every other root (D-018),
-- with `on delete restrict` for the same reason the others have it (D-011).
--
-- The two resume links are not redundant. `resume_id` is the live, mutable
-- resume being tailored for this application — it keeps changing, which is
-- the whole point of the editor. `resume_pdf_id` is the immutable snapshot
-- that was actually sent, set when the application is marked applied. Asking
-- "what did they receive?" and "which resume was that, and what has it become
-- since?" are different questions and need different columns (D-031).
-- ---------------------------------------------------------------------------

create table application (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users (id) on delete restrict,
  company       text not null,
  role_title    text not null default '',
  posting_url   text not null default '',
  notes         text not null default '',
  status        application_status not null default 'draft',
  -- Null exactly while nothing has been sent. Set when the application
  -- leaves 'draft', and never cleared afterwards.
  applied_at    timestamptz,
  -- `set null`: the editor link is a convenience, and losing it when a
  -- resume is deleted costs nothing.
  resume_id     uuid references resume (id) on delete set null,
  -- `restrict`: the snapshot is the evidence of what was sent, so it
  -- outranks a request to delete the resume it came from. `resume_pdf`
  -- cascades from `resume`, so this blocks that delete — `deleteResume`
  -- turns the constraint violation into a 400 before it can happen.
  resume_pdf_id uuid references resume_pdf (id) on delete restrict,
  is_archived   boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index ix_application_user_id on application (user_id);
create index ix_application_resume_id on application (resume_id);
create index ix_application_resume_pdf_id on application (resume_pdf_id);

create trigger set_updated_at before update on application
for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- application_file
--
-- Whatever else belongs to this application: a cover letter, a take-home, a
-- screenshot of the posting, an offer letter. No `kind` column on purpose —
-- classifying them up front is exactly the structure this feature is trying
-- not to impose.
--
-- No `user_id`: the owner is inherited through `application_id`, like every
-- other non-root table (D-018). Cascade is unreachable in practice —
-- applications are archived, never deleted — but it is the right answer if
-- one ever is.
-- ---------------------------------------------------------------------------

create table application_file (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references application (id) on delete cascade,
  filename       text not null,
  content_type   text not null,
  bytes          bytea not null,
  byte_size      integer not null,
  is_archived    boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index ix_application_file_application_id
  on application_file (application_id, created_at desc);

create trigger set_updated_at before update on application_file
for each row execute function set_updated_at();
