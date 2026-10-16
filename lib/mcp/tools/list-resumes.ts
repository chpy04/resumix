/**
 * `list_resumes`: Chris's own resumes, the ones no application is tailored
 * on, which the resume tools change outside the pipeline (D-054).
 */
import { z } from 'zod';
import { listStandaloneResumes } from '../../queries/resumes.ts';
import { defineTool, toolJson } from '../tool.ts';

export const listResumes = defineTool({
  name: 'list_resumes',
  description:
    "Lists Chris's own resumes, the ones no application is tailored on, as JSON [{ " +
    'resume_id, name, is_default }], Default first, then newest. Call it when Chris names a ' +
    'resume other than Default. When he asks to change his resume without naming one, he ' +
    'means Default, which get_resume, edit_resume_selection and suggest_resume_bullet take ' +
    "when resume_id is left out. An application's resume is not listed: change it through " +
    'the application.',
  input: z.strictObject({}),
  async run(ctx) {
    const rows = await listStandaloneResumes(ctx.userId);
    return toolJson(
      rows.map((row) => ({ resume_id: row.id, name: row.name, is_default: row.isDefault })),
    );
  },
});
