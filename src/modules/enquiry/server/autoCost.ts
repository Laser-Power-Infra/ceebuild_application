import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { AuthUser } from '@/lib/auth/server';
import { normalizeDocketNo } from '@/lib/dockets';
import { toNum } from '@/lib/bom/parse';
import { createBomFromDrawing } from '@/modules/costing/server/itemBom';
import { lastQuoted, saveCosting } from '@/modules/costing/server/compute';

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
      const last = await lastQuoted(null, it.ourItemName);
      if (last) {
        const q = toNum(it.qty);
        lines.push({ ...base, basis: 'LAST_QUOTED', rate: last.value, rateUnit: 'Rs/kg', total: q !== null && /^(KG|KGS)$/i.test(it.uom ?? '') ? Math.round(q * last.value * 100) / 100 : null, note: `ESTIMATE: last quoted Rs ${last.value}/kg (${last.ref}) – subject to drawing / BOM` });
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
 * Every docket (typed on the dashboard or made from a mail): items without a price get one right away.
 *   1. a BOM exists        -> costed with the Costing Master and APPLIED (item price = costing price)
 *   2. same item quoted before in the same unit (Rs/SQM, Rs/set, Rs/kg ...) -> that price, logged as ESTIMATE
 *   3. structure costed before (Rs/kg)       -> that rate for a KG item, logged as ESTIMATE
 * Nothing found: the price stays empty ("BOM / drawing needed"). Prices already typed are never changed.
 */
export async function autoPriceDocket(docketNo: string | null | undefined, user: AuthUser = SYSTEM) {
  const no = docketNo ? normalizeDocketNo(docketNo) : null;
  if (!no) return { priced: 0, open: 0 };
  const items = await prisma.itemTable.findMany({ where: { docketNoQtnNo: no, OR: [{ price: null }, { price: '' }] }, orderBy: { id: 'asc' } });
  const quoteDate = new Date().toISOString().slice(0, 10);
  let priced = 0;
  for (const it of items) {
    try {
      const bom = await prisma.itemBom.findFirst({ where: { itemId: it.id }, orderBy: { id: 'desc' } });
      if (bom) {
        const c = await saveCosting(bom.id, { quoteDate, apply: true }, user);
        if (c.applied) {
          priced++;
          continue;
        }
      }
      if (!it.ourItemName) continue;
      const unit = (it.uomOfQtn || it.uom || '').trim();
      // The same item quoted before in the same unit (e.g. DTR fencing Rs/SQM).
      const prev = unit
        ? await prisma.itemTable.findFirst({
            where: {
              id: { not: it.id },
              ourItemName: { equals: it.ourItemName, mode: 'insensitive' },
              price: { not: null },
              NOT: { price: '' },
              OR: [{ uomOfQtn: { equals: unit, mode: 'insensitive' } }, { uomOfQtn: null, uom: { equals: unit, mode: 'insensitive' } }],
            },
            orderBy: { id: 'desc' },
            select: { price: true, docketNoQtnNo: true },
          })
        : null;
      let price: number | null = toNum(prev?.price);
      let ref = prev ? `${prev.docketNoQtnNo ?? 'earlier docket'}` : '';
      let uomOfQtn = unit || null;
      if (!(price && price > 0) && /^(KG|KGS)$/i.test(unit)) {
        const last = await lastQuoted(null, it.ourItemName);
        if (last) {
          price = last.value;
          ref = last.ref;
          uomOfQtn = 'KG';
        }
      }
      if (!(price && price > 0)) continue;
      await prisma.$transaction([
        prisma.itemTable.update({ where: { id: it.id }, data: { price: String(price), uomOfQtn } }),
        prisma.editLog.create({
          data: { tableName: 'iteam-table', recordId: it.id, fieldName: 'price', oldValue: null, newValue: `${price} per ${uomOfQtn ?? 'unit'} (AUTO ESTIMATE: last quoted, ${ref} – check)`, userId: user.id || null, userName: user.name },
        }),
      ]);
      priced++;
    } catch (e) {
      console.error('[auto price]', no, it.id, (e as Error).message);
    }
  }
  return { priced, open: items.length - priced };
}
