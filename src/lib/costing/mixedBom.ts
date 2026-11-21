// Mixed (multi-structure) BOM: one docket item holding several structure types, each with its own
// set count (e.g. CEE-000532, SBPDCL RDSS: ~30 structures over 5 sites). Pure: works on the cell
// grid of a sheet so it can be unit-tested.
//
// Layout read (SBPDCL "BOM of GI Fabricated Material"):
//   header (1-2 rows): Sl.No | Drawing No. | ERE Code | Description | Unit | Billable/Non-Billable |
//                      Qty / Unit | Section | Lg of Section in mm | Unit Wt/Mtr | Wt/No | Wt/Set |
//                      <site columns ...> | Total | Total Weight
//   structure row:     Description = structure name, no section / qty, site set counts, Total = sets
//   piece rows:        section + length + qty per set (Drawing No. on the first piece of a structure)

import { sectionDims, sectionKey, toNum } from '@/lib/bom/parse';
import { guessCategory, nbSize, type BomLineDraft } from './drawings';

export interface MixedLine extends BomLineDraft {
  nonBillable: boolean;
}

export interface MixedGroup {
  name: string;
  drawingNo: string | null;
  sets: number | null;
  siteSets: Record<string, number>;
  lines: MixedLine[];
}

export interface MixedBom {
  groups: MixedGroup[];
  sites: string[];
  note: string;
}

const txt = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const norm = (v: unknown) => txt(v).toLowerCase();

/** Column indexes from a 1- or 2-row header. Null when this is not the mixed layout. */
function columns(cells: unknown[][]) {
  for (let i = 0; i < Math.min(cells.length, 20); i++) {
    const row = cells[i] ?? [];
    const next = cells[i + 1] ?? [];
    const width = Math.max(row.length, next.length);
    const head = Array.from({ length: width }, (_, c) => txt(`${txt(row[c])} ${txt(next[c])}`));
    const h = head.map((x) => x.toLowerCase());
    const find = (re: RegExp, from = 0) => h.findIndex((x, c) => c >= from && re.test(x));
    const desc = find(/desc|particular/);
    const section = h.findIndex((x) => /^section\b|^size\b|^profile\b/.test(x));
    const total = h.findIndex((x) => /^total(\s*(sets?|qty|nos?))?$/.test(x));
    // The header starts on this row (not only on the next one).
    if (desc < 0 || section < 0 || total < 0 || !txt(row[desc]) || !txt(row[section])) continue;
    const kgm = find(/wt\s*\/\s*m(tr)?|kg\s*\/\s*m|wt\s*per\s*m/);
    const wtSet = find(/wt\s*\/\s*set|weight\s*\/\s*set/);
    const siteFrom = Math.max(wtSet, kgm, section) + 1;
    const sites: { col: number; name: string }[] = [];
    for (let c = siteFrom; c < total; c++) if (head[c] && !/wt|weight|kg/i.test(head[c])) sites.push({ col: c, name: head[c] });
    return {
      headerEnd: txt(next[total]) || txt(next[desc]) ? i + 1 : i,
      drawing: find(/drawing/),
      mark: find(/ere\s*code|mark|part\s*no|item\s*code/),
      desc,
      billable: find(/billable/),
      qty: find(/^qty|quantity|nos\s*\/\s*set/),
      section,
      length: find(/^lg|length/),
      kgm,
      total,
      sites,
    };
  }
  return null;
}

/** True when the sheet looks like a multi-structure BOM (structure rows with set counts). */
export function isMixedBom(cells: unknown[][]): boolean {
  const c = columns(cells);
  if (!c) return false;
  let structures = 0;
  for (let r = c.headerEnd + 1; r < cells.length; r++) {
    const row = cells[r] ?? [];
    if (txt(row[c.desc]) && !txt(row[c.section]) && toNum(row[c.total]) !== null) structures++;
  }
  return structures >= 1;
}

export function parseMixedBom(cells: unknown[][]): MixedBom | null {
  const c = columns(cells);
  if (!c) return null;
  const groups: MixedGroup[] = [];
  let cur: MixedGroup | null = null;
  let skipped = 0;
  for (let r = c.headerEnd + 1; r < cells.length; r++) {
    const row = cells[r] ?? [];
    const desc = txt(row[c.desc]);
    const section = txt(row[c.section]);
    if (/^total\b/i.test(desc)) continue;
    if (desc && !section && toNum(row[c.total]) !== null && (c.qty < 0 || !txt(row[c.qty]))) {
      const siteSets: Record<string, number> = {};
      for (const s of c.sites) siteSets[s.name] = toNum(row[s.col]) ?? 0;
      cur = { name: desc.slice(0, 200), drawingNo: null, sets: toNum(row[c.total]), siteSets, lines: [] };
      groups.push(cur);
      continue;
    }
    if (!section) continue;
    if (!cur) {
      skipped++;
      continue;
    }
    const drawing = c.drawing >= 0 ? txt(row[c.drawing]) : '';
    if (drawing && !cur.drawingNo) cur.drawingNo = drawing.slice(0, 200);
    const category = guessCategory(desc, section);
    const lengthMm = c.length >= 0 ? toNum(row[c.length]) : null;
    cur.lines.push({
      markNo: c.mark >= 0 ? txt(row[c.mark]) || null : null,
      description: desc || null,
      section,
      sectionKey: category === 'STRUCTURE' ? sectionKey(section) : null,
      lengthMm: lengthMm === null ? null : Math.round(lengthMm),
      qtyPerSet: c.qty >= 0 ? toNum(row[c.qty]) : null,
      kgPerM: c.kgm >= 0 ? toNum(row[c.kgm]) : null,
      unitWtKg: null,
      category,
      rateKey: category === 'NUTS_BOLTS' ? nbSize(section, desc) : category === 'BOUGHT_OUT' ? desc.toUpperCase() : null,
      nonBillable: c.billable >= 0 && /non/i.test(txt(row[c.billable])),
    });
  }
  const used = groups.filter((g) => g.lines.length > 0);
  if (used.length === 0) return null;
  const lines = used.reduce((a, g) => a + g.lines.length, 0);
  return {
    groups: used,
    sites: c.sites.map((s) => s.name),
    note: `Mixed BOM: ${used.length} structure(s), ${lines} piece line(s), sites: ${c.sites.map((s) => s.name).join(', ') || '–'}. Set counts taken from the "Total" column.${skipped ? ` ${skipped} row(s) above the first structure skipped.` : ''}`,
  };
}

/**
 * Section key as the GTP list knows it. Exact key first; otherwise a GTP section of the same size
 * whose kg/m is within 5% of the BOM's (e.g. "FT 75X40" at 7.14 kg/m is ISMC 75x40).
 */
export function resolveSection(key: string | null, kgPerM: number | null, gtp: Record<string, number>): { key: string | null; note: string | null } {
  if (!key || gtp[key] !== undefined) return { key, note: null };
  const dims = sectionDims(key);
  if (!dims || !kgPerM) return { key, note: null };
  const hits = Object.entries(gtp).filter(([k, v]) => sectionDims(k) === dims && Math.abs(v - kgPerM) / v <= 0.05);
  if (hits.length !== 1) return { key, note: null };
  return { key: hits[0][0], note: `${key} read as ${hits[0][0]} (same size, kg/m ${kgPerM})` };
}
