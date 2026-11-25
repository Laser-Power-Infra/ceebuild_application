// M14 25-11: first (seed) load of Puja's Power BI exports into the dashboard (Rev 2 §5 / §8).
//   node --env-file=.env --conditions=react-server --import tsx scripts/m14_import_pbi.ts [--dry] [dir]
// Default dir: docs/m14-rev2-reference/pbi-25-11 (gitignored). Incremental and idempotent: each
// row is keyed by a hash of its content, existing rows are skipped, nothing is ever deleted.
// Then: freight lanes (Dhulagarh, trucks only, <=6 months lowest / older +5%) -> FREIGHT_MT and
// FREIGHT_TRIP per state, and monthly PO rates per RM family (rate type PO) as rate history.
// Exceptions (#N/A, bad dates / numbers, missing keys) are written to <dir>/exceptions_<date>.csv.
export {};
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import type { Prisma as PrismaTypes } from '@prisma/client';
import { deriveLanes, stateFreight, type FoRow } from '../src/lib/freight/lanes';

const DRY = process.argv.includes('--dry');
const DIR = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'docs/m14-rev2-reference/pbi-25-11';
const AS_OF = '2026-11-25';
const USER_ID = 6;

type Row = Record<string, unknown>;
const exceptions: string[][] = [['file', 'row', 'problem', 'value']];
const bad = (file: string, row: number, problem: string, value: unknown) => exceptions.push([file, String(row), problem, String(value ?? '')]);

const BAD_CELL = /^#(N\/A|REF!|VALUE!|DIV\/0!|NAME\?)$/i;
const str = (v: unknown) => {
  const s = String(v ?? '').trim();
  return s && !BAD_CELL.test(s) && s !== '.' ? s : null;
};
const num = (file: string, row: number, col: string, v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
  if (!Number.isFinite(n)) {
    bad(file, row, `${col}: not a number`, v);
    return null;
  }
  return n;
};
const date = (file: string, row: number, col: string, v: unknown): Date | null => {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // xlsx gives local midnight; keep the calendar day (IST) as a UTC date.
    return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
  }
  bad(file, row, `${col}: not a date`, v);
  return null;
};
const hash = (o: unknown) => createHash('sha1').update(JSON.stringify(o)).digest('hex');
const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

function sheet(file: string): Row[] {
  const wb = XLSX.readFile(path.join(DIR, file), { cellDates: true });
  return XLSX.utils.sheet_to_json<Row>(wb.Sheets[wb.SheetNames[0]], { raw: true, defval: null });
}

async function main() {
  const { prisma } = await import('../src/lib/prisma');
  const { Prisma } = await import('@prisma/client');

  // ---- PO details ----
  const poFile = 'PBI_Ceebuild_PO_Details_25-11-2026.xlsx';
  const po = sheet(poFile).map((r, i) => {
    const row = i + 2;
    const d = {
      indentNo: str(r['indent no']),
      poNo: str(r['PO NO']),
      party: str(r['Party']),
      orderDate: date(poFile, row, 'Ord. Dt.', r['Ord. Dt.']),
      itemName: str(r['ITEM NAME']),
      uom: str(r['UM']),
      rate: num(poFile, row, 'Rate', r['Rate']),
      poQty: num(poFile, row, 'PO QTY', r['PO QTY']),
      grnQty: num(poFile, row, 'GRN QTY', r['GRN QTY']),
      balToGrn: num(poFile, row, 'Bal To GRN', r['Bal To GRN']),
    };
    if (!d.poNo) bad(poFile, row, 'PO no blank', '');
    if (!d.itemName) bad(poFile, row, 'item blank', '');
    return { ...d, rowHash: hash({ ...d, orderDate: ymd(d.orderDate) }), source: poFile };
  });

  // ---- Indent details ----
  const inFile = 'PBI_Ceebuild_Indent_Details_25-11-2026.xlsx';
  const indent = sheet(inFile).map((r, i) => {
    const row = i + 2;
    const d = {
      indentNo: str(r['indent_no']),
      indentDate: date(inFile, row, 'Indent date', r['Indent date']),
      itemName: str(r['item_name']),
      uom: str(r['uom']),
      indentQty: num(inFile, row, 'indent_qty', r['indent_qty']),
      requisitionBy: str(r['Requisition_by']),
      indentBy: str(r['indent by']),
      purpose: str(r['Purpose']),
      requireDate: date(inFile, row, 'require_date', r['require_date']),
      deliverySch: str(r['Delivery Sch']),
      poQty: num(inFile, row, 'Po Qty', r['Po Qty']),
      balToPo: num(inFile, row, 'Bal to Po', r['Bal to Po']),
    };
    if (!d.indentNo) bad(inFile, row, 'indent no blank', '');
    return { ...d, rowHash: hash({ ...d, indentDate: ymd(d.indentDate), requireDate: ymd(d.requireDate) }), source: inFile };
  });

  // ---- Freight history (FO) ----
  const frFile = 'PBI_Freight_History_FO_All_25-11-2026.xlsx';
  const fr = sheet(frFile).map((r, i) => {
    const row = i + 2;
    const d = {
      foNo: str(r['FO NO']),
      foDate: date(frFile, row, 'FO_DATE', r['FO_DATE']),
      docNo: str(r['OUR_DOC_NO']),
      docDate: date(frFile, row, 'OUR DOC DATE', r['OUR DOC DATE']),
      fromLoc: str(r['FROM_LOC']),
      fromPin: str(r['FROM PIN']),
      toLoc: str(r['TO_LOC']),
      toPin: str(r['TO_PIN']),
      vehicleType: str(r['VEHTYPE NAME']),
      truckNo: str(r['TRUCKNO']),
      netWeight: num(frFile, row, 'NET_WEIGHT', r['NET_WEIGHT']),
      foRate: num(frFile, row, 'FO_RATE', r['FO_RATE']),
      freightValue: num(frFile, row, 'FREIGHT_VAL', r['FREIGHT_VAL']),
      distance: num(frFile, row, 'Distance', r['Distance']),
      billNo: str(r['TRNPT_BILL']),
      billAmount: num(frFile, row, 'TRNPT_BILL FREIGHT AMT', r['TRNPT_BILL FREIGHT AMT']),
    };
    if (!d.foNo || !d.fromLoc || !d.toLoc) bad(frFile, row, 'FO no / from / to blank', d.foNo ?? '');
    else if (!(d.foRate && d.foRate > 0)) bad(frFile, row, 'FO rate 0 or blank', d.foRate);
    return { ...d, rowHash: hash({ ...d, foDate: ymd(d.foDate), docDate: ymd(d.docDate), i }), source: frFile };
  });

  console.log(`PO ${po.length} · indent ${indent.length} · freight ${fr.length} · exceptions ${exceptions.length - 1}`);

  // ---- Freight lanes -> Freight Master ----
  const foRows: FoRow[] = fr.map((x) => ({ fromLoc: x.fromLoc, toLoc: x.toLoc, toPin: x.toPin, vehicleType: x.vehicleType, date: ymd(x.docDate ?? x.foDate), tripRate: x.foRate }));
  const lanes = deriveLanes(foRows, AS_OF);
  const perState = stateFreight(lanes);
  const laneCsv = [['state', 'truck MT', 'trip rate', 'Rs/MT full load', 'basis', 'trips', 'last date', 'outliers dropped'], ...lanes.map((l) => [l.state, l.capacityMt, l.tripRate, l.ratePerMt, l.basis, l.trips, l.lastDate, l.outliers].map(String))];
  writeFileSync(path.join(DIR, `freight_lanes_${AS_OF}.csv`), laneCsv.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n'));
  console.log(`Lanes ${lanes.length} over ${perState.length} states (Dhulagarh, trucks only)`);
  for (const s of perState) console.log(`  ${s.state.padEnd(18)} Rs/MT ${s.perMt.ratePerMt} (${s.perMt.capacityMt} MT, ${s.perMt.basis})  trip ${s.trip.tripRate} (${s.trip.capacityMt} MT)`);

  // ---- Monthly PO rate per RM family (history; the 20-11 ESTIMATE stays current) ----
  const familyOfItem = (name: string | null): string | null => {
    const n = String(name ?? '').toUpperCase().replace(/\s+/g, ' ');
    if (/^M\.?\s?S\.? ?FLAT/.test(n)) return 'FLAT';
    if (/^M\.?\s?S\.? ?ANGLE/.test(n)) return 'ANGLE';
    if (/^M\.?\s?S\.? ?CHANNEL/.test(n)) return 'CHANNEL';
    if (/^M\.?\s?S\.? ?ROUND|^NON ALLOY STEEL ROUND/.test(n)) return 'ROD';
    if (/^M\.?\s?S\.? ?PIPE/.test(n)) return 'PIPE';
    return null;
  };
  const since = '2025-11-01';
  const monthly = new Map<string, { fam: string; date: string; qty: number; amt: number; party: string }>();
  for (const p of po) {
    const fam = familyOfItem(p.itemName);
    const d = ymd(p.orderDate);
    if (!fam || !d || d < since || !/^KGS?$/i.test(p.uom ?? '') || !(p.rate && p.rate > 0) || !(p.poQty && p.poQty > 0)) continue;
    const k = `${fam}|${d.slice(0, 7)}`;
    const cur = monthly.get(k);
    // The month's latest order date; the qty-weighted rate of that date.
    if (!cur || d > cur.date) monthly.set(k, { fam, date: d, qty: p.poQty, amt: p.poQty * p.rate, party: p.party ?? '' });
    else if (d === cur.date) {
      cur.qty += p.poQty;
      cur.amt += p.poQty * p.rate;
    }
  }
  const poRates = [...monthly.values()].map((m) => ({ ...m, rate: Math.round((m.amt / m.qty) * 100) / 100 })).sort((a, b) => a.fam.localeCompare(b.fam) || a.date.localeCompare(b.date));
  console.log(`PO rate history rows: ${poRates.length} (RM families, monthly since ${since})`);

  const exFile = path.join(DIR, `exceptions_${AS_OF}.csv`);
  writeFileSync(exFile, exceptions.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n'));
  const byProblem = new Map<string, number>();
  for (const e of exceptions.slice(1)) byProblem.set(`${e[0].slice(4, 30)}: ${e[2]}`, (byProblem.get(`${e[0].slice(4, 30)}: ${e[2]}`) ?? 0) + 1);
  for (const [k, v] of byProblem) console.log(`  exception ${k} = ${v}`);

  if (DRY) {
    console.log('--dry: nothing written.');
    await prisma.$disconnect();
    return;
  }

  const chunk = async <T,>(rows: T[], f: (c: T[]) => Promise<{ count: number }>) => {
    let n = 0;
    for (let i = 0; i < rows.length; i += 2000) n += (await f(rows.slice(i, i + 2000))).count;
    return n;
  };
  const dec = (v: number | null) => (v === null ? null : new Prisma.Decimal(v));
  const nPo = await chunk(po, (c) => prisma.erpPoLine.createMany({ data: c.map((x) => ({ ...x, rate: dec(x.rate), poQty: dec(x.poQty), grnQty: dec(x.grnQty), balToGrn: dec(x.balToGrn) })), skipDuplicates: true }));
  const nIn = await chunk(indent, (c) => prisma.erpIndentLine.createMany({ data: c.map((x) => ({ ...x, indentQty: dec(x.indentQty), poQty: dec(x.poQty), balToPo: dec(x.balToPo) })), skipDuplicates: true }));
  const nFr = await chunk(fr, (c) =>
    prisma.freightHistory.createMany({
      data: c.map((x) => ({ ...x, netWeight: dec(x.netWeight), foRate: dec(x.foRate), freightValue: dec(x.freightValue), distance: dec(x.distance), billAmount: dec(x.billAmount) })),
      skipDuplicates: true,
    }),
  );
  console.log(`Inserted (new rows): PO ${nPo}, indent ${nIn}, freight ${nFr}`);

  // Rates: one row per kind / subject / effective date, skipped when already there.
  const eff = new Date(`${AS_OF}T00:00:00Z`);
  const rateRows: PrismaTypes.CostRateCreateManyInput[] = [];
  for (const s of perState) {
    const subject = s.state.toUpperCase();
    rateRows.push({
      kind: 'FREIGHT_MT', subject, value: s.perMt.ratePerMt, unit: 'Rs/MT', effectiveFrom: eff, rateType: 'ACTUAL', owner: 'Logistics', updateFreqDays: 30,
      source: `Freight history lanes: Dhulagarh -> ${s.state}, ${s.perMt.capacityMt} MT truck full load, ${s.perMt.basis === 'LOWEST_6M' ? 'lowest of last 6 months' : 'older rate +5%'} (${s.perMt.trips} trips, last ${s.perMt.lastDate})`,
      createdById: USER_ID, createdByName: 'M14 import (Power BI seed)',
    });
    rateRows.push({
      kind: 'FREIGHT_TRIP', subject, value: s.trip.tripRate, unit: 'Rs/trip', effectiveFrom: eff, rateType: 'ACTUAL', owner: 'Logistics', updateFreqDays: 30,
      source: `Freight history lanes: Dhulagarh -> ${s.state}, ${s.trip.capacityMt} MT truck trip, ${s.trip.basis === 'LOWEST_6M' ? 'lowest of last 6 months' : 'older rate +5%'} (${s.trip.trips} trips)`,
      createdById: USER_ID, createdByName: 'M14 import (Power BI seed)',
    });
  }
  for (const r of poRates) {
    rateRows.push({
      kind: 'RM_RATE', subject: r.fam, value: r.rate, unit: 'Rs/kg', effectiveFrom: new Date(`${r.date}T00:00:00Z`), rateType: 'PO', supplier: r.party.slice(0, 120), owner: 'Purchase', updateFreqDays: 1,
      source: `Power BI PO details (${r.date}, qty-weighted)`, createdById: USER_ID, createdByName: 'M14 import (Power BI seed)',
    });
  }
  const existing = await prisma.costRate.findMany({ where: { kind: { in: ['FREIGHT_MT', 'FREIGHT_TRIP', 'RM_RATE'] } }, select: { kind: true, subject: true, effectiveFrom: true } });
  const have = new Set(existing.map((e) => `${e.kind}|${e.subject}|${e.effectiveFrom.toISOString().slice(0, 10)}`));
  const fresh = rateRows.filter((r) => !have.has(`${r.kind}|${r.subject}|${(r.effectiveFrom as Date).toISOString().slice(0, 10)}`));
  const nRates = fresh.length ? (await prisma.costRate.createMany({ data: fresh })).count : 0;
  await prisma.editLog.create({
    data: {
      tableName: 'cost_rates',
      recordId: 0,
      fieldName: 'IMPORT',
      oldValue: 'Power BI exports 25-11-2026',
      newValue: JSON.stringify({ erpPo: nPo, erpIndent: nIn, freight: nFr, rates: nRates, exceptions: exceptions.length - 1 }),
      userId: USER_ID,
      userName: 'M14 import (Power BI seed)',
    },
  });
  console.log(`Rates added: ${nRates} (freight per state + RM PO history). Exceptions file: ${exFile}`);
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
