/**
 * Application questions: the vocabularies, how a field is identified, how
 * an answer is stored, and what makes one approvable (D-047). Pure, like
 * `status.ts` and `review.ts` — the query layer, the MCP tool, the routes and
 * the review page all ask these functions rather than restating them.
 *
 * Every answer is stored as one text column. Most kinds store the value
 * itself: the prose, the option picked, `yes` or `no`, an attachment's id.
 * A multi question's picks are a JSON array of options, and an instruction
 * is its words. The wire carries the decoded value (`AnswerValue`), so only
 * this file knows about the JSON.
 */
import type {
  AnswerMode,
  AnswerValue,
  ApplicationQuestion,
  FieldRef,
  QuestionKind,
  QuestionSource,
} from '../types.ts';

/** The order and spelling of the Postgres enums
 *  (drizzle/0010_application_questions.sql). */
export const QUESTION_KINDS = [
  'text',
  'choice',
  'multi',
  'bool',
  'file',
  'letter',
] as const satisfies readonly QuestionKind[];

export const QUESTION_SOURCES = [
  'profile',
  'agent',
  'saved',
] as const satisfies readonly QuestionSource[];

export const ANSWER_MODES = ['value', 'instruction'] as const satisfies readonly AnswerMode[];

export const BOOL_ANSWERS = ['yes', 'no'] as const;

/** Choice and multi offer options, and so are the only kinds that take an
 *  instruction instead of a value (R8). */
export function hasOptions(kind: QuestionKind): boolean {
  return kind === 'choice' || kind === 'multi';
}

/** Prose the agent drafted, which is what a redraft request asks it to
 *  rewrite. A choice takes an instruction from Chris instead, and an EEO
 *  question is never the agent's to answer (C10). */
export function canRedraft(question: { kind: QuestionKind; isEeo: boolean }): boolean {
  return !question.isEeo && (question.kind === 'text' || question.kind === 'letter');
}

// ---------------------------------------------------------------------------
// Identifying a field
// ---------------------------------------------------------------------------

function cleanLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ');
}

/** The ref as stored: the label trimmed and its whitespace collapsed, and an
 *  empty selector as none. */
export function normalizeFieldRef(ref: {
  page: number;
  label: string;
  selector?: string | null;
}): FieldRef {
  const selector = ref.selector?.trim() ?? '';
  return { page: ref.page, label: cleanLabel(ref.label), selector: selector || null };
}

/**
 * What makes two questions the same field: the page and the label, with
 * case and whitespace folded. The selector is left out because a form's
 * generated ids change between visits. `ux_application_question_field`
 * enforces the same key in the database.
 */
export function fieldKey(ref: Pick<FieldRef, 'page' | 'label'>): string {
  return `${ref.page}|${cleanLabel(ref.label).toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// EEO (C10)
// ---------------------------------------------------------------------------

/** "sex" also covers sexual orientation. Word-initial, so "Essex" and
 *  "embrace" do not match. */
const EEO_PATTERN =
  /\b(?:gender|sex|race|racial|ethnic|hispanic|latin[aox]|veteran|disabilit|transgender)/i;

/**
 * A backstop for the agent's own `is_eeo` flag. It can only ever turn the
 * flag on: a false positive costs Chris one answer typed by hand, and a
 * false negative is the leak C10 forbids.
 */
export function looksLikeEeo(prompt: string): boolean {
  return EEO_PATTERN.test(prompt);
}

// ---------------------------------------------------------------------------
// Storing an answer
// ---------------------------------------------------------------------------

/** The stored text, or null for no answer at all: whitespace, or a multi
 *  question with nothing picked. */
export function encodeAnswer(value: AnswerValue | null): string | null {
  if (value === null) return null;
  if (Array.isArray(value)) return value.length === 0 ? null : JSON.stringify(value);
  return value.trim() === '' ? null : value;
}

export function decodeAnswer(
  kind: QuestionKind,
  mode: AnswerMode,
  stored: string | null,
): AnswerValue | null {
  if (stored === null) return null;
  if (kind !== 'multi' || mode === 'instruction') return stored;
  try {
    const parsed: unknown = JSON.parse(stored);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) return parsed;
  } catch {
    // Not JSON: shown as one pick, which `answerProblem` then names.
  }
  return [stored];
}

/** Whether two answers would be stored the same. */
export function sameAnswer(
  a: { answerMode: AnswerMode; answer: AnswerValue | null },
  b: { answerMode: AnswerMode; answer: AnswerValue | null },
): boolean {
  return a.answerMode === b.answerMode && encodeAnswer(a.answer) === encodeAnswer(b.answer);
}

// ---------------------------------------------------------------------------
// Validating an answer
// ---------------------------------------------------------------------------

interface AnswerShape {
  kind: QuestionKind;
  options: readonly string[] | null;
}

/**
 * Why `answer` cannot be saved on this question in `mode`, or null when it
 * can. No answer at all is always savable: clearing one is an edit too.
 */
export function answerProblem(
  question: AnswerShape,
  answer: AnswerValue | null,
  mode: AnswerMode,
): string | null {
  if (mode === 'instruction' && !hasOptions(question.kind)) {
    return 'Only a choice question takes an instruction.';
  }
  if (encodeAnswer(answer) === null) return null;
  if (mode === 'instruction') {
    return typeof answer === 'string' ? null : 'An instruction is text, not a list.';
  }

  const options = question.options ?? [];
  if (question.kind === 'multi') {
    if (!Array.isArray(answer)) return 'Pick from the options, as a list.';
    for (const [index, pick] of answer.entries()) {
      if (!options.includes(pick)) return `"${pick}" is not one of the options.`;
      if (answer.indexOf(pick) !== index) return `"${pick}" is picked twice.`;
    }
    return null;
  }

  if (typeof answer !== 'string') return 'This takes one answer, not a list.';
  if (question.kind === 'choice' && !options.includes(answer)) {
    return `"${answer}" is not one of the options.`;
  }
  if (question.kind === 'bool' && !(BOOL_ANSWERS as readonly string[]).includes(answer)) {
    return 'Answer yes or no.';
  }
  return null;
}

/**
 * Why this question cannot be approved as it stands, or null when it can:
 * it needs an answer that `answerProblem` accepts, and a file answer must be
 * one of the application's attachments that is not archived.
 */
export function approvalProblem(
  question: AnswerShape & { answerMode: AnswerMode; answer: AnswerValue | null },
  files: readonly { id: string; isArchived: boolean }[],
): string | null {
  const isFile = question.kind === 'file' && question.answerMode === 'value';
  if (encodeAnswer(question.answer) === null) {
    return isFile ? 'Pick an attachment.' : 'Answer it first.';
  }
  const problem = answerProblem(question, question.answer, question.answerMode);
  if (problem) return problem;
  if (isFile && !files.some((file) => file.id === question.answer && !file.isArchived)) {
    return 'Pick an attachment.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// The review step
// ---------------------------------------------------------------------------

export interface QuestionProgress {
  approved: number;
  total: number;
  /** Required and not approved: each one blocks final approval (C3). */
  requiredOpen: number;
  /** Optional and not approved: left blank at apply. */
  optionalOpen: number;
}

export function questionProgress(
  questions: readonly { required: boolean; approvedAt: Date | string | null }[],
): QuestionProgress {
  const open = questions.filter((q) => q.approvedAt === null);
  const requiredOpen = open.filter((q) => q.required).length;
  return {
    approved: questions.length - open.length,
    total: questions.length,
    requiredOpen,
    optionalOpen: open.length - requiredOpen,
  };
}

/** Profile answers are the ones approved in bulk. An EEO question never is,
 *  whatever its source (C10). `rest` keeps the questions' own order. */
export function reviewGroups<Q extends Pick<ApplicationQuestion, 'source' | 'isEeo'>>(
  questions: readonly Q[],
): { profile: Q[]; rest: Q[] } {
  const isProfile = (q: Q) => q.source === 'profile' && !q.isEeo;
  return {
    profile: questions.filter(isProfile),
    rest: questions.filter((q) => !isProfile(q)),
  };
}

/** The questions approved in `before` and not in `after`: an edit has just
 *  reopened them, which the page says on the card. */
export function reopenedQuestions(
  before: readonly Pick<ApplicationQuestion, 'id' | 'approvedAt'>[],
  after: readonly Pick<ApplicationQuestion, 'id' | 'approvedAt'>[],
): string[] {
  const wasApproved = new Set(before.filter((q) => q.approvedAt !== null).map((q) => q.id));
  return after.filter((q) => q.approvedAt === null && wasApproved.has(q.id)).map((q) => q.id);
}

export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}
