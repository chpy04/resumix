'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
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
  saveResumePdf,
  updateExperience,
  updateExperienceBullet,
  updateProject,
  updateProjectBullet,
  updateResume,
  updateSelections,
  updateSkill,
  updateSkillRow,
} from '@/lib/api-client';
import { affectedSlice, selectionsReducer, type SelectionsAction } from '@/lib/editor/selections-reducer';
import { EMPTY_SELECTIONS, type Library, type Selections, type Template } from '@/lib/types';
import ContentPane, { type ContentPaneCallbacks } from './ContentPane';
import EditorHeader, { type EditorTab } from './EditorHeader';
import PreviewPanePlaceholder from './PreviewPanePlaceholder';
import TemplateTabPlaceholder from './TemplateTabPlaceholder';
import { useAutosaveRegistry } from './useAutosaveRegistry';

interface ResumeEditorProps {
  resumeId: string;
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

export default function ResumeEditor({ resumeId }: ResumeEditorProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [tab, setTab] = useState<EditorTab>('content');
  const [selections, dispatchSelections] = useReducer(selectionsReducer, EMPTY_SELECTIONS);
  const selectionsRef = useRef<Selections>(EMPTY_SELECTIONS);
  const autosave = useAutosaveRegistry();

  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const [splitPercent, setSplitPercent] = useState(55);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const experienceFieldDraft = useFieldDrafts();
  const projectFieldDraft = useFieldDrafts();
  const skillRowFieldDraft = useFieldDrafts();

  const loadResume = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const detail = await getResumeDetail(resumeId);
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
  const dispatchAndSaveSelection = useCallback(
    (action: SelectionsAction) => {
      const next = selectionsReducer(selectionsRef.current, action);
      selectionsRef.current = next;
      dispatchSelections(action);

      const slice = affectedSlice(action);
      if (!slice) return;
      const controller = autosave.getController<SliceValue>(
        `selections:${slice}`,
        (value) => updateSelections(resumeId, { [slice]: value } as Partial<Selections>).then(() => undefined),
        0,
      );
      controller.schedule(next[slice]);
    },
    [autosave.getController, resumeId],
  );

  const contentCallbacks: ContentPaneCallbacks = {
    onToggleTop: (slice, id) => dispatchAndSaveSelection({ type: 'toggleTop', slice, id }),
    onReorderTop: (slice, order) => dispatchAndSaveSelection({ type: 'reorderTop', slice, order }),
    onToggleNested: (slice, parentId, id) => dispatchAndSaveSelection({ type: 'toggleNested', slice, parentId, id }),
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
                experiences: prev.library.experiences.map((e) => (e.id === id ? { ...e, [key]: value } : e)),
              },
            },
      );
      const draft = experienceFieldDraft(id, key, value);
      autosave
        .getController<Record<string, string>>(
          `experience:${id}`,
          (patch) => updateExperience(id, patch).then(() => undefined),
          500,
        )
        .schedule(draft);
    },
    onArchiveExperience: (id, isArchived) => {
      setState((prev) =>
        prev.status !== 'ready'
          ? prev
          : {
              ...prev,
              library: {
                ...prev.library,
                experiences: prev.library.experiences.map((e) => (e.id === id ? { ...e, isArchived } : e)),
              },
            },
      );
      autosave
        .getController<boolean>(
          `experience-archive:${id}`,
          (value) => updateExperience(id, { isArchived: value }).then(() => undefined),
          0,
        )
        .schedule(isArchived);
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
          : { ...prev, library: { ...prev.library, experiences: [...prev.library.experiences, created] } },
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
      autosave
        .getController<string>(
          `experience-bullet:${bulletId}`,
          (value) => updateExperienceBullet(bulletId, { content: value }).then(() => undefined),
          500,
        )
        .schedule(content);
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
      autosave
        .getController<boolean>(
          `experience-bullet-archive:${bulletId}`,
          (value) => updateExperienceBullet(bulletId, { isArchived: value }).then(() => undefined),
          0,
        )
        .schedule(isArchived);
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
                projects: prev.library.projects.map((p) => (p.id === id ? { ...p, [key]: value } : p)),
              },
            },
      );
      const draft = projectFieldDraft(id, key, value);
      autosave
        .getController<Record<string, string>>(
          `project:${id}`,
          (patch) => updateProject(id, patch).then(() => undefined),
          500,
        )
        .schedule(draft);
    },
    onArchiveProject: (id, isArchived) => {
      setState((prev) =>
        prev.status !== 'ready'
          ? prev
          : {
              ...prev,
              library: {
                ...prev.library,
                projects: prev.library.projects.map((p) => (p.id === id ? { ...p, isArchived } : p)),
              },
            },
      );
      autosave
        .getController<boolean>(
          `project-archive:${id}`,
          (value) => updateProject(id, { isArchived: value }).then(() => undefined),
          0,
        )
        .schedule(isArchived);
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
          : { ...prev, library: { ...prev.library, projects: [...prev.library.projects, created] } },
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
      autosave
        .getController<string>(
          `project-bullet:${bulletId}`,
          (value) => updateProjectBullet(bulletId, { content: value }).then(() => undefined),
          500,
        )
        .schedule(content);
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
      autosave
        .getController<boolean>(
          `project-bullet-archive:${bulletId}`,
          (value) => updateProjectBullet(bulletId, { isArchived: value }).then(() => undefined),
          0,
        )
        .schedule(isArchived);
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
                skillRows: prev.library.skillRows.map((r) => (r.id === rowId ? { ...r, [key]: value } : r)),
              },
            },
      );
      const draft = skillRowFieldDraft(rowId, key, value);
      autosave
        .getController<Record<string, string>>(
          `skill-row:${rowId}`,
          (patch) => updateSkillRow(rowId, patch).then(() => undefined),
          500,
        )
        .schedule(draft);
    },
    onArchiveSkillRow: (rowId, isArchived) => {
      setState((prev) =>
        prev.status !== 'ready'
          ? prev
          : {
              ...prev,
              library: {
                ...prev.library,
                skillRows: prev.library.skillRows.map((r) => (r.id === rowId ? { ...r, isArchived } : r)),
              },
            },
      );
      autosave
        .getController<boolean>(
          `skill-row-archive:${rowId}`,
          (value) => updateSkillRow(rowId, { isArchived: value }).then(() => undefined),
          0,
        )
        .schedule(isArchived);
    },
    onCreateSkillRow: async (top, values) => {
      const created = await createSkillRow({ name: values.name, top, separator: values.separator });
      setState((prev) =>
        prev.status !== 'ready'
          ? prev
          : { ...prev, library: { ...prev.library, skillRows: [...prev.library.skillRows, created] } },
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
      autosave
        .getController<string>(`skill:${skillId}`, (value) => updateSkill(skillId, { name: value }).then(() => undefined), 500)
        .schedule(name);
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
      autosave
        .getController<boolean>(
          `skill-archive:${skillId}`,
          (value) => updateSkill(skillId, { isArchived: value }).then(() => undefined),
          0,
        )
        .schedule(isArchived);
    },
  };

  const onResumeNameChange = useCallback(
    (name: string) => {
      setState((prev) => (prev.status !== 'ready' ? prev : { ...prev, resumeName: name }));
      autosave
        .getController<string>('resume:name', (value) => updateResume(resumeId, { name: value }).then(() => undefined), 500)
        .schedule(name);
    },
    [autosave.getController, resumeId],
  );

  async function handleDownload(): Promise<void> {
    setDownloading(true);
    setDownloadError(null);
    try {
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

  if (state.status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-[var(--color-ink-dim)]">
        Loading resume…
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="flex h-screen items-center justify-center p-6">
        <div className="max-w-sm rounded-lg border border-red-900/50 bg-red-950/30 p-6 text-sm text-red-300">
          <p className="font-medium">Couldn&apos;t load this resume.</p>
          <p className="mt-1 text-red-400/80">{state.message}</p>
          <button
            type="button"
            onClick={() => void loadResume()}
            className="mt-4 rounded-md border border-red-800 px-3 py-1.5 text-sm text-red-200 transition-colors hover:bg-red-900/30"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-[var(--color-canvas)]">
      <EditorHeader
        resumeName={state.resumeName}
        onResumeNameChange={onResumeNameChange}
        tab={tab}
        onTabChange={setTab}
        saveStatus={autosave.status}
        onRetry={autosave.retryAll}
        onDownload={() => void handleDownload()}
        downloading={downloading}
        downloadError={downloadError}
      />

      <div ref={containerRef} className="flex min-h-0 flex-1">
        <div style={{ width: `${splitPercent}%` }} className="min-h-0 overflow-hidden p-3">
          {tab === 'content' ? (
            <ContentPane library={state.library} selections={selections} callbacks={contentCallbacks} />
          ) : (
            <TemplateTabPlaceholder template={state.template} />
          )}
        </div>

        <div
          role="separator"
          aria-orientation="vertical"
          onMouseDown={() => {
            draggingRef.current = true;
            document.body.style.cursor = 'col-resize';
          }}
          className="w-1 shrink-0 cursor-col-resize bg-[var(--color-line)] transition-colors hover:bg-[var(--color-accent)]"
        />

        <div style={{ width: `${100 - splitPercent}%` }} className="min-h-0 overflow-hidden p-3">
          <PreviewPanePlaceholder
            resumeId={resumeId}
            templateName={state.template.name}
            hasSavedPdf={state.latestPdf !== null}
          />
        </div>
      </div>
    </div>
  );
}
