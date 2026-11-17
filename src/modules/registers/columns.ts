import type { DataColumn } from '@/components/data-table/types';

export const REGISTER_KEYS = ['galv', 'inspection', 'di', 'dispatch'] as const;
export type RegisterKey = (typeof REGISTER_KEYS)[number];

export const REGISTER_LABELS: Record<RegisterKey, string> = {
  galv: 'Galvanising',
  inspection: 'Inspection / MC',
  di: 'DI',
  dispatch: 'Dispatch',
};

export type RegisterRow = Record<string, string | number | null> & { id: number; orderId: number };

/** Order columns shown only on the cross-order /execution view. */
const ORDER_COLS: DataColumn<RegisterRow>[] = [
  { key: 'poNumber', label: 'PO no', kind: 'text', sortable: true, filter: true, sticky: true, width: 140 },
  { key: 'client', label: 'Client', kind: 'text', sortable: true, filter: true, width: 180 },
];

const COLS: Record<RegisterKey, DataColumn<RegisterRow>[]> = {
  galv: [
    { key: 'challanNo', label: 'Challan no', kind: 'text', sortable: true, width: 130 },
    { key: 'direction', label: 'Out / In', kind: 'text', sortable: true, filter: true, width: 90 },
    { key: 'challanDate', label: 'Date', kind: 'date', sortable: true, width: 120 },
    { key: 'jobWorker', label: 'Galvaniser', kind: 'text', sortable: true, filter: true, width: 160 },
    { key: 'pieces', label: 'Pieces', kind: 'number', sortable: true, align: 'right', width: 90 },
    { key: 'blackWtKg', label: 'Black wt (kg)', kind: 'number', sortable: true, align: 'right', width: 120 },
    { key: 'galvWtKg', label: 'Galv wt (kg)', kind: 'number', sortable: true, align: 'right', width: 120 },
    { key: 'zincPct', label: 'Zinc pick-up %', kind: 'number', sortable: true, align: 'right', width: 120 },
    { key: 'marks', label: 'Pieces by mark', kind: 'text', width: 260 },
    { key: 'remarks', label: 'Remarks', kind: 'text', width: 200 },
  ],
  inspection: [
    { key: 'inspectionNo', label: 'Inspection no', kind: 'text', sortable: true, width: 140 },
    { key: 'mcNo', label: 'MC no', kind: 'text', sortable: true, width: 130 },
    { key: 'inspectionDate', label: 'Date', kind: 'date', sortable: true, width: 120 },
    { key: 'piecesCleared', label: 'Pieces cleared', kind: 'number', sortable: true, align: 'right', width: 120 },
    { key: 'wtClearedKg', label: 'Wt cleared (kg)', kind: 'number', sortable: true, align: 'right', width: 130 },
    { key: 'remarks', label: 'Remarks', kind: 'text', width: 240 },
  ],
  di: [
    { key: 'diNo', label: 'DI no', kind: 'text', sortable: true, width: 140 },
    { key: 'diDate', label: 'Date', kind: 'date', sortable: true, width: 120 },
    { key: 'pieces', label: 'Pieces', kind: 'number', sortable: true, align: 'right', width: 90 },
    { key: 'wtKg', label: 'DI wt (kg)', kind: 'number', sortable: true, align: 'right', width: 120 },
    { key: 'dispatchedKg', label: 'Dispatched (kg)', kind: 'number', sortable: true, align: 'right', width: 130 },
    { key: 'remarks', label: 'Remarks', kind: 'text', width: 240 },
  ],
  dispatch: [
    { key: 'dispatchDate', label: 'Date', kind: 'date', sortable: true, width: 120 },
    { key: 'diNo', label: 'Against DI', kind: 'text', sortable: true, filter: true, width: 130 },
    { key: 'invoiceNo', label: 'Invoice no', kind: 'text', sortable: true, width: 130 },
    { key: 'lrNo', label: 'LR no', kind: 'text', sortable: true, width: 120 },
    { key: 'vehicleNo', label: 'Vehicle', kind: 'text', sortable: true, filter: true, width: 120 },
    { key: 'pieces', label: 'Pieces', kind: 'number', sortable: true, align: 'right', width: 90 },
    { key: 'wtKg', label: 'Wt (kg)', kind: 'number', sortable: true, align: 'right', width: 110 },
    { key: 'remarks', label: 'Remarks', kind: 'text', width: 220 },
  ],
};

export function registerColumns(key: RegisterKey, crossOrder: boolean): DataColumn<RegisterRow>[] {
  return crossOrder ? [...ORDER_COLS, ...COLS[key]] : COLS[key];
}

/** KPI tiles per register: label + meta key (summed in SQL over the filtered rows). */
export const REGISTER_KPIS: Record<RegisterKey, { key: string; label: string; digits?: number; tone?: 'green' | 'amber' | 'red' }[]> = {
  galv: [
    { key: 'outPieces', label: 'Pieces sent out', digits: 0 },
    { key: 'inPieces', label: 'Pieces back in', digits: 0, tone: 'green' },
    { key: 'pendingPieces', label: 'Pieces at galvaniser', digits: 0, tone: 'amber' },
    { key: 'blackWtKg', label: 'Black wt out (kg)' },
    { key: 'galvWtKg', label: 'Galv wt in (kg)', tone: 'green' },
  ],
  inspection: [
    { key: 'piecesCleared', label: 'Pieces cleared', digits: 0, tone: 'green' },
    { key: 'wtClearedKg', label: 'Wt cleared (kg)', tone: 'green' },
  ],
  di: [
    { key: 'wtKg', label: 'DI wt (kg)' },
    { key: 'dispatchedKg', label: 'Dispatched against DI (kg)', tone: 'green' },
  ],
  dispatch: [
    { key: 'pieces', label: 'Pieces dispatched', digits: 0, tone: 'green' },
    { key: 'wtKg', label: 'Wt dispatched (kg)', tone: 'green' },
  ],
};
