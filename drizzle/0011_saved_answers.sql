-- Saved answers: Chris's answers to the questions forms keep asking, kept
-- so the agent can reuse them on the next application (D-048).
--
-- Additive only: one new table, plus the foreign key and index
-- `application_question.saved_answer_id` was left waiting for. Nothing
-- writes that column before this migration, so adding the key cannot fail
-- on existing rows, and code that has never heard of saved answers keeps
-- working against a database that has them.
--
-- No begin/commit here: scripts/migrate.ts wraps each file in a transaction.

-- ---------------------------------------------------------------------------
-- saved_answer
--
-- A ninth root table: it carries `user_id` like every other root (D-018),
-- with `on delete restrict` for the same reason the others have it (D-011).
--
-- Saved answers are archived, never deleted: unticking "remember this
-- answer" archives the row. A question filled from one holds its own copy
-- of the answer, so archiving it later changes no application.
--
-- `kind` is stored and `options` is not. An answer is encoded per kind
-- (lib/applications/questions.ts), so the text alone cannot say whether
-- `["A","B"]` is prose or two picks; the question being answered supplies
-- the options to check a pick against. Duplicate prompts are allowed: the
-- same words can need different answers on two forms, and choosing between
-- them is the agent's call (D15).
-- ---------------------------------------------------------------------------

create table saved_answer (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users (id) on delete restrict,
  -- The question's wording when it was first saved.
  prompt      text not null,
  kind        application_question_kind not null,
  answer_mode answer_mode not null default 'value',
  -- Encoded as an application_question's answer of the same kind.
  answer      text not null,
  is_archived boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- A file answer is an attachment id, and attachments belong to one
  -- application.
  constraint ck_saved_answer_kind check (kind <> 'file'),
  constraint ck_saved_answer_mode check (answer_mode = 'value' or kind in ('choice', 'multi')),
  constraint ck_saved_answer_answer check (btrim(answer) <> '')
);

create index ix_saved_answer_user_id on saved_answer (user_id);

create trigger set_updated_at before update on saved_answer
for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- application_question.saved_answer_id
--
-- `set null`, like `application.resume_id`: the question keeps its own copy
-- of the answer, so losing the link costs nothing. No CHECK ties it to
-- `source`: `source = 'saved'` with no link is a saved answer since retired.
-- ---------------------------------------------------------------------------

alter table application_question
  add constraint fk_application_question_saved_answer
  foreign key (saved_answer_id) references saved_answer (id) on delete set null;

create index ix_application_question_saved_answer_id on application_question (saved_answer_id);
