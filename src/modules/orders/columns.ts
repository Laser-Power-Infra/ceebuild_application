import type { DataColumn } from '@/components/data-table/types';

export interface OrderRow {
  id: number;
  poNumber: string;
  poDate: string | null;
  docketNo: string | null;
  client: string | null;
  utility: string | null;
  quotedMt: number | null;
  bomMt: number | null;
  dispatchedMt: number | null;
  deliveryDue: string | null;
  billedRs: number | null;
  collectedRs: number | null;
  outstandingRs: number | null;
  status: string;
}

export interface OrdersMeta {
  quotedMt: number;
  bomMt: number;
  dispatchedMt: number;
  billedRs: number;
  collectedRs: number;
  outstandingRs: number;
}

/** Order lifecycle, in sequence (derived in SQL: src/modules/orders/server/query.ts). */
export const ORDER_STATUSES = [
  'PO received',
  'BOM uploaded',
  'BOM correct',
  'RM indented',
  'RM received',
  'In production',
  'Stage inspected',
  'At galvanising',
  'Galvanised',
  'Inspected',
  'DI issued',
  'Part dispatched',
  'Dispatched',
  'Billed',
  'Closed',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_COLUMNS: DataColumn<OrderRow>[] = [
  { key: 'poNumber', label: 'PO no', kind: 'text', sortable: true, sticky: true, width: 150 },
  { key: 'poDate', label: 'PO date', kind: 'date', sortable: true, width: 120 },
  { key: 'docketNo', label: 'Docket', kind: 'text', sortable: true, filter: true, width: 130 },
  { key: 'client', label: 'Client', kind: 'text', sortable: true, filter: true, width: 220 },
  { key: 'utility', label: 'Utility', kind: 'text', sortable: true, filter: true, width: 110 },
  { key: 'quotedMt', label: 'Quoted MT', kind: 'number', sortable: true, align: 'right', width: 110 },
  { key: 'bomMt', label: 'BOM MT', kind: 'number', sortable: true, align: 'right', width: 100 },
  { key: 'dispatchedMt', label: 'Dispatched MT', kind: 'number', sortable: true, align: 'right', width: 120 },
  { key: 'deliveryDue', label: 'Delivery due', kind: 'date', sortable: true, width: 120 },
  { key: 'billedRs', label: 'Billed (Rs)', kind: 'number', sortable: true, align: 'right', width: 130 },
  { key: 'collectedRs', label: 'Collected (Rs)', kind: 'number', sortable: true, align: 'right', width: 130 },
  { key: 'outstandingRs', label: 'Outstanding (Rs)', kind: 'number', sortable: true, align: 'right', width: 140 },
  { key: 'status', label: 'Status', kind: 'text', sortable: true, filter: true, width: 140 },
];
