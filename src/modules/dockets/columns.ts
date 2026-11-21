import type { Docket, DocketItem, DocketSortKey } from './types';

/**
 * Columns of the Dockets table, in display order.
 * - `docket` / `actions` are pinned and cannot be hidden.
 * - `stack` columns show two docket fields as a two-line cell (edited in the drawer).
 * - `text` / `num` / `choice` columns are item fields, edited in place.
 */
export type DocketColumn =
  | { key: 'docket' | 'actions'; label: string; width: number; min?: number; kind: 'fixed'; sort?: DocketSortKey }
  | {
      key: string;
      label: string;
      width: number;
      kind: 'stack';
      /** [line 1, line 2 (muted, joined with " · ")]. */
      lines: [keyof Docket, Array<keyof Docket>];
      sort?: DocketSortKey;
      hidden?: boolean;
    }
  | {
      key: keyof DocketItem;
      label: string;
      width: number;
      kind: 'text' | 'num' | 'choice';
      hidden?: boolean;
    };

export const DOCKET_COLUMNS: DocketColumn[] = [
  { key: 'docket', label: 'Docket', width: 300, min: 260, kind: 'fixed', sort: 'docketNoQtnNo' },
  { key: 'itemNameParty', label: 'Item Name (party)', width: 200, kind: 'text' },
  { key: 'uom', label: 'UOM', width: 72, kind: 'text' },
  { key: 'qty', label: 'Qty', width: 72, kind: 'num' },
  { key: 'ourItemNot', label: 'Our Item / Not', width: 124, kind: 'choice' },
  { key: 'typeOfItem', label: 'Type of Item', width: 140, kind: 'text' },
  { key: 'ourItemName', label: 'Our Item Name', width: 156, kind: 'choice' },
  { key: 'size', label: 'Size', width: 120, kind: 'text' },
  { key: 'weightPerPiece', label: 'Unit Wt', width: 92, kind: 'num' },
  { key: 'unitWtOfMemberKg', label: 'Member Wt (kg)', width: 124, kind: 'num' },
  { key: 'price', label: 'Price', width: 96, kind: 'num' },
  { key: 'sectionMm', label: 'Section (mm)', width: 128, kind: 'text' },
  { key: 'sectionalWtKgMtr', label: 'Sect. Wt (kg/m)', width: 128, kind: 'num' },
  { key: 'lengthInMtr', label: 'Length (m)', width: 104, kind: 'num' },
  { key: 'status', label: 'Status', width: 128, kind: 'choice' },
  { key: 'location', label: 'Location', width: 144, kind: 'stack', lines: ['state', ['utility', 'deliveryLocation']], sort: 'state' },
  { key: 'terms', label: 'Price / Payment', width: 190, kind: 'stack', lines: ['price', ['payment']] },
  { key: 'delivery', label: 'Delivery / Warranty', width: 190, kind: 'stack', lines: ['delivery', ['warranty']], hidden: true },
  { key: 'approval', label: 'Approval / Inspection', width: 190, kind: 'stack', lines: ['approval', ['inspection']], hidden: true },
  { key: 'actions', label: 'Actions', width: 116, min: 116, kind: 'fixed' },
];

/** Item fields in display order (grid paste maps pasted columns onto the visible ones). */
export const ITEM_COLUMN_KEYS = DOCKET_COLUMNS.filter((c) => c.kind !== 'fixed' && c.kind !== 'stack').map(
  (c) => c.key as keyof DocketItem
);

export const MIN_COLUMN_WIDTH = 72;
export const PAGE_SIZES = [25, 50, 100, 200];
/** Items shown under an expanded docket before "Show all". */
export const ITEM_CAP = 20;
