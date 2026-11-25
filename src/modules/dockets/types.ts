import type { ConfirmDialogOptions } from '@/components/ConfirmDialog';

/** Row shapes and contracts of the Dockets screen (shared by the dashboard page and the table). */

export interface DocketItem {
  id: number;
  uniqueNo: string | null;
  docketNoQtnNo: string | null;
  itemNameParty: string | null;
  uom: string | null;
  qty: string | null;
  ourItemNot: string | null;
  typeOfItem: string | null;
  ourItemName: string | null;
  size: string | null;
  sectionMm: string | null;
  sectionalWtKgMtr: string | null;
  lengthInMtr: string | null;
  unitWtOfMemberKg: string | null;
  weightPerPiece: string | null;
  price: string | null;
  uomOfQtn: string | null;
  a: string | null;
  freightPerKg: string | null;
  status: string | null;
  createdAt: string;
}

export interface Docket {
  id: number;
  docketNoQtnNo: string | null;
  partyName: string | null;
  address: string | null;
  state: string | null;
  utility: string | null;
  deliveryLocation: string | null;
  /** Site state for freight; state = billing state (GST). */
  deliveryState?: string | null;
  type?: string | null;
  price: string | null;
  payment: string | null;
  delivery: string | null;
  warranty: string | null;
  approval: string | null;
  inspection: string | null;
  attachments?: string | null;
  /** The docket's items, sent with the page (matching items only while an item filter is on). */
  items?: DocketItem[];
  itemCount?: number;
  createdAt: string;
}

/** Filter-bar selections. Every key is a URL param understood by /api/dockets. */
export const DOCKET_FILTER_KEYS = [
  'item',
  'partyName',
  'state',
  'type',
  'docketNoQtnNo',
  'utility',
  'attachments',
  'price',
  'payment',
  'delivery',
  'warranty',
  'approval',
  'inspection',
  'uom',
  'ourItemNot',
  'size',
] as const;
export type DocketFilterKey = (typeof DOCKET_FILTER_KEYS)[number];
export type DocketFilters = Record<DocketFilterKey, string[]>;

export const emptyDocketFilters = (): DocketFilters =>
  Object.fromEntries(DOCKET_FILTER_KEYS.map((k) => [k, [] as string[]])) as DocketFilters;

/** Filters that narrow the items shown inside a docket: filter key -> item field. */
export const ITEM_FILTER_FIELDS = {
  item: 'ourItemName',
  uom: 'uom',
  ourItemNot: 'ourItemNot',
  size: 'size',
} as const satisfies Partial<Record<DocketFilterKey, keyof DocketItem>>;

export type DocketSortKey = 'docketNoQtnNo' | 'createdAt' | 'partyName' | 'state' | 'type';
export interface DocketSort {
  key: DocketSortKey;
  dir: 'asc' | 'desc';
}

export type ItemUpdate = { id: number; fields: Partial<DocketItem> };

/**
 * What the table asks the dashboard page to do. The page owns the data and the business rules
 * (permissions, audit log, AI autofill, attachments); the table only presents and edits.
 * Passed through a ref so rows can hold stable callbacks.
 */
export interface DocketActions {
  refresh: () => void;
  /** Resolve false when the save was refused or failed. */
  updateItem: (id: number, field: keyof DocketItem, value: string, docketNo: string | null) => Promise<boolean>;
  /** Saves several item rows at once (grid paste, undo); reverts on failure. */
  applyItemUpdates: (docketNo: string, updates: ItemUpdate[]) => Promise<boolean>;
  updateDocket: (id: number, field: keyof Docket, value: string) => Promise<boolean>;
  addDocket: () => void;
  addItem: (docketNo: string) => void;
  aiAutofill: (docketNo: string) => void;
  deleteDocket: (doc: Docket) => void;
  /** Asks for confirmation, then deletes (Admin only). `docketNo` is the owning docket's number. */
  deleteItem: (item: DocketItem, docketNo: string | null) => void;
  openAttachments: (docketId: number) => void;
  uploadAttachments: (docketId: number, files: File[]) => Promise<void>;
  openReasoning: (item: DocketItem, category: string | null) => void;
  confirm: (options: ConfirmDialogOptions) => void;
}
