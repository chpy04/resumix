'use client';

import { useState } from 'react';
import type { Experience, Library, Project, Selections } from '@/lib/types';
import ItemBulletSection, { type FieldSpec } from './ItemBulletSection';
import SkillsSection from './SkillsSection';

const experienceFields: FieldSpec<Experience>[] = [
  {
    key: 'company',
    label: 'Company',
    getValue: (e) => e.company,
    primary: true,
    placeholder: 'Company',
  },
  { key: 'title', label: 'Title', getValue: (e) => e.title, placeholder: 'Title' },
  {
    key: 'dateRange',
    label: 'Dates',
    getValue: (e) => e.dateRange,
    placeholder: 'Jan 2024 – Present',
  },
  { key: 'location', label: 'Location', getValue: (e) => e.location, placeholder: 'City, ST' },
];

const projectFields: FieldSpec<Project>[] = [
  {
    key: 'name',
    label: 'Name',
    getValue: (p) => p.name,
    primary: true,
    placeholder: 'Project name',
  },
  {
    key: 'technologies',
    label: 'Technologies',
    getValue: (p) => p.technologies,
    placeholder: 'React, Postgres, ...',
  },
  { key: 'dateRange', label: 'Dates', getValue: (p) => p.dateRange, placeholder: 'Spring 2024' },
];

export interface ContentPaneCallbacks {
  onToggleTop: (slice: 'experiences' | 'projects' | 'skillRows', id: string) => void;
  onReorderTop: (slice: 'experiences' | 'projects' | 'skillRows', order: string[]) => void;
  onToggleNested: (
    slice: 'experienceBullets' | 'projectBullets' | 'skills',
    parentId: string,
    id: string,
  ) => void;
  onReorderNested: (
    slice: 'experienceBullets' | 'projectBullets' | 'skills',
    parentId: string,
    order: string[],
  ) => void;

  onExperienceFieldChange: (id: string, key: string, value: string) => void;
  onArchiveExperience: (id: string, isArchived: boolean) => void;
  onCreateExperience: (values: Record<string, string>) => Promise<void>;
  onCreateExperienceBullet: (experienceId: string, content: string) => Promise<void>;
  onExperienceBulletContentChange: (bulletId: string, content: string) => void;
  onArchiveExperienceBullet: (bulletId: string, isArchived: boolean) => void;

  onProjectFieldChange: (id: string, key: string, value: string) => void;
  onArchiveProject: (id: string, isArchived: boolean) => void;
  onCreateProject: (values: Record<string, string>) => Promise<void>;
  onCreateProjectBullet: (projectId: string, content: string) => Promise<void>;
  onProjectBulletContentChange: (bulletId: string, content: string) => void;
  onArchiveProjectBullet: (bulletId: string, isArchived: boolean) => void;

  onSkillRowFieldChange: (rowId: string, key: 'name' | 'separator', value: string) => void;
  onArchiveSkillRow: (rowId: string, isArchived: boolean) => void;
  onCreateSkillRow: (top: boolean, values: { name: string; separator?: string }) => Promise<void>;
  onCreateSkill: (rowId: string, name: string) => Promise<void>;
  onSkillNameChange: (skillId: string, name: string) => void;
  onArchiveSkill: (skillId: string, isArchived: boolean) => void;
}

interface ContentPaneProps {
  library: Library;
  selections: Selections;
  callbacks: ContentPaneCallbacks;
}

/**
 * Left-pane body for the Content tab: Experiences, Projects, and Technical
 * Skill Rows (split top/bottom). Owns only the "show archived" toggle —
 * everything else is lifted into `ResumeEditor` (selections state + the
 * autosave registry) and handed down as plain callbacks.
 */
export default function ContentPane({ library, selections, callbacks }: ContentPaneProps) {
  const [showArchived, setShowArchived] = useState(false);

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto pr-1">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2">
        <p className="text-xs text-ink-dim">
          Checkboxes and drag order save to <span className="text-ink">this resume only</span>.
          Editing text, adding, or archiving (⊕) changes it{' '}
          <span className="text-ink">everywhere</span>.
        </p>
        <label className="flex shrink-0 items-center gap-1.5 text-xs text-ink-dim">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => setShowArchived(event.target.checked)}
            className="h-3.5 w-3.5 accent-accent"
          />
          Show archived
        </label>
      </div>

      <ItemBulletSection<Experience>
        title="Experiences"
        itemNoun="experience"
        bulletNoun="bullet"
        items={library.experiences}
        fields={experienceFields}
        selectedOrder={selections.experiences}
        bulletSelections={selections.experienceBullets}
        showArchived={showArchived}
        onToggleItem={(id) => callbacks.onToggleTop('experiences', id)}
        onReorderItems={(order) => callbacks.onReorderTop('experiences', order)}
        onToggleBullet={(parentId, id) =>
          callbacks.onToggleNested('experienceBullets', parentId, id)
        }
        onReorderBullets={(parentId, order) =>
          callbacks.onReorderNested('experienceBullets', parentId, order)
        }
        onFieldChange={callbacks.onExperienceFieldChange}
        onArchiveItem={callbacks.onArchiveExperience}
        onCreateItem={callbacks.onCreateExperience}
        onCreateBullet={callbacks.onCreateExperienceBullet}
        onBulletContentChange={callbacks.onExperienceBulletContentChange}
        onArchiveBullet={callbacks.onArchiveExperienceBullet}
      />

      <ItemBulletSection<Project>
        title="Projects"
        itemNoun="project"
        bulletNoun="bullet"
        items={library.projects}
        fields={projectFields}
        selectedOrder={selections.projects}
        bulletSelections={selections.projectBullets}
        showArchived={showArchived}
        onToggleItem={(id) => callbacks.onToggleTop('projects', id)}
        onReorderItems={(order) => callbacks.onReorderTop('projects', order)}
        onToggleBullet={(parentId, id) => callbacks.onToggleNested('projectBullets', parentId, id)}
        onReorderBullets={(parentId, order) =>
          callbacks.onReorderNested('projectBullets', parentId, order)
        }
        onFieldChange={callbacks.onProjectFieldChange}
        onArchiveItem={callbacks.onArchiveProject}
        onCreateItem={callbacks.onCreateProject}
        onCreateBullet={callbacks.onCreateProjectBullet}
        onBulletContentChange={callbacks.onProjectBulletContentChange}
        onArchiveBullet={callbacks.onArchiveProjectBullet}
      />

      <SkillsSection
        top
        title="Technical Skills (top)"
        rows={library.skillRows}
        selectedRowOrder={selections.skillRows}
        skillSelections={selections.skills}
        showArchived={showArchived}
        onToggleRow={(id) => callbacks.onToggleTop('skillRows', id)}
        onReorderRows={(order) => callbacks.onReorderTop('skillRows', order)}
        onToggleSkill={(rowId, id) => callbacks.onToggleNested('skills', rowId, id)}
        onReorderSkills={(rowId, order) => callbacks.onReorderNested('skills', rowId, order)}
        onRowFieldChange={callbacks.onSkillRowFieldChange}
        onArchiveRow={callbacks.onArchiveSkillRow}
        onCreateRow={(values) => callbacks.onCreateSkillRow(true, values)}
        onCreateSkill={callbacks.onCreateSkill}
        onSkillNameChange={callbacks.onSkillNameChange}
        onArchiveSkill={callbacks.onArchiveSkill}
      />

      <SkillsSection
        top={false}
        title="Additional Information (bottom)"
        rows={library.skillRows}
        selectedRowOrder={selections.skillRows}
        skillSelections={selections.skills}
        showArchived={showArchived}
        onToggleRow={(id) => callbacks.onToggleTop('skillRows', id)}
        onReorderRows={(order) => callbacks.onReorderTop('skillRows', order)}
        onToggleSkill={(rowId, id) => callbacks.onToggleNested('skills', rowId, id)}
        onReorderSkills={(rowId, order) => callbacks.onReorderNested('skills', rowId, order)}
        onRowFieldChange={callbacks.onSkillRowFieldChange}
        onArchiveRow={callbacks.onArchiveSkillRow}
        onCreateRow={(values) => callbacks.onCreateSkillRow(false, values)}
        onCreateSkill={callbacks.onCreateSkill}
        onSkillNameChange={callbacks.onSkillNameChange}
        onArchiveSkill={callbacks.onArchiveSkill}
      />
    </div>
  );
}
