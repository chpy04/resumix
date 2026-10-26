'use client';

import { useRef, useState, type ReactNode } from 'react';
import { MAX_ATTACHMENT_BYTES } from '@/lib/applications/attachments';
import { BOOL_ANSWERS, BOOL_LABELS, hasOptions, wordCount } from '@/lib/applications/questions';
import { ApiError, uploadApplicationFile } from '@/lib/api-client';
import type { AnswerMode, AnswerValue, ApplicationFile, ApplicationQuestion } from '@/lib/types';

/** What is on screen for one question, saved or not. */
export interface AnswerDraft {
  answerMode: AnswerMode;
  answer: AnswerValue | null;
}

interface QuestionAnswerInputProps {
  question: ApplicationQuestion;
  draft: AnswerDraft;
  /** The application's attachments that are not archived. */
  files: ApplicationFile[];
  applicationId: string;
  /** `immediate` for a discrete pick (a radio, a toggle, a file), which saves
   *  at once; typing waits for the debounce. */
  onChange: (next: AnswerDraft, immediate: boolean) => void;
  /** An upload landed: the page adds it to the application's files. */
  onFileUploaded: (file: ApplicationFile) => void;
  /** One line, for the profile group's rows: no mode toggle, no word count. */
  compact?: boolean;
}

const fieldClass =
  'w-full rounded-md border border-line bg-canvas px-2 py-1.5 text-sm text-ink outline-none focus:border-accent';

/**
 * The control for one answer, by kind: prose is a textarea, a choice is
 * radios, a multi is checkboxes, a bool is yes or no, and a file is one of
 * the application's attachments. A choice or multi can instead take an
 * instruction, in words (R8). Nothing is preselected that the answer does
 * not already hold, which is what keeps an EEO question blank until Chris
 * picks (C10).
 */
export default function QuestionAnswerInput({
  question,
  draft,
  files,
  applicationId,
  onChange,
  onFileUploaded,
  compact = false,
}: QuestionAnswerInputProps) {
  const label = question.prompt;
  const text = typeof draft.answer === 'string' ? draft.answer : '';
  const picks = Array.isArray(draft.answer) ? draft.answer : [];
  const options = question.options ?? [];
  const showToggle = !compact && hasOptions(question.kind) && !question.isEeo;

  function setMode(answerMode: AnswerMode): void {
    // A value read as an instruction, or the reverse, is not what Chris
    // chose, so switching starts empty; the server does the same.
    if (answerMode !== draft.answerMode) onChange({ answerMode, answer: null }, true);
  }

  let control: ReactNode;
  if (draft.answerMode === 'instruction') {
    control = (
      <input
        type="text"
        aria-label={`${label}: instruction`}
        value={text}
        placeholder="e.g. Boston if listed, otherwise Remote"
        onChange={(event) =>
          onChange({ answerMode: 'instruction', answer: event.target.value }, false)
        }
        className={fieldClass}
      />
    );
  } else if (question.kind === 'text' || question.kind === 'letter') {
    control = compact ? (
      <input
        type="text"
        aria-label={label}
        value={text}
        onChange={(event) => onChange({ answerMode: 'value', answer: event.target.value }, false)}
        className={fieldClass}
      />
    ) : (
      <div className="flex flex-col gap-1">
        <textarea
          aria-label={label}
          value={text}
          rows={question.kind === 'letter' ? 10 : 5}
          onChange={(event) => onChange({ answerMode: 'value', answer: event.target.value }, false)}
          className={`${fieldClass} resize-y leading-relaxed`}
        />
        <span className="text-xs text-ink-dim">
          {wordCount(text)} {wordCount(text) === 1 ? 'word' : 'words'}
        </span>
      </div>
    );
  } else if (question.kind === 'choice' || question.kind === 'bool') {
    const choices =
      question.kind === 'bool'
        ? BOOL_ANSWERS.map((value) => ({ value, label: BOOL_LABELS[value] }))
        : options.map((value) => ({ value, label: value }));
    control = (
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-x-4 gap-y-1.5">
        {choices.map((choice) => (
          <label key={choice.value} className="flex items-center gap-1.5 text-sm text-ink">
            <input
              type="radio"
              name={`question-${question.id}`}
              value={choice.value}
              checked={text === choice.value}
              onChange={() => onChange({ answerMode: 'value', answer: choice.value }, true)}
              className="h-3.5 w-3.5 accent-accent"
            />
            {choice.label}
          </label>
        ))}
      </div>
    );
  } else if (question.kind === 'multi') {
    control = (
      <div role="group" aria-label={label} className="flex flex-wrap gap-x-4 gap-y-1.5">
        {options.map((option) => (
          <label key={option} className="flex items-center gap-1.5 text-sm text-ink">
            <input
              type="checkbox"
              checked={picks.includes(option)}
              onChange={(event) =>
                onChange(
                  {
                    answerMode: 'value',
                    // In the form's order, whatever order they were ticked in.
                    answer: options.filter((o) =>
                      o === option ? event.target.checked : picks.includes(o),
                    ),
                  },
                  true,
                )
              }
              className="h-3.5 w-3.5 accent-accent"
            />
            {option}
          </label>
        ))}
      </div>
    );
  } else {
    control = (
      <FilePicker
        question={question}
        value={text}
        files={files}
        applicationId={applicationId}
        onPick={(fileId) => onChange({ answerMode: 'value', answer: fileId }, true)}
        onFileUploaded={onFileUploaded}
      />
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {showToggle ? (
        <div
          role="radiogroup"
          aria-label={`${label}: how to answer`}
          className="flex gap-4 text-xs text-ink-dim"
        >
          {(['value', 'instruction'] as const).map((mode) => (
            <label key={mode} className="flex items-center gap-1.5">
              <input
                type="radio"
                name={`question-mode-${question.id}`}
                checked={draft.answerMode === mode}
                onChange={() => setMode(mode)}
                className="h-3 w-3 accent-accent"
              />
              {mode === 'instruction'
                ? 'Give an instruction'
                : question.kind === 'multi'
                  ? 'Pick'
                  : 'Pick one'}
            </label>
          ))}
        </div>
      ) : null}
      {control}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface FilePickerProps {
  question: ApplicationQuestion;
  value: string;
  files: ApplicationFile[];
  applicationId: string;
  onPick: (fileId: string) => void;
  onFileUploaded: (file: ApplicationFile) => void;
}

/** One of the application's attachments, or a new one uploaded here and
 *  picked straight away. */
function FilePicker({
  question,
  value,
  files,
  applicationId,
  onPick,
  onFileUploaded,
}: FilePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUpload(file: File): Promise<void> {
    setUploading(true);
    setError(null);
    try {
      const created = await uploadApplicationFile(applicationId, file);
      onFileUploaded(created);
      onPick(created.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={question.prompt}
          value={files.some((file) => file.id === value) ? value : ''}
          onChange={(event) => {
            if (event.target.value) onPick(event.target.value);
          }}
          className="min-w-0 flex-1 rounded-md border border-line bg-canvas px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
        >
          <option value="">Choose an attachment…</option>
          {files.map((file) => (
            <option key={file.id} value={file.id}>
              {file.filename}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="shrink-0 rounded-md border border-line px-2.5 py-1.5 text-xs text-ink-dim transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
        >
          {uploading ? 'Uploading…' : 'Upload a file…'}
        </button>
        <input
          ref={inputRef}
          type="file"
          aria-label={`Upload a file for ${question.prompt}`}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleUpload(file);
          }}
        />
      </div>
      <span className="text-xs text-ink-dim">
        Up to {MAX_ATTACHMENT_BYTES / 1024 / 1024} MB. It is added to this application&apos;s files.
      </span>
      {error ? <span className="text-xs text-danger">{error}</span> : null}
    </div>
  );
}
