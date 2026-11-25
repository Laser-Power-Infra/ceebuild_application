// Fabrication drawing PDF: A3 landscape, vector, one frame + title block per sheet.
//   Sheet 1      general notes, design decisions (from the standards), to-be-confirmed list
//   Sheets 2..k  member details: a dimensioned bar per mark (4 per sheet) + its cross-section
//   Last sheet(s) cutting list per set and total (= the confirmed BOM), then the not-cut items
// Pure: takes a FabModel, returns PDF bytes.

import { PDFDocument, StandardFonts } from 'pdf-lib';
import { A3_LANDSCAPE, GREY, LIGHT, MM, RED, Sheet } from './primitives';
import { drawingNo, type CutRow, type FabModel, type MemberView } from './model';

export const MEMBERS_PER_SHEET = 4;
export const CUT_ROWS_PER_SHEET = 28;

const [W, H] = A3_LANDSCAPE;
const M = 10; // frame margin
const TB = { x: 248, y: M + 2, w: W - M - 2 - 248, h: 54 }; // title block, inside the inner frame
const CONTENT_TOP = H - M - 8;
const CONTENT_BOTTOM = TB.y + TB.h + 4;

const q = (v: number | null) => (v === null ? '–' : Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000));

type TableRow = { cells: string[]; bold?: boolean; fill?: typeof LIGHT };

function cutCells(r: CutRow): string[] {
  return [r.markNo, r.description, r.section, q(r.lengthMm), q(r.qtyPerSet), q(r.sets), q(r.totalQty), r.holes, r.bendWeld];
}

/** All rows of the cutting list in print order (headings included), for pagination. */
export function cuttingTableRows(model: FabModel): TableRow[] {
  const rows: TableRow[] = [];
  const multi = model.cutting.length > 1;
  for (const g of model.cutting) {
    rows.push({ cells: [`${g.name} – ${g.sets === null ? 'sets to confirm' : `${q(g.sets)} sets`}`], bold: true, fill: LIGHT });
    for (const r of g.rows) rows.push({ cells: cutCells(r) });
    const perSet = g.rows.reduce((a, r) => a + (r.qtyPerSet ?? 0), 0);
    const total = g.rows.every((r) => r.totalQty !== null) ? g.rows.reduce((a, r) => a + (r.totalQty ?? 0), 0) : null;
    rows.push({ cells: ['', 'Pieces', '', '', q(perSet), q(g.sets), q(total), '', ''], bold: true });
  }
  if (multi) {
    rows.push({ cells: ['TOTAL – all structures (same mark, section and length added)'], bold: true, fill: LIGHT });
    for (const r of model.totals) rows.push({ cells: cutCells(r) });
  }
  if (model.other.length) {
    rows.push({ cells: ['NOT CUT – bought-out items and hardware (for reference)'], bold: true, fill: LIGHT });
    for (const o of model.other) rows.push({ cells: [o.markNo, o.description, o.category === 'NUTS_BOLTS' ? 'Nuts & bolts' : 'Bought-out', '–', q(o.qtyPerSet), q(o.sets), q(o.totalQty), '–', '–'] });
  }
  return rows;
}

export function sheetPlan(model: FabModel) {
  const memberSheets = Math.ceil(model.members.length / MEMBERS_PER_SHEET);
  const cutSheets = Math.max(1, Math.ceil(cuttingTableRows(model).length / CUT_ROWS_PER_SHEET));
  return { memberSheets, cutSheets, total: 1 + memberSheets + cutSheets };
}

function frame(s: Sheet, model: FabModel, sheetNo: number, total: number, title: string) {
  const h = model.header;
  s.rect(M, M, W - 2 * M, H - 2 * M, { w: 0.6 });
  s.rect(M + 2, M + 2, W - 2 * M - 4, H - 2 * M - 4, { w: 0.2 });
  // Status line top right
  if (h.status !== 'CONFIRMED') {
    s.text(`${h.status} – not for cutting until confirmed by production`, W - M - 4, H - M - 6, { size: 8, bold: true, color: RED, align: 'right' });
  }
  // Title block
  const { x, y, w } = TB;
  const rows = [10, 7, 8, 7, 7, 8, 7]; // top to bottom
  let yy = y + TB.h;
  s.rect(x, y, w, TB.h, { w: 0.5 });
  const cell = (hgt: number) => {
    yy -= hgt;
    s.line(x, yy, x + w, yy, { w: 0.2 });
    return yy;
  };
  let r = cell(rows[0]);
  s.text(h.company.toUpperCase(), x + 2, r + 3, { size: 11, bold: true, maxWidth: w - 4 });
  r = cell(rows[1]);
  s.text(`Project: ${h.project}`, x + 2, r + 2.3, { size: 7.5, maxWidth: w - 4 });
  r = cell(rows[2]);
  s.text(title, x + 2, r + 2.6, { size: 9, bold: true, maxWidth: w - 4 });
  r = cell(rows[3]);
  const c4 = [0, 62, 82, 118, w];
  c4.slice(1, -1).forEach((cx) => s.line(x + cx, r, x + cx, r + rows[3], { w: 0.2 }));
  s.text(`Drg no. ${drawingNo(model.drawingNoBase, sheetNo)}`, x + 2, r + 2.3, { size: 7.5, bold: true, maxWidth: 58 });
  s.text(`Rev ${h.rev}`, x + 64, r + 2.3, { size: 7.5, bold: true });
  s.text(h.date, x + 84, r + 2.3, { size: 7.5 });
  s.text(`Sheet ${sheetNo} of ${total}`, x + 120, r + 2.3, { size: 7.5 });
  r = cell(rows[4]);
  s.text(`Basis: ${h.basis}`, x + 2, r + 2.3, { size: 7, maxWidth: w - 4 });
  r = cell(rows[5]);
  const thirds = w / 3;
  [1, 2].forEach((i) => s.line(x + thirds * i, r, x + thirds * i, r + rows[5], { w: 0.2 }));
  const sig = (label: string, name: string | null, i: number) => {
    s.text(label, x + thirds * i + 1.5, r + 5.4, { size: 5.5, color: GREY });
    s.text(name ?? '', x + thirds * i + 1.5, r + 1.6, { size: 7, maxWidth: thirds - 3 });
  };
  sig('Prepared', h.preparedBy, 0);
  sig('Checked', h.checkedBy, 1);
  sig('Approved', h.approvedBy, 2);
  r = cell(rows[6]);
  s.text(`Status: ${h.status} · Not to scale – dims in mm`, x + 2, r + 2.2, { size: 7 });
}

function sheetOne(s: Sheet, model: FabModel, plan: ReturnType<typeof sheetPlan>) {
  let y = CONTENT_TOP - 4;
  s.text('GENERAL NOTES, DESIGN DECISIONS AND ITEMS TO CONFIRM', 20, y, { size: 12, bold: true });
  y -= 9;
  // Left column: scope + sheet index + general notes
  const lx = 20;
  const lw = 185;
  s.text('SCOPE (from the confirmed BOM)', lx, y, { size: 9, bold: true });
  y -= 5.5;
  for (const g of model.cutting) {
    const pcs = g.rows.reduce((a, r) => a + (r.qtyPerSet ?? 0), 0);
    y = s.para(`${g.name}: ${g.sets === null ? 'sets to confirm' : `${q(g.sets)} sets`}; ${g.rows.length} cut marks, ${q(pcs)} pieces per set.`, lx, y, lw, { size: 8 });
  }
  y = s.para('General arrangement: assemblies are not yet defined in the dashboard – refer to the approved drawing named in the title block for the arrangement.', lx, y - 1, lw, { size: 8, color: GREY });
  y -= 4;
  s.text('SHEETS IN THIS SET', lx, y, { size: 9, bold: true });
  y -= 5.5;
  const idx: string[] = [`${drawingNo(model.drawingNoBase, 1)}  General notes, design decisions, items to confirm`];
  for (let i = 0; i < plan.memberSheets; i++) {
    const marks = model.members.slice(i * MEMBERS_PER_SHEET, (i + 1) * MEMBERS_PER_SHEET).map((m) => m.markNo);
    idx.push(`${drawingNo(model.drawingNoBase, 2 + i)}  Member details: ${marks.join(', ')}`);
  }
  for (let i = 0; i < plan.cutSheets; i++) idx.push(`${drawingNo(model.drawingNoBase, 2 + plan.memberSheets + i)}  Cutting list per set and total${plan.cutSheets > 1 ? ` (${i + 1}/${plan.cutSheets})` : ''}`);
  for (const t of idx) y = s.para(t, lx, y, lw, { size: 8 });
  y -= 4;
  s.text('GENERAL NOTES', lx, y, { size: 9, bold: true });
  y -= 5.5;
  model.notes.forEach((n, i) => {
    y = s.para(`${i + 1}. ${n}`, lx, y, lw, { size: 8, indent: 4 }) - 0.8;
  });

  // Right column: design decisions + to be confirmed
  const rx = 215;
  const rw = 185;
  let ry = CONTENT_TOP - 13;
  s.text('DESIGN DECISIONS (engineering rules from the drawing standards – not on the approved drawing)', rx, ry, { size: 9, bold: true, maxWidth: rw });
  ry -= 5.5;
  model.decisions.forEach((d, i) => {
    ry = s.para(`${i + 1}. ${d}`, rx, ry, rw, { size: 8, indent: 4 }) - 0.8;
  });
  ry -= 4;
  const boxTop = ry + 4;
  s.text('TO BE CONFIRMED BY PRODUCTION BEFORE CUTTING', rx + 2, ry - 1, { size: 9, bold: true, color: RED });
  ry -= 7;
  const items = model.toConfirm.length ? model.toConfirm : ['Nothing open.'];
  items.forEach((t, i) => {
    ry = s.para(`${i + 1}. ${t}`, rx + 2, ry, rw - 4, { size: 8, indent: 4 }) - 0.8;
  });
  ry = s.para('Confirmed by production (name / date): ______________________', rx + 2, ry - 3, rw - 4, { size: 8 });
  s.rect(rx, ry - 1, rw, boxTop - ry + 1, { w: 0.4, stroke: RED });
}

function sectionSketch(s: Sheet, m: MemberView, cx: number, cy: number) {
  const g = m.geom;
  const box = 26;
  const a = g.a ?? 0;
  const b = g.b ?? a;
  const t = g.t ?? Math.max(1, a / 10);
  if (g.shape === 'ANGLE' && a > 0) {
    const k = box / Math.max(a, b);
    const tt = Math.max(t * k, 1.2);
    const x0 = cx - (b * k) / 2;
    const y0 = cy - (a * k) / 2;
    s.poly([[x0, y0], [x0 + b * k, y0], [x0 + b * k, y0 + tt], [x0 + tt, y0 + tt], [x0 + tt, y0 + a * k], [x0, y0 + a * k]], { fill: LIGHT });
    if (m.gaugeMm) {
      // Gauge line on the vertical leg, measured from the heel (outer corner).
      const gy = y0 + m.gaugeMm * k;
      s.line(x0 - 3, gy, x0 + tt + 3, gy, { w: 0.15, dash: [1.5, 0.8] });
      s.text(`g ${m.gaugeMm}`, x0 + tt + 3.5, gy - 1, { size: 6.5 });
    }
    s.text(`${a}`, x0 - 5, cy, { size: 6.5, align: 'center', rotate90: true });
    s.text(`${b}`, cx, y0 - 3.5, { size: 6.5, align: 'center' });
  } else if (g.shape === 'FLAT' && a > 0) {
    const k = box / a;
    const tt = Math.max((g.t ?? 5) * k, 1.5);
    s.rect(cx - (a * k) / 2, cy - tt / 2, a * k, tt, { fill: LIGHT });
    s.line(cx, cy - tt / 2 - 2.5, cx, cy + tt / 2 + 2.5, { w: 0.15, dash: [1.5, 0.8] });
    s.text(`${a} x ${g.t ?? '?'}`, cx, cy - tt / 2 - 5, { size: 6.5, align: 'center' });
  } else if (g.shape === 'CHANNEL' && a > 0) {
    const k = box / Math.max(a, b);
    const tt = Math.max((g.t ?? 5) * k, 1.2);
    const x0 = cx - (b * k) / 2;
    const y0 = cy - (a * k) / 2;
    s.poly([[x0, y0], [x0 + b * k, y0], [x0 + b * k, y0 + tt], [x0 + tt, y0 + tt], [x0 + tt, y0 + a * k - tt], [x0 + b * k, y0 + a * k - tt], [x0 + b * k, y0 + a * k], [x0, y0 + a * k]], { fill: LIGHT });
    s.text(`${a} x ${b}`, cx, y0 - 3.5, { size: 6.5, align: 'center' });
  } else if ((g.shape === 'ROUND' || g.shape === 'PIPE') && a > 0) {
    s.circle(cx, cy, 8, { fill: LIGHT });
    if (g.shape === 'PIPE') s.circle(cx, cy, 6.5);
    s.text(g.shape === 'PIPE' ? `${a} NB` : `dia ${a}`, cx, cy - 11.5, { size: 6.5, align: 'center' });
  } else {
    s.text('section not drawn', cx, cy, { size: 6.5, align: 'center', color: GREY });
  }
  s.text('SECTION', cx, cy + 16, { size: 6.5, bold: true, align: 'center' });
}

function memberBand(s: Sheet, m: MemberView, yTop: number, bandH: number) {
  const x0 = 30;
  const maxW = 255;
  const uses = m.uses.map((u) => `${q(u.qtyPerSet)}/set${m.uses.length > 1 || u.group ? ` (${u.group})` : ''}`).join(', ');
  s.text(`${m.markNo}`, 20, yTop - 6, { size: 10, bold: true });
  s.text(`${m.description || '–'}  ·  ${m.section}  ·  cut length ${q(m.lengthMm)}  ·  qty ${uses}${m.bendWeld !== '–' ? `  ·  ${m.bendWeld}` : ''}`, 45, yTop - 6, { size: 8, maxWidth: 270 });

  const L = m.lengthMm ?? 0;
  const scale = L > 0 ? Math.min(maxW / L, 1) : 0;
  const drawnL = L > 0 ? L * scale : maxW;
  const face = m.geom.a ?? 40;
  const barH = Math.min(9, Math.max(4, face * scale * 3));
  const barBottom = yTop - 24;
  s.rect(x0, barBottom, drawnL, barH, { fill: LIGHT, w: 0.35 });
  if (m.geom.shape === 'ANGLE' && m.geom.t) s.line(x0, barBottom + Math.max(0.8, barH * 0.15), x0 + drawnL, barBottom + Math.max(0.8, barH * 0.15), { w: 0.15 }); // heel / toe line
  s.text('A', x0 - 3.5, barBottom + barH / 2 - 1, { size: 7, bold: true });
  s.text('B', x0 + drawnL + 1.5, barBottom + barH / 2 - 1, { size: 7, bold: true });
  if (L > 0) s.dimH(x0, x0 + drawnL, barBottom - 6, `${q(L)}`, barBottom);
  else s.text('LENGTH NOT ON BOM – TO CONFIRM', x0 + drawnL / 2, barBottom - 6, { size: 7, align: 'center', color: RED });

  // Holes
  const offset = m.gaugeMm ?? (m.geom.shape === 'FLAT' && m.geom.a ? m.geom.a / 2 : null);
  const hy = offset !== null && face > 0 ? barBottom + barH * Math.min(0.85, Math.max(0.15, offset / face)) : barBottom + barH / 2;
  if (m.holes && L > 0) {
    const r = Math.min(1.4, Math.max(0.7, (m.holeDiaMm ?? 12) * scale * 1.5));
    for (const p of m.holes.positionsMm) {
      const hx = x0 + p * scale;
      s.circle(hx, hy, r);
      s.line(hx, barBottom + barH + 0.5, hx, barBottom + barH + 3, { w: 0.12 });
      s.text(`${q(p)}`, hx, barBottom + barH + 3.6, { size: 6, align: 'center', color: m.holes.toConfirm ? RED : undefined });
    }
  } else if (m.holeDiaMm && L > 0) {
    s.line(x0, hy, x0 + drawnL, hy, { w: 0.15, dash: [2, 1], color: GREY });
    s.text('holes: count / positions to confirm', x0 + drawnL + 6, barBottom + barH / 2 - 1, { size: 6.5, color: RED });
  }

  // Notes
  let ny = barBottom - 12;
  for (const n of m.notes) ny = s.para(n, x0, ny, maxW + 30, { size: 7, color: /to confirm|TO CONFIRM/.test(n) ? RED : undefined });

  sectionSketch(s, m, 360, yTop - bandH / 2 - 1);
  s.line(18, yTop - bandH, W - 18, yTop - bandH, { w: 0.15, color: GREY });
}

function memberSheet(s: Sheet, members: MemberView[]) {
  const bandH = (CONTENT_TOP - CONTENT_BOTTOM) / MEMBERS_PER_SHEET;
  members.forEach((m, i) => memberBand(s, m, CONTENT_TOP - i * bandH, bandH));
}

const CUT_COLS = [
  { title: 'Mark', w: 26 },
  { title: 'Description', w: 92 },
  { title: 'Section', w: 40 },
  { title: 'Cut length (mm)', w: 26, align: 'right' as const },
  { title: 'Qty / set', w: 22, align: 'right' as const },
  { title: 'Sets', w: 20, align: 'right' as const },
  { title: 'Total qty', w: 26, align: 'right' as const },
  { title: 'Holes', w: 60 },
  { title: 'Bend / weld', w: 68 },
];

function cuttingSheet(s: Sheet, model: FabModel, rows: TableRow[], last: boolean) {
  s.text('CUTTING LIST – per set and total (from the confirmed BOM, lengths not changed)', 20, CONTENT_TOP - 2, { size: 11, bold: true });
  // Heading rows (one cell) span all columns.
  const y = s.table(20, CONTENT_TOP - 7, CUT_COLS, rows, 6, 7.5);
  if (last) {
    let fy = y - 5;
    fy = s.para('Total qty = qty per set x sets of the structure. "TBC" = hole count / positions not on the BOM or the approved drawing – production to confirm before cutting.', 20, fy, 225, { size: 7.5 });
    s.para('Cut lengths include no end allowance or kerf; bar lengths and nesting are in the RM indent made from the same BOM.', 20, fy, 225, { size: 7.5, color: GREY });
  }
}

/** Render the model to a PDF (bytes). */
export async function renderFabPdf(model: FabModel): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle(`${model.drawingNoBase} Rev ${model.header.rev} – fabrication drawings`);
  doc.setAuthor(model.header.company);
  doc.setSubject(model.header.project);
  doc.setCreator('Ceebuild dashboard – M14 fabrication drawings');
  doc.setProducer('pdf-lib');

  const plan = sheetPlan(model);
  const newSheet = () => new Sheet(doc.addPage([W * MM, H * MM]), font, bold);
  let no = 1;

  const s1 = newSheet();
  frame(s1, model, no, plan.total, 'Sheet 1 – General notes, design decisions & items to confirm');
  sheetOne(s1, model, plan);

  for (let i = 0; i < plan.memberSheets; i++) {
    no++;
    const ms = model.members.slice(i * MEMBERS_PER_SHEET, (i + 1) * MEMBERS_PER_SHEET);
    const s = newSheet();
    frame(s, model, no, plan.total, `Sheet ${no} – Member details: ${ms.map((m) => m.markNo).join(', ')}`);
    memberSheet(s, ms);
  }

  const rows = cuttingTableRows(model);
  for (let i = 0; i < plan.cutSheets; i++) {
    no++;
    const s = newSheet();
    frame(s, model, no, plan.total, `Sheet ${no} – Cutting list per set and total`);
    cuttingSheet(s, model, rows.slice(i * CUT_ROWS_PER_SHEET, (i + 1) * CUT_ROWS_PER_SHEET), i === plan.cutSheets - 1);
  }
  return doc.save();
}
