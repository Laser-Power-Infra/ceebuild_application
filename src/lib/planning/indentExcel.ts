// RM indent as an Excel workbook (Rev 2 §10), after docs/m14-rev2-reference/indent_excel_rev3_offcut_reference.py.txt.
// Sheets: INDENT, SECTION SUMMARY, CHANGES-HOLD, OFFCUT USED, NOTES.
// buildIndentWorkbook is pure (rows + totals); writeIndentXlsx turns it into an .xlsx with SheetJS.
// SheetJS community does not write cell styles, so the workbook is plain: number formats, column
// widths and live formulas (bars to order, weights, totals) with their values cached.
import * as XLSX from 'xlsx';
import type { BarPattern, CutSettings, IndentLine, SectionInfo, StockUse } from './cutting';

export type XCell = string | number | null | { v: string | number; f?: string; z?: string };

export interface XSheet {
  name: string;
  rows: XCell[][];
  widths: number[];
}

export interface IndentWorkbook {
  sheets: XSheet[];
  totals: { bars: number; wtKg: number; mt: number };
}

export interface BomLine {
  markNo: string;
  sectionKey: string;
  lengthMm: number;
  qty: number;
  description?: string | null;
}

/** A BOM section replaced by an accepted substitute (toSectionKey) or held (toSectionKey null). */
export interface SectionChange {
  fromSection: string;
  toSectionKey: string | null;
  /** Pieces affected; default = BOM pieces of toSectionKey. */
  pieces?: number;
  usedFor?: string;
  basis: string;
  action?: string;
}

export interface IndentExcelInput {
  company?: string;
  /** "Order: <client> PO No. ... dt ..." */
  orderLine: string;
  /** "REV 3 · Indent date: ... · reason" */
  revisionLine: string;
  plan: { lines: IndentLine[]; patterns: BarPattern[]; stock?: StockUse[] };
  /** Same BOM planned without store stock: gives "bars before" on OFFCUT USED. */
  planBeforeStock?: { lines: IndentLine[] } | null;
  settings: CutSettings;
  sections: Record<string, SectionInfo>;
  /** Full BOM (after substitutions), for net weight, piece counts and the "Cut into" text. */
  bom: BomLine[];
  /** Grade printed after the section, e.g. "IS 2062 E250A". */
  materialSpec?: string;
  /** Remark that replaces the default one on every line of the section. */
  sectionRemarks?: Record<string, string>;
  changes?: SectionChange[];
  notes?: string[];
}

const TYPE_ORDER: Record<string, number> = { CUSTOM: 0, STANDARD: 1, OVERLENGTH: 2 };
const r1 = (n: number) => Math.round(n * 10) / 10;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Piece length of a custom / over-length line, from its cutting patterns. */
function pieceLengthOf(line: IndentLine, patterns: BarPattern[]): number | null {
  const p = patterns.find((x) => x.sectionKey === line.sectionKey && x.lineType === line.lineType && x.barLengthMm === line.barLengthMm && x.cuts.length);
  return p ? p.cuts[0].lengthMm : null;
}

function marksOf(line: IndentLine, patterns: BarPattern[]): Set<string> {
  const s = new Set<string>();
  for (const p of patterns) {
    if (p.sectionKey === line.sectionKey && p.lineType === line.lineType && p.barLengthMm === line.barLengthMm) for (const c of p.cuts) s.add(c.markNo.toUpperCase());
  }
  return s;
}

const sameLine = (a: IndentLine, b: IndentLine) => a.sectionKey === b.sectionKey && a.lineType === b.lineType && a.barLengthMm === b.barLengthMm;

export function defaultIndentNotes(settings: CutSettings): string[] {
  return [
    `Standard length ${settings.stdBarMm} mm. Custom lengths = exact multiple of one piece length, max ${settings.maxCustomMm} mm unless the section allows longer.`,
    `Custom lengths: tolerance +0 / +${settings.tolPlusMm} mm only. No negative tolerance accepted – any bar below ordered length to be rejected / debit note.`,
    `End allowance ${settings.endAllowanceMm} mm per bar, cutting allowance ${settings.kerfMm} mm per cut${settings.endAllowanceMm === 0 ? ' (end-squaring not added; if the plant needs end trim, add it to custom order lengths before releasing)' : ''}.`,
    settings.bufferPct > 0 ? `Indent buffer ${settings.bufferPct}% per line (rounded up).` : 'No indent buffer (bars = exact requirement).',
    'On receipt, enter actual lengths in the planning tool to finalise the cutting plan.',
  ];
}

export function buildIndentWorkbook(input: IndentExcelInput): IndentWorkbook {
  const { plan, settings, sections, bom } = input;
  const spec = (key: string) => {
    const label = sections[key]?.label ?? key;
    return input.materialSpec ? `${label} (${input.materialSpec})` : label;
  };
  const kgm = (key: string) => sections[key]?.kgPerM ?? plan.lines.find((l) => l.sectionKey === key)?.kgPerM ?? 0;
  const stock = plan.stock ?? [];
  const before = input.planBeforeStock?.lines ?? null;
  const pieceLen = (l: IndentLine) => pieceLengthOf(l, plan.patterns);

  // ---------------------------------------------------------------- INDENT
  const lines = [...plan.lines].sort(
    (a, b) =>
      kgm(b.sectionKey) - kgm(a.sectionKey) ||
      a.sectionKey.localeCompare(b.sectionKey) ||
      TYPE_ORDER[a.lineType] - TYPE_ORDER[b.lineType] ||
      (pieceLen(b) ?? 0) - (pieceLen(a) ?? 0) ||
      b.barLengthMm - a.barLengthMm,
  );
  const barsBefore = (l: IndentLine) => before?.find((b) => sameLine(b, l))?.bars ?? null;

  const stockRemark = (l: IndentLine): string => {
    const L = pieceLen(l);
    const lots = stock.filter((s) => s.sectionKey === l.sectionKey && (l.lineType === 'STANDARD' ? !s.forLengthMm : l.lineType === 'CUSTOM' && s.forLengthMm === L) && s.pieces > 0);
    if (!lots.length) return '';
    const b0 = barsBefore(l);
    const saved = b0 === null ? null : b0 - l.bars;
    if (saved !== null && saved <= 0) return '';
    const what = lots.map((s) => `${s.nos} ${s.lengthMm >= settings.stdBarMm ? (s.nos === 1 ? 'full bar' : 'full bars') : s.nos === 1 ? 'offcut' : 'offcuts'} of ${s.lengthMm} mm`).join(', ');
    const pcs = lots.reduce((a, s) => a + s.pieces, 0);
    const use = l.lineType === 'STANDARD' ? `Use ${what} in store for nested pieces` : `Use ${what} in store (${pcs} pcs × ${L})`;
    return saved === null ? use : `${use} – order reduced by ${plural(saved, 'bar', 'bars')}`;
  };

  const cutInto = (l: IndentLine): string => {
    if (l.lineType === 'STANDARD') return 'Nested mix of pieces (see cutting plan)';
    const L = pieceLen(l);
    const marks = marksOf(l, plan.patterns);
    const descs = [
      ...new Set(
        bom
          .filter((p) => p.sectionKey === l.sectionKey && p.lengthMm === L && (marks.size === 0 || marks.has(p.markNo.toUpperCase())))
          .map((p) => (p.description ?? '').trim() || p.markNo),
      ),
    ];
    const k = l.piecesPerBar ?? 1;
    const head = `${k} × ${L ?? '?'} mm`;
    return descs.length ? `${head} – ${descs[0]}${descs.length > 1 ? ` (+${descs.length - 1} more)` : ''}` : head;
  };

  const R0 = 5; // header row (1-based)
  const indentRows: XCell[][] = [
    [`${input.company ?? 'CEEBUILD COMPANY PVT. LTD.'} – RAW MATERIAL INDENT`],
    [input.orderLine],
    [`${input.revisionLine} · Custom lengths: +0 / +${settings.tolPlusMm} mm only, NO negative tolerance`],
    [],
    ['Sl', 'Section / Specification', 'Section code', 'Length type', 'Order length (mm)', 'Length tolerance', 'Bars required', 'Buffer bars', 'Bars to order', 'kg/m', 'Weight (kg)', 'Weight (MT)', 'Cut into', 'Remarks'],
  ];
  let totBars = 0;
  let totKg = 0;
  lines.forEach((l, i) => {
    const r = R0 + 1 + i;
    const bars = l.bars + l.bufferBars;
    const wt = (l.barLengthMm / 1000) * bars * l.kgPerM;
    totBars += bars;
    totKg += wt;
    const custom = l.lineType === 'CUSTOM';
    const base = input.sectionRemarks?.[l.sectionKey] ?? (custom ? 'Exact multiple length; reject any bar below ordered length' : l.lineType === 'OVERLENGTH' ? 'Longer than a standard bar: one piece per bar' : '');
    const extra = stockRemark(l);
    indentRows.push([
      i + 1,
      spec(l.sectionKey),
      l.sectionKey,
      custom ? 'Custom (cut length)' : l.lineType === 'OVERLENGTH' ? 'Over-length' : 'Standard',
      { v: l.barLengthMm, z: '#,##0' },
      custom || l.lineType === 'OVERLENGTH' ? `+0 / +${settings.tolPlusMm} mm` : 'Standard mill',
      { v: l.bars, z: '#,##0' },
      { v: l.bufferBars, z: '#,##0' },
      { v: bars, f: `G${r}+H${r}`, z: '#,##0' },
      { v: l.kgPerM, z: '0.00' },
      { v: r3(wt), f: `E${r}/1000*I${r}*J${r}`, z: '#,##0' },
      { v: r3(wt / 1000), f: `K${r}/1000`, z: '0.000' },
      cutInto(l),
      [base, extra].filter(Boolean).join(' | '),
    ]);
  });
  const first = R0 + 1;
  const last = R0 + lines.length;
  const totRow = last + 1;
  indentRows.push([
    null,
    'TOTAL',
    null,
    null,
    null,
    null,
    null,
    null,
    { v: totBars, f: `SUM(I${first}:I${last})`, z: '#,##0' },
    null,
    { v: r3(totKg), f: `SUM(K${first}:K${last})`, z: '#,##0' },
    { v: r3(totKg / 1000), f: `SUM(L${first}:L${last})`, z: '0.000' },
  ]);
  indentRows.push([]);
  indentRows.push([
    `Bars to order and weights are formulas: edit bars to change the order. ${settings.bufferPct > 0 ? `Buffer ${settings.bufferPct}% per line.` : 'No buffer – bars = exact requirement.'} kg/m are the standard sectional weights used in the BOM / GTP.`,
  ]);

  // ---------------------------------------------------------------- SECTION SUMMARY
  const holds = (input.changes ?? []).filter((c) => c.toSectionKey === null);
  const substituted = new Map((input.changes ?? []).filter((c) => c.toSectionKey).map((c) => [c.toSectionKey!, c]));
  const secKeys = [...new Set([...bom.map((p) => p.sectionKey), ...lines.map((l) => l.sectionKey)])];
  const summary: XCell[][] = [['Section code', 'Net BOM weight (kg)', 'Indent weight (kg)', 'Indent weight (MT)', 'Cut-end loss %', 'Pieces in BOM', 'Status']];
  let sNet = 0;
  let sPcs = 0;
  secKeys.forEach((key, i) => {
    const r = 2 + i;
    const bl = bom.filter((p) => p.sectionKey === key);
    const net = r1(bl.reduce((a, p) => a + (p.lengthMm / 1000) * p.qty * kgm(key), 0));
    const pcs = bl.reduce((a, p) => a + p.qty, 0);
    const ind = lines.filter((l) => l.sectionKey === key).reduce((a, l) => a + (l.barLengthMm / 1000) * (l.bars + l.bufferBars) * l.kgPerM, 0);
    const hasLines = lines.some((l) => l.sectionKey === key);
    sNet += net;
    sPcs += pcs;
    const sub = substituted.get(key);
    const status = hasLines ? `Indent raised${sub ? ` – substitute for ${sub.fromSection}` : ''}` : stock.some((s) => s.sectionKey === key) ? 'Covered from store stock' : 'Not indented';
    summary.push([
      key,
      { v: net, z: '#,##0' },
      { v: r3(ind), f: `SUMIFS(INDENT!$K$${first}:$K$${last},INDENT!$C$${first}:$C$${last},A${r})`, z: '#,##0' },
      { v: r3(ind / 1000), f: `C${r}/1000`, z: '0.000' },
      net > 0 && ind > 0 ? { v: ind / net - 1, f: `IF(OR(B${r}=0,C${r}=0),"-",C${r}/B${r}-1)`, z: '0.0%' } : '-',
      { v: pcs, z: '#,##0' },
      status,
    ]);
  });
  for (const h of holds) summary.push([h.fromSection, null, { v: 0, z: '#,##0' }, { v: 0, z: '0.000' }, '-', h.pieces ?? null, `ON HOLD – ${h.basis}`]);
  const sLast = summary.length;
  summary.push([
    'TOTAL',
    { v: r1(sNet), f: `SUM(B2:B${sLast})`, z: '#,##0' },
    { v: r3(totKg), f: `SUM(C2:C${sLast})`, z: '#,##0' },
    { v: r3(totKg / 1000), f: `SUM(D2:D${sLast})`, z: '0.000' },
    null,
    { v: sPcs, f: `SUM(F2:F${sLast})`, z: '#,##0' },
    null,
  ]);

  // ---------------------------------------------------------------- CHANGES-HOLD
  const changes: XCell[][] = [['BOM section', 'Change', 'Replaced by', 'Pieces', 'Bars to order', 'Indent weight (MT)', 'Used for', 'Basis / reason', 'Action']];
  for (const c of input.changes ?? []) {
    if (c.toSectionKey) {
      const ls = lines.filter((l) => l.sectionKey === c.toSectionKey);
      const bars = ls.reduce((a, l) => a + l.bars + l.bufferBars, 0);
      const mt = ls.reduce((a, l) => a + (l.barLengthMm / 1000) * (l.bars + l.bufferBars) * l.kgPerM, 0) / 1000;
      const pcs = c.pieces ?? bom.filter((p) => p.sectionKey === c.toSectionKey).reduce((a, p) => a + p.qty, 0);
      changes.push([c.fromSection, 'Substituted', spec(c.toSectionKey), { v: pcs, z: '#,##0' }, { v: bars, z: '#,##0' }, { v: r3(mt), z: '0.000' }, c.usedFor ?? '', c.basis, c.action ?? '']);
    } else {
      changes.push([c.fromSection, 'ON HOLD', '', c.pieces ?? null, null, null, c.usedFor ?? '', c.basis, c.action ?? '']);
    }
  }
  if (changes.length === 1) changes.push(['No section substitutions or holds in this revision.']);

  // ---------------------------------------------------------------- OFFCUT USED
  const offcut: XCell[][] = [['Section', 'Indent line', 'Store material', 'Pieces obtained', 'Bars before', 'Bars now', 'Saved (kg)']];
  const groups = new Map<string, StockUse[]>();
  for (const s of stock) {
    const k = `${s.sectionKey}\u0000${s.forLengthMm ?? ''}`;
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  let savedBars = 0;
  let savedKg = 0;
  for (const lots of groups.values()) {
    const s0 = lots[0];
    const nested = !s0.forLengthMm;
    const match = (l: IndentLine) => l.sectionKey === s0.sectionKey && (nested ? l.lineType === 'STANDARD' : l.lineType === 'CUSTOM' && pieceLengthOf(l, plan.patterns) === s0.forLengthMm);
    const now = lines.find(match);
    const was = before?.find((b) => (now ? sameLine(b, now) : b.sectionKey === s0.sectionKey && (nested ? b.lineType === 'STANDARD' : b.lineType === 'CUSTOM' && b.barLengthMm === (b.piecesPerBar ?? 0) * s0.forLengthMm! + ((b.piecesPerBar ?? 1) - 1) * settings.kerfMm + settings.endAllowanceMm)));
    const ref = now ?? was;
    const lineTxt = nested ? `Nested ${settings.stdBarMm / 1000} m bars` : ref ? `${ref.piecesPerBar} × ${s0.forLengthMm} (${ref.barLengthMm} mm)` : `${s0.forLengthMm} mm pieces`;
    const material = lots
      .map((s) => `${s.nos} × ${s.lengthMm} mm ${s.lengthMm >= settings.stdBarMm ? (s.nos === 1 ? 'full bar' : 'full bars') : s.nos === 1 ? 'offcut' : 'offcuts'}${s.note ? ` (${s.note})` : ''}`)
      .join(', ');
    const b0 = was?.bars ?? null;
    const b1 = now?.bars ?? 0;
    const saved = b0 === null ? null : b0 - b1;
    const kgSaved = saved === null || !ref ? null : Math.round(saved * (ref.barLengthMm / 1000) * kgm(s0.sectionKey));
    if (saved) savedBars += saved;
    if (kgSaved) savedKg += kgSaved;
    offcut.push([s0.sectionKey, lineTxt, material, { v: lots.reduce((a, s) => a + s.pieces, 0), z: '#,##0' }, b0, b1, kgSaved]);
  }
  if (stock.length) {
    offcut.push(['TOTAL', null, null, null, null, null, before ? { v: savedKg, z: '#,##0' } : null]);
    offcut.push([]);
    if (before) offcut.push([`${plural(savedBars, 'bar', 'bars')} less to order (about ${r3(savedKg / 1000)} MT). Offcut pieces that do not complete a bar leave the bar count unchanged; the balance pieces go to nesting.`]);
    offcut.push(['Store to reserve the listed offcuts/bars for this order.']);
  } else offcut.push(['No store offcuts or stock deducted in this indent.']);

  // ---------------------------------------------------------------- NOTES
  const notes = input.notes ?? defaultIndentNotes(settings);
  const notesRows: XCell[][] = [['NOTES & ASSUMPTIONS'], [], ...notes.map((t, i) => [`${i + 1}. ${t}`])];

  return {
    sheets: [
      { name: 'INDENT', rows: indentRows, widths: [5, 30, 13, 17, 12, 13, 10, 9, 10, 7, 11, 10, 46, 40] },
      { name: 'SECTION SUMMARY', rows: summary, widths: [14, 16, 16, 14, 14, 12, 58] },
      { name: 'CHANGES-HOLD', rows: changes, widths: [16, 12, 34, 9, 11, 12, 46, 50, 40] },
      { name: 'OFFCUT USED', rows: offcut, widths: [13, 22, 34, 14, 11, 10, 11] },
      { name: 'NOTES', rows: notesRows, widths: [130] },
    ],
    totals: { bars: totBars, wtKg: r3(totKg), mt: r3(totKg / 1000) },
  };
}

/** SheetJS workbook from the built sheets (formulas keep their computed values). */
export function indentWorkbookToXlsx(book: IndentWorkbook): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const s of book.sheets) {
    const ws: XLSX.WorkSheet = {};
    let maxC = 0;
    s.rows.forEach((row, r) => {
      row.forEach((cell, c) => {
        if (cell === null || cell === undefined || cell === '') return;
        const addr = XLSX.utils.encode_cell({ r, c });
        if (typeof cell === 'object') {
          const out: XLSX.CellObject = { t: typeof cell.v === 'number' ? 'n' : 's', v: cell.v };
          if (cell.f) out.f = cell.f;
          if (cell.z) out.z = cell.z;
          ws[addr] = out;
        } else ws[addr] = { t: typeof cell === 'number' ? 'n' : 's', v: cell };
        maxC = Math.max(maxC, c);
      });
    });
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, s.rows.length - 1), c: Math.max(maxC, s.widths.length - 1) } });
    ws['!cols'] = s.widths.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
  return wb;
}

/** .xlsx file as base64 (for a server action) or bytes. */
export function writeIndentXlsx(book: IndentWorkbook, type: 'base64'): string;
export function writeIndentXlsx(book: IndentWorkbook, type: 'buffer'): Buffer;
export function writeIndentXlsx(book: IndentWorkbook, type: 'base64' | 'buffer') {
  return XLSX.write(indentWorkbookToXlsx(book), { type, bookType: 'xlsx', compression: true });
}
