import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { auditUser, type AuthUser } from '@/lib/auth/server';
import { UserError } from '@/lib/actionResult';
import { sectionKey, toNum } from '@/lib/bom/parse';
import { normalizeDocketNo } from '@/lib/dockets';
import { CATEGORIES, FAB_TYPES, SCOPES, normSubject } from '@/lib/costing/calc';
import { cleanLines, nbSize, rankDrawings, type BomLineDraft, type MatchLevel } from '@/lib/costing/drawings';
import { createDrawing, lineData } from './drawings';

type Tx = Prisma.TransactionClient;
const dec = (d: Prisma.Decimal | null) => (d === null ? null : d.toNumber());
const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export interface ItemInfo {
  id: number;
  docketNo: string | null;
  itemNameParty: string | null;
  ourItemName: string | null;
  ourItemNot: string | null;
  uom: string | null;
  qty: string | null;
  price: string | null;
  uomOfQtn: string | null;
}

export interface DocketInfo {
  id: number;
  docketNo: string | null;
  partyName: string | null;
  utility: string | null;
  state: string | null;
  deliveryLocation: string | null;
  type: string | null;
}

export interface BomLineRow {
  id: number;
  rowNo: number;
  markNo: string | null;
  description: string | null;
  section: string | null;
  sectionKey: string | null;
  lengthMm: number | null;
  qtyPerSet: number | null;
  kgPerM: number | null;
  unitWtKg: number | null;
  category: string;
  scope: string;
  nonBillable: boolean;
  rateKey: string | null;
}

export interface ItemBomInfo {
  id: number;
  source: string;
  drawingId: number | null;
  drawingRef: string | null;
  matchLevel: string | null;
  fileName: string | null;
  structureType: string | null;
  fabType: string;
  galvanised: boolean;
  billingBasis: string;
  status: string;
  extractNote: string | null;
  createdByName: string | null;
  createdAt: string;
  confirmedByName: string | null;
  confirmedAt: string | null;
  /** Approval details of the source drawing, if any. */
  drawing: { drawingNo: string; revision: string; approvalLetterNo: string | null; approvalDate: string | null; status: string; fileLink: string | null } | null;
  lines: BomLineRow[];
  versions: number;
}

export interface DrawingSuggestion {
  id: number;
  drawingNo: string;
  revision: string;
  utility: string;
  state: string | null;
  itemType: string;
  approvalLetterNo: string | null;
  approvalDate: string | null;
  level: MatchLevel;
  lineCount: number;
}

export async function loadItem(itemId: number) {
  const item = await prisma.itemTable.findUnique({ where: { id: itemId } });
  if (!item) throw new UserError('Docket item not found.');
  const no = item.docketNoQtnNo ? normalizeDocketNo(item.docketNoQtnNo) : '';
  const docket = no ? await prisma.dockerPartyName.findFirst({ where: { docketNoQtnNo: { equals: no, mode: 'insensitive' } } }) : null;
  return { item, docket };
}

export function itemInfo(item: Awaited<ReturnType<typeof loadItem>>['item']): ItemInfo {
  return {
    id: item.id,
    docketNo: item.docketNoQtnNo,
    itemNameParty: item.itemNameParty,
    ourItemName: item.ourItemName,
    ourItemNot: item.ourItemNot,
    uom: item.uom,
    qty: item.qty,
    price: item.price,
    uomOfQtn: item.uomOfQtn,
  };
}

export function docketInfo(d: Awaited<ReturnType<typeof loadItem>>['docket']): DocketInfo | null {
  return d ? { id: d.id, docketNo: d.docketNoQtnNo, partyName: d.partyName, utility: d.utility, state: d.state, deliveryLocation: d.deliveryLocation, type: d.type } : null;
}

export async function currentBom(itemId: number): Promise<ItemBomInfo | null> {
  const [bom, versions] = await Promise.all([
    prisma.itemBom.findFirst({ where: { itemId }, orderBy: { id: 'desc' }, include: { lines: { orderBy: { rowNo: 'asc' } }, drawing: true } }),
    prisma.itemBom.count({ where: { itemId } }),
  ]);
  if (!bom) return null;
  return {
    id: bom.id,
    source: bom.source,
    drawingId: bom.drawingId,
    drawingRef: bom.drawingRef,
    matchLevel: bom.matchLevel,
    fileName: bom.fileName,
    structureType: bom.structureType,
    fabType: bom.fabType,
    galvanised: bom.galvanised,
    billingBasis: bom.billingBasis,
    status: bom.status,
    extractNote: bom.extractNote,
    createdByName: bom.createdByName,
    createdAt: bom.createdAt.toISOString(),
    confirmedByName: bom.confirmedByName,
    confirmedAt: bom.confirmedAt?.toISOString() ?? null,
    drawing: bom.drawing
      ? { drawingNo: bom.drawing.drawingNo, revision: bom.drawing.revision, approvalLetterNo: bom.drawing.approvalLetterNo, approvalDate: ymd(bom.drawing.approvalDate), status: bom.drawing.status, fileLink: bom.drawing.fileLink }
      : null,
    lines: bom.lines.map((l) => ({
      id: l.id,
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
    })),
    versions,
  };
}

/** Approved drawings for this item in the M14 search order. */
export async function suggestDrawings(structureType: string | null, docket: DocketInfo | null): Promise<DrawingSuggestion[]> {
  if (!structureType) return [];
  const all = await prisma.approvedDrawing.findMany({ where: { status: 'APPROVED' }, include: { _count: { select: { lines: true } } } });
  const ranked = rankDrawings(
    all.map((d) => ({ ...d, approvalDate: ymd(d.approvalDate) })),
    { itemType: structureType, utility: docket?.utility ?? null, states: [docket?.state ?? null, docket?.deliveryLocation ?? null] },
  );
  return ranked.slice(0, 20).map(({ drawing: d, level }) => ({
    id: d.id,
    drawingNo: d.drawingNo,
    revision: d.revision,
    utility: d.utility,
    state: d.state,
    itemType: d.itemType,
    approvalLetterNo: d.approvalLetterNo,
    approvalDate: d.approvalDate,
    level,
    lineCount: d._count.lines,
  }));
}

/** Nuts & bolts and bought-out lines start tagged as such; everything starts In scope. */
function bomLineData(lines: BomLineDraft[]) {
  return lineData(lines).map((l) => ({ ...l, scope: l.category === 'BOUGHT_OUT' ? 'BOUGHT_OUT' : 'IN_SCOPE', nonBillable: false }));
}

async function newBom(
  tx: Tx,
  itemId: number,
  docketId: number | null,
  data: { source: string; drawingId?: number | null; drawingRef?: string | null; matchLevel?: string | null; fileName?: string | null; s3Key?: string | null; extractNote?: string | null; structureType: string | null },
  lines: BomLineDraft[],
  user: AuthUser,
) {
  // Carry the costing choices over from the previous version.
  const prev = await tx.itemBom.findFirst({ where: { itemId }, orderBy: { id: 'desc' }, select: { fabType: true, galvanised: true, billingBasis: true } });
  const bom = await tx.itemBom.create({
    data: {
      itemId,
      docketId,
      ...data,
      ...(prev ?? {}),
      createdById: user.id,
      createdByName: user.name,
      lines: { create: bomLineData(lines) },
    },
  });
  await tx.editLog.create({
    data: {
      tableName: 'item_boms',
      recordId: bom.id,
      fieldName: 'ALL_FIELDS',
      oldValue: 'NONE (New Record)',
      newValue: JSON.stringify({ itemId, docketId, source: data.source, drawingRef: data.drawingRef ?? null, matchLevel: data.matchLevel ?? null, fileName: data.fileName ?? null, lines: lines.length }),
      ...auditUser(user),
    },
  });
  return bom;
}

/** (a) BOM from the drawing that came with the enquiry (lines already checked by the user), or typed in. */
export async function createBomFromLines(
  itemId: number,
  input: { source: 'ENQUIRY_DRAWING' | 'MANUAL'; lines: unknown; fileName?: string | null; s3Key?: string | null; drawingRef?: string | null; note?: string | null; structureType?: string | null },
  user: AuthUser,
) {
  const { item, docket } = await loadItem(itemId);
  const lines = cleanLines(Array.isArray(input.lines) ? (input.lines as Record<string, unknown>[]) : []);
  if (input.source !== 'MANUAL' && lines.length === 0) throw new UserError('No BOM lines to save.');
  return prisma.$transaction(async (tx) => {
    const bom = await newBom(
      tx,
      itemId,
      docket?.id ?? null,
      {
        source: input.source,
        drawingRef: String(input.drawingRef ?? '').trim().slice(0, 200) || null,
        fileName: input.fileName?.slice(0, 255) ?? null,
        s3Key: input.s3Key ?? null,
        extractNote: input.note?.slice(0, 1000) ?? null,
        structureType: String(input.structureType ?? '').trim().slice(0, 200) || item.ourItemName,
      },
      lines,
      user,
    );
    return { id: bom.id };
  });
}

/** (b) BOM copied from an approved drawing in the library. */
export async function createBomFromDrawing(itemId: number, drawingId: number, structureType: string | null, user: AuthUser) {
  const { item, docket } = await loadItem(itemId);
  const d = await prisma.approvedDrawing.findUnique({ where: { id: drawingId }, include: { lines: { orderBy: { rowNo: 'asc' } } } });
  if (!d) throw new UserError('Drawing not found.');
  if (d.status !== 'APPROVED') throw new UserError('This drawing is superseded. Pick the current revision.');
  const type = String(structureType ?? '').trim() || item.ourItemName;
  const ranked = rankDrawings([{ ...d, approvalDate: ymd(d.approvalDate) }], { itemType: d.itemType, utility: docket?.utility ?? null, states: [docket?.state ?? null, docket?.deliveryLocation ?? null] });
  const level = ranked[0]?.level ?? 'ANY_ITEM';
  const lines: BomLineDraft[] = d.lines.map((l) => ({
    markNo: l.markNo,
    description: l.description,
    section: l.section,
    sectionKey: l.sectionKey,
    lengthMm: l.lengthMm,
    qtyPerSet: dec(l.qtyPerSet),
    kgPerM: dec(l.kgPerM),
    unitWtKg: dec(l.unitWtKg),
    category: (CATEGORIES as readonly string[]).includes(l.category) ? (l.category as BomLineDraft['category']) : 'STRUCTURE',
    rateKey: l.rateKey,
  }));
  const ref = `${d.drawingNo} rev ${d.revision}${d.approvalLetterNo ? ` · ${d.approvalLetterNo}` : ''}${d.approvalDate ? ` dt ${ymd(d.approvalDate)}` : ''}`;
  return prisma.$transaction(async (tx) => {
    const bom = await newBom(
      tx,
      itemId,
      docket?.id ?? null,
      {
        source: 'APPROVED_DRAWING',
        drawingId: d.id,
        drawingRef: ref.slice(0, 200),
        matchLevel: level,
        structureType: type || d.itemType,
        extractNote: level === 'ANY_ITEM' ? 'Reference only – confirm: this drawing is not for the same utility or state.' : null,
      },
      lines,
      user,
    );
    return { id: bom.id, level };
  });
}

async function lockBom(tx: Tx, bomId: number) {
  const rows = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM item_boms WHERE id = ${bomId} FOR UPDATE`;
  if (rows.length === 0) throw new UserError('BOM not found.');
  const bom = await tx.itemBom.findUnique({ where: { id: bomId } });
  return bom!;
}

const LINE_FIELDS = ['markNo', 'description', 'section', 'lengthMm', 'qtyPerSet', 'kgPerM', 'unitWtKg', 'category', 'scope', 'nonBillable', 'rateKey'] as const;

export async function updateBomLine(lineId: number, field: string, value: string, user: AuthUser) {
  if (!(LINE_FIELDS as readonly string[]).includes(field)) throw new UserError('This column cannot be edited.');
  return prisma.$transaction(async (tx) => {
    const ref = await tx.itemBomLine.findUnique({ where: { id: lineId }, select: { bomId: true } });
    if (!ref) throw new UserError('Line not found.');
    const bom = await lockBom(tx, ref.bomId);
    if (bom.status !== 'DRAFT') throw new UserError('This BOM is confirmed. Reopen it to edit.');
    const line = (await tx.itemBomLine.findUnique({ where: { id: lineId } }))!;
    const v = value.trim();
    const data: Prisma.ItemBomLineUpdateInput = {};
    if (field === 'section') {
      data.section = v.slice(0, 200) || null;
      data.sectionKey = line.category === 'STRUCTURE' ? sectionKey(v) : null;
      if (line.category === 'NUTS_BOLTS' && !line.rateKey) data.rateKey = nbSize(v);
    } else if (field === 'markNo' || field === 'description') data[field] = v.slice(0, 200) || null;
    else if (field === 'rateKey') data.rateKey = v ? normSubject(v) : null;
    else if (field === 'category') {
      if (!(CATEGORIES as readonly string[]).includes(v)) throw new UserError('Unknown category.');
      data.category = v;
      data.sectionKey = v === 'STRUCTURE' ? sectionKey(line.section) : null;
      if (v === 'NUTS_BOLTS' && !line.rateKey) data.rateKey = nbSize(line.section, line.description);
      if (v === 'BOUGHT_OUT') {
        if (!line.rateKey) data.rateKey = normSubject(line.description ?? line.section);
        if (line.scope === 'IN_SCOPE') data.scope = 'BOUGHT_OUT';
      }
    } else if (field === 'scope') {
      if (!(SCOPES as readonly string[]).includes(v)) throw new UserError('Unknown scope.');
      data.scope = v;
    } else if (field === 'nonBillable') data.nonBillable = v === 'true' || v === 'Yes';
    else {
      const n = v === '' ? null : toNum(v);
      if (v !== '' && n === null) throw new UserError('Enter a number.');
      if (n !== null && n < 0) throw new UserError('Negative values are not allowed.');
      if (field === 'lengthMm') data.lengthMm = n === null ? null : Math.round(n);
      else data[field as 'qtyPerSet' | 'kgPerM' | 'unitWtKg'] = n;
    }
    await tx.itemBomLine.update({ where: { id: lineId }, data });
    const old = (line as Record<string, unknown>)[field];
    await tx.editLog.create({ data: { tableName: 'item_bom_lines', recordId: lineId, fieldName: field, oldValue: old === null || old === undefined ? '' : String(old), newValue: v, ...auditUser(user) } });
    return { id: lineId };
  });
}

export async function addBomLine(bomId: number, user: AuthUser) {
  return prisma.$transaction(async (tx) => {
    const bom = await lockBom(tx, bomId);
    if (bom.status !== 'DRAFT') throw new UserError('This BOM is confirmed. Reopen it to edit.');
    const last = await tx.itemBomLine.findFirst({ where: { bomId }, orderBy: { rowNo: 'desc' }, select: { rowNo: true } });
    const line = await tx.itemBomLine.create({ data: { bomId, rowNo: (last?.rowNo ?? 0) + 1 } });
    await tx.editLog.create({ data: { tableName: 'item_bom_lines', recordId: line.id, fieldName: 'ALL_FIELDS', oldValue: 'NONE (New Record)', newValue: JSON.stringify({ bomId }), ...auditUser(user) } });
    return { id: line.id };
  });
}

export async function deleteBomLine(lineId: number, user: AuthUser) {
  return prisma.$transaction(async (tx) => {
    const line = await tx.itemBomLine.findUnique({ where: { id: lineId } });
    if (!line) throw new UserError('Line not found.');
    const bom = await lockBom(tx, line.bomId);
    if (bom.status !== 'DRAFT') throw new UserError('This BOM is confirmed. Reopen it to edit.');
    await tx.itemBomLine.delete({ where: { id: lineId } });
    await tx.editLog.create({ data: { tableName: 'item_bom_lines', recordId: lineId, fieldName: 'DELETED', oldValue: JSON.stringify(line), newValue: null, ...auditUser(user) } });
    return { id: lineId };
  });
}

/** Costing choices on the BOM (allowed while confirmed: they change the price, not the BOM). */
export async function updateBomMeta(bomId: number, field: string, value: string, user: AuthUser) {
  const v = value.trim();
  const data: Prisma.ItemBomUpdateInput = {};
  if (field === 'fabType') {
    if (!(FAB_TYPES as readonly string[]).includes(v)) throw new UserError('Unknown fabrication type.');
    data.fabType = v;
  } else if (field === 'billingBasis') {
    if (v !== 'BLACK' && v !== 'GALV') throw new UserError('Billing basis is Black or Galvanised weight.');
    data.billingBasis = v;
  } else if (field === 'galvanised') data.galvanised = v === 'true';
  else if (field === 'structureType') data.structureType = v.slice(0, 200) || null;
  else throw new UserError('This field cannot be edited.');
  return prisma.$transaction(async (tx) => {
    const bom = await lockBom(tx, bomId);
    await tx.itemBom.update({ where: { id: bomId }, data });
    await tx.editLog.create({ data: { tableName: 'item_boms', recordId: bomId, fieldName: field, oldValue: String((bom as Record<string, unknown>)[field] ?? ''), newValue: v, ...auditUser(user) } });
    return { id: bomId };
  });
}

/** User has checked the lines against the drawing. Lines with blank quantity are refused. */
export async function confirmItemBom(bomId: number, user: AuthUser) {
  return prisma.$transaction(async (tx) => {
    const bom = await lockBom(tx, bomId);
    if (bom.status === 'CONFIRMED') throw new UserError('Already confirmed.');
    const latest = await tx.itemBom.findFirst({ where: { itemId: bom.itemId }, orderBy: { id: 'desc' }, select: { id: true } });
    if (latest?.id !== bomId) throw new UserError('Only the latest BOM of the item can be confirmed.');
    const lines = await tx.itemBomLine.findMany({ where: { bomId } });
    if (lines.length === 0) throw new UserError('The BOM has no lines.');
    const bad = lines.filter((l) => l.scope !== 'NOT_IN_SCOPE' && l.scope !== 'CLIENT_SUPPLY' && !(l.qtyPerSet && l.qtyPerSet.toNumber() > 0));
    if (bad.length) throw new UserError(`Qty per set is blank on row ${bad.map((l) => l.rowNo).slice(0, 10).join(', ')}.`);
    const noLen = lines.filter((l) => l.category === 'STRUCTURE' && l.scope === 'IN_SCOPE' && !(l.lengthMm && l.lengthMm > 0));
    if (noLen.length) throw new UserError(`Length is blank on structure row ${noLen.map((l) => l.rowNo).slice(0, 10).join(', ')}.`);
    await tx.itemBom.update({ where: { id: bomId }, data: { status: 'CONFIRMED', confirmedByName: user.name, confirmedAt: new Date() } });
    await tx.editLog.create({ data: { tableName: 'item_boms', recordId: bomId, fieldName: 'status', oldValue: 'DRAFT', newValue: 'CONFIRMED', ...auditUser(user) } });
    return { id: bomId };
  });
}

export async function reopenItemBom(bomId: number, user: AuthUser) {
  return prisma.$transaction(async (tx) => {
    const bom = await lockBom(tx, bomId);
    if (bom.status !== 'CONFIRMED') throw new UserError('This BOM is not confirmed.');
    const ordered = await tx.bomUpload.count({ where: { source: 'QUOTATION', columnMap: { path: ['itemBomIds'], array_contains: [bomId] } } });
    if (ordered > 0 && user.role !== 'Admin') throw new UserError('This BOM was copied into an order. Only an Admin can reopen it.');
    await tx.itemBom.update({ where: { id: bomId }, data: { status: 'DRAFT', confirmedByName: null, confirmedAt: null } });
    await tx.editLog.create({ data: { tableName: 'item_boms', recordId: bomId, fieldName: 'status', oldValue: 'CONFIRMED', newValue: 'DRAFT (reopened)', ...auditUser(user) } });
    return { id: bomId };
  });
}

/** Save this item BOM as a new approved drawing (e.g. after the client approved it). */
export async function addBomToLibrary(bomId: number, header: Record<string, unknown>, user: AuthUser) {
  const bom = await prisma.itemBom.findUnique({ where: { id: bomId }, include: { lines: { orderBy: { rowNo: 'asc' } } } });
  if (!bom) throw new UserError('BOM not found.');
  if (bom.status !== 'CONFIRMED') throw new UserError('Confirm the BOM first.');
  const { docket } = await loadItem(bom.itemId);
  const lines = bom.lines
    .filter((l) => l.scope !== 'NOT_IN_SCOPE')
    .map((l) => ({ markNo: l.markNo, description: l.description, section: l.section, lengthMm: l.lengthMm, qtyPerSet: dec(l.qtyPerSet), kgPerM: dec(l.kgPerM), unitWtKg: dec(l.unitWtKg), category: l.category }));
  const res = await createDrawing(
    { utility: docket?.utility, state: docket?.deliveryLocation || docket?.state, itemType: bom.structureType, ...header },
    lines,
    user,
    bomId,
  );
  await prisma.itemBom.update({ where: { id: bomId }, data: { drawingId: res.id } });
  return res;
}
