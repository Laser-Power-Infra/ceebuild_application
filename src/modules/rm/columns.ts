import type { DataColumn } from '@/components/data-table/types';
import type { BarPattern, IndentLine, PlanComparison, ReplanResult, CutSettings } from '@/lib/planning/cutting';

export const INDENT_STATUSES = ['DRAFT', 'ISSUED', 'CANCELLED'] as const;
export type IndentStatus = (typeof INDENT_STATUSES)[number];
export const LOT_DECISIONS = ['ACCEPTED', 'REJECTED', 'DEBIT_NOTE'] as const;
export type LotDecision = (typeof LOT_DECISIONS)[number];
export const DECISION_LABELS: Record<LotDecision, string> = { ACCEPTED: 'Accepted', REJECTED: 'Rejected', DEBIT_NOTE: 'Accepted on debit note' };
export const LENGTH_STATUS_LABELS: Record<string, string> = { OK: 'OK', SHORT: 'Short', OVER_TOL: 'Over tolerance' };

export interface IndentSettingsSnapshot extends CutSettings {
  confirmed: boolean;
}

export interface IndentDetail {
  id: number;
  orderId: number;
  indentNo: string;
  kind: 'PRIMARY' | 'SUPPLEMENTARY';
  strategy: 'MIXED' | 'STANDARD';
  status: IndentStatus;
  settings: IndentSettingsSnapshot;
  comparison: PlanComparison | null;
  patterns: BarPattern[];
  warnings: string[];
  lines: (IndentLine & { id: number })[];
  totalBars: number;
  totalWtKg: number;
  remarks: string | null;
  createdByName: string | null;
  createdAt: string;
  issuedByName: string | null;
  issuedAt: string | null;
}

export interface ReceiptLotView {
  id: number;
  sectionKey: string;
  sectionLabel: string | null;
  orderedLengthMm: number;
  measuredLengthMm: number;
  nos: number;
  wtKg: number | null;
  heatNo: string | null;
  lengthStatus: 'OK' | 'SHORT' | 'OVER_TOL';
  decision: LotDecision;
  debitNoteNo: string | null;
  remarks: string | null;
}

export interface ReceiptView {
  id: number;
  receiptNo: string;
  receiptDate: string;
  supplier: string | null;
  invoiceNo: string | null;
  indentNo: string | null;
  remarks: string | null;
  createdByName: string | null;
  lots: ReceiptLotView[];
}

export interface CuttingPlanView {
  id: number;
  createdAt: string;
  createdByName: string | null;
  settings: CutSettings;
  result: ReplanResult;
  supplementaryIndentId: number | null;
  supplementaryIndentNo: string | null;
  /** Receipts/lots changed after this plan was made: re-plan again. */
  stale: boolean;
}

/** Options for the receipt form: sections of the BOM + issued indent lines. */
export interface ReceiptOptions {
  sections: { sectionKey: string; label: string }[];
  indents: { id: number; indentNo: string; kind: string; status: string }[];
  orderedLengths: { sectionKey: string; barLengthMm: number }[];
  tolPlusMm: number;
}

// ------------------------------------------------------------- cross-order tables

export interface IndentRow {
  id: number;
  orderId: number;
  poNumber: string;
  client: string | null;
  indentNo: string;
  kind: string;
  strategy: string;
  status: string;
  totalBars: number;
  totalMt: number;
  createdAt: string;
  createdByName: string | null;
}

export interface IndentsMeta {
  totalMt: number;
  issuedMt: number;
  drafts: number;
}

export const INDENT_COLUMNS: DataColumn<IndentRow>[] = [
  { key: 'indentNo', label: 'Indent no', kind: 'text', sortable: true, sticky: true, width: 130 },
  { key: 'poNumber', label: 'PO no', kind: 'text', sortable: true, filter: true, width: 150 },
  { key: 'client', label: 'Client', kind: 'text', sortable: true, filter: true, width: 200 },
  { key: 'kind', label: 'Kind', kind: 'text', sortable: true, filter: true, width: 130 },
  { key: 'strategy', label: 'Plan', kind: 'text', sortable: true, filter: true, width: 110 },
  { key: 'status', label: 'Status', kind: 'text', sortable: true, filter: true, width: 110 },
  { key: 'totalBars', label: 'Bars', kind: 'number', sortable: true, align: 'right', width: 90 },
  { key: 'totalMt', label: 'MT', kind: 'number', sortable: true, align: 'right', width: 100 },
  { key: 'createdAt', label: 'Created', kind: 'date', sortable: true, width: 120 },
  { key: 'createdByName', label: 'By', kind: 'text', sortable: true, filter: true, width: 140 },
];

export interface LotRow {
  id: number;
  orderId: number;
  poNumber: string;
  client: string | null;
  receiptNo: string;
  receiptDate: string;
  supplier: string | null;
  section: string;
  orderedLengthMm: number;
  measuredLengthMm: number;
  diffMm: number;
  nos: number;
  wtKg: number | null;
  heatNo: string | null;
  lengthStatus: string;
  decision: string;
  debitNoteNo: string | null;
}

export interface LotsMeta {
  nos: number;
  wtMt: number;
  shortLots: number;
  rejectedNos: number;
}

export const LOT_COLUMNS: DataColumn<LotRow>[] = [
  { key: 'poNumber', label: 'PO no', kind: 'text', sortable: true, filter: true, sticky: true, width: 150 },
  { key: 'client', label: 'Client', kind: 'text', sortable: true, filter: true, width: 180 },
  { key: 'receiptNo', label: 'Receipt / GRN', kind: 'text', sortable: true, width: 130 },
  { key: 'receiptDate', label: 'Date', kind: 'date', sortable: true, width: 115 },
  { key: 'supplier', label: 'Supplier', kind: 'text', sortable: true, filter: true, width: 160 },
  { key: 'section', label: 'Section', kind: 'text', sortable: true, filter: true, width: 140 },
  { key: 'orderedLengthMm', label: 'Ordered (mm)', kind: 'number', sortable: true, align: 'right', width: 115 },
  { key: 'measuredLengthMm', label: 'Measured (mm)', kind: 'number', sortable: true, align: 'right', width: 120 },
  { key: 'diffMm', label: 'Diff (mm)', kind: 'number', sortable: true, align: 'right', width: 95 },
  { key: 'nos', label: 'Nos', kind: 'number', sortable: true, align: 'right', width: 80 },
  { key: 'wtKg', label: 'Wt (kg)', kind: 'number', sortable: true, align: 'right', width: 100 },
  { key: 'heatNo', label: 'Heat no', kind: 'text', sortable: true, width: 110 },
  { key: 'lengthStatus', label: 'Length', kind: 'text', sortable: true, filter: true, width: 120 },
  { key: 'decision', label: 'Decision', kind: 'text', sortable: true, filter: true, width: 170 },
  { key: 'debitNoteNo', label: 'Debit note', kind: 'text', sortable: true, width: 120 },
];
