import type { DataColumn } from '@/components/data-table/types';

export interface PieceRow {
  id: number;
  rowNo: number;
  markNo: string | null;
  description: string | null;
  section: string | null;
  lengthMm: number | null;
  qtyPerSet: number | null;
  sets: number | null;
  totalQty: number | null;
  kgPerM: number | null;
  unitWtKg: number | null;
  totalWtKg: number | null;
  flagged: boolean;
  issues: string | null;
}

export const FLAGS = [
  { key: 'flagMarkLength', column: 'flag_mark_length', label: 'Same mark, different length' },
  { key: 'flagBlankQty', column: 'flag_blank_qty', label: 'Blank qty' },
  { key: 'flagKgm', column: 'flag_kgm', label: 'kg/m off by more than ±5%' },
  { key: 'flagFractionalSets', column: 'flag_fractional_sets', label: 'Fractional sets' },
  { key: 'flagSection', column: 'flag_section', label: 'Section not in GTP' },
] as const;
export type FlagKey = (typeof FLAGS)[number]['key'];

export interface PiecesMeta {
  totalWtKg: number;
  flagged: number;
  flagCounts: Record<FlagKey, number>;
}

/** Fields an editor may change on a piece (re-runs the checks). */
export const EDITABLE_PIECE_FIELDS = ['markNo', 'section', 'lengthMm', 'qtyPerSet', 'sets', 'totalQty', 'kgPerM', 'unitWtKg'] as const;
export type EditablePieceField = (typeof EDITABLE_PIECE_FIELDS)[number];

export const PIECE_COLUMNS: DataColumn<PieceRow>[] = [
  { key: 'rowNo', label: 'Row', kind: 'number', sortable: true, sticky: true, width: 70, align: 'right' },
  { key: 'markNo', label: 'Mark no', kind: 'text', sortable: true, filter: true, sticky: true, width: 110, edit: 'text' },
  { key: 'section', label: 'Section', kind: 'text', sortable: true, filter: true, width: 150, edit: 'text' },
  { key: 'lengthMm', label: 'Length (mm)', kind: 'number', sortable: true, filter: true, align: 'right', width: 110, edit: 'text' },
  { key: 'qtyPerSet', label: 'Qty/set', kind: 'number', sortable: true, align: 'right', width: 90, edit: 'text' },
  { key: 'sets', label: 'Sets', kind: 'number', sortable: true, align: 'right', width: 80, edit: 'text' },
  { key: 'totalQty', label: 'Total qty', kind: 'number', sortable: true, align: 'right', width: 100, edit: 'text' },
  { key: 'kgPerM', label: 'kg/m', kind: 'number', sortable: true, align: 'right', width: 90, edit: 'text' },
  { key: 'unitWtKg', label: 'Unit wt (kg)', kind: 'number', sortable: true, align: 'right', width: 110, edit: 'text' },
  { key: 'totalWtKg', label: 'Total wt (kg)', kind: 'number', sortable: true, align: 'right', width: 120 },
  { key: 'description', label: 'Description', kind: 'text', sortable: true, width: 220 },
  { key: 'issues', label: 'Issues', kind: 'text', width: 340 },
];
