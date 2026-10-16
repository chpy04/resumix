'use client';

import { Fragment, useState } from 'react';
import type { Bullet, BulletSuggestion } from '@/lib/types';
import { placeSuggestions } from '@/lib/editor/suggestions';
import { extractSelectedOrder, orderForDisplay, visibleItems } from '@/lib/editor/visibility';
import {
  AgentPickBadge,
  ArchiveButton,
  ArchivedBadge,
  ExpandChevron,
  GlobalEditBadge,
  SelectToggle,
} from './atoms';
import SortableList from './SortableList';
import SortableRow from './SortableRow';
import SuggestionCard, { type SuggestionHandlers } from './SuggestionCard';

export interface FieldSpec<TParent> {
  key: string;
  label: string;
  getValue: (item: TParent) => string;
  placeholder?: string;
  /** Rendered wider — used for the one field that best identifies the item. */
  primary?: boolean;
}

type ParentWithBullets = { id: string; isArchived: boolean; bullets: Bullet[] };

interface ItemBulletSectionProps<TParent extends ParentWithBullets> {
  title: string;
  itemNoun: string;
  bulletNoun: string;
  items: TParent[];
  fields: FieldSpec<TParent>[];
  selectedOrder: string[];
  bulletSelections: Record<string, string[]>;
  showArchived: boolean;
  /** Items and bullets the agent picked, badged in review (C7). */
  agentPicks: ReadonlySet<string>;
  /** The agent's pending bullet suggestions, by the parent whose list shows
   *  them (D-045); empty outside review. */
  suggestions: ReadonlyMap<string, BulletSuggestion[]>;
  suggestionHandlers: SuggestionHandlers | null;
  onToggleItem: (id: string) => void;
  onReorderItems: (order: string[]) => void;
  onToggleBullet: (parentId: string, bulletId: string) => void;
  onReorderBullets: (parentId: string, order: string[]) => void;
  onFieldChange: (id: string, key: string, value: string) => void;
  onArchiveItem: (id: string, isArchived: boolean) => void;
  onCreateItem: (values: Record<string, string>) => Promise<void>;
  onCreateBullet: (parentId: string, content: string) => Promise<void>;
  onBulletContentChange: (bulletId: string, content: string) => void;
  onArchiveBullet: (bulletId: string, isArchived: boolean) => void;
}

export default function ItemBulletSection<TParent extends ParentWithBullets>(
  props: ItemBulletSectionProps<TParent>,
) {
  const {
    title,
    itemNoun,
    bulletNoun,
    items,
    fields,
    selectedOrder,
    bulletSelections,
    showArchived,
    agentPicks,
    suggestions,
    suggestionHandlers,
    onToggleItem,
    onReorderItems,
    onToggleBullet,
    onReorderBullets,
    onFieldChange,
    onArchiveItem,
    onCreateItem,
    onCreateBullet,
    onBulletContentChange,
    onArchiveBullet,
  } = props;

  const [adding, setAdding] = useState(false);
  // A parent with a suggestion opens with its bullets showing, so the card
  // is in view without a click.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(suggestions.keys()));
  const selectedSet = new Set(selectedOrder);

  // A pending suggestion blocks approval, so its parent never hides behind
  // "show archived".
  const visible = visibleItems(items, [...selectedOrder, ...suggestions.keys()], showArchived);
  const ordered = orderForDisplay(visible, selectedOrder);
  const orderedIds = ordered.map((item) => item.id);

  function toggleExpanded(id: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleReorder(newIds: string[]): void {
    onReorderItems(extractSelectedOrder(newIds, selectedOrder));
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
          {adding ? 'Cancel' : `+ Add ${itemNoun}`}
        </button>
      </header>

      {adding ? (
        <CreateItemForm
          fields={fields}
          noun={itemNoun}
          onCancel={() => setAdding(false)}
          onSubmit={async (values) => {
            await onCreateItem(values);
            setAdding(false);
          }}
        />
      ) : null}

      {orderedIds.length === 0 ? (
        <p className="px-3 py-4 text-xs text-ink-dim">
          No {itemNoun}s yet
          {showArchived ? '' : ' (or all are archived — toggle "show archived" above)'}.
        </p>
      ) : (
        <SortableList
          ids={orderedIds}
          onReorder={handleReorder}
          className="flex flex-col gap-1 p-2"
        >
          {ordered.map((item) => (
            <SortableRow key={item.id} id={item.id}>
              <ItemRow
                item={item}
                fields={fields}
                bulletNoun={bulletNoun}
                selected={selectedSet.has(item.id)}
                expanded={expanded.has(item.id)}
                showArchived={showArchived}
                agentPicks={agentPicks}
                suggestions={suggestions.get(item.id) ?? NO_SUGGESTIONS}
                suggestionHandlers={suggestionHandlers}
                bulletOrder={bulletSelections[item.id] ?? []}
                onToggleSelected={() => onToggleItem(item.id)}
                onToggleExpanded={() => toggleExpanded(item.id)}
                onFieldChange={(key, value) => onFieldChange(item.id, key, value)}
                onArchive={() => onArchiveItem(item.id, !item.isArchived)}
                onToggleBullet={(bulletId) => onToggleBullet(item.id, bulletId)}
                onReorderBullets={(order) => onReorderBullets(item.id, order)}
                onCreateBullet={(content) => onCreateBullet(item.id, content)}
                onBulletContentChange={onBulletContentChange}
                onArchiveBullet={onArchiveBullet}
              />
            </SortableRow>
          ))}
        </SortableList>
      )}
    </section>
  );
}

const NO_SUGGESTIONS: BulletSuggestion[] = [];

// ---------------------------------------------------------------------------

interface ItemRowProps<TParent extends ParentWithBullets> {
  item: TParent;
  fields: FieldSpec<TParent>[];
  bulletNoun: string;
  selected: boolean;
  expanded: boolean;
  showArchived: boolean;
  agentPicks: ReadonlySet<string>;
  suggestions: BulletSuggestion[];
  suggestionHandlers: SuggestionHandlers | null;
  bulletOrder: string[];
  onToggleSelected: () => void;
  onToggleExpanded: () => void;
  onFieldChange: (key: string, value: string) => void;
  onArchive: () => void;
  onToggleBullet: (bulletId: string) => void;
  onReorderBullets: (order: string[]) => void;
  onCreateBullet: (content: string) => Promise<void>;
  onBulletContentChange: (bulletId: string, content: string) => void;
  onArchiveBullet: (bulletId: string, isArchived: boolean) => void;
}

function ItemRow<TParent extends ParentWithBullets>({
  item,
  fields,
  bulletNoun,
  selected,
  expanded,
  showArchived,
  agentPicks,
  suggestions,
  suggestionHandlers,
  bulletOrder,
  onToggleSelected,
  onToggleExpanded,
  onFieldChange,
  onArchive,
  onToggleBullet,
  onReorderBullets,
  onCreateBullet,
  onBulletContentChange,
  onArchiveBullet,
}: ItemRowProps<TParent>) {
  const [addingBullet, setAddingBullet] = useState(false);
  const primaryLabel =
    fields.find((f) => f.primary)?.getValue(item) ?? fields[0]?.getValue(item) ?? item.id;

  return (
    <div
      data-testid={`content-row-${item.id}`}
      className={`rounded-md border px-2 py-1.5 ${
        selected ? 'border-accent/40 bg-surface-2' : 'border-line'
      } ${item.isArchived ? 'opacity-70' : ''}`}
    >
      <div className="flex items-start gap-2">
        <SelectToggle
          checked={selected}
          onChange={onToggleSelected}
          label={`Include ${primaryLabel} on this resume`}
        />
        <ExpandChevron
          expanded={expanded}
          onClick={onToggleExpanded}
          label={`Expand ${primaryLabel} bullets`}
        />

        <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-2 gap-y-1 sm:grid-cols-4">
          {fields.map((field) => (
            <input
              key={field.key}
              value={field.getValue(item)}
              placeholder={field.placeholder}
              onChange={(event) => onFieldChange(field.key, event.target.value)}
              className={`min-w-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-ink outline-none hover:border-line focus:border-accent ${
                field.primary ? 'col-span-2 font-medium sm:col-span-2' : 'text-ink-dim'
              }`}
            />
          ))}
        </div>

        {agentPicks.has(item.id) ? <AgentPickBadge /> : null}
        <GlobalEditBadge />
        {item.isArchived ? <ArchivedBadge /> : null}
        <ArchiveButton isArchived={item.isArchived} onClick={onArchive} />
      </div>

      {expanded ? (
        <div className="mt-2 border-t border-line pt-2 pl-9">
          <BulletList
            bullets={item.bullets}
            selectedOrder={bulletOrder}
            showArchived={showArchived}
            agentPicks={agentPicks}
            suggestions={suggestions}
            suggestionHandlers={suggestionHandlers}
            bulletNoun={bulletNoun}
            onToggle={onToggleBullet}
            onReorder={onReorderBullets}
            onContentChange={onBulletContentChange}
            onArchive={onArchiveBullet}
          />
          {addingBullet ? (
            <CreateBulletForm
              noun={bulletNoun}
              onCancel={() => setAddingBullet(false)}
              onSubmit={async (content) => {
                await onCreateBullet(content);
                setAddingBullet(false);
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => setAddingBullet(true)}
              className="mt-1.5 text-xs text-ink-dim transition-colors hover:text-accent"
            >
              + Add {bulletNoun}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface BulletListProps {
  bullets: Bullet[];
  selectedOrder: string[];
  showArchived: boolean;
  agentPicks: ReadonlySet<string>;
  /** This parent's pending suggestions, shown in place (D-045). */
  suggestions: BulletSuggestion[];
  suggestionHandlers: SuggestionHandlers | null;
  bulletNoun: string;
  onToggle: (bulletId: string) => void;
  onReorder: (order: string[]) => void;
  onContentChange: (bulletId: string, content: string) => void;
  onArchive: (bulletId: string, isArchived: boolean) => void;
}

function BulletList({
  bullets,
  selectedOrder,
  showArchived,
  agentPicks,
  suggestions,
  suggestionHandlers,
  bulletNoun,
  onToggle,
  onReorder,
  onContentChange,
  onArchive,
}: BulletListProps) {
  const selectedSet = new Set(selectedOrder);
  const visible = visibleItems(bullets, selectedOrder, showArchived);
  const ordered = orderForDisplay(visible, selectedOrder);
  const orderedIds = ordered.map((b) => b.id);
  const placed = placeSuggestions(orderedIds, selectedOrder, suggestions);
  const contentOf = new Map(bullets.map((b) => [b.id, b.content]));

  function handleReorder(newIds: string[]): void {
    onReorder(extractSelectedOrder(newIds, selectedOrder));
  }

  function card(suggestion: BulletSuggestion) {
    if (!suggestionHandlers) return null;
    return (
      <SuggestionCard
        key={suggestion.id}
        suggestion={suggestion}
        current={suggestion.bulletId ? (contentOf.get(suggestion.bulletId) ?? null) : null}
        handlers={suggestionHandlers}
      />
    );
  }

  if (orderedIds.length === 0) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-[11px] text-ink-dim">No {bulletNoun}s yet.</p>
        {placed.after.map(card)}
      </div>
    );
  }

  return (
    <SortableList ids={orderedIds} onReorder={handleReorder} className="flex flex-col gap-1">
      {ordered.map((bullet) => {
        const edit = placed.edits.get(bullet.id);
        const tone = edit
          ? 'border-warning-line bg-warning-surface/20'
          : selectedSet.has(bullet.id)
            ? 'border-accent/30 bg-surface-2'
            : 'border-line';
        return (
          <Fragment key={bullet.id}>
            {(placed.before.get(bullet.id) ?? []).map(card)}
            <SortableRow id={bullet.id}>
              <div
                data-testid={`bullet-row-${bullet.id}`}
                className={`rounded border px-1.5 py-1 ${tone} ${bullet.isArchived ? 'opacity-70' : ''}`}
              >
                <div className="flex items-start gap-2">
                  <SelectToggle
                    checked={selectedSet.has(bullet.id)}
                    onChange={() => onToggle(bullet.id)}
                    label="Include this bullet on this resume"
                  />
                  <textarea
                    value={bullet.content}
                    onChange={(event) => onContentChange(bullet.id, event.target.value)}
                    rows={2}
                    spellCheck={false}
                    className="min-w-0 flex-1 resize-y rounded border border-transparent bg-transparent px-1 py-0.5 font-mono text-xs whitespace-pre-wrap text-ink outline-none hover:border-line focus:border-accent"
                  />
                  {agentPicks.has(bullet.id) ? <AgentPickBadge /> : null}
                  <GlobalEditBadge />
                  {bullet.isArchived ? <ArchivedBadge /> : null}
                  <ArchiveButton
                    isArchived={bullet.isArchived}
                    onClick={() => onArchive(bullet.id, !bullet.isArchived)}
                  />
                </div>
                {edit ? card(edit) : null}
              </div>
            </SortableRow>
          </Fragment>
        );
      })}
      {placed.after.map(card)}
    </SortableList>
  );
}

// ---------------------------------------------------------------------------

function CreateItemForm<TParent>({
  fields,
  noun,
  onSubmit,
  onCancel,
}: {
  fields: FieldSpec<TParent>[];
  noun: string;
  onSubmit: (values: Record<string, string>) => Promise<void>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(values);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not create ${noun}.`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-2 px-3 py-2"
    >
      {fields.map((field) => (
        <input
          key={field.key}
          value={values[field.key] ?? ''}
          placeholder={field.placeholder ?? field.label}
          onChange={(event) => setValues((prev) => ({ ...prev, [field.key]: event.target.value }))}
          className="min-w-0 flex-1 rounded border border-line bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-accent"
        />
      ))}
      {error ? <span className="text-xs text-danger">{error}</span> : null}
      <button
        type="submit"
        disabled={submitting}
        className="rounded bg-accent px-2 py-1 text-xs font-medium text-canvas disabled:opacity-50"
      >
        {submitting ? 'Adding…' : `Add ${noun}`}
      </button>
      <button type="button" onClick={onCancel} className="text-xs text-ink-dim hover:text-ink">
        Cancel
      </button>
    </form>
  );
}

function CreateBulletForm({
  noun,
  onSubmit,
  onCancel,
}: {
  noun: string;
  onSubmit: (content: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (content.trim().length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(content);
      setContent('');
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not create ${noun}.`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-1.5 flex items-start gap-2">
      <textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        rows={2}
        placeholder={`Raw LaTeX for the new ${noun}…`}
        spellCheck={false}
        className="min-w-0 flex-1 resize-y rounded border border-line bg-surface-2 px-1.5 py-1 font-mono text-xs text-ink outline-none focus:border-accent"
      />
      <div className="flex shrink-0 flex-col gap-1">
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-accent px-2 py-1 text-xs font-medium text-canvas disabled:opacity-50"
        >
          {submitting ? '…' : 'Add'}
        </button>
        <button type="button" onClick={onCancel} className="text-xs text-ink-dim hover:text-ink">
          Cancel
        </button>
      </div>
      {error ? <span className="text-xs text-danger">{error}</span> : null}
    </form>
  );
}
