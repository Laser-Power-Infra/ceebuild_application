import 'server-only';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { UserError } from '@/lib/actionResult';
import { deriveLanes, stateFreight, type FoRow } from '@/lib/freight/lanes';

// Rev 2 §5 / §8 daily feed: Power BI rows (Power Automate "Run a query against a dataset", or a
// manual export) arrive through n8n and are upserted here. Incremental: a row is keyed by a hash of
// its content (+ an occurrence count for identical rows in one batch), existing rows are skipped,
// nothing is ever deleted. After each load the derived masters are refreshed: freight lanes ->
// FREIGHT_MT / FREIGHT_TRIP per state, monthly RM PO rates (rate type PO).

export const ERP_SOURCES = ['PO', 'INDENT', 'FREIGHT'] as const;
export type ErpSource = (typeof ERP_SOURCES)[number];

type Row = Record<string, unknown>;
export interface ErpException {
  row: number;
  problem: string;
  value: string;
}

const BAD_CELL = /^#(N\/A|REF!|VALUE!|DIV\/0!|NAME\?)$/i;
/** Column value by any of its names (Power BI exports and DAX queries name columns differently). */
const pick = (r: Row, ...names: string[]) => {
  for (const n of names) {
    if (n in r) return r[n];
    const k = Object.keys(r).find((x) => x.replace(/^.*\[|\]$/g, '').trim().toLowerCase() === n.toLowerCase());
    if (k) return r[k];
  }
  return undefined;
};
const MON: Record<string, number> = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

export function erpStr(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return s && !BAD_CELL.test(s) && s !== '.' ? s.slice(0, 500) : null;
}
export function erpNum(v: unknown): number | null | 'BAD' {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 'BAD';
}
/** Date from an ISO string, "24-Nov-26", "24-11-2026", an Excel serial or a Date -> UTC midnight. */
export function erpDate(v: unknown): Date | null | 'BAD' {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? 'BAD' : new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 86400000);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = s.match(/^(\d{1,2})[-/ ]([A-Za-z]{3})[A-Za-z]*[-/ ](\d{2,4})$/);
  if (m && MON[m[2].toUpperCase()] !== undefined) return new Date(Date.UTC(m[3].length === 2 ? 2000 + +m[3] : +m[3], MON[m[2].toUpperCase()], +m[1]));
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  return 'BAD';
}
const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const sha1 = (o: unknown) => createHash('sha1').update(JSON.stringify(o)).digest('hex');

/** Content hash; the 2nd, 3rd ... identical row in one batch gets its occurrence number in the key. */
export function rowHashes(keys: unknown[]): string[] {
  const seen = new Map<string, number>();
  return keys.map((k) => {
    const base = JSON.stringify(k);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return sha1(n ? { ...(k as object), _n: n } : k);
  });
}

function mapRows(source: ErpSource, rows: Row[], exceptions: ErpException[]) {
  const bad = (row: number, problem: string, value: unknown) => exceptions.push({ row, problem, value: String(value ?? '').slice(0, 100) });
  // Rounded to the column's precision, so a stored row hashes the same as the next export of it.
  const N = (row: number, col: string, v: unknown, dp = 3) => {
    const n = erpNum(v);
    if (n === 'BAD') {
      bad(row, `${col}: not a number`, v);
      return null;
    }
    // Decimal rounding (half up on the decimal text), the same as Postgres numeric.
    return n === null ? null : new Prisma.Decimal(n).toDecimalPlaces(dp).toNumber();
  };
  const D = (row: number, col: string, v: unknown) => {
    const d = erpDate(v);
    if (d === 'BAD') {
      bad(row, `${col}: not a date`, v);
      return null;
    }
    return d;
  };
  if (source === 'PO')
    return rows.map((r, i) => {
      const row = i + 1;
      const d = {
        indentNo: erpStr(pick(r, 'indent no', 'indent_no')),
        poNo: erpStr(pick(r, 'PO NO', 'po_no')),
        party: erpStr(pick(r, 'Party')),
        orderDate: D(row, 'Ord. Dt.', pick(r, 'Ord. Dt.', 'order_date', 'Ord Dt')),
        itemName: erpStr(pick(r, 'ITEM NAME', 'item_name')),
        uom: erpStr(pick(r, 'UM', 'uom')),
        rate: N(row, 'Rate', pick(r, 'Rate'), 4),
        poQty: N(row, 'PO QTY', pick(r, 'PO QTY', 'po_qty')),
        grnQty: N(row, 'GRN QTY', pick(r, 'GRN QTY', 'grn_qty')),
        balToGrn: N(row, 'Bal To GRN', pick(r, 'Bal To GRN', 'bal_to_grn')),
      };
      if (!d.poNo) bad(row, 'PO no blank', '');
      if (!d.itemName) bad(row, 'item blank', '');
      return { d, key: { ...d, orderDate: ymd(d.orderDate) } };
    });
  if (source === 'INDENT')
    return rows.map((r, i) => {
      const row = i + 1;
      const d = {
        indentNo: erpStr(pick(r, 'indent_no', 'indent no')),
        indentDate: D(row, 'Indent date', pick(r, 'Indent date', 'indent_date')),
        itemName: erpStr(pick(r, 'item_name', 'ITEM NAME')),
        uom: erpStr(pick(r, 'uom', 'UM')),
        indentQty: N(row, 'indent_qty', pick(r, 'indent_qty')),
        requisitionBy: erpStr(pick(r, 'Requisition_by')),
        indentBy: erpStr(pick(r, 'indent by', 'indent_by')),
        purpose: erpStr(pick(r, 'Purpose')),
        requireDate: D(row, 'require_date', pick(r, 'require_date')),
        deliverySch: erpStr(pick(r, 'Delivery Sch', 'delivery_sch')),
        poQty: N(row, 'Po Qty', pick(r, 'Po Qty', 'po_qty')),
        balToPo: N(row, 'Bal to Po', pick(r, 'Bal to Po', 'bal_to_po')),
      };
      if (!d.indentNo) bad(row, 'indent no blank', '');
      return { d, key: { ...d, indentDate: ymd(d.indentDate), requireDate: ymd(d.requireDate) } };
    });
  return rows.map((r, i) => {
    const row = i + 1;
    const d = {
      foNo: erpStr(pick(r, 'FO NO', 'fo_no')),
      foDate: D(row, 'FO_DATE', pick(r, 'FO_DATE', 'fo_date')),
      docNo: erpStr(pick(r, 'OUR_DOC_NO', 'our_doc_no')),
      docDate: D(row, 'OUR DOC DATE', pick(r, 'OUR DOC DATE', 'our_doc_date')),
      fromLoc: erpStr(pick(r, 'FROM_LOC', 'from_loc')),
      fromPin: erpStr(pick(r, 'FROM PIN', 'from_pin')),
      toLoc: erpStr(pick(r, 'TO_LOC', 'to_loc')),
      toPin: erpStr(pick(r, 'TO_PIN', 'to_pin')),
      vehicleType: erpStr(pick(r, 'VEHTYPE NAME', 'vehtype_name', 'vehicle_type')),
      truckNo: erpStr(pick(r, 'TRUCKNO', 'truck_no')),
      netWeight: N(row, 'NET_WEIGHT', pick(r, 'NET_WEIGHT', 'net_weight')),
      foRate: N(row, 'FO_RATE', pick(r, 'FO_RATE', 'fo_rate'), 2),
      freightValue: N(row, 'FREIGHT_VAL', pick(r, 'FREIGHT_VAL', 'freight_val'), 2),
      distance: N(row, 'Distance', pick(r, 'Distance'), 1),
      billNo: erpStr(pick(r, 'TRNPT_BILL', 'trnpt_bill')),
      billAmount: N(row, 'TRNPT_BILL FREIGHT AMT', pick(r, 'TRNPT_BILL FREIGHT AMT', 'trnpt_bill_freight_amt'), 2),
    };
    if (!d.foNo || !d.fromLoc || !d.toLoc) bad(row, 'FO no / from / to blank', d.foNo ?? '');
    else if (!(d.foRate && d.foRate > 0)) bad(row, 'FO rate 0 or blank', d.foRate);
    return { d, key: { ...d, foDate: ymd(d.foDate), docDate: ymd(d.docDate) } };
  });
}

const dec = (v: number | null) => (v === null ? null : new Prisma.Decimal(v));

/** Upsert one batch of rows of one source. Returns new rows and the exception list. */
export async function importErpRows(source: ErpSource, rows: Row[], label: string, userName = 'n8n (Power BI feed)') {
  if (!(ERP_SOURCES as readonly string[]).includes(source)) throw new UserError(`source must be one of ${ERP_SOURCES.join(', ')}.`);
  if (!Array.isArray(rows)) throw new UserError('rows must be an array.');
  if (rows.length > 60000) throw new UserError('At most 60,000 rows per call.');
  const exceptions: ErpException[] = [];
  const mapped = mapRows(source, rows, exceptions);
  const hashes = rowHashes(mapped.map((m) => m.key));
  const src = label.slice(0, 200) || 'n8n';
  let inserted = 0;
  for (let i = 0; i < mapped.length; i += 2000) {
    const part = mapped.slice(i, i + 2000).map((m, j) => ({ ...m.d, rowHash: hashes[i + j], source: src }));
    if (source === 'PO')
      inserted += (await prisma.erpPoLine.createMany({ data: part.map((x) => { const p = x as typeof x & Record<string, number | null>; return { ...p, rate: dec(p.rate), poQty: dec(p.poQty), grnQty: dec(p.grnQty), balToGrn: dec(p.balToGrn) }; }) as Prisma.ErpPoLineCreateManyInput[], skipDuplicates: true })).count;
    else if (source === 'INDENT')
      inserted += (await prisma.erpIndentLine.createMany({ data: part.map((x) => { const p = x as typeof x & Record<string, number | null>; return { ...p, indentQty: dec(p.indentQty), poQty: dec(p.poQty), balToPo: dec(p.balToPo) }; }) as Prisma.ErpIndentLineCreateManyInput[], skipDuplicates: true })).count;
    else
      inserted += (await prisma.freightHistory.createMany({ data: part.map((x) => { const p = x as typeof x & Record<string, number | null>; return { ...p, netWeight: dec(p.netWeight), foRate: dec(p.foRate), freightValue: dec(p.freightValue), distance: dec(p.distance), billAmount: dec(p.billAmount) }; }) as Prisma.FreightHistoryCreateManyInput[], skipDuplicates: true })).count;
  }
  const derived = inserted > 0 ? await refreshDerivedMasters(source) : { rates: 0 };
  await prisma.editLog.create({
    data: {
      tableName: source === 'PO' ? 'erp_po_lines' : source === 'INDENT' ? 'erp_indent_lines' : 'freight_history',
      recordId: 0,
      fieldName: 'IMPORT',
      oldValue: src,
      newValue: JSON.stringify({ rows: rows.length, inserted, exceptions: exceptions.length, derivedRates: derived.rates }),
      userName,
    },
  });
  return { source, rows: rows.length, inserted, skipped: rows.length - inserted, exceptions: exceptions.length, exceptionSample: exceptions.slice(0, 50), derived };
}

/** Freight lanes (FREIGHT source) or monthly RM PO rates (PO source): new rate rows only where the value changed. */
export async function refreshDerivedMasters(source: ErpSource, asOf = new Date().toISOString().slice(0, 10)) {
  const eff = new Date(`${asOf}T00:00:00Z`);
  const rows: Prisma.CostRateCreateManyInput[] = [];
  const who = { createdByName: 'n8n (Power BI feed)' };
  if (source === 'FREIGHT') {
    const since = new Date(Date.UTC(new Date(eff).getUTCFullYear() - 3, 0, 1));
    const fo = await prisma.freightHistory.findMany({
      where: { fromLoc: { contains: 'DHULAGARH', mode: 'insensitive' }, OR: [{ docDate: { gte: since } }, { foDate: { gte: since } }] },
      select: { fromLoc: true, toLoc: true, toPin: true, vehicleType: true, docDate: true, foDate: true, foRate: true },
    });
    const foRows: FoRow[] = fo.map((x) => ({ fromLoc: x.fromLoc, toLoc: x.toLoc, toPin: x.toPin, vehicleType: x.vehicleType, date: ymd(x.docDate ?? x.foDate), tripRate: x.foRate ? x.foRate.toNumber() : null }));
    for (const s of stateFreight(deriveLanes(foRows, asOf))) {
      const subject = s.state.toUpperCase();
      const basis = s.trip.basis === 'LOWEST_6M' ? 'lowest of last 6 months' : 'older rate +5%';
      rows.push({ kind: 'FREIGHT_MT', subject, value: s.perMt.ratePerMt, unit: 'Rs/MT', effectiveFrom: eff, rateType: 'ACTUAL', owner: 'Logistics', updateFreqDays: 30, source: `Freight history lanes: Dhulagarh -> ${s.state}, ${s.perMt.capacityMt} MT truck full load, ${basis} (${s.perMt.trips} trips, last ${s.perMt.lastDate})`, ...who });
      rows.push({ kind: 'FREIGHT_TRIP', subject, value: s.trip.tripRate, unit: 'Rs/trip', effectiveFrom: eff, rateType: 'ACTUAL', owner: 'Logistics', updateFreqDays: 30, source: `Freight history lanes: Dhulagarh -> ${s.state}, ${s.trip.capacityMt} MT truck trip, ${basis} (${s.trip.trips} trips)`, ...who });
    }
  } else if (source === 'PO') {
    const fam = (name: string | null): string | null => {
      const n = String(name ?? '').toUpperCase().replace(/\s+/g, ' ');
      if (/^M\.?\s?S\.? ?FLAT/.test(n)) return 'FLAT';
      if (/^M\.?\s?S\.? ?ANGLE/.test(n)) return 'ANGLE';
      if (/^M\.?\s?S\.? ?CHANNEL/.test(n)) return 'CHANNEL';
      if (/^M\.?\s?S\.? ?ROUND|^NON ALLOY STEEL ROUND/.test(n)) return 'ROD';
      if (/^M\.?\s?S\.? ?PIPE/.test(n)) return 'PIPE';
      return null;
    };
    const since = new Date(eff.getTime() - 62 * 86400000);
    const po = await prisma.erpPoLine.findMany({ where: { orderDate: { gte: since }, rate: { gt: 0 }, poQty: { gt: 0 } } });
    const latest = new Map<string, { date: string; qty: number; amt: number; party: string }>();
    for (const p of po) {
      const f = fam(p.itemName);
      const d = ymd(p.orderDate);
      if (!f || !d || !/^KGS?$/i.test(p.uom ?? '')) continue;
      const q = p.poQty!.toNumber();
      const cur = latest.get(f);
      if (!cur || d > cur.date) latest.set(f, { date: d, qty: q, amt: q * p.rate!.toNumber(), party: p.party ?? '' });
      else if (d === cur.date) {
        cur.qty += q;
        cur.amt += q * p.rate!.toNumber();
      }
    }
    for (const [f, m] of latest)
      rows.push({ kind: 'RM_RATE', subject: f, value: Math.round((m.amt / m.qty) * 100) / 100, unit: 'Rs/kg', effectiveFrom: new Date(`${m.date}T00:00:00Z`), rateType: 'PO', supplier: m.party.slice(0, 120), owner: 'Purchase', updateFreqDays: 1, source: `Power BI PO details (${m.date}, qty-weighted)`, ...who });
  }
  if (!rows.length) return { rates: 0 };
  // Skip a row when the same kind/subject already has that value on or before its date (no change),
  // or a row on the same date.
  const current = await prisma.costRate.findMany({ where: { kind: { in: [...new Set(rows.map((r) => r.kind))] } }, orderBy: [{ effectiveFrom: 'desc' }, { id: 'desc' }] });
  const fresh = rows.filter((r) => {
    const e = r.effectiveFrom as Date;
    const prev = current.find((c) => c.kind === r.kind && c.subject === r.subject && c.effectiveFrom <= e);
    if (!prev) return true;
    if (prev.effectiveFrom.getTime() === e.getTime()) return false;
    return Math.abs(prev.value.toNumber() - Number(r.value)) > 0.005;
  });
  const n = fresh.length ? (await prisma.costRate.createMany({ data: fresh })).count : 0;
  return { rates: n };
}

/** Counts for the feed status (n8n run log / dashboard). */
export async function erpFeedStatus() {
  const [po, indent, freight] = await Promise.all([
    prisma.erpPoLine.aggregate({ _count: true, _max: { orderDate: true, createdAt: true } }),
    prisma.erpIndentLine.aggregate({ _count: true, _max: { indentDate: true, createdAt: true } }),
    prisma.freightHistory.aggregate({ _count: true, _max: { docDate: true, createdAt: true } }),
  ]);
  return {
    po: { rows: po._count, lastOrder: ymd(po._max.orderDate), lastLoad: po._max.createdAt },
    indent: { rows: indent._count, lastIndent: ymd(indent._max.indentDate), lastLoad: indent._max.createdAt },
    freight: { rows: freight._count, lastDoc: ymd(freight._max.docDate), lastLoad: freight._max.createdAt },
  };
}
