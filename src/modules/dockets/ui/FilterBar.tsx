'use client';

import { memo, useCallback, useRef, useState } from 'react';
import { Calendar, SlidersHorizontal, X } from 'lucide-react';
import MultiSelectFilter, { BLANK } from '@/components/ui/multi-select-filter';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SearchField } from '@/components/data-table/SearchField';
import { cn } from '@/lib/utils';
import type { DocketFilterKey, DocketFilters } from '../types';

const control =
  'inline-flex h-8 w-auto shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50';
const controlOn = 'border-blue-500 bg-blue-50/80 font-semibold text-blue-700 hover:bg-blue-50';
// The shared filter panel is set in 9-10px; this screen's floor is 11px.
const panel =
  'w-72 max-h-80 [&_label]:!py-1.5 [&_label]:!text-xs [&_input[type=text]]:!h-5 [&_input[type=text]]:!text-xs [&_button]:!text-[11px] [&_label_span:last-child]:!text-[11px] [&_div.flex-1]:!max-h-60';

interface Facet {
  /** Filter signature (all filters except this one) the options were computed for. */
  sig: string;
  options: { value: string; count: number }[];
}

const LABELS: Record<DocketFilterKey, string> = {
  item: 'Item',
  partyName: 'Party',
  state: 'State',
  type: 'Type',
  docketNoQtnNo: 'Docket no',
  utility: 'Utility',
  attachments: 'Attachments',
  price: 'Price condition',
  payment: 'Payment condition',
  delivery: 'Delivery condition',
  warranty: 'Warranty condition',
  approval: 'Approval condition',
  inspection: 'Inspection condition',
  uom: 'UOM',
  ourItemNot: 'Our Item / Not',
  size: 'Size',
};
const INLINE: DocketFilterKey[] = ['item', 'partyName', 'state', 'type'];
const MORE_DOCKET: DocketFilterKey[] = ['docketNoQtnNo', 'utility', 'attachments', 'price', 'payment', 'delivery', 'warranty', 'approval', 'inspection'];
const MORE_ITEMS: DocketFilterKey[] = ['uom', 'ourItemNot', 'size'];
const ATTACHMENT_LABELS = { has: 'With attachments', empty: 'Without attachments' };

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

interface FilterBarProps {
  search: string;
  onSearch: (value: string) => void;
  busy: boolean;
  startDate: string;
  endDate: string;
  onDates: (start: string, end: string) => void;
  filters: DocketFilters;
  onFilters: (next: DocketFilters) => void;
  /** Current filter params (no page / sort), as sent to /api/dockets. */
  filterQuery: string;
  active: boolean;
  onClear: () => void;
}

/** The one place to filter: search, the everyday filters inline, the rest under "More filters". */
export const FilterBar = memo(function FilterBar({
  search,
  onSearch,
  busy,
  startDate,
  endDate,
  onDates,
  filters,
  onFilters,
  filterQuery,
  active,
  onClear,
}: FilterBarProps) {
  const [facets, setFacets] = useState<Partial<Record<DocketFilterKey, Facet>>>({});
  const facetsRef = useRef(facets);
  facetsRef.current = facets;
  const queryRef = useRef(filterQuery);
  queryRef.current = filterQuery;

  // Options are fetched when a dropdown opens, under all the OTHER filters; the previous list
  // stays on screen until the new one arrives.
  const loadFacet = useCallback(async (key: DocketFilterKey) => {
    if (key === 'attachments') return;
    const params = new URLSearchParams(queryRef.current);
    params.delete(key);
    const sig = params.toString();
    if (facetsRef.current[key]?.sig === sig) return;
    params.set('field', key);
    try {
      const res = await fetch(`/api/dockets/facets?${params}`);
      const data = await res.json();
      if (res.ok && Array.isArray(data.options)) setFacets((prev) => ({ ...prev, [key]: { sig, options: data.options } }));
    } catch {
      // Keep whatever options are already on screen.
    }
  }, []);

  const select = (key: DocketFilterKey) => {
    const picked = filters[key];
    const facet = facets[key];
    const fixed = key === 'attachments';
    const options = fixed ? Object.keys(ATTACHMENT_LABELS) : (facet?.options ?? []).filter((o) => o.value !== BLANK).map((o) => o.value);
    return (
      <MultiSelectFilter
        key={key}
        label={LABELS[key]}
        allLabel={LABELS[key]}
        options={options}
        cascadedOptions={options}
        selected={picked}
        onChange={(vals) => onFilters({ ...filters, [key]: vals })}
        onOpen={() => void loadFacet(key)}
        counts={fixed ? undefined : Object.fromEntries((facet?.options ?? []).map((o) => [o.value, o.count]))}
        optionLabels={fixed ? ATTACHMENT_LABELS : undefined}
        includeBlank={!fixed && Boolean(facet?.options.some((o) => o.value === BLANK) || picked.includes(BLANK))}
        loading={!fixed && !facet}
        renderButtonLabel={(sel) => (sel.length ? `${LABELS[key]} (${sel.length})` : LABELS[key])}
        className={cn(control, 'justify-between', picked.length > 0 && controlOn)}
        panelClassName={panel}
      />
    );
  };

  const moreCount = [...MORE_DOCKET, ...MORE_ITEMS].filter((k) => filters[k].length > 0).length;
  const dated = Boolean(startDate || endDate);

  return (
    <div className="flex h-11 shrink-0 items-center gap-2 overflow-x-auto border-b border-border bg-background px-4">
      <SearchField
        value={search}
        onCommit={onSearch}
        delay={250}
        busy={busy}
        placeholder="Docket no, party or item"
        className="w-56 shrink-0 [&_input]:rounded-md [&_input]:text-xs"
      />
      {INLINE.map(select)}

      <Popover>
        <PopoverTrigger className={cn(control, dated && controlOn)}>
          <Calendar size={13} className={dated ? '' : 'text-muted-foreground'} />
          {dated ? `${startDate ? shortDate(startDate) : '…'} – ${endDate ? shortDate(endDate) : '…'}` : 'Date'}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-60 gap-2 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold">Created between</span>
            {dated && (
              <button type="button" onClick={() => onDates('', '')} className="text-[11px] font-semibold text-rose-600 hover:underline">
                Clear
              </button>
            )}
          </div>
          {(['From', 'To'] as const).map((label) => (
            <label key={label} className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="w-9">{label}</span>
              <input
                type="date"
                value={label === 'From' ? startDate : endDate}
                min={label === 'To' ? startDate || undefined : undefined}
                max={label === 'From' ? endDate || undefined : undefined}
                onChange={(e) => (label === 'From' ? onDates(e.target.value, endDate) : onDates(startDate, e.target.value))}
                className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </label>
          ))}
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger className={cn(control, moreCount > 0 && controlOn)}>
          <SlidersHorizontal size={13} className={moreCount ? '' : 'text-muted-foreground'} />
          {moreCount ? `More filters (${moreCount})` : 'More filters'}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[26rem] gap-3 p-3">
          {(
            [
              ['Docket', MORE_DOCKET],
              ['Items', MORE_ITEMS],
            ] as const
          ).map(([heading, keys]) => (
            <div key={heading} className="space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{heading}</div>
              <div className="flex flex-wrap gap-1.5">{keys.map(select)}</div>
            </div>
          ))}
        </PopoverContent>
      </Popover>

      {active && (
        <button
          type="button"
          onClick={onClear}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-semibold text-rose-600 hover:bg-rose-50"
        >
          <X size={13} />
          Clear all
        </button>
      )}
    </div>
  );
});
