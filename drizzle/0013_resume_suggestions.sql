-- Bullet suggestions on a resume, outside any application (D-054).
--
-- Asked to change one of Chris's own resumes, the agent sets its selection
-- directly and proposes bullet text as a suggestion, which he reviews in that
-- resume's editor on the same card the review page shows. The agent still
-- never writes to the library (D-045).
--
-- A suggestion now belongs to exactly one application (the pipeline,
-- unchanged) or exactly one resume. Every existing row has an application and
-- no resume, so the new CHECK holds for all of them as they are.
--
-- No begin/commit here: scripts/migrate.ts wraps each file in a transaction.

alter table bullet_suggestion
  alter column application_id drop not null,
  -- Cascades as application_id does: a resume's suggestions mean nothing
  -- once it is gone.
  add column resume_id uuid references resume (id) on delete cascade,
  add constraint ck_bullet_suggestion_owner check (
    (application_id is null) <> (resume_id is null)
  );

create index ix_bullet_suggestion_resume_id
  on bullet_suggestion (resume_id, created_at)
  where resume_id is not null;

-- One pending edit per bullet per resume, as ux_bullet_suggestion_pending_edit
-- is per application, where the null application ids of these rows never
-- collide.
create unique index ux_bullet_suggestion_pending_resume_edit
  on bullet_suggestion (resume_id, bullet_id)
  where status = 'pending' and resume_id is not null;
