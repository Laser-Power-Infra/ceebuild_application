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
  },
  required: ['documentType', 'fields', 'lines', 'bomPieces', 'warnings'],
};

export function buildPrompt(today: string) {
  const fieldList = PO_FIELDS.map((f) => `- ${f.key} (${f.label}): ${f.hint}`).join('\n');
  return `You are reading a customer's purchase order (PO) sent to CEEBUILD COMPANY (the supplier / vendor of galvanised steel
fabricated structures). The documents may be scanned images with no text layer: read them by OCR, carefully, digit by digit.
Several documents may be attached (the PO, its annexures, a drawing or a BOM). Today is ${today}.

Return JSON matching the schema.

fields - one entry per key below. value = the text as printed (amounts may keep Rs/commas; dates in any printed format).
Use value null when the PO does not state it - never guess, never copy Ceebuild's own details into customer fields.
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

When the text of the mail thread is attached ("Mail thread text"), use it as context only: field values come from the
PO documents. But read it for drawingStatus and warnings - if the mail shows the drawing / GTP / BOM is only
provisionally approved, not yet received or still to be confirmed, or the price / order is not yet agreed, set
drawingStatus TO_BE_APPROVED and say why in its note, and add a warning.

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
