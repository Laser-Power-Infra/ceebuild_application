import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { DateRange, TableSort } from '@/components/data-table/types';

// Query + selection state for every server table of the order-to-execution screens, keyed by
// table id (e.g. "orders", "bom:12", "register:galv:12"), plus the order page's active tab.

export interface TableState {
  page: number;
  pageSize: number;
  sort: TableSort | null;
  search: string;
  filters: Record<string, string[]>;
  dateRanges: Record<string, DateRange>;
  columnSearch: Record<string, string>;
  /** Screen-specific toggles sent to the server as query.extra (e.g. {flag: "flagKgm"}). */
  extra: Record<string, string>;
  selectedId: string | null;
}

export const initialTable: TableState = {
  page: 1,
  pageSize: 50,
  sort: null,
  search: '',
  filters: {},
  dateRanges: {},
  columnSearch: {},
  extra: {},
  selectedId: null,
};

export type OrderTab = 'bom' | 'galv' | 'inspection' | 'di' | 'dispatch' | 'quotation';

interface OpsState {
  tables: Record<string, TableState>;
  orderTab: OrderTab;
  executionTab: Exclude<OrderTab, 'bom' | 'quotation'>;
}

const initialState: OpsState = { tables: {}, orderTab: 'bom', executionTab: 'galv' };

const t = (s: OpsState, id: string) => (s.tables[id] ??= { ...initialTable });

const slice = createSlice({
  name: 'ops',
  initialState,
  reducers: {
    setSearch(s, a: PayloadAction<{ id: string; value: string }>) {
      const x = t(s, a.payload.id);
      x.search = a.payload.value;
      x.page = 1;
    },
    setFilter(s, a: PayloadAction<{ id: string; key: string; values: string[] }>) {
      const x = t(s, a.payload.id);
      if (a.payload.values.length) x.filters[a.payload.key] = a.payload.values;
      else delete x.filters[a.payload.key];
      x.page = 1;
    },
    setDateRange(s, a: PayloadAction<{ id: string; key: string; range: DateRange | undefined }>) {
      const x = t(s, a.payload.id);
      if (a.payload.range) x.dateRanges[a.payload.key] = a.payload.range;
      else delete x.dateRanges[a.payload.key];
      x.page = 1;
    },
    setColumnSearch(s, a: PayloadAction<{ id: string; key: string; value: string }>) {
      const x = t(s, a.payload.id);
      if (a.payload.value.trim()) x.columnSearch[a.payload.key] = a.payload.value.trim();
      else delete x.columnSearch[a.payload.key];
      x.page = 1;
    },
    setExtra(s, a: PayloadAction<{ id: string; key: string; value: string | null }>) {
      const x = t(s, a.payload.id);
      if (a.payload.value) x.extra[a.payload.key] = a.payload.value;
      else delete x.extra[a.payload.key];
      x.page = 1;
    },
    clearFilters(s, a: PayloadAction<{ id: string }>) {
      const x = t(s, a.payload.id);
      x.filters = {};
      x.dateRanges = {};
      x.columnSearch = {};
      x.search = '';
      x.extra = {};
      x.page = 1;
    },
    setSort(s, a: PayloadAction<{ id: string; sort: TableSort | null }>) {
      const x = t(s, a.payload.id);
      x.sort = a.payload.sort;
      x.page = 1;
    },
    setPage(s, a: PayloadAction<{ id: string; page: number }>) {
      t(s, a.payload.id).page = a.payload.page;
    },
    setPageSize(s, a: PayloadAction<{ id: string; size: number }>) {
      const x = t(s, a.payload.id);
      x.pageSize = a.payload.size;
      x.page = 1;
    },
    select(s, a: PayloadAction<{ id: string; rowId: string | null }>) {
      t(s, a.payload.id).selectedId = a.payload.rowId;
    },
    setOrderTab(s, a: PayloadAction<OrderTab>) {
      s.orderTab = a.payload;
    },
    setExecutionTab(s, a: PayloadAction<OpsState['executionTab']>) {
      s.executionTab = a.payload;
    },
  },
});

export const opsActions = slice.actions;
export const opsReducer = slice.reducer;
export type { OpsState };
