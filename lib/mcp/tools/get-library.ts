/**
 * `get_library`: everything the agent may put on a resume, in one call (C9).
 * Archived content is absent, so it cannot be chosen (D-011), and every
 * string is plain text, because the agent works in plain text (D-042).
 */
import { z } from 'zod';
import { assembleLibrary } from '../../queries/library.ts';
import { latexToPlainText as plain } from '../../render/plain-text.ts';
import type { Bullet } from '../../types.ts';
import { defineTool, toolJson } from '../tool.ts';

function bullets(list: Bullet[]) {
  return list.map((b) => ({ id: b.id, text: plain(b.content) }));
}

export const getLibrary = defineTool({
  name: 'get_library',
  description:
    'Returns every experience, project and skill row you can put on a resume, with their ' +
    'bullets and skills, as JSON: { experiences: [{ id, company, title, date_range, location, ' +
    'bullets: [{ id, text }] }], projects: [{ id, name, technologies, date_range, bullets }], ' +
    'skill_rows: [{ id, name, top, skills: [{ id, name }] }] }, in library order. Call it before ' +
    'set_resume_selection; its ids come from here. Archived content is absent and cannot be ' +
    'selected. top=true rows print under Technical Skills, the rest under Additional Information.',
  input: z.strictObject({}),
  async run(ctx) {
    // Non-archived only: an archived parent goes with its children, and an
    // archived bullet under a live experience goes on its own.
    const library = await assembleLibrary(ctx.userId, false);
    return toolJson({
      experiences: library.experiences.map((e) => ({
        id: e.id,
        company: plain(e.company),
        title: plain(e.title),
        date_range: plain(e.dateRange),
        location: plain(e.location),
        bullets: bullets(e.bullets),
      })),
      projects: library.projects.map((p) => ({
        id: p.id,
        name: plain(p.name),
        technologies: plain(p.technologies),
        date_range: plain(p.dateRange),
        bullets: bullets(p.bullets),
      })),
      skill_rows: library.skillRows.map((r) => ({
        id: r.id,
        name: plain(r.name),
        top: r.top,
        skills: r.skills.map((s) => ({ id: s.id, name: plain(s.name) })),
      })),
    });
  },
});
