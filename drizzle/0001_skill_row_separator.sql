-- Technical skill rows need a per-row separator.
--
-- The real resume joins the top "Technical Skills" rows with commas
-- ("JavaScript, Typescript, Python") but the bottom "Additional Information"
-- rows with pipes ("Skiing $|$ Ski Racing $|$ Hiking"). A hardcoded separator
-- in the renderer cannot represent the user's actual resume, which is the
-- project's governing smoke test. See docs/DECISIONS.md D-013.

alter table technical_skill_row
  add column separator text not null default ', ';
