import type { DataColumn } from '@/components/data-table/types';
import type { CutOp, MachinePlanResult, Operation, Routing } from '@/lib/planning/machines';

// Client-safe types and table columns of the production module (machines, routing,
// machine plan, daily production entries).

export type PlanBasis = 'FULL' | 'CUTTABLE' | 'REMAINING';
export const PLAN_BASES: { value: PlanBasis; label: string; hint: string }[] = [
  { value: 'FULL', label: 'Full order', hint: 'All BOM pieces' },
  { value: 'CUTTABLE', label: 'Cuttable from RM', hint: 'Pieces the latest cutting plan (RM received) can cut' },
  { value: 'REMAINING', label: 'Remaining', hint: 'BOM pieces minus what is already produced per operation' },
];
export const isPlanBasis = (v: unknown): v is PlanBasis => v === 'FULL' || v === 'CUTTABLE' || v === 'REMAINING';

export const RATE_UNITS = ['cuts', 'holes', 'notches', 'bends', 'joints', 'pieces', 'threads'] as const;
export const SHIFTS = ['A', 'B', 'C'] as const;

export interface MachineRow {
  id: number;
  code: string;
  name: string;
  operation: Operation;
  units: number;
  ratePerHour: number;
  rateUnit: string;
  shiftsPerDay: number;
  hoursPerShift: number;
  utilisationPct: number;
  capacityPerDay: number;
  rateConfirmed: boolean;
  active: boolean;
  sortOrder: number;
  remarks: string | null;
  entries: number;
}

export interface RoutingRow {
  markNo: string;
  section: string | null;
  description: string | null;
  qty: number;
  routing: Routing;
  /** True when a saved row overrides the section default. */
  saved: boolean;
  operations: Operation[];
}

export interface RoutingInput {
  markNo: string;
  cutOp: CutOp;
  holes: number;
  notches: number;
  bends: number;
  welds: number;
  threads: number;
  numbering: boolean;
}

export interface OrderMachinePlan {
  basis: PlanBasis;
  hasBom: boolean;
  bomStatus: string | null;
  /** Why the plan is empty or partial (e.g. no cutting plan yet). */
  note: string | null;
  workDaysPerWeek: number;
  plan: MachinePlanResult;
}

export interface ShopPlanOrder {
  orderId: number;
  poNumber: string;
  client: string | null;
  remainingPieces: number;
  bottleneck: Operation | null;
  days: number | null;
}

export interface ShopPlan {
  workDaysPerWeek: number;
  plan: MachinePlanResult;
  orders: ShopPlanOrder[];
}

export interface ProgressRow {
  markNo: string;
  section: string | null;
  qty: number;
  /** Per operation the mark needs: pieces produced (required = qty). */
  ops: Partial<Record<Operation, number>>;
}

export interface EntryOptions {
  marks: { markNo: string; qty: number; operations: Operation[] }[];
  machines: { id: number; code: string; name: string; operation: Operation }[];
}

export interface EntryRow {
  id: number;
  orderId: number;
  poNumber: string;
  client: string | null;
  entryDate: string | null;
  shift: string;
  machineCode: string;
  operation: string;
  markNo: string;
  pieces: number;
  wtKg: number | null;
  operatorName: string | null;
  remarks: string | null;
  createdByName: string | null;
}

export interface EntriesMeta {
  pieces: number;
  piecesToday: number;
  cutKg: number;
}

const ORDER_COLS: DataColumn<EntryRow>[] = [
  { key: 'poNumber', label: 'PO no', kind: 'text', sortable: true, filter: true, sticky: true, width: 140 },
  { key: 'client', label: 'Client', kind: 'text', sortable: true, filter: true, width: 180 },
];

const COLS: DataColumn<EntryRow>[] = [
  { key: 'entryDate', label: 'Date', kind: 'date', sortable: true, width: 120 },
  { key: 'shift', label: 'Shift', kind: 'text', sortable: true, filter: true, width: 80 },
  { key: 'machineCode', label: 'Machine', kind: 'text', sortable: true, filter: true, width: 110 },
  { key: 'operation', label: 'Operation', kind: 'text', sortable: true, filter: true, width: 120 },
  { key: 'markNo', label: 'Mark no', kind: 'text', sortable: true, filter: true, width: 110 },
  { key: 'pieces', label: 'Pieces', kind: 'number', sortable: true, align: 'right', width: 90 },
  { key: 'wtKg', label: 'Wt (kg)', kind: 'number', sortable: true, align: 'right', width: 100 },
  { key: 'operatorName', label: 'Operator', kind: 'text', sortable: true, filter: true, width: 140 },
  { key: 'remarks', label: 'Remarks', kind: 'text', width: 200 },
  { key: 'createdByName', label: 'Entered by', kind: 'text', sortable: true, filter: true, width: 130 },
];

export function entryColumns(crossOrder: boolean): DataColumn<EntryRow>[] {
  return crossOrder ? [...ORDER_COLS, ...COLS] : COLS;
}
