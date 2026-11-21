import 'server-only';
import { UserError } from '@/lib/actionResult';
import { getGroqApiKey } from '@/lib/groqHelper';
import { autoMapHeaders, findHeaderRow, parsePieces } from '@/lib/bom/parse';
import { cleanLines, parseAiLines, type BomLineDraft } from '@/lib/costing/drawings';
import { readWorkbook, sheetCells } from '@/modules/bom/server/workbook';

// Piece list out of an enquiry drawing / BOM. Spreadsheets are read by the column rules of the
// order BOM import (no AI needed). PDFs: the browser extracts the text (pdf.js) - or, for a scanned
// PDF, renders page images - and the AI turns that into lines. The user always checks the result.

export interface ExtractResult {
  lines: BomLineDraft[];
  note: string;
}

/** xlsx/csv -> lines, via the same header detection as the client BOM import. */
export function extractFromSheet(buffer: Buffer): ExtractResult {
  const wb = readWorkbook(buffer);
  for (const name of wb.SheetNames) {
    const { cells } = sheetCells(wb, name);
    const headerRow = findHeaderRow(cells);
    const headers = (cells[headerRow] ?? []).map((c) => String(c ?? '').trim());
    const map = autoMapHeaders(headers);
    if (!map.section && !map.description) continue;
    const pieces = parsePieces(cells, headerRow, map);
    const lines = cleanLines(
      pieces.map((p) => ({
        markNo: p.markNo,
        description: p.description,
        section: p.section,
        lengthMm: p.lengthMm,
        qtyPerSet: p.qtyPerSet ?? p.totalQty,
        kgPerM: p.kgPerM,
        unitWtKg: p.unitWtKg,
      })),
    );
    if (lines.length) {
      const mapped = Object.entries(map).map(([f, h]) => `${f}=“${h}”`).join(', ');
      return { lines, note: `Read sheet "${name}", header row ${headerRow + 1} (${mapped}). Qty is taken as qty per set${map.qtyPerSet ? '' : ' (from the Total qty column – check it is per set)'}.` };
    }
  }
  throw new UserError('No piece list found in the workbook (need Section or Description columns).');
}

const SYSTEM = `You read steel-structure fabrication drawings and BOM tables (power transmission / distribution structures: cross arms, clamps, channels, angles, flats, rods, nuts & bolts).
Return ONLY JSON: {"lines":[{"markNo":string|null,"description":string|null,"section":string|null,"lengthMm":number|null,"qtyPerSet":number|null,"kgPerM":number|null,"unitWtKg":number|null,"category":"STRUCTURE"|"NUTS_BOLTS"|"BOUGHT_OUT"}]}
Rules:
- One line per row of the bill of materials / piece list. Do not invent rows. Skip total rows.
- section: as written, e.g. "ISMC 100x50", "ISA 50x50x6", "Flat 50x6", "Rod 16 dia".
- lengthMm in millimetres (convert metres). qtyPerSet = quantity for ONE set/structure.
- Nuts, bolts, washers -> category NUTS_BOLTS and put the size (e.g. M16x40) in section.
- Danger board, stay set, eye bolt, insulator and similar purchased items -> BOUGHT_OUT.
- Use null when a value is not on the drawing. Never guess numbers.`;

const TEXT_MODELS = ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile'];
const VISION_MODELS = ['meta-llama/llama-4-scout-17b-16e-instruct', 'meta-llama/llama-4-maverick-17b-128e-instruct'];

async function groq(models: string[], user: unknown): Promise<string> {
  const key = getGroqApiKey();
  if (!key) throw new UserError('AI is not configured (GROQ_API_KEY missing on the server). Upload the BOM as xlsx or enter the lines.');
  let last = '';
  for (const model of models) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: user },
          ],
          temperature: 0,
          max_tokens: 6000,
        }),
        signal: AbortSignal.timeout(90_000),
      });
      if (res.ok) {
        const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        const content = data.choices?.[0]?.message?.content ?? '';
        if (content) return content;
        last = 'empty reply';
        continue;
      }
      last = `${res.status} ${(await res.text()).slice(0, 300)}`;
      if (res.status === 401) break;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
    console.warn(`[costing] Groq model ${model} failed: ${last}`);
  }
  throw new UserError('AI extraction failed. Upload the BOM as xlsx, or pick an approved drawing, or enter the lines.');
}

const MAX_TEXT = 60_000;

/** Drawing text (from pdf.js in the browser) and/or page images (data URLs) -> lines. */
export async function extractWithAi(input: { text?: string; images?: string[]; fileName?: string }): Promise<ExtractResult> {
  const text = String(input.text ?? '').slice(0, MAX_TEXT);
  const images = (input.images ?? []).filter((s) => typeof s === 'string' && /^data:image\/(png|jpeg);base64,/.test(s)).slice(0, 3);
  if (images.some((s) => s.length > 4_500_000)) throw new UserError('Page image too large.');
  let reply: string;
  let how: string;
  if (text.replace(/\s/g, '').length >= 40) {
    reply = await groq(TEXT_MODELS, `Drawing file: ${input.fileName ?? 'drawing'}\nText extracted from the drawing (layout may be broken; rows of the BOM table are usually on one line):\n\n${text}`);
    how = 'from the PDF text';
  } else if (images.length) {
    reply = await groq(VISION_MODELS, [
      { type: 'text', text: `Read the bill of materials / piece list on this drawing (${input.fileName ?? 'drawing'}).` },
      ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
    ]);
    how = `from ${images.length} page image(s) (scanned drawing)`;
  } else throw new UserError('The PDF has no readable text or images.');
  const lines = cleanLines(parseAiLines(reply));
  if (lines.length === 0) throw new UserError('The AI found no piece list on this drawing. Upload the BOM as xlsx, or pick an approved drawing, or enter the lines.');
  return { lines, note: `Extracted by AI ${how}: ${lines.length} line(s). Check every line against the drawing before confirming.` };
}
