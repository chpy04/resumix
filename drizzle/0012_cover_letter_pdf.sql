-- The approved cover letter's PDF, pinned by id (D-050).
--
-- Final approval stores the letter's PDF as an `application_file` (D-044),
-- and this column points at the one it stored, exactly as `resume_pdf_id`
-- points at the resume snapshot. Finding it by its download name instead
-- would let a rename, or an older copy taken out of the archive, change
-- what the apply packet sends. Only final approval writes it; a reopen
-- leaves it, and the next final approval re-points it.
--
-- `restrict`, as on `resume_pdf_id`: files are never deleted (D-011), so
-- nothing should ever take the approved PDF out from under the pointer.
-- Deleting the application itself still cascades to its files.
--
-- Additive only: nullable, no backfill. A Ready application approved before
-- this column existed has none, and its packet asks for one more approval.
--
-- No begin/commit here: scripts/migrate.ts wraps each file in a transaction.

alter table application
  add column cover_letter_pdf_id uuid references application_file (id) on delete restrict;

create index if not exists ix_application_cover_letter_pdf_id
  on application (cover_letter_pdf_id);
