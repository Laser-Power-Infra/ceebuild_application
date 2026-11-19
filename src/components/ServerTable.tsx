'use client';

import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { DataTable } from '@/components/data-table/DataTable';
import { Pagination } from '@/components/data-table/Pagination';
import { SearchField } from '@/components/data-table/SearchField';
import { FilterChips, type FilterChip } from '@/components/data-table/FilterChips';
import { useServerTable } from '@/components/data-table/useServerTable';
import type { DataColumn, TablePage, TableQuery } from '@/components/data-table/types';
import { initialTable, opsActions } from '@/lib/opsSlice';
import { useAppDispatch, useAppSelector } from '@/lib/store';

type Result<T> = { success: true; data: T } | { success: false; error: string };

export interface ServerTableProps<Row, Meta> {
  /** Key of this table's query state in the Redux store. */
  tableId: string;
  columns: DataColumn<Row>[];
  rowId: (row: Row) => string;
  fetchPage: (query: TableQuery) => Promise<Result<TablePage<Row, Meta>>>;
  fetchFacet: (key: string, query: TableQuery) => Promise<Result<string[]>>;
  /** Fixed predicates added to every query (e.g. {orderId: "12"}). */
  scope?: Record<string, string>;
  onEdit?: (row: Row, column: DataColumn<Row>, value: string) => Promise<boolean>;
  rowClassName?: (row: Row) => string | undefined;
  renderDetail?: (row: Row) => ReactNode;
  /** KPI tiles / quick toggles above the table; gets the server meta of the filtered set. */
  header?: (ctx: { meta: Meta | undefined; total: number; extra: Record<string, string>; setExtra: (key: string, value: string | null) => void }) => ReactNode;
  toolbar?: ReactNode;
  /** Bump to reload after a mutation done outside the table. */
  reloadToken?: number;
  searchPlaceholder?: string;
}

/** The GMD table standard in one component: Redux query state + useServerTable + DataTable + chips + paging. */
export function ServerTable<Row, Meta = unknown>({
  tableId,
  columns,
  rowId,
  fetchPage,
  fetchFacet,
  scope,
  onEdit,
  rowClassName,
  renderDetail,
  header,
  toolbar,
  reloadToken = 0,
  searchPlaceholder,
}: ServerTableProps<Row, Meta>) {
  const dispatch = useAppDispatch();
  const st = useAppSelector((s) => s.ops.tables[tableId]) ?? initialTable;
  const id = tableId;

  const query: TableQuery = useMemo(
    () => ({
      page: st.page,
      pageSize: st.pageSize,
      sort: st.sort,
      search: st.search,
      filters: st.filters,
      dateRanges: st.dateRanges,
      columnSearch: st.columnSearch,
      extra: { ...st.extra, ...scope },
    }),
    [st, scope],
  );
  const filterPart = { search: st.search, filters: st.filters, dateRanges: st.dateRanges, columnSearch: st.columnSearch, extra: st.extra, scope };
  const filterKey = JSON.stringify(filterPart);
  const queryKey = JSON.stringify({ q: query, reloadToken });

  const unwrap = <T,>(r: Result<T>) => {
    if (!r.success) throw new Error(r.error);
    return r.data;
  };
  const table = useServerTable<TablePage<Row, Meta>>({
    queryKey,
    filterKey,
    facetKey: (key) => JSON.stringify({ ...filterPart, filters: { ...st.filters, [key]: undefined } }),
    fetchPage: async () => unwrap(await fetchPage(query)),
    fetchFacet: async (key) => unwrap(await fetchFacet(key, query)),
  });

  // Drop a selection that is no longer on the page.
  useEffect(() => {
    if (st.selectedId && table.data && !table.data.rows.some((r) => rowId(r) === st.selectedId)) {
      dispatch(opsActions.select({ id, rowId: null }));
    }
  }, [table.data, st.selectedId, rowId, dispatch, id]);

  const chips: FilterChip[] = [
    ...Object.entries(st.filters).flatMap(([key, values]) =>
      values.map((value) => ({ key, value, label: columns.find((c) => c.key === key)?.label ?? key })),
    ),
    ...Object.entries(st.columnSearch).map(([key, value]) => ({ key, value, search: true, label: columns.find((c) => c.key === key)?.label ?? key })),
    ...Object.entries(st.dateRanges).map(([key, r]) => ({ key, value: `${r.from || '…'} – ${r.to || '…'}`, date: true, label: columns.find((c) => c.key === key)?.label ?? key })),
  ];
  const hasFilters = chips.length > 0 || !!st.search || Object.keys(st.extra).length > 0;

  const removeChip = useCallback(
    (chip: FilterChip) => {
      if (chip.date) dispatch(opsActions.setDateRange({ id, key: chip.key, range: undefined }));
      else if (chip.search) dispatch(opsActions.setColumnSearch({ id, key: chip.key, value: '' }));
      else dispatch(opsActions.setFilter({ id, key: chip.key, values: (st.filters[chip.key] ?? []).filter((v) => v !== chip.value) }));
    },
    [dispatch, id, st.filters],
  );

  const total = table.data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / st.pageSize));

  return (
    <div className="flex flex-col gap-3">
      {header?.({
        meta: table.data?.meta,
        total,
        extra: st.extra,
        setExtra: (key, value) => dispatch(opsActions.setExtra({ id, key, value })),
      })}
      <div className="flex flex-wrap items-center gap-2">
        <SearchField
          value={st.search}
          onCommit={(value) => dispatch(opsActions.setSearch({ id, value }))}
          busy={table.refreshing}
          placeholder={searchPlaceholder ?? 'Search'}
          className="w-full max-w-sm"
        />
        <div className="flex-1" />
        {toolbar}
      </div>
      <FilterChips chips={chips} onRemove={removeChip} onClear={() => dispatch(opsActions.clearFilters({ id }))} />
      <DataTable<Row>
        columns={columns}
        rows={table.data?.rows ?? []}
        rowId={rowId}
        sort={st.sort}
        onSortChange={(sort) => dispatch(opsActions.setSort({ id, sort }))}
        filters={st.filters}
        onFilterChange={(key, values) => dispatch(opsActions.setFilter({ id, key, values }))}
        dateRanges={st.dateRanges}
        onDateRangeChange={(key, range) => dispatch(opsActions.setDateRange({ id, key, range }))}
        columnSearch={st.columnSearch}
        onColumnSearchChange={(key, value) => dispatch(opsActions.setColumnSearch({ id, key, value }))}
        facetOptions={table.getFacetOptions}
        onFacetOpen={(key) => void table.requestFacet(key)}
        selectedId={st.selectedId}
        onSelect={(rowIdValue) => dispatch(opsActions.select({ id, rowId: rowIdValue }))}
        onEdit={
          onEdit
            ? async (row, column, value) => {
                const ok = await onEdit(row, column, value);
                if (ok) void table.refresh();
                return ok;
              }
            : undefined
        }
        rowClassName={rowClassName}
        renderDetail={renderDetail}
        loading={table.loading}
        refreshing={table.refreshing}
        error={table.error}
        onRetry={() => void table.refresh()}
        hasFilters={hasFilters}
        onClearFilters={() => dispatch(opsActions.clearFilters({ id }))}
        onPageStep={(d) => {
          const next = st.page + d;
          if (next >= 1 && next <= lastPage) dispatch(opsActions.setPage({ id, page: next }));
        }}
      />
      <Pagination
        page={st.page}
        pageSize={st.pageSize}
        total={total}
        onPageChange={(page) => dispatch(opsActions.setPage({ id, page }))}
        onPageSizeChange={(size) => dispatch(opsActions.setPageSize({ id, size }))}
      />
    </div>
  );
}

/** Small KPI tile used above tables. `active` highlights a tile that acts as a filter toggle. */
export function Kpi({ label, value, tone, active, onClick }: { label: string; value: ReactNode; tone?: 'red' | 'green' | 'amber'; active?: boolean; onClick?: () => void }) {
  const toneCls = tone === 'red' ? 'text-rose-700' : tone === 'green' ? 'text-emerald-700' : tone === 'amber' ? 'text-amber-700' : 'text-slate-900';
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      aria-pressed={onClick ? !!active : undefined}
      className={`min-w-36 rounded-xl border bg-white px-4 py-3 text-left shadow-sm ${active ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-slate-200'} ${onClick ? 'hover:border-blue-300' : ''}`}
    >
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${toneCls}`}>{value}</div>
    </Tag>
  );
}

export const fmtNum = (n: number | null | undefined, digits = 2) =>
  n === null || n === undefined || !Number.isFinite(n) ? '–' : new Intl.NumberFormat('en-IN', { maximumFractionDigits: digits }).format(n);
