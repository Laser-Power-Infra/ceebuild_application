import 'server-only';
import { geminiJson, getGeminiModel, parseGeminiAnswer, type GeminiFile } from '@/lib/gemini';
import { PO_FIELDS } from '@/lib/po/fields';
import { normaliseExtraction, type RawExtraction } from '@/lib/po/normalise';
import type { PoExtraction } from '@/lib/po/fields';

// M15: one Gemini call reads the PO copy (text or scanned) and any drawing / BOM pages sent with
// it, and returns every order field with a confidence, the PO lines and - when a BOM table is
// printed - the piece list. src/lib/po/normalise.ts then cleans the values.

const S = { type: 'STRING', nullable: true } as const;
const CONF = { type: 'STRING', enum: ['high', 'medium', 'low'] } as const;

export const PO_SCHEMA = {
  type: 'OBJECT',
  properties: {
    documentType: { type: 'STRING', enum: ['PURCHASE_ORDER', 'REVISED_OR_AMENDED_PO', 'WORK_ORDER_OR_LOA', 'NOT_A_PO'] },
    fields: {
      type: 'OBJECT',
      properties: Object.fromEntries(
        PO_FIELDS.map((f) => [f.key, { type: 'OBJECT', properties: { value: S, confidence: CONF, note: S }, required: ['value', 'confidence'] }]),
      ),
      required: PO_FIELDS.map((f) => f.key),
    },
    lines: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { description: { type: 'STRING' }, hsn: S, unit: S, qty: S, unitRate: S, lineValue: S, qtyVariation: S, confidence: CONF },
        required: ['description', 'confidence'],
      },
    },
    bomPieces: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { structure: S, markNo: S, description: S, section: S, lengthMm: S, qtyPerSet: S, sets: S, totalQty: S, unitWtKg: S },
      },
    },
    warnings: { type: 'ARRAY', items: { type: 'STRING' } },
    // Do NOT add properties: this schema is exactly at Gemini's size limit ("too many states for
    // serving" with even one more string, tested 24-11-2026). Document types, pending items and the
    // latest position come back as tagged warnings ("DOC: ", "PENDING: ", "LATEST: "), split in normalise.ts.
  },
  required: ['documentType', 'fields', 'lines', 'bomPieces', 'warnings'],
};

export function buildPrompt(today: string) {
  const fieldList = PO_FIELDS.map((f) => `- ${f.key} (${f.label}): ${f.hint}`).join('\n');
  return `You are reading a customer's purchase order (PO) sent to CEEBUILD COMPANY (the supplier / vendor of galvanised steel
fabricated structures; its group company is LASER POWER & INFRA LIMITED - both are "us"). The documents may be scanned images
with no text layer: read them by OCR, carefully, digit by digit. Several documents may be attached (the PO, its annexures, a
drawing / GTP, a BOM, and sometimes OUR OWN price offer). Today is ${today}.

Return JSON matching the schema.

Besides real warnings, the "warnings" array carries tagged lines (exact prefixes, one per line item):
- "DOC: TYPE | file name" - one per attached document (file name exactly as given in "Document n (KIND): name"),
  e.g. "DOC: OFFER | AKS_Revised Price.pdf".
- "PENDING: item | dd-mm-yyyy | who must act" - see pending below.
- "LATEST: dd-mm-yyyy: ..." - see latestPosition below (one line at most).

Document TYPE is one of: PO = the customer's
purchase / work order or its revision / corrigendum; OFFER = a price offer / quotation / revised price list made by US (Ceebuild /
Laser letterhead or signature, addressed to the customer) - even when its file name says "revised"; BOM, DRAWING, GTP, LETTER,
OTHER. Read EVERY PO field and EVERY PO line (prices, quantities, values, terms) ONLY from the PO document(s). Never take a
price, quantity or term from an OFFER - it is what we quoted, not what the customer ordered.

fields - one entry per key below. value = the text as printed (amounts may keep Rs/commas; dates in any printed format).
Use value null when the PO does not state it - never guess. Customer fields (customer, GSTIN, addresses, contact person / email /
phone) are about the BUYER only: never put Ceebuild's or Laser Power & Infra's names, people, phone numbers or emails there. A PO
"addressed to" / "Kind Attn." a person at Ceebuild or Laser names OUR person - not the contact. The customer's contact is their
own signatory / purchase or project person, taken from the PO or from the customer's own mail signature in the thread.
confidence: "high" = printed clearly and unambiguous; "medium" = readable but inferred or slightly unclear;
"low" = hard to read (poor scan, handwriting, cut off) or worked out from other figures. note = where you found it or why
it is uncertain (short).
${fieldList}

lines - one row per PO line item (schedule of quantities / price schedule), in order. Skip sub-total, tax and total rows.
description as printed (short form ok), hsn = HSN/SAC code, unit as printed (MT, Kg, Nos, Set, Km...), qty, unitRate (rate
per unit before GST), lineValue (amount before GST), qtyVariation = allowed quantity variation if stated (e.g. "+/-25%"),
for the line or for the whole PO.

bomPieces - ONLY if a document contains a bill of materials / piece list / cutting list of fabricated steel pieces
(columns like mark no, section/size, length, qty). One row per piece row; structure = the structure / drawing the row
belongs to when the BOM is split by structure; lengthMm in millimetres; qtyPerSet = qty for one structure; sets = number
of structures if printed; totalQty if printed. Leave bomPieces empty when there is no such table. Do not invent rows.

Mail thread ("Mail thread text"): the messages are listed OLDEST FIRST, each with its date; the message marked (LATEST) is the
newest. Read them in that order. The LATEST message on a subject decides its status: a statement that a later message
superseded (e.g. "we cannot accept the revised PO at the existing price" followed later by the customer issuing the revised
PO at our re-quoted rates) is history - do NOT report it as a current problem, warning or pending item. Field values come from
the PO documents; from the mail take only the customer's contact (signature), drawingStatus, pending and latestPosition.
- drawingStatus: the status at the latest message that speaks about drawings / GTP / BOM. If a later mail says the customer's
  drawing / GTP / BOM confirmation or approval is still awaited, it is TO_BE_APPROVED even if an older mail or the PO says
  "approved". note = the date and gist of the deciding message, e.g. "16-11-2026: AKS drawing confirmation still pending".
- pending ("PENDING: " lines) - what is still open at the latest message (drawing / GTP / BOM confirmation, price agreement, advance, inspection
  call ...), one line each: "PENDING: item | dd-mm-yyyy | who must act" (the date of the message that says it is open),
  e.g. "PENDING: Drawing confirmation | 16-11-2026 | AKS". Leave out anything a later message closed. None when nothing is open.
- latestPosition ("LATEST: " line) - one or two sentences: the position at the latest message, starting with its date
  (dd-mm-yyyy). None when there is no mail thread.
- other (untagged) warnings only for CURRENT issues (not superseded ones).

documentType - what the main document is. A PO issued BY Ceebuild to its own supplier (Ceebuild is the buyer), an
invoice, a quotation or a letter is NOT_A_PO. warnings - anything the reviewer must know (illegible pages, two different
PO numbers, totals that do not add up, documents that are not POs).`;
}

export async function extractPo(files: GeminiFile[]): Promise<PoExtraction> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, model } = await geminiJson<RawExtraction>({ files, prompt: buildPrompt(today), schema: PO_SCHEMA });
  return normaliseExtraction(data, model);
}

/** What n8n needs to read a PO mail itself: the same prompt, schema and model as the dashboard. */
export function geminiRequestSpec() {
  return { model: getGeminiModel(), prompt: buildPrompt(new Date().toISOString().slice(0, 10)), schema: PO_SCHEMA };
}

/** A Gemini answer n8n got for a PO mail -> the normalised extraction. */
export function extractionFromAnswer(status: number, text: string, model: string): PoExtraction {
  return normaliseExtraction(parseGeminiAnswer<RawExtraction>(status, text), model);
}
