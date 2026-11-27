import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { AuthUser } from '@/lib/auth/server';
import { normalizeDocketNo } from '@/lib/dockets';
import { toNum } from '@/lib/bom/parse';
import { createBomFromDrawing } from '@/modules/costing/server/itemBom';
import { saveCosting } from '@/modules/costing/server/compute';

// Rev 2 §2 E4-E5 (stage 2, first part): as soon as an enquiry docket exists, every item gets a draft
// price the same day, without waiting for missing inputs:
//   1. APPROVED_DRAWING - the enquiry line is the same structure as an approved drawing (the AI picked
//      its type): BOM copied from the drawing (DRAFT, to be checked) and costed with the Costing Master.
//   2. LAST_QUOTED - no drawing: the last price we quoted for the same item, marked ESTIMATE.
//   3. NONE - nothing to go on: listed as "needs BOM / drawing from the party".
// Nothing is applied to the quotation and nothing is sent: the result is stored on the enquiry row
// ("budgetary – subject to drawing / BOM") for Puja's approval.

const SYSTEM: AuthUser = { id: 0, username: 'enquiry-automation', name: 'Enquiry automation (n8n)', role: 'User' } as AuthUser;

export interface AutoCostLine {
  itemId: number;
  description: string | null;
  ourItemName: string | null;
  qty: string | null;
  uom: string | null;
  basis: 'APPROVED_DRAWING' | 'LAST_QUOTED' | 'NONE';
  drawing?: string | null;
  bomId?: number;
  costingId?: number;
  /** Rs per kg (structure) or per unit, before GST. */
  rate?: number | null;
  rateUnit?: string | null;
  total?: number | null;
  ok?: boolean;
  note: string;
}

export interface AutoCostResult {
  at: string;
  quoteDate: string;
  lines: AutoCostLine[];
  budgetary: boolean;
  total: number | null;
  needs: string[];
}

export async function autoCostEnquiry(intakeId: number): Promise<AutoCostResult | null> {
  const intake = await prisma.enquiryIntake.findUnique({ where: { id: intakeId } });
  if (!intake?.docketId) return null;
  const docket = await prisma.dockerPartyName.findUnique({ where: { id: intake.docketId } });
  if (!docket?.docketNoQtnNo) return null;
  const items = await prisma.itemTable.findMany({ where: { docketNoQtnNo: normalizeDocketNo(docket.docketNoQtnNo) }, orderBy: { id: 'asc' } });
  const raw = (intake.extracted ?? {}) as { items?: { description?: string; libraryType?: string | null }[] };
  const quoteDate = new Date().toISOString().slice(0, 10);
  const lines: AutoCostLine[] = [];
  for (const [i, it] of items.entries()) {
    const base = { itemId: it.id, description: it.itemNameParty, ourItemName: it.ourItemName, qty: it.qty, uom: it.uom };
    const libraryType = raw.items?.[i]?.libraryType?.trim() || null;
    try {
      const existing = await prisma.itemBom.findFirst({ where: { itemId: it.id }, orderBy: { id: 'desc' } });
      const drawing = !existing && libraryType ? await prisma.approvedDrawing.findFirst({ where: { status: 'APPROVED', itemType: libraryType }, orderBy: { approvalDate: 'desc' } }) : null;
      const bomId = existing?.id ?? (drawing ? (await createBomFromDrawing(it.id, drawing.id, libraryType, SYSTEM)).id : null);
      if (bomId) {
        const c = await saveCosting(bomId, { quoteDate, apply: false }, SYSTEM);
        const row = await prisma.itemCosting.findUnique({ where: { id: c.id } });
        const flags = (row?.flags ?? {}) as { ok?: boolean; messages?: string[] };
        const perKg = /^(KG|KGS|MT)$/i.test(it.uom ?? '') || !row?.sellPerSet || row.sellPerSet.toNumber() === 0;
        lines.push({
          ...base,
          basis: 'APPROVED_DRAWING',
          drawing: drawing ? `${drawing.drawingNo} rev ${drawing.revision}` : existing?.drawingRef ?? null,
          bomId,
          costingId: c.id,
          rate: row ? (perKg ? row.sellPerKg.toNumber() : row.sellPerSet.toNumber()) : null,
          rateUnit: perKg ? 'Rs/kg' : 'Rs/set',
          total: row ? row.sellTotal.toNumber() : null,
          ok: !!flags.ok,
          note: `Costed from the approved drawing (BOM is a DRAFT to check)${flags.ok ? '' : `; open points: ${(flags.messages ?? []).slice(0, 3).join(' ')}`}`,
        });
        continue;
      }
      const last = await sameItemQuoted(it);
      if (last) {
        const q = toNum(it.qty);
        const unitMatch = (it.uom ?? '').trim().toUpperCase() === last.unit;
        lines.push({ ...base, basis: 'LAST_QUOTED', rate: last.value, rateUnit: `Rs/${last.unit.toLowerCase()}`, total: q !== null && unitMatch ? Math.round(q * last.value * 100) / 100 : null, note: `ESTIMATE: same item last quoted Rs ${last.value}/${last.unit.toLowerCase()} (${last.ref}) – subject to drawing / BOM` });
        continue;
      }
      lines.push({ ...base, basis: 'NONE', note: 'No approved drawing or earlier price: BOM / drawing needed from the party' });
    } catch (e) {
      lines.push({ ...base, basis: 'NONE', note: `Could not cost: ${(e as Error).message.slice(0, 200)}` });
    }
  }
  const totals = lines.map((l) => l.total).filter((t): t is number => typeof t === 'number');
  const result: AutoCostResult = {
    at: new Date().toISOString(),
    quoteDate,
    lines,
    budgetary: lines.some((l) => l.basis !== 'APPROVED_DRAWING' || !l.ok),
    total: totals.length ? Math.round(totals.reduce((a, b) => a + b, 0) * 100) / 100 : null,
    needs: lines.filter((l) => l.basis === 'NONE').map((l) => `${l.description ?? 'item'}: BOM / drawing`),
  };
  await prisma.enquiryIntake.update({ where: { id: intakeId }, data: { autoCost: result as unknown as Prisma.InputJsonValue } });
  return result;
}

/**
 * Every docket (typed on the dashboard or made from a mail) gets DRAFT prices right away, Puja's rule
 * (Rev 2 §2 stage 2): nothing is put on the item or the quotation without approval.
 *   - docket made from an enquiry -> autoCostEnquiry (drawing BOM costing / last quoted ESTIMATE / needs BOM),
 *     shown on Quotation -> Enquiries.
 *   - item with a BOM             -> M14 costing saved NOT applied (item costing page: check, then Apply).
 * Item prices typed or applied by a person are never changed.
 */
export async function autoPriceDocket(docketNo: string | null | undefined, user: AuthUser = SYSTEM) {
  const no = docketNo ? normalizeDocketNo(docketNo) : null;
  if (!no) return { drafts: 0 };
  const docket = await prisma.dockerPartyName.findUnique({ where: { docketNoQtnNo: no }, select: { id: true } });
  const intake = docket ? await prisma.enquiryIntake.findFirst({ where: { docketId: docket.id }, orderBy: { id: 'desc' }, select: { id: true } }) : null;
  if (intake) {
    const r = await autoCostEnquiry(intake.id);
    return { drafts: r?.lines.filter((l) => l.basis !== 'NONE').length ?? 0 };
  }
  const items = await prisma.itemTable.findMany({ where: { docketNoQtnNo: no, OR: [{ price: null }, { price: '' }] }, orderBy: { id: 'asc' } });
  const quoteDate = new Date().toISOString().slice(0, 10);
  let drafts = 0;
  for (const it of items) {
    try {
      const bom = await prisma.itemBom.findFirst({ where: { itemId: it.id }, orderBy: { id: 'desc' } });
      if (!bom) continue;
      await saveCosting(bom.id, { quoteDate, apply: false }, user);
      drafts++;
    } catch (e) {
      console.error('[auto price draft]', no, it.id, (e as Error).message);
    }
  }
  return { drafts };
}

/** Puja's "last quoted" for a draft: the same material + size quoted before in the same unit (see itemKey). */
async function sameItemQuoted(it: { id: number; itemNameParty: string | null; uom: string | null; uomOfQtn: string | null; docketNoQtnNo: string | null }) {
  const key = itemKey(it.itemNameParty);
  const unit = (it.uomOfQtn || it.uom || '').trim().toUpperCase();
  if (!key || !unit) return null;
  const cands = await prisma.itemTable.findMany({
    where: {
      id: { not: it.id },
      docketNoQtnNo: { not: it.docketNoQtnNo },
      price: { not: null },
      NOT: { price: '' },
      OR: [{ uomOfQtn: { equals: unit, mode: 'insensitive' } }, { uomOfQtn: null, uom: { equals: unit, mode: 'insensitive' } }],
    },
    orderBy: { id: 'desc' },
    take: 3000,
    select: { price: true, docketNoQtnNo: true, itemNameParty: true },
  });
  const prev = cands.find((c) => itemKey(c.itemNameParty) === key);
  const v = toNum(prev?.price);
  return v && v > 0 ? { value: v, unit, ref: `${prev!.docketNoQtnNo ?? 'earlier docket'} "${String(prev!.itemNameParty).slice(0, 50)}"` } : null;
}

/**
 * Material + size key of an item line: "GI Flat 50x6 mm Riser" -> "GI|FLAT|50X6", "GI FLAT SIZE:50MM X 6MM (2\" x 1/4\")"
 * -> "GI|FLAT|50X6", "MS ANGLE ISA 5050 SIZE 50MM X 50MM X 6MM" -> "MS|ANGLE|50X50X6". Null when no shape or size is found.
 */
export function itemKey(name: string | null | undefined): string | null {
  const s = String(name ?? '').toUpperCase().replace(/\(.*?\)/g, ' ');
  const shape = s.match(/\b(FLAT|ANGLE|CHANNEL|ROD|PIPE|BEAM|STRIP|PLATE|BOLT|NUT|WASHER|CLAMP|FENCING|MESH)\b/)?.[1];
  if (!shape) return null;
  const m = s.match(/(\d+(?:\.\d+)?)\s*(?:MM)?\s*[X\*]\s*(\d+(?:\.\d+)?)(?:\s*(?:MM)?\s*[X\*]\s*(\d+(?:\.\d+)?))?/);
  if (!m) return null;
  const dims = [m[1], m[2], m[3]].filter(Boolean).map((d) => String(Number(d)));
  const coat = /\b(GI|GALV|GALVANI[SZ]ED|HDG)\b/.test(s) ? 'GI' : 'MS';
  // A line that is more than the bare section (with clamp, nuts & bolts, holding, support, assembly ...) is
  // a different product: "M.S. ANGLE 75X75X6 WITH HOLDING CLAMP, N & B" never prices a plain 75x75x6 angle.
  const extra = /\b(WITH|CLAMP|BOLT|BOLTS|NUT|NUTS|N\s*&\s*B|HOLDING|SUPPORT|ASSEMBL\w*|SET|STRUCTURE|FABRICATED)\b/.test(s.replace(shape, '')) ? '|+' : '';
  return `${coat}|${shape}|${dims.join('X')}${extra}`;
}

export interface DraftPrice {
  price: number;
  unit: string;
  /** M14_DRAFT = unapplied BOM costing, ENQUIRY = enquiry draft, ESTIMATE = same item last quoted. */
  source: 'M14_DRAFT' | 'ENQUIRY' | 'ESTIMATE';
  note: string;
}

/**
 * Draft prices for items that have no price yet, for the docket table (shown grey, never saved on the
 * item: Puja's rule - a price is applied only after approval). One query per source, not per item.
 */
export async function draftPrices(items: { id: number; itemNameParty: string | null; uom: string | null; uomOfQtn: string | null; price: string | null; docketNoQtnNo: string | null }[], docketIds: number[]) {
  const open = items.filter((i) => !String(i.price ?? '').trim());
  const out: Record<number, DraftPrice> = {};
  if (!open.length) return out;
  const ids = open.map((i) => i.id);
  const isKg = (u: string | null) => /^(KG|KGS|MT)$/i.test((u ?? '').trim());
  // 1. M14 costing saved but not applied (latest per item).
  const costs = await prisma.itemCosting.findMany({ where: { itemId: { in: ids }, applied: false }, orderBy: { id: 'desc' }, select: { id: true, itemId: true, sellPerKg: true, sellPerSet: true } });
  for (const c of costs) {
    if (out[c.itemId]) continue;
    const it = open.find((i) => i.id === c.itemId)!;
    const perKg = isKg(it.uomOfQtn || it.uom) || c.sellPerSet.toNumber() === 0;
    out[c.itemId] = { price: perKg ? c.sellPerKg.toNumber() : c.sellPerSet.toNumber(), unit: perKg ? 'KG' : (it.uomOfQtn || it.uom || 'SET').toUpperCase(), source: 'M14_DRAFT', note: `M14 BOM costing #${c.id} (draft) – open the item costing and Apply` };
  }
  // 2. Enquiry draft (autoCost on the enquiry row).
  if (docketIds.length) {
    const intakes = await prisma.enquiryIntake.findMany({ where: { docketId: { in: docketIds }, NOT: { autoCost: { equals: Prisma.DbNull } } }, select: { autoCost: true } });
    for (const r of intakes)
      for (const l of ((r.autoCost as unknown as AutoCostResult | null)?.lines ?? [])) {
        if (out[l.itemId] || !ids.includes(l.itemId) || !(typeof l.rate === 'number' && l.rate > 0)) continue;
        out[l.itemId] = { price: l.rate, unit: String(l.rateUnit ?? '').replace(/^Rs\//i, '').toUpperCase() || 'KG', source: 'ENQUIRY', note: l.note };
      }
  }
  // 3. Same material + size last quoted in the same unit.
  const rest = open.filter((i) => !out[i.id] && itemKey(i.itemNameParty));
  if (rest.length) {
    const priced = await prisma.itemTable.findMany({ where: { price: { not: null }, NOT: { price: '' } }, orderBy: { id: 'desc' }, take: 5000, select: { itemNameParty: true, price: true, uom: true, uomOfQtn: true, docketNoQtnNo: true } });
    const best = new Map<string, { price: number; ref: string }>();
    for (const p of priced) {
      const k = itemKey(p.itemNameParty);
      const v = toNum(p.price);
      if (!k || !(v && v > 0)) continue;
      const any = `${k}#${(p.uomOfQtn || p.uom || '').trim().toUpperCase()}`;
      if (!best.has(any)) best.set(any, { price: v, ref: `${p.docketNoQtnNo ?? 'earlier docket'} "${String(p.itemNameParty).slice(0, 50)}"` });
    }
    for (const it of rest) {
      const unit = (it.uomOfQtn || it.uom || '').trim().toUpperCase();
      const hit = best.get(`${itemKey(it.itemNameParty)}#${unit}`);
      if (hit && !String(hit.ref).startsWith(String(it.docketNoQtnNo))) out[it.id] = { price: hit.price, unit, source: 'ESTIMATE', note: `ESTIMATE: same item last quoted in ${hit.ref} – subject to BOM / approval` };
    }
  }
  return out;
}
