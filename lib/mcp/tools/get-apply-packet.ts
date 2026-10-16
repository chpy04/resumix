/**
 * `get_apply_packet`: what the agent fills into the real form, which is
 * exactly what Chris approved (C4, D-050). Refused unless the application
 * is Ready.
 *
 * Every question is listed, with its approved answer, or with none when it
 * was left unapproved, which means leave the field blank. Files are paths
 * under `/api/mcp/files/`, fetched with this connection's token (C5): no
 * result ever carries bytes. The packet itself is built in
 * `lib/applications/apply-packet.ts`, the same rule the files route
 * serves from.
 */
import { z } from 'zod';
import type { ApplyPacketFile } from '../../applications/apply-packet.ts';
import { loadApplyPacket } from '../../apply-packet.ts';
import { noSuchApplication } from '../application.ts';
import { defineTool, toolError, toolJson } from '../tool.ts';

function fileJson(file: ApplyPacketFile) {
  return { filename: file.filename, url: file.url };
}

export const getApplyPacket = defineTool({
  name: 'get_apply_packet',
  description:
    "Returns what to fill into an application's real form: exactly what Chris approved, and " +
    'nothing else. Call it first when applying. Refused unless the application is ready. ' +
    'Returns JSON { application_id, status, company, role_title, posting_url, approved_at, ' +
    'resume: { filename, url }, cover_letter: { filename, url } | null, questions: [{ ' +
    'question_id, field_ref, prompt, kind, options, required, is_eeo, approved, answer_mode, ' +
    'answer, file }] }. Every question recorded for the form is listed, in order, and field_ref ' +
    'is where it is, as add_questions recorded it. answer null means leave that field empty, ' +
    'clearing anything in it; a file question has file { filename, url } instead. ' +
    'answer_mode instruction means answer is words saying which option to pick; a multi ' +
    'answer is the list of options to set. url is a path on the Resumix server, under the same ' +
    'origin as this endpoint, fetched with the same bearer token. resume goes in the resume ' +
    'upload, cover_letter in the cover letter upload.',
  input: z.strictObject({ application_id: z.uuid() }),
  async run(ctx, args) {
    const loaded = await loadApplyPacket(ctx.userId, args.application_id);
    if (!loaded) return noSuchApplication(args.application_id);
    if (!loaded.ok) return toolError(loaded.refusal);

    const packet = loaded.packet;
    return toolJson({
      application_id: packet.applicationId,
      status: 'ready',
      company: packet.company,
      role_title: packet.roleTitle,
      posting_url: packet.postingUrl,
      approved_at: packet.approvedAt,
      resume: fileJson(packet.resume),
      cover_letter: packet.coverLetter ? fileJson(packet.coverLetter) : null,
      questions: packet.questions.map((q) => ({
        question_id: q.questionId,
        field_ref: q.fieldRef,
        prompt: q.prompt,
        kind: q.kind,
        options: q.options,
        required: q.required,
        is_eeo: q.isEeo,
        approved: q.approved,
        answer_mode: q.answerMode,
        answer: q.answer,
        file: q.file ? fileJson(q.file) : null,
      })),
    });
  },
});
