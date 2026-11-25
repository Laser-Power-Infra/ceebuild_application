import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { auditUser, type AuthUser } from '@/lib/auth/server';
import { UserError } from '@/lib/actionResult';
import { toNum } from '@/lib/bom/parse';
import { normalizeDocketNo } from '@/lib/dockets';
import { computeCosting, setsFromItem, wastageFromPlan, type BillingBasis, type CostLineInput, type CostResult, type DiscountInput, type LoadBasis } from '@/lib/costing/calc';
import { classifyFab } from '@/lib/costing/fab';
import { planIndent, type PlanPiece, type SectionInfo } from '@/lib/planning/cutting';
import { getPlanSettings } from '@/modules/settings/server';
import { cutSettingsOf } from '@/modules/rm/server/common';
import { allRates } from './master';
import { loadItem } from './itemBom';

const dec = (d: Prisma.Decimal | null) => (d === null ? null : d.toNumber());
const today = () => new Date().toISOString().slice(0, 10);
const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export interface CostingPreview {
  bomId: number;
  bomStatus: string;
  quoteDate: string;
  itemQty: number | null;
  itemUom: string | null;
  /** SETS = given; WEIGHT = item kg / set weight; STRUCTURES = mixed BOM, each structure's own count. */
  setsBasis: 'SETS' | 'WEIGHT' | 'UNKNOWN' | 'STRUCTURES';
  destState: string | null;
  planNote: string | null;
  /** Net weight by section (all supplied structure pieces), for checking against a take-off. */
  sectionWeights: { key: string; label: string; kg: number; billableKg: number; inGtp: boolean; approved: boolean }[];
  netKg: number;
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
export async function previewCosting(bomId: number, opts: { vaPct?: number | null; quoteDate?: string | null; discount?: DiscountInput | null }): Promise<CostingPreview> {
  const bom = await prisma.itemBom.findUnique({ where: { id: bomId }, include: { lines: { orderBy: { rowNo: 'asc' } }, groups: { orderBy: { seq: 'asc' } } } });
  if (!bom) throw new UserError('BOM not found.');
  const { item, docket } = await loadItem(bom.itemId);
  const quoteDate = opts.quoteDate && /^\d{4}-\d{2}-\d{2}$/.test(opts.quoteDate) ? opts.quoteDate : today();

  const keys = [...new Set(bom.lines.map((l) => l.sectionKey).filter((k): k is string => !!k))];
  const [sections, purchase, rates, settings] = await Promise.all([
    prisma.sectionMaster.findMany({ where: { sectionKey: { in: keys } }, select: { sectionKey: true, label: true, kgPerM: true, maxBarMm: true, approved: true } }),
    prisma.rmPurchaseItem.findMany({ where: { active: true }, select: { sectionKey: true, label: true } }),
    allRates(),
    getPlanSettings(),
  ]);
  const sectionKgm = Object.fromEntries(sections.map((s) => [s.sectionKey, s.kgPerM.toNumber()]));
  const purchaseItems = Object.fromEntries(purchase.map((p) => [p.sectionKey, p.label]));

  // Structures: a mixed BOM takes each structure's own set count; a single structure with no count
  // takes it from the item quantity (kg / MT divided by the set weight, or nos / sets as given).
  const groups = bom.groups;
  const mixed = groups.length > 1;
  const groupOf = new Map(groups.map((g) => [g.id, g]));
  const toLine = (l: (typeof bom.lines)[number], sets: number | null): CostLineInput => {
    const g = l.groupId ? groupOf.get(l.groupId) : undefined;
    return {
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
      sets,
      group: mixed ? (g ? `${g.seq}. ${g.name}` : 'No structure') : null,
      // Fabrication category: set by hand on the line, else from section / description / item type.
      fabCat: l.fabCat ?? classifyFab({ sectionKey: l.sectionKey, section: l.section, description: l.description, lengthMm: l.lengthMm, structureType: g?.name ?? bom.structureType }),
    };
  };
  // Freight goes to the site: the delivery state when set (billing state stays for GST), else the state.
  const base = {
    galvanised: bom.galvanised,
    painted: bom.painted,
    billingBasis: bom.billingBasis as BillingBasis,
    destState: docket?.deliveryState || docket?.state || null,
    quoteDate,
    sectionKgm,
    purchaseItems,
    rates,
    load: { basis: (bom.loadBasis === 'SPACE' ? 'SPACE' : 'WEIGHT') as LoadBasis, setsPerTruck: dec(bom.setsPerTruck) },
  };
  const qty = toNum(item.qty);
  let setsBasis: CostingPreview['setsBasis'];
  let lines: CostLineInput[];
  if (mixed) {
    setsBasis = 'STRUCTURES';
    lines = bom.lines.map((l) => {
      const g = l.groupId ? groupOf.get(l.groupId) : undefined;
      return toLine(l, g ? dec(g.sets) : null);
    });
  } else {
    const given = groups[0] ? dec(groups[0].sets) : null;
    if (given !== null) {
      setsBasis = 'SETS';
      lines = bom.lines.map((l) => toLine(l, given));
    } else {
      // Weight of one set on the billing basis (billable lines only), to turn a KG/MT quantity into sets.
      const oneSet = computeCosting({ ...base, lines: bom.lines.map((l) => toLine(l, 1)), vaPct: opts.vaPct ?? null, planWastagePct: {} });
      const setWt = oneSet.groups[0]?.billedWtPerSet ?? 0;
      const d = setsFromItem(qty, item.uom, setWt);
      setsBasis = d.basis;
      lines = bom.lines.map((l) => toLine(l, d.sets));
    }
  }

  // Wastage from the cutting plan (6 m standard / exact-multiple custom lengths, Planning Settings),
  // on the actual quantities of every structure (non-billable pieces are cut too).
  let planWastagePct: Record<string, number> = {};
  let planNote: string | null = null;
  const pieces: PlanPiece[] = [];
  const info: Record<string, SectionInfo> = {};
  for (const l of lines) {
    if (l.category !== 'STRUCTURE' || l.scope !== 'IN_SCOPE' || !l.sectionKey || !l.lengthMm || !(l.qtyPerSet && l.qtyPerSet > 0) || !(l.sets && l.sets > 0)) continue;
    const kgm = sectionKgm[l.sectionKey] ?? l.kgPerM;
    if (!kgm || !purchaseItems[l.sectionKey]) continue;
    const s = sections.find((x) => x.sectionKey === l.sectionKey);
    info[l.sectionKey] = { label: s?.label ?? l.section ?? l.sectionKey, kgPerM: kgm, maxBarMm: s?.maxBarMm ?? null };
    pieces.push({ markNo: l.markNo || `ROW ${l.rowNo}`, sectionKey: l.sectionKey, lengthMm: l.lengthMm, qty: Math.ceil(l.qtyPerSet * l.sets - 1e-9) });
  }
  if (pieces.length) {
    try {
      const plan = planIndent(pieces, info, cutSettingsOf(settings), 'MIXED');
      // Sections needing fewer bars than the custom-length minimum take the master default wastage.
      planWastagePct = wastageFromPlan(plan.sections, settings.customMinBars);
      planNote = `Wastage from the cutting plan on the BOM quantities (sections needing under ${settings.customMinBars} bars use the master default), Mixed (custom exact-multiple + ${settings.stdBarMm} mm) bars, end allowance ${settings.endAllowanceMm} mm, kerf ${settings.kerfMm} mm${settings.confirmed ? '' : ' – Planning Settings not yet confirmed by the plant'}.`;
    } catch (e) {
      planNote = `Cutting plan could not run (${e instanceof Error ? e.message : 'error'}); master/default wastage used.`;
    }
  }

  const last = await lastQuoted(bom.structureType, item.ourItemName);
  const result = computeCosting({ ...base, lines, vaPct: opts.vaPct ?? null, planWastagePct, lastPricePerKg: last, planConfirmed: settings.confirmed, discount: opts.discount ?? null });

  // Section-wise weight (net, all supplied pieces) for checking against an independent take-off.
  const bySection = new Map<string, { label: string; kg: number; billableKg: number; inGtp: boolean; approved: boolean }>();
  for (const l of result.lines) {
    if (l.category !== 'STRUCTURE' || !(l.sets > 0) || !l.kgPerM) continue;
    const src = lines.find((x) => x.rowNo === l.rowNo)!;
    const k = src.sectionKey ?? '?';
    const sec = sections.find((s) => s.sectionKey === k);
    const kg = (src.qtyPerSet ?? 0) * ((src.lengthMm ?? 0) / 1000) * l.kgPerM * l.sets;
    const cur = bySection.get(k) ?? { label: sec?.label ?? src.section ?? k, kg: 0, billableKg: 0, inGtp: !!sec, approved: !!sec?.approved };
    cur.kg += kg;
    if (!src.nonBillable) cur.billableKg += kg;
    bySection.set(k, cur);
  }
  // Weight of lines flagged before a kg/m was known (e.g. section not in the GTP) still counts, from the drawing's kg/m.
  for (const src of lines) {
    const res = result.lines.find((x) => x.rowNo === src.rowNo)!;
    if (src.category !== 'STRUCTURE' || res.kgPerM || !src.kgPerM || !(src.sets && src.sets > 0)) continue;
    const k = src.sectionKey ?? '?';
    const cur = bySection.get(k) ?? { label: `${src.section ?? k} (drawing kg/m)`, kg: 0, billableKg: 0, inGtp: false, approved: false };
    const kg = (src.qtyPerSet ?? 0) * ((src.lengthMm ?? 0) / 1000) * src.kgPerM * src.sets;
    cur.kg += kg;
    if (!src.nonBillable) cur.billableKg += kg;
    bySection.set(k, cur);
  }
  const sectionWeights = [...bySection.entries()]
    .map(([key, v]) => ({ key, label: v.label, kg: r3(v.kg), billableKg: r3(v.billableKg), inGtp: v.inGtp, approved: v.approved }))
    .sort((a, b) => b.kg - a.kg);
  const netKg = r3(sectionWeights.reduce((a, s) => a + s.kg, 0));

  const notApproved = sectionWeights.filter((s) => s.inGtp && !s.approved);
  if (notApproved.length) result.checks.messages.push(`Section(s) not in the approved GTP (flag – confirm with the client): ${notApproved.map((s) => `${s.label} ${r3(s.kg / 1000)} MT`).join(', ')}.`);
  const u = String(item.uom ?? '').trim().toUpperCase();
  const qtyKg = qty === null ? null : /^(MT|TON|TONNE|TONNES|MTS)$/.test(u) ? qty * 1000 : /^(KG|KGS)$/.test(u) ? qty : null;
  if (mixed && qtyKg) {
    const pct = r2(((netKg - qtyKg) / qtyKg) * 100);
    result.checks.messages.push(`BOM net weight ${r3(netKg / 1000)} MT (billable ${r3(result.structure.billedWtKg / 1000)} MT) vs item quantity ${r3(qtyKg / 1000)} MT (${pct > 0 ? '+' : ''}${pct}%).`);
  }
  if (setsBasis === 'UNKNOWN') result.checks.messages.push('Item quantity is blank: totals are for 0 sets.');
  if (bom.status !== 'CONFIRMED') result.checks.messages.push('BOM is still a draft: confirm it before applying the price.');
  if (bom.matchLevel === 'ANY_ITEM') result.checks.messages.push('BOM is from a reference-only drawing (other utility/state): confirm with the client.');
  return { bomId, bomStatus: bom.status, quoteDate, itemQty: qty, itemUom: item.uom, setsBasis, destState: base.destState, planNote, sectionWeights, netKg, result };
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
export async function saveCosting(
  bomId: number,
  opts: { vaPct?: number | null; quoteDate?: string | null; apply: boolean; note?: string; discount?: DiscountInput | null; vaApprovalReason?: string | null },
  user: AuthUser,
) {
  // Rev 2 §7: discount is Admin only and needs a reason.
  if (opts.discount) {
    if (user.role !== 'Admin') throw new UserError('Only an Admin can give a discount.');
    if (!opts.discount.reason?.trim()) throw new UserError('Give the reason for the discount.');
  }
  const p = await previewCosting(bomId, opts);
  const r = p.result;
  // Discount scales every price (per kg, per set, N&B, bought-out) to the final price.
  const f = r.discount ? r.discount.factor : 1;
  // VA band (25-11): below the minimum is blocked for everyone (checks.ok is false); between the
  // minimum and the default VA needs an Admin's approval with a reason, kept with the costing.
  const vaApproval =
    r.checks.vaNeedsApproval && opts.vaApprovalReason?.trim() ? { reason: opts.vaApprovalReason.trim().slice(0, 300), by: user.name, at: new Date().toISOString() } : null;
  if (opts.apply) {
    if (p.bomStatus !== 'CONFIRMED') throw new UserError('Confirm the BOM before applying the price.');
    if (r.checks.belowMinVa) throw new UserError(`VA ${r.checks.effectiveVaPct}% is below the minimum ${r.minVaPct}%: blocked.`);
    if (!r.checks.ok) throw new UserError(`Cannot apply: ${r.checks.messages.join(' ')}`);
    if (r.checks.vaNeedsApproval) {
      if (user.role !== 'Admin') throw new UserError(`VA ${r.checks.effectiveVaPct}% is below the default: an Admin must approve it.`);
      if (!vaApproval) throw new UserError(`VA ${r.checks.effectiveVaPct}% is below the default: give the reason for the approval.`);
    }
  }
  const bom = await prisma.itemBom.findUnique({ where: { id: bomId }, select: { itemId: true, docketId: true, billingBasis: true } });
  const priceFields = (() => {
    if (!opts.apply) return null;
    const u = String(p.itemUom ?? '').trim().toUpperCase();
    const perMt = /^(MT|TON|TONNE|TONNES|MTS)$/.test(u);
    // Per kg for weight items and mixed BOMs; per set only for a single structure quoted in sets.
    const perKg = p.setsBasis === 'WEIGHT' || p.setsBasis === 'STRUCTURES' || !r.perSet;
    const billed = r.perSet && !perKg ? (r.groups[0]?.billedWtPerSet ?? 0) : r.perSet ? (r.groups[0]?.billedWtPerSet ?? 0) : r.structure.billedWtKg;
    return {
      price: String(perMt ? r2(r.structure.sellPerKg * f * 1000) : perKg ? r2(r.structure.sellPerKg * f) : r2(r.perSet!.sell * f)),
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
        sets: r.sets ?? r.totalSets,
        blackWtKg: r.structure.blackWtKg,
        galvWtKg: r.structure.galvWtKg,
        costTotal: r2(r.structure.cost + r.nutsBolts.cost + r.boughtOut.cost),
        // Final (after discount) prices; the detail JSON keeps the price before discount and the discount.
        sellTotal: r.discount ? r.discount.finalPrice : r.grandSell,
        sellPerKg: r2(r.structure.sellPerKg * f),
        sellPerSet: r2((r.perSet?.sell ?? 0) * f),
        nbSellTotal: r2(r.nutsBolts.sell * f),
        boSellTotal: r2(r.boughtOut.sell * f),
        detail: { ...p, ratesUsed: r.ratesUsed } as unknown as Prisma.InputJsonValue,
        flags: { ...r.checks, vaApproval } as unknown as Prisma.InputJsonValue,
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
        newValue: JSON.stringify({
          bomId,
          quoteDate: p.quoteDate,
          vaPct: r.vaPct,
          sellPerKg: r2(r.structure.sellPerKg * f),
          sellTotal: r.discount ? r.discount.finalPrice : r.grandSell,
          discount: r.discount ? { mode: r.discount.mode, value: r.discount.value, amount: r.discount.amount, reason: r.discount.reason, effectiveVaPct: r.discount.effectiveVaPct } : null,
          vaApproval,
          applied: !!priceFields,
        }),
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
    docket: { id: docket.id, docketNo: docket.docketNoQtnNo, partyName: docket.partyName, utility: docket.utility, state: docket.state, deliveryLocation: docket.deliveryLocation, deliveryState: docket.deliveryState },
    rows,
    total,
  };
}
