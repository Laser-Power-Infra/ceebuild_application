// M15 - client-safe shapes for the PO intake review screen and the order's PO tab.
import type { PoExtraction, PoFieldKey, PoLineDraft } from '@/lib/po/fields';
import type { DocketCandidate, DocketMatch, PoCheck } from '@/lib/po/checks';

/** OFFER = our own price offer / quotation that came with the mail (kept for reference, never read as the PO). */
export type DocKind = 'PO' | 'OFFER' | 'BOM' | 'DRAWING' | 'OTHER';

export interface IntakeDoc {
  id: number;
  kind: DocKind;
  fileName: string;
  mimeType: string | null;
  /** In-app link (/api/attachments/...), null when the file could not be stored. */
  url: string | null;
}

export interface IntakeReview {
  intakeId: number;
  status: string;
  source: string;
  mailSubject: string | null;
  documents: IntakeDoc[];
  extraction: PoExtraction;
  /** Best-first docket (offer) matches, with their quoted items for the rate comparison. */
  dockets: (DocketMatch & { items: DocketCandidate['items'] })[];
  suggestedDocketId: number | null;
  /** Server-side duplicate check on the extracted customer + PO no. */
  duplicateOf: { poNumber: string; orderId: number } | null;
  leadTimeDays: number;
  today: string;
  /** Drawing refs found in the Approved Drawing Library. */
  libraryDrawings: { drawingNo: string; revision: string; approvalLetterNo: string | null; itemType: string }[];
  /** Hold suggested by the drawing check / the items still pending at the latest mail. */
  suggestedHold: { on: boolean; reason: string };
  /** Delivery date proposal (PO date + standard lead time) when the PO gives none. */
  proposedCompletion: { date: string; reason: string } | null;
  /** n8n mail intakes can be read again (after a prompt fix) - the old reading is then discarded. */
  canReread: boolean;
}

export interface ConfirmIntakeInput {
  docketId: number;
  fields: Partial<Record<PoFieldKey, string | null>>;
  lines: PoLineDraft[];
  hold: { on: boolean; reason: string };
  remarks?: string;
}

export interface OrderPoView {
  orderId: number;
  poSource: string | null;
  fields: Record<PoFieldKey, string | null>;
  /** AI reading kept for the yellow highlights and "as read" values. */
  extraction: PoExtraction | null;
  lines: (PoLineDraft & { id: number; lineNo: number })[];
  documents: IntakeDoc[];
  checks: PoCheck[];
  hold: { on: boolean; reason: string | null; since: string | null; by: string | null };
  job: { status: string | null; note: string | null; at: string | null };
  edits: { fieldName: string; oldValue: string | null; newValue: string | null; userName: string | null; at: string }[];
}
