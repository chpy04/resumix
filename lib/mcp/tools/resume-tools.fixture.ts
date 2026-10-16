/**
 * The account the resume tools' tests share (D-054): Default showing one
 * experience with two of its three bullets, a resume of Chris's own showing
 * the third, and a resume an application is tailored on, which every one of
 * the tools must refuse. A fresh account each time, so its Default is the
 * test's own, never the seeded one other tests read.
 *
 * Imported only by those tests, and only once DATABASE_URL is set.
 */
import { listResumeSuggestions } from '../../queries/bullet-suggestions.ts';
import { assembleLibrary } from '../../queries/library.ts';
import { getSelections, replaceSelections } from '../../queries/selections.ts';
import * as fixtures from '../../queries/test-fixtures.ts';

export async function resumeToolsSetup() {
  const tag = fixtures.testTag();
  const user = await fixtures.insertUser(`rtools-${tag}`);
  const exp = await fixtures.insertExperience(user.id, tag);
  const b1 = await fixtures.insertExperienceBullet(exp.id, 'Cut latency \\textbf{40\\%}');
  const b2 = await fixtures.insertExperienceBullet(exp.id, 'Shipped tooling');
  const b3 = await fixtures.insertExperienceBullet(exp.id, 'Led a migration');
  const defaultResume = await fixtures.getDefaultResumeRow(user.id);
  await replaceSelections(user.id, defaultResume.id, {
    experiences: [exp.id],
    experienceBullets: { [exp.id]: [b1.id, b2.id] },
  });
  const own = await fixtures.insertTestResume(user.id, tag);
  await replaceSelections(user.id, own.id, {
    experiences: [exp.id],
    experienceBullets: { [exp.id]: [b3.id] },
  });
  const tailored = await fixtures.insertTestResume(user.id, `${tag}-app`);
  const app = await fixtures.insertTestApplication(user.id, tag, {
    status: 'proposing',
    resumeId: tailored.id,
  });

  return {
    user,
    exp,
    b1,
    b2,
    b3,
    defaultResume,
    own,
    tailored,
    app,
    /** The library and every resume's selection, to prove none moved. */
    async state() {
      return {
        library: await assembleLibrary(user.id, true),
        selections: await Promise.all(
          [defaultResume.id, own.id, tailored.id].map((id) => getSelections(id)),
        ),
      };
    },
    suggestions: (resumeId: string = defaultResume.id) => listResumeSuggestions(user.id, resumeId),
    async cleanup() {
      await fixtures.deleteApplicationRow(app.id);
      await fixtures.deleteResumeRow(own.id);
      await fixtures.deleteResumeRow(tailored.id);
    },
  };
}

/** What every tool answers with: the first text item. */
export function text(result: { content: { text: string }[] }): string {
  return result.content[0]?.text ?? '';
}
