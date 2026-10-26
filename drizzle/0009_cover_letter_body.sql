-- Cover letters as plain text: a letter's prose, kept apart from its LaTeX
-- (D-046).
--
-- `content` stays what it was, the letter's LaTeX, raw and unescaped
-- (D-008). `body` is the prose the agent drafts and Chris edits in review,
-- typed as plain text. Rendering escapes it and puts it where the one line of
-- `content` holding only `%%BODY%%` was. That line is a TeX comment, so a
-- letter whose `body` is null compiles exactly as before.
--
-- Additive only, and no backfill: every existing letter keeps a null body
-- and is LaTeX only, as it was. Adding the marker to an existing letter is
-- an edit Chris makes himself, which is also what makes his Default letter
-- ready to copy into letters that have a body. The rule that a non-null body
-- needs exactly one marker line lives in `updateCoverLetter`, not in a CHECK:
-- what counts as a marker line is TypeScript (`lib/render/cover-letter.ts`),
-- and two copies of it would drift.
--
-- No begin/commit here: scripts/migrate.ts wraps each file in a transaction.

alter table cover_letter add column body text;
