'use client';

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  ApiError,
  createExperience,
  createExperienceBullet,
  createProject,
  createProjectBullet,
  createSkill,
  createSkillRow,
  downloadResumePdf,
  getResumeDetail,
  renderResume,
  saveResumePdf,
  saveResumeToApplication,
  updateExperience,
  updateExperienceBullet,
  updateProject,
  updateProjectBullet,
  updateResume,
  updateSelections,
  updateSkill,
  updateSkillRow,
  updateTemplate,
} from '@/lib/api-client';
import { agentPickIds, sameSelections, SLICES } from '@/lib/editor/agent-pick';
import type { SaveStatus } from '@/lib/editor/autosave';
import {
  affectedSlice,
  selectionsReducer,
  type SelectionsAction,
} from '@/lib/editor/selections-reducer';
import { EMPTY_SELECTIONS, type Library, type Selections, type Template } from '@/lib/types';
import ContentPane, { type ContentPaneCallbacks } from './ContentPane';
import EditorHeader, { type EditorTab } from './EditorHeader';
import PreviewPane from './PreviewPane';
import TemplateTab from './TemplateTab';
import { useAutosaveRegistry } from './useAutosaveRegistry';

/** What the review page's resume step adds to the editor (D-044). */
export interface ResumeReviewMode {
  /** The agent's pick (C7): its rows carry a badge, and "Reset to agent
   *  pick" returns to it. Null hides the reset. */
  proposedSelection: Selections | null;
  /** Called each time a selection write lands, since it may have cleared
   *  this application's approval. */
  onSelectionsSaved: () => void;
  /** The step's own buttons, beside the reset. They get the save status so
   *  an approval can wait for the edit it is meant to cover. */
  actions: (saveStatus: SaveStatus) => ReactNode;
  /** The same status, for the page's later steps, which approve this
   *  resume without showing the editor. */
  onSaveStatusChange: (status: SaveStatus) => void;
  /** False while another step is showing. Hiding the editor sends any edit
   *  still in its debounce, so the status a later step sees is the truth. */
  visible: boolean;
}

interface ResumeEditorProps {
  resumeId: string;
  /** Present when the editor was opened from an application
   *  (`/resume/:id?application=:id`). Saving then writes the PDF to that
   *  application and returns to it, rather than downloading a snapshot. */
  applicationId?: string;
  /** Present inside the review page: the editor fills its step rather than
   *  the screen, has no back link or save action, and gains a footer. */
  review?: ResumeReviewMode;
}

type SliceValue = string[] | Record<string, string[]>;

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      resumeName: string;
      latestPdf: { filename: string; createdAt: string } | null;
      template: Template;
      library: Library;
    };

/** Merges a single field change into a per-entity draft so a burst of edits
 *  across different fields of the same entity coalesces into one PATCH. */
function useFieldDrafts() {
  const drafts = useRef<Record<string, Record<string, string>>>({});
  return useCallback((id: string, key: string, value: string): Record<string, string> => {
    const next = { ...(drafts.current[id] ?? {}), [key]: value };
    drafts.current[id] = next;
    return next;
  }, []);
}

export default function ResumeEditor({ resumeId, applicationId, review }: ResumeEditorProps) {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [tab, setTab] = useState<EditorTab>('content');
  const [selections, dispatchSelections] = useReducer(selectionsReducer, EMPTY_SELECTIONS);
  const selectionsRef = useRef<Selections>(EMPTY_SELECTIONS);
  // Destructured, not held as an `autosave` object: the registry returns a
  // fresh object literal every render, so `getController` in a
  // dependency array is unverifiable to the exhaustive-deps rule even though
  // `getController` itself is stable. The local binding is checkable.
  const {
    getController,
    retryAll: retryAllSaves,
    flushAll: flushAllSaves,
    status: saveStatus,
  } = useAutosaveRegistry();

  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const [splitPercent, setSplitPercent] = useState(55);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const experienceFieldDraft = useFieldDrafts();
  const projectFieldDraft = useFieldDrafts();
  const skillRowFieldDraft = useFieldDrafts();

  // Only the latest load may land. StrictMode runs the load effect twice
  // under `next dev`, and Retry starts another; an older answer arriving last
  // would `replace` the selections with ones read before an edit already
  // saved since, re-ticking what the server has unticked.
  const latestLoad = useRef(0);

  const loadResume = useCallback(async () => {
    const load = ++latestLoad.current;
    setState({ status: 'loading' });
    try {
      const detail = await getResumeDetail(resumeId);
      if (load !== latestLoad.current) return;
      selectionsRef.current = detail.selections;
      dispatchSelections({ type: 'replace', selections: detail.selections });
      setState({
        status: 'ready',
        resumeName: detail.resume.name,
        latestPdf: detail.resume.latestPdf,
        template: detail.template,
        library: detail.library,
      });
    } catch (error) {
      if (load !== latestLoad.current) return;
      setState({
        status: 'error',
        message: error instanceof ApiError ? error.message : 'Could not load this resume.',
      });
    }
  }, [resumeId]);

  useEffect(() => {
    void loadResume();
  }, [loadResume]);

  // ---------------------------------------------------------------------
  // Selections (per-resume): every mutation goes through this one function
  // so `selectionsRef` and the reducer's own state can never drift apart.
  // ---------------------------------------------------------------------
  const onSelectionsSaved = review?.onSelectionsSaved;
  const proposedSelection = review?.proposedSelection ?? null;

  /** One queue per slice, so a burst of edits to one slice coalesces and
   *  edits to different slices never overwrite each other. */
  const saveSlice = useCallback(
    (slice: keyof Selections, value: SliceValue) => {
      getController<SliceValue>(
        `selections:${slice}`,
        async (latest) => {
          await updateSelections(resumeId, { [slice]: latest } as Partial<Selections>);
          onSelectionsSaved?.();
        },
        0,
      ).schedule(value);
    },
    [getController, resumeId, onSelectionsSaved],
  );

  const dispatchAndSaveSelection = useCallback(
    (action: SelectionsAction) => {
      const next = selectionsReducer(selectionsRef.current, action);
      selectionsRef.current = next;
      dispatchSelections(action);

      const slice = affectedSlice(action);
      if (slice) saveSlice(slice, next[slice]);
    },
    [saveSlice],
  );

  /** Back to what the agent proposed. All six slices go through their usual
   *  queues, so a write already in flight for one cannot land after it. */
  function resetToAgentPick(): void {
    if (!proposedSelection) return;
    selectionsRef.current = proposedSelection;
    dispatchSelections({ type: 'replace', selections: proposedSelection });
    for (const slice of SLICES) saveSlice(slice, proposedSelection[slice]);
  }

  const agentPicks = useMemo(() => agentPickIds(proposedSelection), [proposedSelection]);

  const onSaveStatusChange = review?.onSaveStatusChange;
  useEffect(() => {
    onSaveStatusChange?.(saveStatus);
  }, [saveStatus, onSaveStatusChange]);

  const visible = review?.visible;
  useEffect(() => {
    if (visible === false) flushAllSaves();
  }, [visible, flushAllSaves]);

  const contentCallbacks: ContentPaneCallbacks = {
    onToggleTop: (slice, id) => dispatchAndSaveSelection({ type: 'toggleTop', slice, id }),
    onReorderTop: (slice, order) => dispatchAndSaveSelection({ type: 'reorderTop', slice, order }),
    onToggleNested: (slice, parentId, id) =>
      dispatchAndSaveSelection({ type: 'toggleNested', slice, parentId, id }),
    onReorderNested: (slice, parentId, order) =>
      dispatchAndSaveSelection({ type: 'reorderNested', slice, parentId, order }),

    // -- Experiences ------------------------------------------------------
    onExperienceFieldChange: (id, key, value) => {
      setState((prev) =>
        prev.status !== 'ready'
          ? prev
          : {
              ...prev,
              library: {
                ...prev.library,
                experiences: prev.library.experiences.map((e) =>
                  e.id === id ? { ...e, [key]: value } : e,
                ),
              },
            },
      );
      const draft = experienceFieldDraft(id, key, value);
      getController<Record<string, string>>(
        `experience:${id}`,
        (patch) => updateExperience(id, patch).then(() => undefined),
        500,
      ).schedule(draft);
    },
    onArchiveExperience: (id, isArchived) => {
      setState((prev) =>
        prev.status !== 'ready'
          ? prev
          : {
              ...prev,
              library: {
                ...prev.library,
                experiences: prev.library.experiences.map((e) =>
                  e.id === id ? { ...e, isArchived } : e,
                ),
              },
            },
      );
      getController<boolean>(
        `experience-archive:${id}`,
        (value) => updateExperience(id, { isArchived: value }).then(() => undefined),
        0,
      ).schedule(isArchived);
    },
    onCreateExperience: async (values) => {
      const created = await createExperience({
        company: values.company ?? '',
        title: values.title ?? '',
        dateRange: values.dateRange ?? '',
        location: values.location ?? '',
      });
      setState((prev) =>
        prev.status !== 'ready'
          ? prev
          : {
              ...prev,
              library: { ...prev.library, experiences: [...prev.library.experiences, created] },
            },
      );
    },
    onCreateExperienceBullet: async (experienceId, content) => {
      const created = await createExperienceBullet(experienceId, content);
      setState((prev) =>
        prev.status !== 'ready'
          ? prev
          : {
              ...prev,
              library: {
                ...prev.library,
                experiences: prev.library.experiences.map((e) =>
                  e.id === experienceId ? { ...e, bullets: [...e.bullets, created] } : e,
                ),
              },
            },
      );
    },
    onExperienceBulletContentChange: (bulletId, content) => {
      setState((prev) =>
        prev.status !== 'ready'
          ? prev
          : {
              ...prev,
              library: {
                ...prev.library,
                experiences: prev.library.experiences.map((e) => ({
                  ...e,
                  bullets: e.bullets.map((b) => (b.id === bulletId ? { ...b, content } : b)),
                })),
              },
            },
      );
      getController<string>(
        `experience-bullet:${bulletId}`,
        (value) => updateExperienceBullet(bulletId, { content: value }).then(() => undefined),
        500,
      ).schedule(content);
    },
    onArchiveExperienceBullet: (bulletId, isArchived) => {
      setState((prev) =>
        prev.status !== 'ready'
          ? prev
          : {
              ...prev,
              library: {
                ...prev.library,
                experiences: prev.library.experiences.map((e) => ({
                  ...e,
                  bullets: e.bullets.map((b) => (b.id === bulletId ? { ...b, isArchived } : b)),
                })),
              },
            },
      );
      getController<boolean>(
        `experience-bullet-archive:${bulletId}`,
        (value) => updateExperienceBullet(bulletId, { isArchived: value }).then(() => undefined),
        0,
      ).schedule(isArchived);
    },

    // -- Projects -----------------------------------------------------------
    onProjectFieldChange: (id, key, value) => {
      setState((prev) =>
        prev.status !== 'ready'
          ? prev
          : {
              ...prev,
              library: {
                ...prev.library,
                projects: prev.library.projects.map((p) =>
                  p.id === id ? { ...p, [key]: value } : p,
                ),
              },
            },
      );
      const draft = projectFieldDraft(id, key, value);
      getController<Record<string, string>>(
        `project:${id}`,
        (patch) => updateProject(id, patch).then(() => undefined),
        500,
      ).schedule(draft);
    },
    onArchiveProject: (id, isArchived) => {
      setState((prev) =>
        prev.status !== 'ready'
          ? prev
          : {
              ...prev,
              library: {
                ...prev.library,
                projects: prev.library.projects.map((p) =>
                  p.id === id ? { ...p, isArchived } : p,
                ),
              },
            },
      );
      getController<boolean>(
        `project-archive:${id}`,
        (value) => updateProject(id, { isArchived: value }).then(() => undefined),
        0,
      ).schedule(isArchived);
    },
    onCreateProject: async (values) => {
      const created = await createProject({
        name: values.name ?? '',
        technologies: values.technologies ?? '',
        dateRange: values.dateRange ?? '',
      });
      setState((prev) =>
        prev.status !== 'ready'
          ? prev
          : {
              ...prev,
              library: { ...prev.library, projects: [...prev.library.projects, created] },
            },
      );
    },
    onCreateProjectBullet: async (projectId, content) => {
      const created = await createProjectBullet(projectId, content);
      setState((prev) =>
        prev.status !== 'ready'
          ? prev
          : {
              ...prev,
              library: {
                ...prev.library,
                projects: prev.library.projects.map((p) =>
                  p.id === projectId ? { ...p, bullets: [...p.bullets, created] } : p,
                ),
              },
            },
      );
    },
    onProjectBulletContentChange: (bulletId, content) => {
      setState((prev) =>
        prev.status !== 'ready'
          ? prev
          : {
              ...prev,
              library: {
                ...prev.library,
                projects: prev.library.projects.map((p) => ({
                  ...p,
                  bullets: p.bullets.map((b) => (b.id === bulletId ? { ...b, content } : b)),
                })),
              },
            },
      );
      getController<string>(
        `project-bullet:${bulletId}`,
        (value) => updateProjectBullet(bulletId, { content: value }).then(() => undefined),
        500,
      ).schedule(content);
    },
    onArchiveProjectBullet: (bulletId, isArchived) => {
      setState((prev) =>
        prev.status !== 'ready'
          ? prev
          : {
              ...prev,
              library: {
                ...prev.library,
                projects: prev.library.projects.map((p) => ({
                  ...p,
                  bullets: p.bullets.map((b) => (b.id === bulletId ? { ...b, isArchived } : b)),
                })),
              },
            },
      );
      getController<boolean>(
        `project-bullet-archive:${bulletId}`,
        (value) => updateProjectBullet(bulletId, { isArchived: value }).then(() => undefined),
        0,
      ).schedule(isArchived);
    },

    // -- Technical skill rows / skills ---------------------------------------
    onSkillRowFieldChange: (rowId, key, value) => {
      setState((prev) =>
        prev.status !== 'ready'
          ? prev
          : {
              ...prev,
              library: {
                ...prev.library,
                skillRows: prev.library.skillRows.map((r) =>
                  r.id === rowId ? { ...r, [key]: value } : r,
                ),
              },
            },
      );
      const draft = skillRowFieldDraft(rowId, key, value);
      getController<Record<string, string>>(
        `skill-row:${rowId}`,
        (patch) => updateSkillRow(rowId, patch).then(() => undefined),
        500,
      ).schedule(draft);
    },
    onArchiveSkillRow: (rowId, isArchived) => {
      setState((prev) =>
        prev.status !== 'ready'
          ? prev
          : {
              ...prev,
              library: {
                ...prev.library,
                skillRows: prev.library.skillRows.map((r) =>
                  r.id === rowId ? { ...r, isArchived } : r,
                ),
              },
            },
      );
      getController<boolean>(
        `skill-row-archive:${rowId}`,
        (value) => updateSkillRow(rowId, { isArchived: value }).then(() => undefined),
        0,
      ).schedule(isArchived);
    },
    onCreateSkillRow: async (top, values) => {
      const created = await createSkillRow({ name: values.name, top, separator: values.separator });
      setState((prev) =>
        prev.status !== 'ready'
          ? prev
          : {
              ...prev,
              library: { ...prev.library, skillRows: [...prev.library.skillRows, created] },
            },
      );
    },
    onCreateSkill: async (rowId, name) => {
      const created = await createSkill(rowId, name);
      setState((prev) =>
        prev.status !== 'ready'
          ? prev
          : {
              ...prev,
              library: {
                ...prev.library,
                skillRows: prev.library.skillRows.map((r) =>
                  r.id === rowId ? { ...r, skills: [...r.skills, created] } : r,
                ),
              },
            },
      );
    },
    onSkillNameChange: (skillId, name) => {
      setState((prev) =>
        prev.status !== 'ready'
          ? prev
          : {
              ...prev,
              library: {
                ...prev.library,
                skillRows: prev.library.skillRows.map((r) => ({
                  ...r,
                  skills: r.skills.map((s) => (s.id === skillId ? { ...s, name } : s)),
                })),
              },
            },
      );
      getController<string>(
        `skill:${skillId}`,
        (value) => updateSkill(skillId, { name: value }).then(() => undefined),
        500,
      ).schedule(name);
    },
    onArchiveSkill: (skillId, isArchived) => {
      setState((prev) =>
        prev.status !== 'ready'
          ? prev
          : {
              ...prev,
              library: {
                ...prev.library,
                skillRows: prev.library.skillRows.map((r) => ({
                  ...r,
                  skills: r.skills.map((s) => (s.id === skillId ? { ...s, isArchived } : s)),
                })),
              },
            },
      );
      getController<boolean>(
        `skill-archive:${skillId}`,
        (value) => updateSkill(skillId, { isArchived: value }).then(() => undefined),
        0,
      ).schedule(isArchived);
    },
  };

  const onResumeNameChange = useCallback(
    (name: string) => {
      setState((prev) => (prev.status !== 'ready' ? prev : { ...prev, resumeName: name }));
      getController<string>(
        'resume:name',
        (value) => updateResume(resumeId, { name: value }).then(() => undefined),
        500,
      ).schedule(name);
    },
    [getController, resumeId],
  );

  // Template content is optimistically updated the same way every other
  // content field is (see `onExperienceFieldChange` etc.): the editor's
  // in-memory `state.template.content` *is* the draft the live preview
  // reads from, and autosave persists it to every resume that references
  // this template in the background, on a longer ~1s debounce since a full
  // LaTeX document is a much bigger payload than a bullet.
  function onTemplateContentChange(content: string): void {
    if (state.status !== 'ready') return;
    const templateId = state.template.id;
    setState((prev) =>
      prev.status !== 'ready' ? prev : { ...prev, template: { ...prev.template, content } },
    );
    getController<string>(
      'template:content',
      (value) => updateTemplate(templateId, { content: value }).then(() => undefined),
      1000,
    ).schedule(content);
  }

  /**
   * The primary action, which means two different things.
   *
   * From an application: render, store the snapshot on the application, and
   * go back to it — you came here to tailor this resume for that job, and
   * saving is what finishes the errand. From the library: snapshot the resume
   * and download it, as it has always worked.
   */
  async function handleDownload(): Promise<void> {
    setDownloading(true);
    setDownloadError(null);
    try {
      if (applicationId !== undefined) {
        const saved = await saveResumeToApplication(applicationId);
        if (!saved.ok) {
          setDownloadError(saved.errors[0] ?? 'The LaTeX for this resume failed to compile.');
          return;
        }
        router.push(`/applications/${applicationId}`);
        return;
      }

      const result = await saveResumePdf(resumeId);
      if (!result.ok) {
        setDownloadError(result.errors[0] ?? 'The LaTeX for this resume failed to compile.');
        return;
      }
      setState((prev) =>
        prev.status !== 'ready'
          ? prev
          : { ...prev, latestPdf: { filename: result.filename, createdAt: result.createdAt } },
      );
      await downloadResumePdf(resumeId);
    } catch (error) {
      setDownloadError(error instanceof ApiError ? error.message : 'Could not save the PDF.');
    } finally {
      setDownloading(false);
    }
  }

  // -- Live preview ---------------------------------------------------------
  // The pane re-renders whenever any of these three change; it never reads
  // the key, only compares it. Selections and library are a change *signal*
  // only — `POST /render` re-reads the resume's persisted state itself, and
  // the one piece of client state it needs is the template draft, which
  // rides along as `templateOverride` so unsaved LaTeX previews too.
  const templateContent = state.status === 'ready' ? state.template.content : '';
  const previewKey = useMemo(
    () =>
      state.status === 'ready'
        ? JSON.stringify([selections, state.library, templateContent])
        : 'loading',
    [state, selections, templateContent],
  );
  const renderPreview = useCallback(
    () => renderResume(resumeId, templateContent),
    [resumeId, templateContent],
  );

  // -- Resizable divider (cheap: raw mouse events, percentage split) --------
  useEffect(() => {
    function handleMouseMove(event: MouseEvent): void {
      if (!draggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((event.clientX - rect.left) / rect.width) * 100;
      setSplitPercent(Math.min(75, Math.max(25, pct)));
    }
    function handleMouseUp(): void {
      if (draggingRef.current) {
        draggingRef.current = false;
        document.body.style.removeProperty('cursor');
      }
    }
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // In review the editor fills its step, under the page's own header.
  const frame = review ? 'flex min-h-0 flex-1' : 'flex h-screen';

  if (state.status === 'loading') {
    return (
      <div className={`${frame} items-center justify-center text-sm text-ink-dim`}>
        Loading resume…
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className={`${frame} items-center justify-center p-6`}>
        <div className="max-w-sm rounded-lg border border-danger-line/50 bg-danger-surface/30 p-6 text-sm text-danger-ink">
          <p className="font-medium">Couldn&apos;t load this resume.</p>
          <p className="mt-1 text-danger/80">{state.message}</p>
          <button
            type="button"
            onClick={() => void loadResume()}
            className="mt-4 rounded-md border border-danger-line-strong px-3 py-1.5 text-sm text-danger-ink-strong transition-colors hover:bg-danger-line/30"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const atAgentPick = proposedSelection !== null && sameSelections(selections, proposedSelection);

  return (
    <div className={`${frame} flex-col bg-canvas`}>
      <EditorHeader
        resumeName={state.resumeName}
        onResumeNameChange={onResumeNameChange}
        tab={tab}
        onTabChange={setTab}
        saveStatus={saveStatus}
        onRetry={retryAllSaves}
        onDownload={() => void handleDownload()}
        downloading={downloading}
        downloadError={downloadError}
        applicationId={applicationId}
        embedded={review !== undefined}
      />

      <div ref={containerRef} className="flex min-h-0 flex-1">
        <div style={{ width: `${splitPercent}%` }} className="min-h-0 overflow-hidden p-3">
          {tab === 'content' ? (
            <ContentPane
              library={state.library}
              selections={selections}
              callbacks={contentCallbacks}
              agentPicks={agentPicks}
            />
          ) : (
            <TemplateTab
              template={state.template}
              onContentChange={onTemplateContentChange}
              saveStatus={saveStatus}
              onRetry={retryAllSaves}
            />
          )}
        </div>

        <div
          role="separator"
          aria-orientation="vertical"
          onMouseDown={() => {
            draggingRef.current = true;
            document.body.style.cursor = 'col-resize';
          }}
          className="w-1 shrink-0 cursor-col-resize bg-line transition-colors hover:bg-accent"
        />

        <div style={{ width: `${100 - splitPercent}%` }} className="min-h-0 overflow-hidden p-3">
          <PreviewPane renderKey={previewKey} render={renderPreview} />
        </div>
      </div>

      {review ? (
        // `pr-48` keeps the actions out from under the fixed "Give feedback"
        // button (FeedbackWidget), which sits over this corner of every page.
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line bg-surface py-3 pr-48 pl-4">
          <p className="text-xs text-ink-dim">
            Same editor as /resume/:id. Ticking changes this application&apos;s resume; editing text
            changes every resume.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {proposedSelection ? (
              <button
                type="button"
                onClick={resetToAgentPick}
                disabled={atAgentPick}
                title="Puts back exactly what the agent proposed, order included"
                className="rounded-md border border-line px-3 py-1.5 text-sm text-ink transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                {atAgentPick ? "Already the agent's pick" : 'Reset to agent pick'}
              </button>
            ) : null}
            {review.actions(saveStatus)}
          </div>
        </footer>
      ) : null}
    </div>
  );
}
