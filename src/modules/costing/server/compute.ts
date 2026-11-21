import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { auditUser, type AuthUser } from '@/lib/auth/server';
import { UserError } from '@/lib/actionResult';
import { toNum } from '@/lib/bom/parse';
import { normalizeDocketNo } from '@/lib/dockets';
import { computeCosting, setsFromItem, wastageFromPlan, type BillingBasis, type CostLineInput, type CostResult } from '@/lib/costing/calc';
import { planIndent, type PlanPiece, type SectionInfo } from '@/lib/planning/cutting';
import { getPlanSettings } from '@/modules/settings/server';
import { cutSettingsOf } from '@/modules/rm/server/common';
import { allRates } from './master';
import { loadItem } from './itemBom';

const dec = (d: Prisma.Decimal | null) => (d === null ? null : d.toNumber());
const today = () => new Date().toISOString().slice(0, 10);
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface CostingPreview {
  bomId: number;
  bomStatus: string;
  quoteDate: string;
  itemQty: number | null;
  itemUom: string | null;
  setsBasis: 'SETS' | 'WEIGHT' | 'UNKNOWN';
  destState: string | null;
  planNote: string | null;
  result: CostResult;
}

export interface SavedCosting {
  id: number;
  quoteDate: string;
  vaPct: number;
  billingBasis: string;
  sets: number;
  sellPerKg: number;
  sellPerSet: number;
  sellTotal: number;
  nbSellTotal: number;
  boSellTotal: number;
  applied: boolean;
  appliedAt: string | null;
  createdByName: string | null;
  createdAt: string;
  okToApply: boolean;
}

/** Last quoted structure price per kg for the same item type on another docket (variance check). */
async function lastQuoted(structureType: string | null, ourItemName: string | null): Promise<{ value: number; ref: string } | null> {
  const type = structureType || ourItemName;
  if (!type) return null;
  const rows = await prisma.$queryRaw<{ sell_per_kg: Prisma.Decimal; docket_no: string | null; created_at: Date }[]>`
    SELECT c.sell_per_kg, d.docket_no_qtn_no AS docket_no, c.created_at
    FROM item_costings c JOIN item_boms b ON b.id = c.bom_id
    LEFT JOIN "docket-party-name" d ON d.id = c.docket_id
    WHERE c.applied AND upper(coalesce(b.structure_type, '')) = upper(${type})
    ORDER BY c.applied_at DESC NULLS LAST, c.id DESC LIMIT 1`;
  if (rows[0]) return { value: rows[0].sell_per_kg.toNumber(), ref: `${rows[0].docket_no ?? 'docket'} on ${rows[0].created_at.toISOString().slice(0, 10)}` };
  // Fall back to the last price typed by hand for the same item type, this item included (per kg only).
  if (!ourItemName) return null;
  const prev = await prisma.itemTable.findFirst({
    where: { ourItemName: { equals: ourItemName, mode: 'insensitive' }, price: { not: null }, OR: [{ uomOfQtn: { equals: 'KG', mode: 'insensitive' } }, { uom: { equals: 'KG', mode: 'insensitive' } }] },
    orderBy: { id: 'desc' },
    select: { price: true, docketNoQtnNo: true },
  });
  const v = toNum(prev?.price);
  return v && v > 0 ? { value: v, ref: `${prev!.docketNoQtnNo ?? 'earlier docket'} (typed price)` } : null;
}

/** Everything the calculator needs, from the BOM, the masters and the docket. */
export async function previewCosting(bomId: number, opts: { vaPct?: number | null; quoteDate?: string | null }): Promise<CostingPreview> {
  const bom = await prisma.itemBom.findUnique({ where: { id: bomId }, include: { lines: { orderBy: { rowNo: 'asc' } } } });
  if (!bom) throw new UserError('BOM not found.');
  const { item, docket } = await loadItem(bom.itemId);
  const quoteDate = opts.quoteDate && /^\d{4}-\d{2}-\d{2}$/.test(opts.quoteDate) ? opts.quoteDate : today();

  const keys = [...new Set(bom.lines.map((l) => l.sectionKey).filter((k): k is string => !!k))];
  const [sections, purchase, rates, settings] = await Promise.all([
    prisma.sectionMaster.findMany({ where: { sectionKey: { in: keys } }, select: { sectionKey: true, label: true, kgPerM: true, maxBarMm: true } }),
    prisma.rmPurchaseItem.findMany({ where: { active: true }, select: { sectionKey: true, label: true } }),
    allRates(),
    getPlanSettings(),
  ]);
  const sectionKgm = Object.fromEntries(sections.map((s) => [s.sectionKey, s.kgPerM.toNumber()]));
  const purchaseItems = Object.fromEntries(purchase.map((p) => [p.sectionKey, p.label]));

  const lines: CostLineInput[] = bom.lines.map((l) => ({
    rowNo: l.rowNo,
    markNo: l.markNo,
    description: l.description,
    section: l.section,
    sectionKey: l.sectionKey,
    lengthMm: l.lengthMm,
    qtyPerSet: dec(l.qtyPerSet),
    kgPerM: dec(l.kgPerM),
    unitWtKg: dec(l.unitWtKg),
    category: l.category,
    scope: l.scope,
    nonBillable: l.nonBillable,
    rateKey: l.rateKey,
  }));

  // Weight of one set on the billing basis, to turn a KG/MT item quantity into sets.
  const base = { lines, fabType: bom.fabType, galvanised: bom.galvanised, billingBasis: bom.billingBasis as BillingBasis, destState: docket?.deliveryLocation || docket?.state || null, quoteDate, sectionKgm, purchaseItems, rates };
  const oneSet = computeCosting({ ...base, sets: 1, vaPct: opts.vaPct ?? null, planWastagePct: {} });
  const setWt = bom.billingBasis === 'GALV' ? oneSet.perSet.galvWtKg : oneSet.perSet.blackWtKg;
  const qty = toNum(item.qty);
  const { sets, basis } = setsFromItem(qty, item.uom, setWt);

  // Wastage from the cutting plan (6 m standard / exact-multiple custom lengths, Planning Settings).
  let planWastagePct: Record<string, number> = {};
  let planNote: string | null = null;
  const planSets = Math.max(1, Math.ceil(sets || 1));
  const pieces: PlanPiece[] = [];
  const info: Record<string, SectionInfo> = {};
  for (const l of lines) {
    if (l.category !== 'STRUCTURE' || l.scope !== 'IN_SCOPE' || l.nonBillable || !l.sectionKey || !l.lengthMm || !(l.qtyPerSet && l.qtyPerSet > 0)) continue;
    const kgm = sectionKgm[l.sectionKey] ?? l.kgPerM;
    if (!kgm || !purchaseItems[l.sectionKey]) continue;
    const s = sections.find((x) => x.sectionKey === l.sectionKey);
    info[l.sectionKey] = { label: s?.label ?? l.section ?? l.sectionKey, kgPerM: kgm, maxBarMm: s?.maxBarMm ?? null };
    pieces.push({ markNo: l.markNo || `ROW ${l.rowNo}`, sectionKey: l.sectionKey, lengthMm: l.lengthMm, qty: Math.ceil(l.qtyPerSet * planSets) });
  }
  if (pieces.length) {
    try {
      const plan = planIndent(pieces, info, cutSettingsOf(settings), 'MIXED');
      planWastagePct = wastageFromPlan(plan.sections);
      planNote = `Wastage from the cutting plan for ${planSets} set(s), Mixed (custom exact-multiple + ${settings.stdBarMm} mm) bars${settings.confirmed ? '' : '; Planning Settings not yet confirmed by the plant'}.`;
    } catch (e) {
      planNote = `Cutting plan could not run (${e instanceof Error ? e.message : 'error'}); master/default wastage used.`;
    }
  }

  const last = await lastQuoted(bom.structureType, item.ourItemName);
  const result = computeCosting({ ...base, sets, vaPct: opts.vaPct ?? null, planWastagePct, lastPricePerKg: last });
  if (basis === 'UNKNOWN') result.checks.messages.push('Item quantity is blank: totals are for 0 sets.');
  if (bom.status !== 'CONFIRMED') result.checks.messages.push('BOM is still a draft: confirm it before applying the price.');
  if (bom.matchLevel === 'ANY_ITEM') result.checks.messages.push('BOM is from a reference-only drawing (other utility/state): confirm with the client.');
  return { bomId, bomStatus: bom.status, quoteDate, itemQty: qty, itemUom: item.uom, setsBasis: basis, destState: base.destState, planNote, result };
}

export async function listCostings(itemId: number): Promise<SavedCosting[]> {
  const rows = await prisma.itemCosting.findMany({ where: { itemId }, orderBy: { id: 'desc' }, take: 20 });
  return rows.map((c) => ({
    id: c.id,
    quoteDate: c.quoteDate.toISOString().slice(0, 10),
    vaPct: c.vaPct.toNumber(),
    billingBasis: c.billingBasis,
    sets: c.sets.toNumber(),
    sellPerKg: c.sellPerKg.toNumber(),
    sellPerSet: c.sellPerSet.toNumber(),
    sellTotal: c.sellTotal.toNumber(),
    nbSellTotal: c.nbSellTotal.toNumber(),
    boSellTotal: c.boSellTotal.toNumber(),
    applied: c.applied,
    appliedAt: c.appliedAt?.toISOString() ?? null,
    createdByName: c.createdByName,
    createdAt: c.createdAt.toISOString(),
    okToApply: !!(c.flags as { ok?: boolean } | null)?.ok,
  }));
}

export async function costingDetail(id: number) {
  const c = await prisma.itemCosting.findUnique({ where: { id } });
  if (!c) throw new UserError('Costing not found.');
  return { id: c.id, quoteDate: c.quoteDate.toISOString().slice(0, 10), detail: c.detail as unknown as CostingPreview, createdByName: c.createdByName };
}

/**
 * Save the costing (rates snapshot + result). With `apply`, also write the selling price to the
 * quotation item so it flows into the offer PDF: per kg for KG/MT items, per set otherwise.
 * Applying needs a confirmed BOM and no blank weight/rate; below-minimum VA needs an Admin.
 */
export async function saveCosting(bomId: number, opts: { vaPct?: number | null; quoteDate?: string | null; apply: boolean; note?: string }, user: AuthUser) {
  const p = await previewCosting(bomId, opts);
  const r = p.result;
  if (opts.apply) {
    if (p.bomStatus !== 'CONFIRMED') throw new UserError('Confirm the BOM before applying the price.');
    if (!r.checks.ok) throw new UserError(`Cannot apply: ${r.checks.messages.join(' ')}`);
    if (r.checks.belowMinVa && user.role !== 'Admin') throw new UserError(`VA ${r.vaPct}% is below the minimum ${r.minVaPct}%. Only an Admin can apply it.`);
  }
  const bom = await prisma.itemBom.findUnique({ where: { id: bomId }, select: { itemId: true, docketId: true, billingBasis: true } });
  const priceFields = (() => {
    if (!opts.apply) return null;
    const u = String(p.itemUom ?? '').trim().toUpperCase();
    const perMt = /^(MT|TON|TONNE|TONNES|MTS)$/.test(u);
    const perKg = p.setsBasis === 'WEIGHT';
    const billed = bom!.billingBasis === 'GALV' ? r.perSet.galvWtKg : r.perSet.blackWtKg;
    return {
      price: String(perMt ? r2(r.structure.sellPerKg * 1000) : perKg ? r.structure.sellPerKg : r2(r.perSet.sell)),
      uomOfQtn: perMt ? 'MT' : perKg ? 'KG' : 'SET',
      weightPerPiece: String(billed),
    };
  })();

  return prisma.$transaction(async (tx) => {
    const c = await tx.itemCosting.create({
      data: {
        bomId,
        itemId: bom!.itemId,
        docketId: bom!.docketId,
        quoteDate: new Date(`${p.quoteDate}T00:00:00Z`),
        vaPct: r.vaPct,
        billingBasis: bom!.billingBasis,
        sets: r.sets,
        blackWtKg: r.structure.blackWtKg,
        galvWtKg: r.structure.galvWtKg,
        costTotal: r2(r.structure.cost + r.nutsBolts.cost + r.boughtOut.cost),
        sellTotal: r.grandSell,
        sellPerKg: r.structure.sellPerKg,
        sellPerSet: r.perSet.sell,
        nbSellTotal: r.nutsBolts.sell,
        boSellTotal: r.boughtOut.sell,
        detail: { ...p, ratesUsed: r.ratesUsed } as unknown as Prisma.InputJsonValue,
        flags: r.checks as unknown as Prisma.InputJsonValue,
        applied: !!priceFields,
        appliedAt: priceFields ? new Date() : null,
        createdById: user.id,
        createdByName: user.name,
      },
    });
    await tx.editLog.create({
      data: {
        tableName: 'item_costings',
        recordId: c.id,
        fieldName: 'ALL_FIELDS',
        oldValue: 'NONE (New Record)',
        newValue: JSON.stringify({ bomId, quoteDate: p.quoteDate, vaPct: r.vaPct, sellPerKg: r.structure.sellPerKg, sellTotal: r.grandSell, applied: !!priceFields }),
        ...auditUser(user),
      },
    });
    if (priceFields) {
      await tx.itemCosting.updateMany({ where: { itemId: bom!.itemId, id: { not: c.id }, applied: true }, data: { applied: false } });
      const item = await tx.itemTable.findUnique({ where: { id: bom!.itemId } });
      await tx.itemTable.update({ where: { id: bom!.itemId }, data: priceFields });
      const logs = (Object.keys(priceFields) as (keyof typeof priceFields)[])
        .filter((k) => String(item?.[k] ?? '') !== priceFields[k])
        .map((k) => ({ tableName: 'iteam-table', recordId: bom!.itemId, fieldName: k, oldValue: item?.[k] ?? null, newValue: `${priceFields[k]} (BOM costing #${c.id})`, ...auditUser(user) }));
      if (logs.length) await tx.editLog.createMany({ data: logs });
    }
    return { id: c.id, applied: !!priceFields };
  });
}

export interface DocketCostRow {
  itemId: number;
  itemNameParty: string | null;
  ourItemName: string | null;
  qty: string | null;
  uom: string | null;
  price: string | null;
  uomOfQtn: string | null;
  bomId: number | null;
  bomStatus: string | null;
  bomSource: string | null;
  drawingRef: string | null;
  matchLevel: string | null;
  costingId: number | null;
  sellPerKg: number | null;
  sellPerSet: number | null;
  sets: number | null;
  sellTotal: number | null;
  nbSellTotal: number | null;
  boSellTotal: number | null;
  vaPct: number | null;
  flags: { belowMinVa?: boolean; variancePct?: number | null; ok?: boolean } | null;
}

/** All items of a docket with their BOM and applied costing, for the docket summary. */
export async function docketCosting(docketId: number) {
  const docket = await prisma.dockerPartyName.findUnique({ where: { id: docketId } });
  if (!docket) throw new UserError('Docket not found.');
  const no = docket.docketNoQtnNo ? normalizeDocketNo(docket.docketNoQtnNo) : '';
  const items = no ? await prisma.itemTable.findMany({ where: { docketNoQtnNo: { equals: no, mode: 'insensitive' } }, orderBy: { id: 'asc' } }) : [];
  const ids = items.map((i) => i.id);
  const [boms, costings] = await Promise.all([
    prisma.itemBom.findMany({ where: { itemId: { in: ids } }, orderBy: { id: 'desc' } }),
    prisma.itemCosting.findMany({ where: { itemId: { in: ids }, applied: true }, orderBy: { id: 'desc' } }),
  ]);
  const rows: DocketCostRow[] = items.map((i) => {
    const b = boms.find((x) => x.itemId === i.id) ?? null;
    const c = costings.find((x) => x.itemId === i.id) ?? null;
    return {
      itemId: i.id,
      itemNameParty: i.itemNameParty,
      ourItemName: i.ourItemName,
      qty: i.qty,
      uom: i.uom,
      price: i.price,
      uomOfQtn: i.uomOfQtn,
      bomId: b?.id ?? null,
      bomStatus: b?.status ?? null,
      bomSource: b?.source ?? null,
      drawingRef: b?.drawingRef ?? null,
      matchLevel: b?.matchLevel ?? null,
      costingId: c?.id ?? null,
      sellPerKg: c ? c.sellPerKg.toNumber() : null,
      sellPerSet: c ? c.sellPerSet.toNumber() : null,
      sets: c ? c.sets.toNumber() : null,
      sellTotal: c ? c.sellTotal.toNumber() : null,
      nbSellTotal: c ? c.nbSellTotal.toNumber() : null,
      boSellTotal: c ? c.boSellTotal.toNumber() : null,
      vaPct: c ? c.vaPct.toNumber() : null,
      flags: (c?.flags as DocketCostRow['flags']) ?? null,
    };
  });
  const total = r2(rows.reduce((a, r) => a + (r.sellTotal ?? 0), 0));
  return {
    docket: { id: docket.id, docketNo: docket.docketNoQtnNo, partyName: docket.partyName, utility: docket.utility, state: docket.state, deliveryLocation: docket.deliveryLocation },
    rows,
    total,
  };
}
