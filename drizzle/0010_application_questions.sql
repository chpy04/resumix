-- Application questions: what an application's form asks, the answer the
-- agent proposes for each, and Chris's approval of each one (D-047).
--
-- Additive only: one new table and three new types. Nothing that exists
-- changes, so code that has never heard of questions keeps working against a
-- database that has them.
--
-- No begin/commit here: scripts/migrate.ts wraps each file in a transaction.
-- These enums are created in this file rather than altered, so using their
-- values below is safe (0007's warning is about `alter type … add value`).

-- `answer_mode` is not prefixed with the table's name: saved answers reuse it.
create type application_question_kind as enum ('text', 'choice', 'multi', 'bool', 'file', 'letter');
create type application_question_source as enum ('profile', 'agent', 'saved');
create type answer_mode as enum ('value', 'instruction');

-- ---------------------------------------------------------------------------
-- application_question
--
-- No `user_id`: the owner is inherited through `application_id`, like
-- `application_file` (D-018). Questions are never deleted or archived; the
-- cascade is unreachable in practice, since applications are archived too.
--
-- `field_ref` is `{ page, label, selector }`: the form page (0-based), the
-- field's visible label (trimmed, whitespace collapsed) and a selector hint
-- or null. It is where the applying agent fills the answer in, and its page
-- and label are what makes two questions the same one.
--
-- An answer is one text column whatever the kind: the prose, the option, a
-- JSON array of options for `multi`, `yes`/`no`, an `application_file` id,
-- or, in `instruction` mode, the instruction's words
-- (lib/applications/questions.ts).
--
-- `saved_answer_id` is a plain uuid for now; the saved answers table adds
-- the foreign key.
-- ---------------------------------------------------------------------------

create table application_question (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references application (id) on delete cascade,
  -- Dense, in the order the questions were added.
  sort_order      integer not null,
  prompt          text not null,
  kind            application_question_kind not null,
  -- A JSON array of option strings, for choice and multi only.
  options         jsonb,
  field_ref       jsonb not null,
  required        boolean not null,
  is_eeo          boolean not null default false,
  -- Who proposed the answer; null when nothing was proposed.
  source          application_question_source,
  answer_mode     answer_mode not null default 'value',
  -- What was proposed, kept beside the answer Chris edits.
  proposed_answer text,
  answer          text,
  -- Non-null while Chris has asked the agent for a new draft.
  redraft_note    text,
  saved_answer_id uuid,
  approved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint ck_application_question_options
    check ((options is not null) = (kind in ('choice', 'multi'))),
  -- An instruction describes a choice in words (R8); prose has nothing to
  -- describe.
  constraint ck_application_question_instruction
    check (answer_mode = 'value' or kind in ('choice', 'multi')),
  constraint ck_application_question_proposal
    check ((source is null) = (proposed_answer is null)),
  -- C10, in the database: an EEO answer is typed by Chris, or comes from a
  -- saved answer he made, and never from the agent or his profile.
  constraint ck_application_question_eeo
    check (not is_eeo or source is null or source = 'saved'),
  constraint ck_application_question_approved_answer
    check (approved_at is null or answer is not null),
  -- A redraft request is a refusal of the current answer.
  constraint ck_application_question_redraft
    check (redraft_note is null or approved_at is null)
);

-- The dedupe key `fieldKey` computes (lib/applications/questions.ts): page
-- plus the label with case and whitespace folded. It also serves every
-- lookup by application.
create unique index ux_application_question_field
  on application_question (
    application_id,
    (field_ref ->> 'page'),
    lower(regexp_replace(btrim(field_ref ->> 'label'), '\s+', ' ', 'g'))
  );

create trigger set_updated_at before update on application_question
for each row execute function set_updated_at();
