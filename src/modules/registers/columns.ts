import type { DataColumn } from '@/components/data-table/types';

export const REGISTER_KEYS = ['stage', 'galv', 'inspection', 'di', 'dispatch', 'invoice', 'collection', 'security'] as const;
export type RegisterKey = (typeof REGISTER_KEYS)[number];

/** Registers of the shop floor and despatch (/execution). */
export const EXECUTION_KEYS = ['stage', 'galv', 'inspection', 'di', 'dispatch'] as const satisfies readonly RegisterKey[];
/** Registers of money and guarantees (/billing and the order's Billing tab). */
export const BILLING_KEYS = ['invoice', 'collection', 'security'] as const satisfies readonly RegisterKey[];

export const REGISTER_LABELS: Record<RegisterKey, string> = {
  stage: 'Stage inspection',
  galv: 'Galvanising',
  inspection: 'Inspection / MC',
  di: 'DI',
  dispatch: 'Dispatch',
  invoice: 'Invoice',
  collection: 'Collection',
  security: 'PBG / LC / Retention',
};

export const COLLECTION_MODES = ['RTGS', 'LC', 'CHEQUE', 'OTHER'] as const;
export const SECURITY_KINDS = ['PBG', 'ABG', 'LC', 'RETENTION', 'SD'] as const;
export const SECURITY_STATUSES = ['ACTIVE', 'RELEASED', 'CLAIMED'] as const;
export const STAGE_NAMES = ['After cutting', 'After punching', 'After bending', 'After welding', 'Final (before galvanising)'] as const;

export type RegisterRow = Record<string, string | number | null> & { id: number; orderId: number };

/** Order columns shown only on the cross-order views. */
const ORDER_COLS: DataColumn<RegisterRow>[] = [
  { key: 'poNumber', label: 'PO no', kind: 'text', sortable: true, filter: true, sticky: true, width: 140 },
  { key: 'client', label: 'Client', kind: 'text', sortable: true, filter: true, width: 180 },
];

const COLS: Record<RegisterKey, DataColumn<RegisterRow>[]> = {
  stage: [
    { key: 'inspectionDate', label: 'Date', kind: 'date', sortable: true, width: 120 },
    { key: 'stage', label: 'Stage', kind: 'text', sortable: true, filter: true, width: 170 },
    { key: 'markNo', label: 'Mark', kind: 'text', sortable: true, filter: true, width: 100 },
    { key: 'piecesOffered', label: 'Offered', kind: 'number', sortable: true, align: 'right', width: 90 },
    { key: 'piecesAccepted', label: 'Accepted', kind: 'number', sortable: true, align: 'right', width: 90 },
    { key: 'piecesRejected', label: 'Rejected', kind: 'number', sortable: true, align: 'right', width: 90 },
    { key: 'inspector', label: 'Inspector', kind: 'text', sortable: true, filter: true, width: 140 },
    { key: 'remarks', label: 'Remarks', kind: 'text', width: 220 },
  ],
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
    { key: 'ewayBillNo', label: 'E-way bill', kind: 'text', sortable: true, width: 130 },
    { key: 'lrNo', label: 'LR no', kind: 'text', sortable: true, width: 120 },
    { key: 'vehicleNo', label: 'Vehicle', kind: 'text', sortable: true, filter: true, width: 120 },
    { key: 'pieces', label: 'Pieces', kind: 'number', sortable: true, align: 'right', width: 90 },
    { key: 'wtKg', label: 'Wt (kg)', kind: 'number', sortable: true, align: 'right', width: 110 },
    { key: 'remarks', label: 'Remarks', kind: 'text', width: 220 },
  ],
  invoice: [
    { key: 'invoiceNo', label: 'Invoice no', kind: 'text', sortable: true, width: 140 },
    { key: 'invoiceDate', label: 'Date', kind: 'date', sortable: true, width: 120 },
    { key: 'dispatchRef', label: 'Dispatch', kind: 'text', sortable: true, width: 150 },
    { key: 'wtKg', label: 'Wt (kg)', kind: 'number', sortable: true, align: 'right', width: 110 },
    { key: 'taxableAmount', label: 'Taxable (Rs)', kind: 'number', sortable: true, align: 'right', width: 130 },
    { key: 'totalAmount', label: 'Total (Rs)', kind: 'number', sortable: true, align: 'right', width: 130 },
    { key: 'dueDate', label: 'Due date', kind: 'date', sortable: true, width: 120 },
    { key: 'collected', label: 'Collected (Rs)', kind: 'number', sortable: true, align: 'right', width: 130 },
    { key: 'retention', label: 'Retention (Rs)', kind: 'number', sortable: true, align: 'right', width: 130 },
    { key: 'outstanding', label: 'Outstanding (Rs)', kind: 'number', sortable: true, align: 'right', width: 140 },
    { key: 'daysOverdue', label: 'Days overdue', kind: 'number', sortable: true, align: 'right', width: 110 },
    { key: 'ageing', label: 'Ageing', kind: 'text', sortable: true, filter: true, width: 110 },
    { key: 'remarks', label: 'Remarks', kind: 'text', width: 200 },
  ],
  collection: [
    { key: 'receiptDate', label: 'Date', kind: 'date', sortable: true, width: 120 },
    { key: 'invoiceNo', label: 'Against invoice', kind: 'text', sortable: true, filter: true, width: 150 },
    { key: 'mode', label: 'Mode', kind: 'text', sortable: true, filter: true, width: 100 },
    { key: 'reference', label: 'Reference / UTR', kind: 'text', sortable: true, width: 160 },
    { key: 'amount', label: 'Amount (Rs)', kind: 'number', sortable: true, align: 'right', width: 130 },
    { key: 'retention', label: 'Retention (Rs)', kind: 'number', sortable: true, align: 'right', width: 130 },
    { key: 'remarks', label: 'Remarks', kind: 'text', width: 220 },
  ],
  security: [
    { key: 'kind', label: 'Type', kind: 'text', sortable: true, filter: true, width: 100 },
    { key: 'refNo', label: 'Ref no', kind: 'text', sortable: true, width: 150 },
    { key: 'bank', label: 'Bank', kind: 'text', sortable: true, filter: true, width: 150 },
    { key: 'amount', label: 'Amount (Rs)', kind: 'number', sortable: true, align: 'right', width: 130 },
    { key: 'issueDate', label: 'Issued', kind: 'date', sortable: true, width: 120 },
    { key: 'expiryDate', label: 'Expiry', kind: 'date', sortable: true, width: 120 },
    { key: 'daysToExpiry', label: 'Days to expiry', kind: 'number', sortable: true, align: 'right', width: 120 },
    { key: 'status', label: 'Status', kind: 'text', sortable: true, filter: true, width: 120, edit: 'select', options: SECURITY_STATUSES },
    { key: 'releasedDate', label: 'Released', kind: 'date', sortable: true, width: 120 },
    { key: 'remarks', label: 'Remarks', kind: 'text', width: 200 },
  ],
};

export function registerColumns(key: RegisterKey, crossOrder: boolean): DataColumn<RegisterRow>[] {
  return crossOrder ? [...ORDER_COLS, ...COLS[key]] : COLS[key];
}

/** KPI tiles per register: label + meta key (summed in SQL over the filtered rows). */
export const REGISTER_KPIS: Record<RegisterKey, { key: string; label: string; digits?: number; tone?: 'green' | 'amber' | 'red' }[]> = {
  stage: [
    { key: 'piecesOffered', label: 'Pieces offered', digits: 0 },
    { key: 'piecesAccepted', label: 'Accepted', digits: 0, tone: 'green' },
    { key: 'piecesRejected', label: 'Rejected', digits: 0, tone: 'red' },
  ],
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
  invoice: [
    { key: 'billed', label: 'Billed (Rs)', digits: 0 },
    { key: 'collected', label: 'Collected (Rs)', digits: 0, tone: 'green' },
    { key: 'retention', label: 'Retention held (Rs)', digits: 0, tone: 'amber' },
    { key: 'outstanding', label: 'Outstanding (Rs)', digits: 0, tone: 'amber' },
    { key: 'overdue', label: 'Overdue (Rs)', digits: 0, tone: 'red' },
  ],
  collection: [
    { key: 'collected', label: 'Collected (Rs)', digits: 0, tone: 'green' },
    { key: 'retention', label: 'Retention withheld (Rs)', digits: 0, tone: 'amber' },
  ],
  security: [
    { key: 'activeAmount', label: 'Active amount (Rs)', digits: 0 },
    { key: 'expiring30', label: 'Expiring in 30 days', digits: 0, tone: 'amber' },
    { key: 'expired', label: 'Expired, still active', digits: 0, tone: 'red' },
  ],
};
