// M15 - the fields read from a PO copy. Client-safe (no server imports).
// One list drives the AI schema, the review form, the order columns and the edit log.

export type PoFieldType = 'text' | 'longtext' | 'date' | 'money' | 'pct' | 'int' | 'gstin' | 'email' | 'drawingStatus';
export type PoFieldGroup = 'header' | 'commercial' | 'references';

export interface PoFieldDef {
  key: PoFieldKey;
  label: string;
  group: PoFieldGroup;
  type: PoFieldType;
  /** What the AI should look for (goes into the prompt). */
  hint: string;
  /** Must be present to confirm the order. */
  required?: boolean;
}

export const PO_FIELD_KEYS = [
  'customerName',
  'customerGstin',
  'billingAddress',
  'deliveryAddress',
  'poNumber',
  'poDate',
  'amendmentNo',
  'amendmentDate',
  'endClient',
  'state',
  'project',
  'scheme',
  'contactPerson',
  'contactEmail',
  'contactPhone',
  'basicValue',
  'gstPct',
  'gstAmount',
  'totalValue',
  'priceBasis',
  'freight',
  'paymentTerms',
  'advancePct',
  'creditDays',
  'completionDate',
  'deliverySchedule',
  'ldPenalty',
  'pbgPct',
  'sdPct',
  'warranty',
  'inspection',
  'testCertificates',
  'galvSpec',
  'bomRef',
  'drawingRef',
  'approvalLetterNo',
  'drawingStatus',
] as const;
export type PoFieldKey = (typeof PO_FIELD_KEYS)[number];

export const PO_FIELDS: PoFieldDef[] = [
  // ---- header
  { key: 'customerName', label: 'Customer (PO issued by)', group: 'header', type: 'text', required: true, hint: 'Company that issued the PO to Ceebuild (the buyer), as printed in the letterhead / "From".' },
  { key: 'customerGstin', label: 'Customer GSTIN', group: 'header', type: 'gstin', hint: "The buyer's 15-character GSTIN (not Ceebuild's own GSTIN)." },
  { key: 'billingAddress', label: 'Billing address', group: 'header', type: 'longtext', hint: 'Bill-to / invoice-to address of the buyer.' },
  { key: 'deliveryAddress', label: 'Delivery address', group: 'header', type: 'longtext', hint: 'Ship-to / consignee / delivery site address. If several sites, list them separated by "; ".' },
  { key: 'poNumber', label: 'PO no.', group: 'header', type: 'text', required: true, hint: 'Purchase order / work order / LOA number exactly as printed.' },
  { key: 'poDate', label: 'PO date', group: 'header', type: 'date', required: true, hint: 'Date of the PO (the original PO date, not the amendment date).' },
  { key: 'amendmentNo', label: 'Amendment no.', group: 'header', type: 'text', hint: 'Amendment / revision number if this is an amended or revised PO, e.g. "Rev 1", "Amendment-01".' },
  { key: 'amendmentDate', label: 'Amendment date', group: 'header', type: 'date', hint: 'Date of the amendment / revision.' },
  { key: 'endClient', label: 'End client / utility', group: 'header', type: 'text', hint: 'Final owner of the project, e.g. SBPDCL, UPCL, NHPC, Water Resources Dept.' },
  { key: 'state', label: 'State', group: 'header', type: 'text', hint: 'Indian state of the delivery site / project.' },
  { key: 'project', label: 'Project', group: 'header', type: 'text', hint: 'Project name, e.g. "Chelligada Irrigation Project", "11 kV line works".' },
  { key: 'scheme', label: 'Scheme', group: 'header', type: 'text', hint: 'Government scheme or package, e.g. RDSS, RDSS Loss Reduction, PMKSY.' },
  { key: 'contactPerson', label: 'Contact person', group: 'header', type: 'text', hint: "The BUYER's own contact person (customer staff: PO signatory, purchase / project person in the customer's mail signature). NEVER Ceebuild's or Laser Power & Infra's people, nor the person the PO is addressed to (\"Kind Attn\" on the supplier side)." },
  { key: 'contactEmail', label: 'Contact email', group: 'header', type: 'email', hint: "The buyer's contact email (customer domain). Never a ceebuildcompany.com / laserpowerinfra.com address." },
  { key: 'contactPhone', label: 'Contact phone', group: 'header', type: 'text', hint: "The buyer's contact phone / mobile (from the PO or the customer's mail signature). Never Ceebuild's / Laser's own numbers or the supplier-side addressee's number." },
  // ---- commercial
  { key: 'basicValue', label: 'Basic value (Rs)', group: 'commercial', type: 'money', hint: 'Total before GST (sum of line values).' },
  { key: 'gstPct', label: 'GST %', group: 'commercial', type: 'pct', hint: 'GST rate in % (IGST, or CGST+SGST added together) only when a rate is printed. "Extra as applicable / at actual" without a rate: value null, note "extra at actual".' },
  { key: 'gstAmount', label: 'GST amount (Rs)', group: 'commercial', type: 'money', hint: 'Total GST amount in rupees.' },
  { key: 'totalValue', label: 'Total value incl. GST (Rs)', group: 'commercial', type: 'money', hint: 'Grand total including GST (and freight if printed in the total).' },
  { key: 'priceBasis', label: 'Price basis', group: 'commercial', type: 'text', hint: 'FOR site / FOR destination / Ex-works, with the place.' },
  { key: 'freight', label: 'Freight', group: 'commercial', type: 'text', hint: 'Freight terms: included / extra at actual / to-pay / amount.' },
  { key: 'paymentTerms', label: 'Payment terms', group: 'commercial', type: 'longtext', hint: 'Payment terms as written.' },
  { key: 'advancePct', label: 'Advance %', group: 'commercial', type: 'pct', hint: 'Advance payment as % of order value (0 if none stated as advance).' },
  { key: 'creditDays', label: 'Credit days', group: 'commercial', type: 'int', hint: 'Number of days of credit after invoice / receipt of material.' },
  { key: 'completionDate', label: 'Delivery / completion date', group: 'commercial', type: 'date', hint: 'Date by which full supply must be complete. If only a period is given (e.g. "within 60 days of PO"), work out the date from the PO date.' },
  { key: 'deliverySchedule', label: 'Delivery schedule / phasing', group: 'commercial', type: 'longtext', hint: 'Delivery schedule or phasing as written (e.g. "50% in 30 days, balance in 60 days").' },
  { key: 'ldPenalty', label: 'LD / penalty', group: 'commercial', type: 'longtext', hint: 'Liquidated damages / penalty clause (rate per week and cap).' },
  { key: 'pbgPct', label: 'PBG %', group: 'commercial', type: 'pct', hint: 'Performance bank guarantee as % of order value.' },
  { key: 'sdPct', label: 'SD / retention %', group: 'commercial', type: 'pct', hint: 'Security deposit / retention as % of order value.' },
  { key: 'warranty', label: 'Warranty', group: 'commercial', type: 'longtext', hint: 'Warranty / guarantee period and terms.' },
  { key: 'inspection', label: 'Inspection', group: 'commercial', type: 'text', hint: 'Inspection agency: TPI / client / MC (material clearance) / self.' },
  { key: 'testCertificates', label: 'Test certificates', group: 'commercial', type: 'text', hint: 'Test certificates required (MTC, galvanising test report, etc.).' },
  { key: 'galvSpec', label: 'Galvanising spec', group: 'commercial', type: 'text', hint: 'Galvanising standard and coating, e.g. "IS 2629, 610 g/m2" or "IS 4759, 86 micron".' },
  // ---- references
  { key: 'bomRef', label: 'BOM reference', group: 'references', type: 'text', hint: 'BOM / bill of quantities reference the PO is based on (number, date or "as per BOM enclosed").' },
  { key: 'drawingRef', label: 'Drawing / GTP no.', group: 'references', type: 'text', hint: 'Drawing / GTP document NUMBERS only (e.g. "UPCL/DRG/11KV/05 R1", "GTP-AKS-03"), separated by "; ". Never a list of items, sizes or descriptions (e.g. not "G.I. Wire 4.00 mm"). null when no number is printed.' },
  { key: 'approvalLetterNo', label: 'Approval letter no.', group: 'references', type: 'text', hint: 'Letter number by which the drawing / GTP was approved by the end client, e.g. "SBPDCL letter 2333".' },
  {
    key: 'drawingStatus',
    label: 'Drawing status (PO + mail)',
    group: 'references',
    type: 'drawingStatus',
    hint: 'Status as of the LATEST message of the mail thread (or the PO when there is no mail): APPROVED only if the drawing/GTP is approved and nothing later says a confirmation is still pending; TO_BE_APPROVED if drawing / BOM / GTP approval or confirmation is still to come at the latest message (also: provisionally approved, on hold, awaiting client / site confirmation, to be finalised); NOT_STATED if neither says anything. note = which message (date) decides.',
  },
];

export const PO_FIELD_BY_KEY = Object.fromEntries(PO_FIELDS.map((f) => [f.key, f])) as Record<PoFieldKey, PoFieldDef>;

export const DRAWING_STATUSES = ['APPROVED', 'TO_BE_APPROVED', 'NOT_STATED'] as const;
export type DrawingStatus = (typeof DRAWING_STATUSES)[number];

export type Confidence = 'high' | 'medium' | 'low' | 'missing';

/** One field as read and cleaned. `value` is the normalised string the form shows. */
export interface PoFieldValue {
  value: string | null;
  confidence: Confidence;
  /** Where it was found or why confidence is low. */
  note?: string | null;
}

export interface PoLineDraft {
  description: string;
  hsn: string | null;
  unit: string | null;
  qty: number | null;
  unitRate: number | null;
  lineValue: number | null;
  qtyVarPct: number | null;
  confidence: Confidence;
  /** PO = printed on the PO; MASTER = filled from the HSN item master (src/lib/po/hsn.ts). */
  hsnSource?: 'PO' | 'MASTER' | null;
  /** Filled on the server from the docket's quotation items. quotedUom = the unit the quoted price is per. */
  quotedRate?: number | null;
  quotedItemId?: number | null;
  quotedItemName?: string | null;
  quotedUom?: string | null;
  /** Unit weight of the quoted item (kg per `quotedWtPer`), to compare per-kg and per-piece / per-metre rates. */
  quotedWtKg?: number | null;
  quotedWtPer?: string | null;
}

/** What each attached document is, as the AI read it. OFFER = our own price offer (never the PO). */
export const AI_DOC_TYPES = ['PO', 'OFFER', 'BOM', 'DRAWING', 'GTP', 'LETTER', 'OTHER'] as const;
export interface PoDocumentRead {
  name: string;
  type: (typeof AI_DOC_TYPES)[number];
  note?: string | null;
}

/** Something still open at the latest message of the mail thread (drives the hold). */
export interface PoPendingItem {
  item: string;
  /** yyyy-mm-dd of the message that says it is pending. */
  since: string | null;
  /** Who has to act (customer name / us). */
  by: string | null;
}

/** A BOM row read from a drawing / BOM table inside the PO documents. */
export interface PoBomPiece {
  markNo: string | null;
  description: string | null;
  section: string | null;
  lengthMm: number | null;
  qtyPerSet: number | null;
  sets: number | null;
  totalQty: number | null;
  unitWtKg: number | null;
  structure: string | null;
}

export interface PoExtraction {
  fields: Record<PoFieldKey, PoFieldValue>;
  lines: PoLineDraft[];
  bomPieces: PoBomPiece[];
  /** What the AI thinks the document is (PURCHASE_ORDER, AMENDMENT, ...) and any warnings. */
  documentType: string | null;
  warnings: string[];
  /** Per-document type (older readings: absent). */
  documents?: PoDocumentRead[];
  /** Open items as of the latest mail (older readings: absent). */
  pending?: PoPendingItem[];
  /** One or two lines: the position at the latest message, with its date. */
  latestPosition?: string | null;
  /** Other, separate POs found in the same mail (each becomes its own intake). */
  otherPos?: { poNumber: string; fileName: string | null }[];
  model: string;
  at: string;
}

/** Fields shown yellow on the review screen. */
export const needsReview = (f: PoFieldValue | undefined) => !f || f.confidence === 'low' || f.confidence === 'missing' || !f.value;
