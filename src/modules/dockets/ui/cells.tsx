'use client';

import { memo, useEffect, useRef, useState, type ClipboardEvent, type RefObject } from 'react';
import { ChevronDown } from 'lucide-react';
import { OptionPicker } from '@/components/data-table/OptionPicker';
import { cn } from '@/lib/utils';

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 6 });

/** Plain numbers get Indian digit grouping; anything else ("LOT", "2 sets") shows as typed. */
export function formatNumber(value: string): string {
  const raw = value.replace(/,/g, '').trim();
  return /^-?\d+(\.\d+)?$/.test(raw) ? inr.format(Number(raw)) : value;
}

/** True for 600 ms after `value` changes (own save, grid paste, undo, AI autofill) - the "saved" flash. */
function useFlash(value: string) {
  const [on, setOn] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setOn(true);
    const t = setTimeout(() => setOn(false), 600);
    return () => clearTimeout(t);
  }, [value]);
  return on;
}

/** Opens the same field of the next row (Enter moves down, like a spreadsheet). */
function openCellBelow(wrapper: HTMLElement | null) {
  const col = wrapper?.dataset.edit;
  const table = wrapper?.closest('table');
  if (!col || !table) return;
  const cells = Array.from(table.querySelectorAll<HTMLElement>(`[data-edit="${CSS.escape(col)}"]`));
  const next = cells[cells.indexOf(wrapper!) + 1]?.querySelector<HTMLElement>('[data-cell]');
  // After this cell has re-rendered back to plain text.
  requestAnimationFrame(() => next?.click());
}

const isGrid = (text: string) => text.includes('\t') || text.includes('\n');

interface TextCellProps {
  /** Column key; also how Enter finds the cell below. */
  col: string;
  value: string;
  /** Resolve false to reject: the old value comes back and the cell is ringed. */
  onSave: (value: string) => Promise<boolean>;
  /** A multi-cell paste (Excel block) starting at this cell. */
  onPasteGrid?: (text: string) => void;
  readOnly?: boolean;
  numeric?: boolean;
  /** Wrap to two lines instead of truncating (long item names). */
  clamp?: boolean;
}

/**
 * Plain text until clicked; then an input, pre-filled and selected.
 * Enter saves and moves down, Tab saves and moves on, Esc cancels, blur saves.
 */
export const TextCell = memo(function TextCell({ col, value, onSave, onPasteGrid, readOnly, numeric, clamp }: TextCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [pending, setPending] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const skipBlur = useRef(false);
  const flash = useFlash(value);

  const shown = pending ?? value;
  const text = numeric ? formatNumber(shown) : shown;
  const body = (
    <span
      data-tip={shown || undefined}
      className={cn('block min-w-0', clamp ? 'line-clamp-2 break-words' : 'truncate', !shown && 'text-muted-foreground')}
    >
      {text || '-'}
    </span>
  );

  if (readOnly) {
    return <div className={cn('px-2.5 py-1.5', numeric && 'text-right tabular-nums')}>{body}</div>;
  }

  const open = () => {
    setDraft(value);
    setFailed(false);
    setEditing(true);
  };

  const commit = async (next: string, moveDown = false) => {
    setEditing(false);
    if (moveDown) openCellBelow(wrapper.current);
    if (next === value) return;
    setPending(next);
    const ok = await onSave(next);
    setPending(null);
    if (!ok) setFailed(true);
  };

  const pasteGrid = (e: ClipboardEvent) => {
    const pasted = e.clipboardData.getData('text');
    if (!onPasteGrid || !isGrid(pasted.trim())) return;
    e.preventDefault();
    skipBlur.current = true;
    setEditing(false);
    onPasteGrid(pasted);
  };

  return (
    <div ref={wrapper} data-edit={col} className="h-full">
      {editing ? (
        <input
          autoFocus
          value={draft}
          inputMode={numeric ? 'decimal' : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.target.select()}
          onPaste={pasteGrid}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              skipBlur.current = true;
              void commit(draft, true);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              skipBlur.current = true;
              setEditing(false);
            } else if (e.key === 'Tab') {
              skipBlur.current = true;
              void commit(draft);
            }
          }}
          onBlur={() => {
            if (skipBlur.current) skipBlur.current = false;
            else void commit(draft);
          }}
          aria-label="Edit value"
          className={cn(
            'h-8 w-full rounded-md bg-background px-2.5 text-xs outline-none ring-1 ring-inset ring-blue-500',
            numeric && 'text-right tabular-nums'
          )}
        />
      ) : (
        <div
          data-cell
          role="button"
          tabIndex={0}
          onClick={open}
          onPaste={pasteGrid}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'F2') {
              e.preventDefault();
              open();
            }
          }}
          aria-label={`Edit ${shown || 'blank'}`}
          className={cn(
            'h-full min-h-8 cursor-text rounded-md px-2.5 py-1.5 outline-none hover:bg-muted focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-blue-500',
            numeric && 'text-right tabular-nums',
            pending !== null && 'opacity-60',
            failed && 'ring-1 ring-inset ring-rose-500',
            flash && 'cell-saved'
          )}
        >
          {body}
        </div>
      )}
    </div>
  );
});

interface ChoiceCellProps {
  col: string;
  value: string;
  options: readonly string[];
  onSave: (value: string) => Promise<boolean>;
  readOnly?: boolean;
  /** Tint for values that carry meaning (status pills). */
  tone?: 'green' | 'red';
}

const TONES = {
  green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  red: 'border-rose-200 bg-rose-50 text-rose-800',
};

/** A chip showing the value; click opens a searchable single-choice list. */
export const ChoiceCell = memo(function ChoiceCell({ col, value, options, onSave, readOnly, tone }: ChoiceCellProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const chipRef = useRef<HTMLButtonElement>(null);
  const flash = useFlash(value);
  const shown = pending ?? value;

  const chipClass = cn(
    'inline-flex h-[22px] max-w-full items-center gap-1 rounded border px-1.5 text-[11px] font-medium',
    tone ? TONES[tone] : 'border-border bg-background text-foreground',
    !shown && 'text-muted-foreground'
  );
  const label = (
    <span data-tip={shown || undefined} className="truncate">
      {shown || '-'}
    </span>
  );

  if (readOnly) {
    return (
      <div className="px-2.5 py-1.5">
        <span className={chipClass}>{label}</span>
      </div>
    );
  }

  const pick = async (next: string) => {
    setOpen(false);
    requestAnimationFrame(() => chipRef.current?.focus());
    if (next === value) return;
    setFailed(false);
    setPending(next);
    const ok = await onSave(next);
    setPending(null);
    if (!ok) setFailed(true);
  };

  const triggerClass = cn(
    chipClass,
    'cursor-pointer outline-none hover:bg-muted focus-visible:ring-1 focus-visible:ring-blue-500',
    pending !== null && 'opacity-60',
    failed && 'ring-1 ring-rose-500',
    flash && 'cell-saved'
  );
  const inner = (
    <>
      {label}
      <ChevronDown size={11} className="shrink-0 opacity-60" />
    </>
  );

  // The popover is mounted only while open: one per cell made 50-row pages slow.
  return (
    <div data-edit={col} className="flex min-h-8 items-center px-2.5 py-[5px]">
      {open ? (
        <OptionPicker
          ref={chipRef as RefObject<HTMLButtonElement>}
          value={shown}
          options={options}
          onChange={(v) => void pick(v)}
          clearable
          open
          onOpenChange={(next) => !next && setOpen(false)}
          aria-label={`Change ${shown || 'blank'}`}
          className={triggerClass}
        >
          {inner}
        </OptionPicker>
      ) : (
        <button
          ref={chipRef}
          type="button"
          data-cell
          onClick={() => setOpen(true)}
          aria-label={`Change ${shown || 'blank'}`}
          aria-haspopup="listbox"
          className={triggerClass}
        >
          {inner}
        </button>
      )}
    </div>
  );
});
