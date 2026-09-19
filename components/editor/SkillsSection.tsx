'use client';

import { useState } from 'react';
import type { Skill, SkillRow } from '@/lib/types';
import { extractSelectedOrder, orderForDisplay, visibleItems } from '@/lib/editor/visibility';
import { ArchiveButton, ArchivedBadge, GlobalEditBadge, SelectToggle } from './atoms';
import SortableList from './SortableList';
import SortableRow from './SortableRow';

interface SkillsSectionProps {
  /** true -> "Technical Skills" (top of resume); false -> "Additional Information" (bottom). */
  top: boolean;
  title: string;
  rows: SkillRow[];
  selectedRowOrder: string[];
  skillSelections: Record<string, string[]>;
  showArchived: boolean;
  onToggleRow: (id: string) => void;
  onReorderRows: (order: string[]) => void;
  onToggleSkill: (rowId: string, skillId: string) => void;
  onReorderSkills: (rowId: string, order: string[]) => void;
  onRowFieldChange: (rowId: string, key: 'name' | 'separator', value: string) => void;
  onArchiveRow: (rowId: string, isArchived: boolean) => void;
  onCreateRow: (values: { name: string; separator?: string }) => Promise<void>;
  onCreateSkill: (rowId: string, name: string) => Promise<void>;
  onSkillNameChange: (skillId: string, name: string) => void;
  onArchiveSkill: (skillId: string, isArchived: boolean) => void;
}

/** Technical skill rows are structurally close to experiences/projects (a
 *  parent + orderable/selectable children) but children only have a `name`
 *  (no bullet content, no monospace), and rows carry a `top`/`separator`
 *  the other content types don't — different enough to not force through
 *  `ItemBulletSection`'s generic shape. */
export default function SkillsSection({
  top,
  title,
  rows,
  selectedRowOrder,
  skillSelections,
  showArchived,
  onToggleRow,
  onReorderRows,
  onToggleSkill,
  onReorderSkills,
  onRowFieldChange,
  onArchiveRow,
  onCreateRow,
  onCreateSkill,
  onSkillNameChange,
  onArchiveSkill,
}: SkillsSectionProps) {
  const [adding, setAdding] = useState(false);
  const scoped = rows.filter((row) => row.top === top);
  const selectedSet = new Set(selectedRowOrder);
  const visible = visibleItems(scoped, selectedRowOrder, showArchived);
  const ordered = orderForDisplay(visible, selectedRowOrder);
  const orderedIds = ordered.map((row) => row.id);

  function handleReorder(newIds: string[]): void {
    onReorderRows(extractSelectedOrder(newIds, selectedRowOrder));
  }

  return (
    <section className="rounded-lg border border-line bg-surface">
      <header className="flex items-center justify-between border-b border-line px-3 py-2">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="rounded border border-line px-2 py-1 text-xs text-ink-dim transition-colors hover:border-accent hover:text-accent"
        >
          {adding ? 'Cancel' : '+ Add row'}
        </button>
      </header>

      {adding ? (
        <CreateRowForm
          onCancel={() => setAdding(false)}
          onSubmit={async (values) => {
            await onCreateRow(values);
            setAdding(false);
          }}
        />
      ) : null}

      {orderedIds.length === 0 ? (
        <p className="px-3 py-4 text-xs text-ink-dim">
          No rows yet{showArchived ? '' : ' (or all are archived)'}.
        </p>
      ) : (
        <SortableList
          ids={orderedIds}
          onReorder={handleReorder}
          className="flex flex-col gap-1 p-2"
        >
          {ordered.map((row) => (
            <SortableRow key={row.id} id={row.id}>
              <SkillRowCard
                row={row}
                selected={selectedSet.has(row.id)}
                showArchived={showArchived}
                skillOrder={skillSelections[row.id] ?? []}
                onToggleSelected={() => onToggleRow(row.id)}
                onFieldChange={(key, value) => onRowFieldChange(row.id, key, value)}
                onArchive={() => onArchiveRow(row.id, !row.isArchived)}
                onToggleSkill={(skillId) => onToggleSkill(row.id, skillId)}
                onReorderSkills={(order) => onReorderSkills(row.id, order)}
                onCreateSkill={(name) => onCreateSkill(row.id, name)}
                onSkillNameChange={onSkillNameChange}
                onArchiveSkill={onArchiveSkill}
              />
            </SortableRow>
          ))}
        </SortableList>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

interface SkillRowCardProps {
  row: SkillRow;
  selected: boolean;
  showArchived: boolean;
  skillOrder: string[];
  onToggleSelected: () => void;
  onFieldChange: (key: 'name' | 'separator', value: string) => void;
  onArchive: () => void;
  onToggleSkill: (skillId: string) => void;
  onReorderSkills: (order: string[]) => void;
  onCreateSkill: (name: string) => Promise<void>;
  onSkillNameChange: (skillId: string, name: string) => void;
  onArchiveSkill: (skillId: string, isArchived: boolean) => void;
}

function SkillRowCard({
  row,
  selected,
  showArchived,
  skillOrder,
  onToggleSelected,
  onFieldChange,
  onArchive,
  onToggleSkill,
  onReorderSkills,
  onCreateSkill,
  onSkillNameChange,
  onArchiveSkill,
}: SkillRowCardProps) {
  const [addingSkill, setAddingSkill] = useState(false);
  const [skillName, setSkillName] = useState('');
  const [skillError, setSkillError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedSet = new Set(skillOrder);
  const visible = visibleItems(row.skills, skillOrder, showArchived);
  const ordered = orderForDisplay(visible, skillOrder);
  const orderedIds = ordered.map((s) => s.id);

  function handleReorder(newIds: string[]): void {
    onReorderSkills(extractSelectedOrder(newIds, skillOrder));
  }

  async function handleAddSkill(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (skillName.trim().length === 0) return;
    setSubmitting(true);
    setSkillError(null);
    try {
      await onCreateSkill(skillName.trim());
      setSkillName('');
      setAddingSkill(false);
    } catch (err) {
      setSkillError(err instanceof Error ? err.message : 'Could not add skill.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className={`rounded-md border px-2 py-1.5 ${
        selected ? 'border-accent/40 bg-surface-2' : 'border-line'
      } ${row.isArchived ? 'opacity-70' : ''}`}
    >
      <div className="flex items-center gap-2">
        <SelectToggle
          checked={selected}
          onChange={onToggleSelected}
          label={`Include ${row.name} on this resume`}
        />
        <input
          value={row.name}
          onChange={(event) => onFieldChange('name', event.target.value)}
          placeholder="Row name (e.g. Languages)"
          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs font-medium text-ink outline-none hover:border-line focus:border-accent"
        />
        <input
          value={row.separator}
          onChange={(event) => onFieldChange('separator', event.target.value)}
          title="Separator joining this row's skills, e.g. ', '"
          className="w-16 min-w-0 shrink-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-ink-dim outline-none hover:border-line focus:border-accent"
        />
        <GlobalEditBadge />
        {row.isArchived ? <ArchivedBadge /> : null}
        <ArchiveButton isArchived={row.isArchived} onClick={onArchive} />
      </div>

      <div className="mt-2 border-t border-line pt-2 pl-7">
        {orderedIds.length === 0 ? (
          <p className="text-[11px] text-ink-dim">No skills yet.</p>
        ) : (
          <SortableList
            ids={orderedIds}
            onReorder={handleReorder}
            className="flex flex-wrap gap-1.5"
          >
            {ordered.map((skill) => (
              <SkillChip
                key={skill.id}
                skill={skill}
                selected={selectedSet.has(skill.id)}
                onToggle={() => onToggleSkill(skill.id)}
                onNameChange={(value) => onSkillNameChange(skill.id, value)}
                onArchive={() => onArchiveSkill(skill.id, !skill.isArchived)}
              />
            ))}
          </SortableList>
        )}

        {addingSkill ? (
          <form onSubmit={handleAddSkill} className="mt-1.5 flex items-center gap-1.5">
            <input
              value={skillName}
              onChange={(event) => setSkillName(event.target.value)}
              autoFocus
              placeholder="Skill name"
              className="min-w-0 flex-1 rounded border border-line bg-surface-2 px-1.5 py-0.5 text-xs text-ink outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={submitting}
              className="rounded bg-accent px-1.5 py-0.5 text-[11px] font-medium text-canvas disabled:opacity-50"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => setAddingSkill(false)}
              className="text-[11px] text-ink-dim hover:text-ink"
            >
              Cancel
            </button>
            {skillError ? <span className="text-[11px] text-danger">{skillError}</span> : null}
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setAddingSkill(true)}
            className="mt-1.5 text-[11px] text-ink-dim transition-colors hover:text-accent"
          >
            + Add skill
          </button>
        )}
      </div>
    </div>
  );
}

function SkillChip({
  skill,
  selected,
  onToggle,
  onNameChange,
  onArchive,
}: {
  skill: Skill;
  selected: boolean;
  onToggle: () => void;
  onNameChange: (value: string) => void;
  onArchive: () => void;
}) {
  return (
    <SortableRow
      id={skill.id}
      className={`!gap-1 rounded border px-1 py-0.5 ${
        selected ? 'border-accent/40 bg-surface-2' : 'border-line'
      } ${skill.isArchived ? 'opacity-70' : ''}`}
    >
      <div className="flex items-center gap-1">
        <SelectToggle
          checked={selected}
          onChange={onToggle}
          label={`Include ${skill.name} on this resume`}
        />
        <input
          value={skill.name}
          onChange={(event) => onNameChange(event.target.value)}
          size={Math.max(4, skill.name.length)}
          className="min-w-0 rounded border border-transparent bg-transparent px-0.5 text-xs text-ink outline-none hover:border-line focus:border-accent"
        />
        {skill.isArchived ? <ArchivedBadge /> : null}
        <button
          type="button"
          onClick={onArchive}
          title={skill.isArchived ? 'Unarchive (global)' : 'Archive (global)'}
          className="text-[10px] text-ink-dim hover:text-accent"
        >
          {skill.isArchived ? '⟲' : '✕'}
        </button>
      </div>
    </SortableRow>
  );
}

function CreateRowForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (values: { name: string; separator?: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (name.trim().length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ name: name.trim() });
      setName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create row.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-center gap-2 border-b border-line bg-surface-2 px-3 py-2"
    >
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Row name (e.g. Languages)"
        autoFocus
        className="min-w-0 flex-1 rounded border border-line bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-accent"
      />
      {error ? <span className="text-xs text-danger">{error}</span> : null}
      <button
        type="submit"
        disabled={submitting}
        className="rounded bg-accent px-2 py-1 text-xs font-medium text-canvas disabled:opacity-50"
      >
        {submitting ? 'Adding…' : 'Add row'}
      </button>
      <button type="button" onClick={onCancel} className="text-xs text-ink-dim hover:text-ink">
        Cancel
      </button>
    </form>
  );
}
