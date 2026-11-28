import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { auditUser, type AuthUser } from '@/lib/auth/server';
import { UserError } from '@/lib/actionResult';
import { toNum } from '@/lib/bom/parse';
import { normalizeDocketNo } from '@/lib/dockets';
import { offerHsn } from '@/lib/po/hsn';
import { pickRate, RATE_KINDS, type RateRow } from '@/lib/costing/calc';
import { manualPrices } from '@/lib/manualPrice';
import { allRates } from './master';

// Rev 2 §11: the quotation as quoted is frozen when it is sent or approved. A snapshot is never
// changed; a new revision is a new row (Rev 0, 1, ...). Back-dated master changes never touch it.

export const SNAPSHOT_STATUSES = ['SENT', 'APPROVED'] as const;

export interface SnapshotItem {
  itemId: number;
  itemNameParty: string | null;
  ourItemName: string | null;
  hsn: string;
  qty: string | null;
  uom: string | null;
  price: string | null;
  uomOfQtn: string | null;
  /** qty x price when both are numbers (same unit), else null. */
  value: number | null;
  costingId: number | null;
  vaPct: number | null;
  sellPerKg: number | null;
}

export interface SnapshotPayload {
  docket: Record<string, unknown>;
  items: SnapshotItem[];
  /** Latest rate of every kind / subject in force on the quoted date. */
  rates: RateRow[];
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const isYmd = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Rates in force on `date`: one row per kind + subject (latest effective on or before the date). */
function ratesOn(rates: RateRow[], date: string): RateRow[] {
  const out: RateRow[] = [];
  for (const kind of RATE_KINDS) {
    const subjects = [...new Set(rates.filter((r) => r.kind === kind).map((r) => r.subject))];
    for (const s of subjects) {
      const r = pickRate(rates, kind, s, date, false);
      if (r) out.push(r);
    }
  }
  return out;
}

async function buildPayload(docketId: number, quotedOn: string, prices?: Record<number, string>) {
  const docket = await prisma.dockerPartyName.findUnique({ where: { id: docketId } });
  if (!docket) throw new UserError('Docket not found.');
  const no = docket.docketNoQtnNo ? normalizeDocketNo(docket.docketNoQtnNo) : null;
  const items = no ? await prisma.itemTable.findMany({ where: { docketNoQtnNo: no }, orderBy: { id: 'asc' } }) : [];
  const costings = items.length
    ? await prisma.itemCosting.findMany({ where: { itemId: { in: items.map((i) => i.id) } }, orderBy: { id: 'desc' } })
    : [];
  const rates = ratesOn(await allRates(), quotedOn);
  const out: SnapshotItem[] = items.map((i) => {
    const c = costings.find((x) => x.itemId === i.id && x.applied) ?? costings.find((x) => x.itemId === i.id) ?? null;
    const price = prices?.[i.id] ?? i.price;
    const q = toNum(i.qty);
    const pr = toNum(price);
    return {
      itemId: i.id,
      itemNameParty: i.itemNameParty,
      ourItemName: i.ourItemName,
      hsn: offerHsn(i),
      qty: i.qty,
      uom: i.uom,
      price: price ?? null,
      uomOfQtn: i.uomOfQtn,
      value: q !== null && pr !== null && (!i.uomOfQtn || !i.uom || i.uomOfQtn.toUpperCase() === i.uom.toUpperCase()) ? Math.round(q * pr * 100) / 100 : null,
      costingId: c?.id ?? null,
      vaPct: c ? c.vaPct.toNumber() : null,
      sellPerKg: c ? c.sellPerKg.toNumber() : null,
    };
  });
  const { createdAt, updatedAt, ...d } = docket;
  const payload: SnapshotPayload = { docket: { ...d, createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString() }, items: out, rates };
  return { docket, payload, total: out.reduce((a, x) => a + (x.value ?? 0), 0) };
}

/** Freeze the docket as quoted. Admin only (the quotation is Puja's call). */
export async function freezeQuotation(
  docketId: number,
  input: { quotedOn?: unknown; status?: unknown; note?: unknown; sentTo?: unknown; prices?: Record<number, string> },
  user: AuthUser,
) {
  if (user.role !== 'Admin') throw new UserError('Only an Admin can freeze a quotation.');
  const quotedOn = isYmd(input.quotedOn) ? input.quotedOn : ymd(new Date());
  const status = (SNAPSHOT_STATUSES as readonly string[]).includes(String(input.status)) ? String(input.status) : 'SENT';
  const { docket, payload, total } = await buildPayload(docketId, quotedOn, input.prices);
  if (payload.items.length === 0) throw new UserError('The docket has no items to freeze.');
  // C6: a typed (manual, not system-costed) price must be approved by an Admin before the offer is frozen.
  const items = await prisma.itemTable.findMany({ where: { id: { in: payload.items.map((i) => i.itemId) } }, select: { id: true, price: true, priceSource: true, priceApprovedBy: true, itemNameParty: true } });
  const manual = await manualPrices(items);
  const pending = items.filter((i) => manual[i.id] && !manual[i.id].approvedBy && !(input.prices && input.prices[i.id]));
  if (pending.length) throw new UserError(`Manual price(s) not approved by an Admin: ${pending.map((i) => `#${i.id} ${(i.itemNameParty ?? '').slice(0, 40)}`).join('; ')}. Approve them on the docket first.`);
  return prisma.$transaction(async (tx) => {
    const last = await tx.quotationSnapshot.findFirst({ where: { docketId }, orderBy: { rev: 'desc' }, select: { rev: true } });
    const rev = last ? last.rev + 1 : 0;
    const s = await tx.quotationSnapshot.create({
      data: {
        docketId,
        docketNo: docket.docketNoQtnNo,
        rev,
        quotedOn: new Date(`${quotedOn}T00:00:00Z`),
        status,
        note: typeof input.note === 'string' ? input.note.slice(0, 1000) || null : null,
        sentTo: typeof input.sentTo === 'string' ? input.sentTo.slice(0, 300) || null : null,
        totalValue: Math.round(total * 100) / 100,
        payload: payload as unknown as Prisma.InputJsonValue,
        createdById: user.id,
        createdByName: user.name,
      },
    });
    await tx.editLog.create({
      data: {
        tableName: 'quotation_snapshots',
        recordId: s.id,
        fieldName: 'ALL_FIELDS',
        oldValue: 'NONE (New Record)',
        newValue: JSON.stringify({ docketId, rev, quotedOn, status, items: payload.items.length, total: s.totalValue?.toNumber() ?? null }),
        ...auditUser(user),
      },
    });
    return { id: s.id, rev };
  });
}

export interface SnapshotRow {
  id: number;
  rev: number;
  quotedOn: string;
  status: string;
  note: string | null;
  sentTo: string | null;
  totalValue: number | null;
  createdByName: string | null;
  createdAt: string;
  items: SnapshotItem[];
  rateCount: number;
}

/** Costing history of a docket: every frozen revision, newest first, and the live prices to compare. */
export async function quotationHistory(docketId: number) {
  const rows = await prisma.quotationSnapshot.findMany({ where: { docketId }, orderBy: { rev: 'desc' } });
  const live = await buildPayload(docketId, ymd(new Date()));
  const snapshots: SnapshotRow[] = rows.map((r) => {
    const p = r.payload as unknown as SnapshotPayload;
    return {
      id: r.id,
      rev: r.rev,
      quotedOn: ymd(r.quotedOn),
      status: r.status,
      note: r.note,
      sentTo: r.sentTo,
      totalValue: r.totalValue ? r.totalValue.toNumber() : null,
      createdByName: r.createdByName,
      createdAt: r.createdAt.toISOString(),
      items: p.items ?? [],
      rateCount: p.rates?.length ?? 0,
    };
  });
  return { snapshots, live: live.payload.items, liveTotal: Math.round(live.total * 100) / 100 };
}
