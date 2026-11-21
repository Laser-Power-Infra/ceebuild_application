'use client';

import Link from 'next/link';
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type RefObject } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Brain,
  Calculator,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Columns3,
  Copy,
  Eye,
  FileText,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { BLANK } from '@/components/ui/multi-select-filter';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { LoadingBar } from '@/components/data-table/LoadingBar';
import { ResizeHandle } from '@/components/data-table/ResizeHandle';
import { isDocketType } from '@/lib/dockets';
import { cn } from '@/lib/utils';
import { DOCKET_COLUMNS, ITEM_CAP, ITEM_COLUMN_KEYS, MIN_COLUMN_WIDTH, PAGE_SIZES, type DocketColumn } from '../columns';
import {
  ITEM_FILTER_FIELDS,
  type Docket,
  type DocketActions,
  type DocketFilters,
  type DocketItem,
  type DocketSort,
  type DocketSortKey,
  type ItemUpdate,
} from '../types';
import { ChoiceCell, TextCell } from './cells';
import { DocketDrawer } from './DocketDrawer';
import { FilterBar } from './FilterBar';

const n = new Intl.NumberFormat('en-IN');
const STORE_WIDTHS = 'ceebuild.dockets.widths';
const STORE_HIDDEN = 'ceebuild.dockets.hidden';
const DEFAULT_HIDDEN = DOCKET_COLUMNS.filter((c) => 'hidden' in c && c.hidden).map((c) => c.key as string);
const OUR_ITEM_NOT = ['MANUFACTURING', 'NO', 'TRADING'];
const DOCKET_SORTS: Array<[DocketSortKey, string]> = [
  ['docketNoQtnNo', 'Docket no'],
  ['createdAt', 'Date'],
  ['partyName', 'Party'],
];

function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
function writeStore(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

const parseAttachments = (raw?: string | null): string[] => {
  try {
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};

type ItemFilterValues = Pick<DocketFilters, keyof typeof ITEM_FILTER_FIELDS>;

/** Same rule as the server (src/lib/docketWhere.ts): any picked value, case-insensitive; BLANK = empty. */
const matchesItemFilters = (item: DocketItem, f: ItemFilterValues) =>
  (Object.keys(ITEM_FILTER_FIELDS) as Array<keyof typeof ITEM_FILTER_FIELDS>).every((key) => {
    const picked = f[key];
    if (!picked.length) return true;
    const value = String(item[ITEM_FILTER_FIELDS[key]] ?? '');
    return picked.some((p) => (p === BLANK ? !value : p.toLowerCase() === value.toLowerCase()));
  });

const iconButton =
  'flex size-7 shrink-0 items-center justify-center rounded-md text-foreground/70 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-blue-500 active:translate-y-px disabled:pointer-events-none disabled:opacity-40';
const neutralButton =
  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[13px] font-medium text-foreground outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 active:translate-y-px disabled:opacity-50';
const chip = 'inline-flex h-[18px] shrink-0 items-center rounded-full border px-1.5 text-[11px] font-medium leading-none';

export interface DocketsTabProps {
  dockets: Docket[];
  /** Totals of the whole filtered set (from the server), not of this page. */
  total: number;
  totalItems: number;
  loading: boolean;
  error: string | null;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  search: string;
  onSearch: (value: string) => void;
  startDate: string;
  endDate: string;
  onDates: (start: string, end: string) => void;
  filters: DocketFilters;
  onFilters: (next: DocketFilters) => void;
  /** Current filter params (no page / sort), as sent to /api/dockets. */
  filterQuery: string;
  onClearFilters: () => void;
  sort: DocketSort | null;
  onSort: (sort: DocketSort | null) => void;
  /** Items by docket number (all of them arrive with the page). */
  itemsByDocket: Record<string, DocketItem[]>;
  canEdit: boolean;
  isAdmin: boolean;
  ourItemNames: string[];
  statuses: string[];
  termOptions: Record<'price' | 'payment' | 'delivery' | 'warranty' | 'approval' | 'inspection', string[]>;
  uploading: boolean;
  actionsRef: RefObject<DocketActions>;
}

interface Layout {
  cols: DocketColumn[];
  width: (c: DocketColumn) => number;
  /** Item Name stays pinned beside Docket only while pinned columns take under 45% of the view. */
  freezeItem: boolean;
  docketWidth: number;
}

/** Stable callbacks rows use; everything current is read through refs. */
interface RowApi {
  openDrawer: (id: number) => void;
  showAll: (id: number) => void;
  saveItem: (doc: Docket, item: DocketItem, field: keyof DocketItem, value: string) => Promise<boolean>;
  paste: (doc: Docket, item: DocketItem, field: keyof DocketItem, text: string) => void;
  copy: (text: string) => void;
  actions: () => DocketActions;
}

interface RowContext {
  canEdit: boolean;
  isAdmin: boolean;
  ourItemNames: readonly string[];
  statuses: readonly string[];
  itemFilters: ItemFilterValues;
  api: RowApi;
}

/**
 * The Dockets screen: one card holding the toolbar, the filter bar, the table (the only scroller)
 * and the pager. Each docket's cells span the rows of its items, which are always shown.
 */
export const DocketsTab = memo(function DocketsTab(props: DocketsTabProps) {
  const { dockets, total, totalItems, loading, error, page, pageSize, sort, filters, canEdit, isAdmin, actionsRef } = props;

  const [widths, setWidths] = useState<Record<string, number>>({});
  const [hidden, setHidden] = useState<string[]>(DEFAULT_HIDDEN);
  const [showAll, setShowAll] = useState<number[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [drawerId, setDrawerId] = useState<number | null>(null);
  const [changedId, setChangedId] = useState<number | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string; undo?: () => void } | null>(null);
  const [viewWidth, setViewWidth] = useState(0);
  const [tip, setTip] = useState<{ text: string; left: number; top: number } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const tipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tipEl = useRef<Element | null>(null);

  useEffect(() => {
    setWidths(readStore(STORE_WIDTHS, {}));
    setHidden(readStore(STORE_HIDDEN, DEFAULT_HIDDEN));
  }, []);

  // ---- layout -------------------------------------------------------------------------------
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewWidth(Math.round(el.clientWidth / 16) * 16);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo<Layout>(() => {
    const cols = DOCKET_COLUMNS.filter((c) => c.kind === 'fixed' || !hidden.includes(c.key));
    const width = (c: DocketColumn) => widths[c.key] ?? c.width;
    const by = (key: string) => {
      const c = cols.find((col) => col.key === key);
      return c ? width(c) : 0;
    };
    const pinned = by('docket') + by('itemNameParty') + by('actions');
    return { cols, width, docketWidth: by('docket'), freezeItem: by('itemNameParty') > 0 && pinned <= viewWidth * 0.45 };
  }, [hidden, widths, viewWidth]);
  const tableWidth = layout.cols.reduce((sum, c) => sum + layout.width(c), 0);

  // During a drag only the DOM moves (the <col> and the table width); React gets the final width.
  const resize = (c: DocketColumn, width: number, final: boolean) => {
    if (final) {
      setWidths((prev) => {
        const next = { ...prev, [c.key]: width };
        writeStore(STORE_WIDTHS, next);
        return next;
      });
      return;
    }
    const col = tableRef.current?.querySelector<HTMLElement>(`col[data-key="${c.key}"]`);
    if (!col || !tableRef.current) return;
    col.style.width = `${width}px`;
    tableRef.current.style.width = `${tableWidth - layout.width(c) + width}px`;
  };
  const resetWidth = (key: string) =>
    setWidths((prev) => {
      const { [key]: _, ...next } = prev;
      writeStore(STORE_WIDTHS, next);
      return next;
    });
  const toggleColumn = (key: string) =>
    setHidden((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      writeStore(STORE_HIDDEN, next);
      return next;
    });
  const resetLayout = () => {
    setWidths({});
    setHidden(DEFAULT_HIDDEN);
    writeStore(STORE_WIDTHS, {});
    writeStore(STORE_HIDDEN, DEFAULT_HIDDEN);
  };

  // ---- toast with undo ----------------------------------------------------------------------
  const notify = useCallback((text: string, undo?: () => void) => setToast({ id: Date.now(), text, undo }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  // ---- row api (stable; reads the latest props through a ref) --------------------------------
  const visibleItemFields = useMemo(() => ITEM_COLUMN_KEYS.filter((k) => !hidden.includes(k)), [hidden]);
  const latest = useRef({ props, visibleItemFields });
  latest.current = { props, visibleItemFields };

  const api = useMemo<RowApi>(() => {
    const actions = () => latest.current.props.actionsRef.current;
    return {
      actions,
      openDrawer: setDrawerId,
      showAll: (id) => setShowAll((prev) => [...prev, id]),
      copy: (text) => {
        void navigator.clipboard?.writeText(text).then(
          () => notify(`Copied ${text}`),
          () => notify('Could not copy')
        );
      },
      saveItem: async (doc, item, field, value) => {
        const before = String(item[field] ?? '');
        const ok = await actions().updateItem(item.id, field, value, doc.docketNoQtnNo);
        if (!ok) return false;
        notify('Saved', () => {
          void actions()
            .updateItem(item.id, field, before, doc.docketNoQtnNo)
            .then((undone) => undone && notify('Change undone'));
        });
        // Choosing OTHERS asks for the reason, as it always has.
        if (field === 'ourItemName' && value === 'OTHERS') actions().openReasoning(item, 'OTHERS');
        return true;
      },
      // A block copied from Excel fills down (and across) from the cell it was pasted into.
      paste: (doc, item, field, text) => {
        const no = doc.docketNoQtnNo;
        if (!no) return;
        const matrix = text
          .split(/\r?\n/)
          .filter((line) => line.trim() !== '')
          .map((line) => line.split('\t').map((cell) => cell.replace(/^"+|"+$/g, '').trim()));
        if (!matrix.length) return;
        const { props: p, visibleItemFields: fields } = latest.current;
        const rows = (p.itemsByDocket[no] ?? []).filter((it) => matchesItemFilters(it, p.filters));
        const start = rows.findIndex((it) => it.id === item.id);
        const startCol = fields.indexOf(field);
        if (start < 0 || startCol < 0) return;

        const updates: ItemUpdate[] = [];
        const before: ItemUpdate[] = [];
        matrix.forEach((cells, r) => {
          const target = rows[start + r];
          if (!target) return;
          const next: Record<string, string> = {};
          const old: Record<string, string> = {};
          cells.forEach((value, c) => {
            const key = fields[startCol + c];
            if (!key) return;
            next[key] = value;
            old[key] = String(target[key] ?? '');
          });
          updates.push({ id: target.id, fields: next });
          before.push({ id: target.id, fields: old });
        });
        if (!updates.length) return;
        void actions()
          .applyItemUpdates(no, updates)
          .then((ok) => {
            if (!ok) return;
            notify(`Filled ${updates.length} item${updates.length === 1 ? '' : 's'}`, () => {
              void actions()
                .applyItemUpdates(no, before)
                .then((undone) => undone && notify('Fill undone'));
            });
          });
      },
    };
  }, [notify]);

  const ourItemNamesKey = props.ourItemNames.join('\n');
  const statusesKey = props.statuses.join('\n');
  const { item, uom, ourItemNot, size } = filters;
  const ctx = useMemo<RowContext>(
    () => ({
      canEdit,
      isAdmin,
      ourItemNames: ['OTHERS', ...ourItemNamesKey.split('\n').filter(Boolean)],
      statuses: statusesKey.split('\n').filter(Boolean),
      itemFilters: { item, uom, ourItemNot, size },
      api,
    }),
    [canEdit, isAdmin, ourItemNamesKey, statusesKey, item, uom, ourItemNot, size, api]
  );

  // ---- keyboard -----------------------------------------------------------------------------
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return; // keys typed inside a cell belong to the cell
    const index = dockets.findIndex((d) => d.id === activeId);
    const doc = dockets[index];
    let next: Docket | undefined;
    if (e.key === 'ArrowDown') next = dockets[Math.min(dockets.length - 1, index + 1)];
    else if (e.key === 'ArrowUp') next = dockets[Math.max(0, index - 1)];
    else if (e.key === 'Enter' && doc) setDrawerId(doc.id);
    else return;
    e.preventDefault();
    if (!next) return;
    setActiveId(next.id);
    scrollRef.current?.querySelector(`[data-docket-id="${next.id}"]`)?.scrollIntoView({ block: 'nearest' });
  };

  // "/" jumps to search from anywhere on the screen.
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.key !== '/' || e.ctrlKey || e.metaKey || target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      cardRef.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---- hover card for truncated text (one for the whole table) --------------------------------
  const hideTip = () => {
    if (tipTimer.current) clearTimeout(tipTimer.current);
    tipEl.current = null;
    setTip(null);
  };
  const showTip = (target: EventTarget | null) => {
    const start = target as HTMLElement | null;
    const el = start?.closest<HTMLElement>('[data-tip]') ?? start?.querySelector<HTMLElement>('[data-tip]') ?? null;
    if (el === tipEl.current) return;
    hideTip();
    if (!el) return;
    tipEl.current = el;
    tipTimer.current = setTimeout(() => {
      const clipped = el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight;
      if (!clipped && !('tipAlways' in el.dataset)) return;
      const rect = el.getBoundingClientRect();
      const below = rect.bottom + 80 < window.innerHeight;
      setTip({ text: el.dataset.tip || '', left: Math.min(rect.left, window.innerWidth - 400), top: below ? rect.bottom + 4 : rect.top - 4 - 60 });
    }, 150);
  };

  // ---- drawer --------------------------------------------------------------------------------
  const drawerDoc = drawerId === null ? null : dockets.find((d) => d.id === drawerId) ?? null;
  const closeDrawer = (changed: boolean) => {
    const id = drawerId;
    setDrawerId(null);
    setActiveId(id);
    if (changed) {
      setChangedId(id);
      setTimeout(() => setChangedId(null), 700);
    }
    scrollRef.current?.focus();
  };

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const hasFilters = props.filterQuery !== '';
  const firstLoad = loading && dockets.length === 0;
  const lastScrollable = layout.cols[layout.cols.length - 2]?.key;

  const stickyHead = (c: DocketColumn) =>
    c.key === 'docket'
      ? { className: 'z-40 left-0', style: undefined }
      : c.key === 'itemNameParty' && layout.freezeItem
        ? { className: 'z-40', style: { left: layout.docketWidth } }
        : c.key === 'actions'
          ? { className: 'z-40 right-0 border-l border-r-0', style: undefined }
          : { className: '', style: undefined };

  const docketSorted = sort && DOCKET_SORTS.some(([k]) => k === sort.key) ? sort : null;
  const cycleSort = (key: DocketSortKey) => {
    const firstDir = key === 'createdAt' ? 'desc' : 'asc';
    if (sort?.key !== key) return props.onSort({ key, dir: firstDir });
    props.onSort(sort.dir === firstDir ? { key, dir: firstDir === 'asc' ? 'desc' : 'asc' } : null);
  };

  return (
    <div ref={cardRef} className="console flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card text-foreground shadow-sm">
      {/* Toolbar: title and totals | actions */}
      <div className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-border bg-muted/50 px-4">
        <div className="flex min-w-0 items-baseline gap-3">
          <h2 className="text-base font-bold tracking-tight">Dockets</h2>
          <span className="truncate text-xs font-medium tabular-nums text-foreground/70">
            {n.format(total)} docket{total === 1 ? '' : 's'} · {n.format(totalItems)} item{totalItems === 1 ? '' : 's'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => actionsRef.current.refresh()} disabled={loading} className={neutralButton}>
            <RefreshCw size={14} className={cn('text-muted-foreground', loading && 'animate-spin')} />
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <Popover>
            <PopoverTrigger className={neutralButton}>
              <Columns3 size={14} className="text-muted-foreground" />
              Columns
            </PopoverTrigger>
            <PopoverContent align="end" className="w-60 gap-1 p-2">
              <div className="max-h-80 overflow-y-auto">
                {DOCKET_COLUMNS.map((c) => (
                  <label key={c.key} className={cn('flex h-7 cursor-pointer items-center gap-2 rounded px-1.5 text-xs hover:bg-muted', c.kind === 'fixed' && 'cursor-default opacity-60')}>
                    <input
                      type="checkbox"
                      checked={c.kind === 'fixed' || !hidden.includes(c.key)}
                      disabled={c.kind === 'fixed'}
                      onChange={() => toggleColumn(c.key)}
                      className="size-3.5 accent-[#0f62fe]"
                    />
                    <span className="truncate">{c.label}</span>
                  </label>
                ))}
              </div>
              <button type="button" onClick={resetLayout} className="mt-1 border-t border-border px-1.5 pt-2 text-left text-xs font-semibold text-[#0f62fe] hover:underline">
                Reset layout
              </button>
            </PopoverContent>
          </Popover>
          {canEdit && (
            <button
              type="button"
              onClick={() => actionsRef.current.addDocket()}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-[#0f62fe] px-3 text-[13px] font-semibold text-white outline-none hover:bg-[#0353e9] focus-visible:ring-[3px] focus-visible:ring-blue-500/40 active:translate-y-px"
            >
              <Plus size={15} />
              Add Docket
            </button>
          )}
        </div>
      </div>

      <FilterBar
        search={props.search}
        onSearch={props.onSearch}
        busy={loading}
        startDate={props.startDate}
        endDate={props.endDate}
        onDates={props.onDates}
        filters={filters}
        onFilters={props.onFilters}
        filterQuery={props.filterQuery}
        active={hasFilters}
        onClear={props.onClearFilters}
      />

      <div className="relative h-0.5 shrink-0">
        <LoadingBar active={loading && !firstLoad} />
      </div>

      {error && (
        <div role="alert" className="flex h-9 shrink-0 items-center justify-between border-b border-rose-200 bg-rose-50 px-4 text-xs font-medium text-rose-700">
          Couldn&apos;t load dockets
          <button type="button" onClick={() => actionsRef.current.refresh()} className="font-semibold underline">
            Retry
          </button>
        </div>
      )}

      {/* The only scroller on the screen */}
      <div
        ref={scrollRef}
        tabIndex={0}
        aria-busy={loading}
        aria-label="Dockets table"
        onKeyDown={onKeyDown}
        onScroll={hideTip}
        onMouseOver={(e) => showTip(e.target)}
        onMouseLeave={hideTip}
        onFocus={(e) => showTip(e.target)}
        onBlur={hideTip}
        className="min-h-0 w-full min-w-0 flex-1 overflow-auto overscroll-contain outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-blue-500"
      >
        <table ref={tableRef} className="border-separate border-spacing-0 text-left text-xs" style={{ tableLayout: 'fixed', width: tableWidth }}>
          <colgroup>
            {layout.cols.map((c) => (
              <col key={c.key} data-key={c.key} style={{ width: layout.width(c) }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {layout.cols.map((c) => {
                const s = stickyHead(c);
                const sortKey = c.key === 'docket' ? (docketSorted?.key ?? 'docketNoQtnNo') : 'sort' in c ? c.sort : undefined;
                const dir = sortKey && sort?.key === sortKey ? sort.dir : null;
                const Arrow = dir === 'asc' ? ArrowUp : dir === 'desc' ? ArrowDown : ChevronsUpDown;
                const numeric = c.kind === 'num';
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined}
                    style={s.style}
                    className={cn(
                      'group/th sticky top-0 z-30 h-9 border-b border-r border-border bg-muted px-2.5 text-[11px] font-semibold uppercase tracking-wide text-foreground/70',
                      c.key === lastScrollable && 'border-r-0',
                      s.className
                    )}
                  >
                    <div className={cn('flex items-center gap-1', numeric && 'justify-end')}>
                      {sortKey ? (
                        <button
                          type="button"
                          onClick={() => cycleSort(sortKey)}
                          className="flex min-w-0 items-center gap-1 rounded px-0.5 uppercase tracking-wide outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-blue-500"
                        >
                          <span className="truncate">
                            {c.label}
                            {c.key === 'docket' && docketSorted && docketSorted.key !== 'docketNoQtnNo' && ` · ${DOCKET_SORTS.find(([k]) => k === docketSorted.key)?.[1]}`}
                          </span>
                          <Arrow size={12} className={cn('shrink-0', dir ? 'text-[#0f62fe]' : 'text-muted-foreground')} />
                        </button>
                      ) : (
                        <span className="truncate">{c.label}</span>
                      )}
                      {c.key === 'docket' && (
                        <Popover>
                          <PopoverTrigger aria-label="Sort dockets by" className={cn(iconButton, 'size-6')}>
                            <ChevronDown size={13} />
                          </PopoverTrigger>
                          <PopoverContent align="start" className="w-40 gap-0.5 p-1 normal-case">
                            {DOCKET_SORTS.map(([key, label]) => (
                              <button
                                key={key}
                                type="button"
                                onClick={() => cycleSort(key)}
                                className={cn('flex h-7 items-center justify-between rounded px-2 text-left text-xs hover:bg-muted', sort?.key === key && 'font-semibold text-[#0f62fe]')}
                              >
                                Sort by {label}
                                {sort?.key === key && (sort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                              </button>
                            ))}
                          </PopoverContent>
                        </Popover>
                      )}
                    </div>
                    {c.key !== 'actions' && (
                      <ResizeHandle
                        label={c.label}
                        min={('min' in c && c.min) || MIN_COLUMN_WIDTH}
                        onResize={(w, final) => resize(c, w, final)}
                        onReset={() => resetWidth(c.key)}
                      />
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className={cn(loading && !firstLoad && 'opacity-60')}>
            {firstLoad
              ? Array.from({ length: 8 }, (_, r) => <SkeletonRow key={r} layout={layout} seed={r} tall />)
              : dockets.map((doc) => (
                  <DocketGroup
                    key={doc.id}
                    doc={doc}
                    items={doc.docketNoQtnNo ? props.itemsByDocket[doc.docketNoQtnNo] : undefined}
                    showAll={showAll.includes(doc.id)}
                    active={doc.id === activeId}
                    changed={doc.id === changedId}
                    layout={layout}
                    ctx={ctx}
                  />
                ))}
          </tbody>
        </table>

        {!loading && !error && dockets.length === 0 && (
          <div className="sticky left-0 flex w-full flex-col items-center gap-3 py-16 text-center text-xs">
            <p className="font-medium text-foreground/70">{hasFilters ? 'No dockets match these filters' : 'No dockets yet'}</p>
            {hasFilters ? (
              <button type="button" onClick={props.onClearFilters} className={neutralButton}>
                Clear filters
              </button>
            ) : (
              canEdit && (
                <button type="button" onClick={() => actionsRef.current.addDocket()} className={neutralButton}>
                  <Plus size={14} /> Add Docket
                </button>
              )
            )}
          </div>
        )}
      </div>

      {/* Footer: the only place the range and the page number appear */}
      <div className="flex h-11 shrink-0 items-center justify-between border-t border-border bg-muted/50 px-4 text-xs font-medium text-foreground/70">
        <div className="flex items-center gap-4">
          <span className="tabular-nums" aria-live="polite">
            {total === 0 ? 'No dockets' : `${n.format(from)}–${n.format(to)} of ${n.format(total)}`}
          </span>
          <label className="flex items-center gap-2">
            Rows per page
            <select
              value={pageSize}
              onChange={(e) => props.onPageSize(Number(e.target.value))}
              className="h-7 rounded-md border border-border bg-background px-1.5 text-xs font-medium text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {PAGE_SIZES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        </div>
        <Pager page={page} pages={Math.max(1, Math.ceil(total / pageSize))} onPage={props.onPage} />
      </div>

      {drawerDoc && (
        <DocketDrawer
          key={drawerDoc.id}
          doc={drawerDoc}
          canEdit={canEdit}
          isAdmin={isAdmin}
          termOptions={props.termOptions}
          attachmentCount={parseAttachments(drawerDoc.attachments).length}
          uploading={props.uploading}
          actions={actionsRef.current}
          onClose={closeDrawer}
        />
      )}

      {tip && (
        <div
          role="tooltip"
          style={{ left: tip.left, top: tip.top }}
          className="pointer-events-none fixed z-50 max-w-sm whitespace-pre-line rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-foreground shadow-md"
        >
          {tip.text}
        </div>
      )}

      {toast && (
        <div role="status" className="fixed right-5 top-16 z-50 flex items-center gap-3 rounded-md border border-border bg-foreground px-3 py-2 text-xs font-medium text-background shadow-lg">
          {toast.text}
          {toast.undo && (
            <button
              type="button"
              onClick={() => {
                toast.undo?.();
                setToast(null);
              }}
              className="font-semibold text-blue-300 underline-offset-2 hover:underline"
            >
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
});

/** Numbered pages: first, last, current ± 1, gaps as "…". */
function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) {
  const shown = Array.from(new Set([1, page - 1, page, page + 1, pages])).filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);
  const square = 'flex size-7 items-center justify-center rounded-md text-xs tabular-nums outline-none focus-visible:ring-1 focus-visible:ring-blue-500';
  return (
    <nav className="flex items-center gap-1" aria-label="Pagination">
      <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)} className={iconButton}>
        <ChevronLeft size={15} />
      </button>
      {shown.map((p, i) => (
        <Fragment key={p}>
          {i > 0 && p - shown[i - 1] > 1 && <span className="px-1 text-muted-foreground">…</span>}
          <button
            type="button"
            aria-current={p === page ? 'page' : undefined}
            onClick={() => onPage(p)}
            className={cn(square, p === page ? 'bg-[#0f62fe] font-semibold text-white' : 'text-foreground hover:bg-muted')}
          >
            {p}
          </button>
        </Fragment>
      ))}
      <button type="button" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)} className={iconButton}>
        <ChevronRight size={15} />
      </button>
    </nav>
  );
}

// ---- rows -------------------------------------------------------------------------------------

const cell = 'border-b border-r border-border bg-[var(--row)] p-0 align-top';

/** Pinned-column classes and offsets for a body cell. */
const stickyBody = (c: DocketColumn, layout: Layout) =>
  c.key === 'docket'
    ? { className: 'sticky left-0 z-20', style: undefined }
    : c.key === 'itemNameParty' && layout.freezeItem
      ? { className: 'sticky z-20', style: { left: layout.docketWidth } }
      : c.key === 'actions'
        ? { className: 'sticky right-0 z-20 border-l border-r-0', style: undefined }
        : { className: '', style: undefined };

function SkeletonRow({ layout, seed, tall }: { layout: Layout; seed: number; tall?: boolean }) {
  const last = layout.cols[layout.cols.length - 2]?.key;
  return (
    <tr className="[--row:var(--background)]" aria-hidden>
      {layout.cols.map((c, i) => {
        const s = stickyBody(c, layout);
        return (
          <td key={c.key} style={s.style} className={cn(cell, tall ? 'h-11' : 'h-8', c.key === last && 'border-r-0', s.className)}>
            {c.key !== 'actions' && <div className="mx-2.5 my-2 h-3 animate-pulse rounded bg-muted" style={{ width: `${40 + ((seed * 7 + i * 13) % 45)}%` }} />}
          </td>
        );
      })}
    </tr>
  );
}

interface DocketGroupProps {
  doc: Docket;
  items: DocketItem[] | undefined;
  showAll: boolean;
  active: boolean;
  changed: boolean;
  layout: Layout;
  ctx: RowContext;
}

/** One docket: a row per item; the docket's own cells span them all. */
const DocketGroup = memo(function DocketGroup({ doc, items, showAll, active, changed, layout, ctx }: DocketGroupProps) {
  const { api, canEdit } = ctx;
  const no = doc.docketNoQtnNo || '';
  const visible = (items ?? []).filter((it) => matchesItemFilters(it, ctx.itemFilters));
  const first = visible[0] ?? null;
  const count = visible.length;
  const rest = visible.slice(1);
  const shownRest = showAll ? rest : rest.slice(0, ITEM_CAP - 1);
  const span = 1 + shownRest.length;
  const itemCols = layout.cols.filter((c) => c.kind !== 'fixed' && c.kind !== 'stack');
  const typeMissing = !isDocketType(doc.type);
  const attachments = parseAttachments(doc.attachments).length;
  const last = layout.cols[layout.cols.length - 2]?.key;

  const created = new Date(doc.createdAt);
  const age = Math.max(0, Math.floor((Date.now() - created.getTime()) / 86_400_000));
  const fullDate = created.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  // A click on the docket's own cells opens it - unless it landed on a control or ended a text selection.
  const open = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, a, input, select, label, [data-cell]')) return;
    if (window.getSelection()?.toString()) return;
    api.openDrawer(doc.id);
  };

  const itemCell = (c: DocketColumn, item: DocketItem | null) => {
    if (c.kind === 'fixed' || c.kind === 'stack') return null;
    if (!item) return <div className="px-2.5 py-1.5 text-muted-foreground">{c.key === 'itemNameParty' && count === 0 ? 'No items' : '-'}</div>;
    const value = String(item[c.key] ?? '');
    const save = (next: string) => api.saveItem(doc, item, c.key, next);
    if (c.kind === 'choice') {
      const options = c.key === 'ourItemNot' ? OUR_ITEM_NOT : c.key === 'status' ? ctx.statuses : ctx.ourItemNames;
      const tone = c.key !== 'status' ? undefined : value === 'Quoted' ? 'green' : value === 'NOT Required' ? 'red' : undefined;
      const choice = <ChoiceCell col={c.key} value={value} options={options} onSave={save} readOnly={!canEdit} tone={tone} />;
      if (c.key !== 'ourItemName' || !value) return choice;
      return (
        <div className="flex items-center">
          <div className="min-w-0 flex-1">{choice}</div>
          <button
            type="button"
            onClick={() => api.actions().openReasoning(item, item.ourItemName)}
            aria-label="Why this category? (AI reasoning)"
            title="Why this category? (AI reasoning)"
            className={cn(iconButton, 'mr-1 size-6')}
          >
            <Brain size={13} />
          </button>
        </div>
      );
    }
    const text = (
      <TextCell
        col={c.key}
        value={value}
        onSave={save}
        onPasteGrid={(text) => api.paste(doc, item, c.key, text)}
        readOnly={!canEdit}
        numeric={c.kind === 'num'}
        clamp={c.key === 'itemNameParty'}
      />
    );
    if (c.key !== 'itemNameParty') return text;
    // M14: every docket item gets its BOM + costing (Create BOM from a drawing, cost from the Costing Master).
    const bomLink = (
      <Link
        href={`/costing/${item.id}`}
        aria-label={`BOM and costing for item #${item.id}`}
        title="Create BOM / costing"
        className={cn(iconButton, 'mr-0.5 mt-1 size-6 text-[#0f62fe] opacity-60 hover:opacity-100 focus-visible:opacity-100 group-hover/item:opacity-100')}
      >
        <Calculator size={12} />
      </Link>
    );
    if (!ctx.isAdmin) {
      return (
        <div className="group/item flex items-start">
          <div className="min-w-0 flex-1">{text}</div>
          {bomLink}
        </div>
      );
    }
    return (
      <div className="group/item flex items-start">
        <div className="min-w-0 flex-1">{text}</div>
        {bomLink}
        <button
          type="button"
          onClick={() => api.actions().deleteItem(item, doc.docketNoQtnNo)}
          aria-label={`Delete item #${item.id}`}
          title="Delete item (Admin only)"
          className={cn(iconButton, 'mr-1 mt-1 size-6 text-rose-600 opacity-0 hover:bg-rose-50 hover:text-rose-700 focus-visible:opacity-100 group-hover/item:opacity-100')}
        >
          <Trash2 size={12} />
        </button>
      </div>
    );
  };

  return (
    <>
      <tr
        data-docket-id={doc.id}
        className={cn(
          'group/row hover:[--row:var(--muted)]',
          active ? '[--row:var(--muted)]' : typeMissing ? '[--row:#fffbeb]' : '[--row:var(--background)]'
        )}
      >
        {layout.cols.map((c) => {
          const s = stickyBody(c, layout);
          const base = cn(cell, c.key === last && 'border-r-0', s.className);

          if (c.key === 'docket') {
            return (
              <td key={c.key} rowSpan={span} style={s.style} onClick={open} className={cn(base, 'cursor-pointer', active && 'shadow-[inset_2px_0_0_#0f62fe]')}>
                {/* Sticks under the header while the docket's items scroll past. */}
                <div className={cn('sticky top-9 flex h-11 items-center gap-1 pl-2.5 pr-1', changed && 'cell-saved')}>
                  <div className="min-w-0 flex-1">
                    <div className="flex h-4 items-center gap-1.5">
                      <span
                        data-tip={`${no || 'No docket number'} · #${doc.id}\nCreated ${fullDate}${doc.address ? `\n${doc.address}` : ''}`}
                        data-tip-always=""
                        className="truncate font-semibold text-[#0f62fe]"
                      >
                        {no || '-'}
                      </span>
                      {count > 1 && (
                        <span title={`${count} items`} className={cn(chip, 'border-border bg-muted text-foreground/70')}>
                          {count}
                        </span>
                      )}
                      <span className="shrink-0 whitespace-nowrap text-muted-foreground">
                        · {created.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · {age}d
                      </span>
                      {typeMissing ? (
                        <span className={cn(chip, 'ml-auto border-amber-200 bg-amber-50 text-amber-700')}>Type missing</span>
                      ) : (
                        <span className={cn(chip, 'ml-auto border-border bg-background text-foreground/70')}>{doc.type}</span>
                      )}
                    </div>
                    <div className="mt-0.5 flex h-[22px] items-center gap-1">
                      <span data-tip={doc.partyName || undefined} className={cn('min-w-0 flex-1 truncate font-semibold', !doc.partyName && 'font-normal text-muted-foreground')}>
                        {doc.partyName || '-'}
                      </span>
                      {no && (
                        <button
                          type="button"
                          onClick={() => api.copy(no)}
                          aria-label={`Copy ${no}`}
                          title="Copy docket number"
                          className={cn(iconButton, 'size-6 opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100')}
                        >
                          <Copy size={12} />
                        </button>
                      )}
                      {attachments > 0 && (
                        <button
                          type="button"
                          onClick={() => api.actions().openAttachments(doc.id)}
                          aria-label={`View ${attachments} attachment${attachments === 1 ? '' : 's'}`}
                          title={`${attachments} attachment${attachments === 1 ? '' : 's'}`}
                          className={cn(iconButton, 'h-6 w-auto gap-0.5 px-1 text-[11px] font-medium tabular-nums')}
                        >
                          <Paperclip size={12} />
                          {attachments}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => api.openDrawer(doc.id)}
                        aria-label={canEdit ? `Edit docket ${no}` : `View docket ${no}`}
                        title={canEdit ? 'Edit docket' : 'View docket'}
                        className={cn(iconButton, 'size-6 opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100')}
                      >
                        {canEdit ? <Pencil size={12} /> : <Eye size={12} />}
                      </button>
                    </div>
                  </div>
                </div>
              </td>
            );
          }

          if (c.key === 'actions') {
            return (
              <td key={c.key} rowSpan={span} style={s.style} className={base}>
                <div className="sticky top-9 flex h-11 items-center justify-center gap-0.5">
                  <Link href={`/quotation/${doc.id}`} target="_blank" aria-label={`Open PDF quotation for ${no}`} title="PDF quotation" className={iconButton}>
                    <FileText size={15} />
                  </Link>
                  <Link href={`/costing/docket/${doc.id}`} aria-label={`BOM costing for ${no}`} title="BOM costing (all items)" className={iconButton}>
                    <Calculator size={15} />
                  </Link>
                  <RowMenu doc={doc} attachments={attachments} ctx={ctx} />
                </div>
              </td>
            );
          }

          if (c.kind === 'stack') {
            const [top, below] = c.lines;
            const line1 = String(doc[top] ?? '');
            const line2 = below.map((k) => doc[k]).filter(Boolean).join(' · ');
            return (
              <td key={c.key} rowSpan={span} onClick={open} className={cn(base, 'cursor-pointer')}>
                <div className="sticky top-9 space-y-0.5 px-2.5 py-1.5">
                  <div data-tip={line1 || undefined} className={cn('truncate', !line1 && 'text-muted-foreground')}>
                    {line1 || '-'}
                  </div>
                  <div data-tip={line2 || undefined} className="truncate text-muted-foreground">
                    {line2 || '-'}
                  </div>
                </div>
              </td>
            );
          }

          return (
            <td key={c.key} style={s.style} className={base}>
              {itemCell(c, first)}
            </td>
          );
        })}
      </tr>

      {shownRest.map((item) => (
        <tr key={item.id} className="[--row:var(--background)] hover:[--row:var(--muted)]">
          {itemCols.map((c) => {
            const s = stickyBody(c, layout);
            return (
              <td key={c.key} style={s.style} className={cn(cell, c.key === last && 'border-r-0', s.className)}>
                {itemCell(c, item)}
              </td>
            );
          })}
        </tr>
      ))}

      {rest.length > shownRest.length && (
        <tr className="[--row:var(--background)]">
          <td colSpan={layout.cols.length} className="border-b border-border bg-[var(--row)] p-0">
            <button
              type="button"
              onClick={() => api.showAll(doc.id)}
              className="sticky left-0 h-8 px-9 text-xs font-semibold text-[#0f62fe] outline-none hover:underline focus-visible:underline"
            >
              Show all {count} items
            </button>
          </td>
        </tr>
      )}
    </>
  );
});

/** Less-used row actions. The popover is mounted only while open (one per row is 50 idle popovers). */
function RowMenu({ doc, attachments, ctx }: { doc: Docket; attachments: number; ctx: RowContext }) {
  const [open, setOpen] = useState(false);
  const no = doc.docketNoQtnNo?.trim() || '';
  const actions = ctx.api.actions;
  const item = 'flex h-8 w-full items-center gap-2 rounded px-2 text-left text-xs outline-none hover:bg-muted focus-visible:bg-muted disabled:opacity-40';
  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  const trigger = <MoreHorizontal size={15} />;

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} aria-label={`More actions for ${no || `docket #${doc.id}`}`} aria-haspopup="menu" className={iconButton}>
        {trigger}
      </button>
    );
  }
  return (
    <Popover open onOpenChange={setOpen}>
      <PopoverTrigger aria-label="More actions" className={cn(iconButton, 'bg-muted')}>
        {trigger}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 gap-0.5 p-1">
        <button type="button" className={item} onClick={run(() => ctx.api.openDrawer(doc.id))}>
          {ctx.canEdit ? <Pencil size={14} className="text-muted-foreground" /> : <Eye size={14} className="text-muted-foreground" />}
          {ctx.canEdit ? 'Edit docket' : 'View docket'}
        </button>
        <button type="button" className={item} disabled={attachments === 0} onClick={run(() => actions().openAttachments(doc.id))}>
          <Paperclip size={14} className="text-muted-foreground" />
          Attachments ({attachments})
        </button>
        {ctx.canEdit && (
          <>
            <button
              type="button"
              className={item}
              disabled={!no}
              title={no ? undefined : 'Needs a docket number first'}
              onClick={run(() => actions().aiAutofill(no))}
            >
              <Sparkles size={14} className="text-muted-foreground" />
              Autofill items by AI
            </button>
            <button type="button" className={item} disabled={!no} onClick={run(() => actions().addItem(no))}>
              <Plus size={14} className="text-muted-foreground" />
              Add item
            </button>
          </>
        )}
        {ctx.isAdmin && (
          <button type="button" className={cn(item, 'text-rose-600 hover:bg-rose-50')} onClick={run(() => actions().deleteDocket(doc))}>
            <Trash2 size={14} />
            Delete docket
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
