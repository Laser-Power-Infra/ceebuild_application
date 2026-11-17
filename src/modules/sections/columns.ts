import type { DataColumn } from '@/components/data-table/types';

export interface SectionRow {
  id: number;
  label: string;
  sectionKey: string;
  kgPerM: number;
  grade: string | null;
  approved: string; // 'Yes' | 'No'
  source: string | null;
  usedInBoms: number;
}

export const SECTION_COLUMNS: DataColumn<SectionRow>[] = [
  { key: 'label', label: 'Section', kind: 'text', sortable: true, sticky: true, width: 170, edit: 'text' },
  { key: 'sectionKey', label: 'Match key', kind: 'text', sortable: true, width: 150 },
  { key: 'kgPerM', label: 'kg/m (standard)', kind: 'number', sortable: true, align: 'right', width: 130, edit: 'text' },
  { key: 'grade', label: 'Grade', kind: 'text', sortable: true, filter: true, width: 120, edit: 'text' },
  { key: 'approved', label: 'Approved in GTP', kind: 'text', sortable: true, filter: true, width: 140, edit: 'select', options: ['Yes', 'No'] },
  { key: 'source', label: 'Source', kind: 'text', sortable: true, filter: true, width: 220, edit: 'text' },
  { key: 'usedInBoms', label: 'BOM rows using it', kind: 'number', sortable: true, align: 'right', width: 140 },
];

export const EDITABLE_SECTION_FIELDS = ['label', 'kgPerM', 'grade', 'approved', 'source'] as const;
