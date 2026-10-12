-- Application pipeline: the statuses an agent moves an application through,
-- and the columns it fills in on the way (D-041).
--
-- Three new statuses sit between `draft` and `applied`: `proposing` (the
-- agent is putting the resume and letter together), `needs_review` (waiting
-- on a human) and `ready` (approved, not yet sent). They belong to the review
-- flow, not to the person using the board — the API refuses to set them by
-- hand — so nothing here changes what an existing row means.
--
-- Additive only. Every new column is nullable, so a row logged by hand reads
-- exactly as it did before, and code that has never heard of these columns
-- keeps working against a database that has them.
--
-- No begin/commit here: scripts/migrate.ts wraps each file in a transaction.
--
-- **Do not use the new enum values in this file.** Postgres allows
-- `alter type … add value` inside a transaction but refuses to *use* a value
-- added in the same transaction until it commits ("unsafe use of new value").
-- Nothing below does: the CHECK is on `fit_score`, the status default stays
-- `'draft'`, and `before 'applied'` names a value that already existed. A
-- backfill, partial index or default that mentions `proposing`,
-- `needs_review` or `ready` belongs in a later migration file.

-- ---------------------------------------------------------------------------
-- application_status
--
-- `before 'applied'` so the enum's own order is the order an application
-- moves through: draft, proposing, needs_review, ready, applied, … — the same
-- order `APPLICATION_STATUSES` lists them in (lib/applications/status.ts).
-- `if not exists` because the dev database is shared across branches.
-- ---------------------------------------------------------------------------

alter type application_status add value if not exists 'proposing' before 'applied';
alter type application_status add value if not exists 'needs_review' before 'applied';
alter type application_status add value if not exists 'ready' before 'applied';

-- ---------------------------------------------------------------------------
-- application: what the agent supplies, and the approval stamps
--
-- `job_description` and `agent_summary` are nullable rather than
-- `not null default ''` like `notes`: null means the agent never supplied
-- one, which is a different fact from "supplied an empty one", and a row
-- logged by hand has neither.
--
-- `fit_score` is one decimal place on a 0–5 scale (C13). `numeric(2,1)`
-- alone would allow up to 9.9, so the range is a CHECK.
--
-- `proposed_selection` is the agent's original pick, in the API's
-- `Selections` shape, kept so the review can badge it and reset to it (C7).
--
-- The three approval timestamps are null until a human approves that part;
-- `approved_at` is the final approval that makes an application `ready`.
-- ---------------------------------------------------------------------------

alter table application
  add column job_description          text,
  add column agent_summary            text,
  add column fit_score                numeric(2, 1),
  add column proposed_selection       jsonb,
  add column resume_approved_at       timestamptz,
  add column cover_letter_approved_at timestamptz,
  add column approved_at              timestamptz,
  add constraint ck_application_fit_score check (fit_score between 0 and 5);
