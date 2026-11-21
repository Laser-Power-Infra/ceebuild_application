import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { auditUser, type AuthUser } from '@/lib/auth/server';
import { UserError } from '@/lib/actionResult';
import { sectionKey, toNum } from '@/lib/bom/parse';
import { normalizeDocketNo } from '@/lib/dockets';
import { CATEGORIES, FAB_TYPES, SCOPES, normSubject } from '@/lib/costing/calc';
import { cleanLines, nbSize, rankDrawings, type BomLineDraft, type MatchLevel } from '@/lib/costing/drawings';
import { resolveSection } from '@/lib/costing/mixedBom';
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
  groupId: number | null;
}

export interface BomGroupRow {
  id: number;
  seq: number;
  name: string;
  drawingNo: string | null;
  drawingId: number | null;
  sets: number | null;
  siteSets: Record<string, number> | null;
  lineCount: number;
}

/** One structure to save: its name, drawing, set count and lines. */
export interface GroupDraft {
  name: string;
  drawingNo?: string | null;
  drawingId?: number | null;
  sets?: number | null;
  siteSets?: Record<string, number> | null;
  lines: BomLineDraft[];
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
  groups: BomGroupRow[];
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
    prisma.itemBom.findFirst({ where: { itemId }, orderBy: { id: 'desc' }, include: { lines: { orderBy: { rowNo: 'asc' } }, drawing: true, groups: { orderBy: { seq: 'asc' }, include: { _count: { select: { lines: true } } } } } }),
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
      groupId: l.groupId,
    })),
    groups: bom.groups.map((g) => ({
      id: g.id,
      seq: g.seq,
      name: g.name,
      drawingNo: g.drawingNo,
      drawingId: g.drawingId,
      sets: dec(g.sets),
      siteSets: (g.siteSets as Record<string, number> | null) ?? null,
      lineCount: g._count.lines,
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

/** GTP kg/m by section key (for resolving BOM section names). */
async function gtpKgm(tx: Tx | typeof prisma) {
  const rows = await tx.sectionMaster.findMany({ select: { sectionKey: true, kgPerM: true } });
  return Object.fromEntries(rows.map((r) => [r.sectionKey, r.kgPerM.toNumber()]));
}

type DrawingLine = {
  markNo: string | null;
  description: string | null;
  section: string | null;
  sectionKey: string | null;
  lengthMm: number | null;
  qtyPerSet: Prisma.Decimal | null;
  kgPerM: Prisma.Decimal | null;
  unitWtKg: Prisma.Decimal | null;
  category: string;
  rateKey: string | null;
  nonBillable: boolean;
};

/** Library drawing lines -> drafts for an item BOM. */
export function drawingDrafts(lines: DrawingLine[]): BomLineDraft[] {
  return lines.map((l) => ({
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
    nonBillable: l.nonBillable,
  }));
}

/**
 * Save the structures and their lines. Structure lines get the GTP section key (exact, or same
 * size within 5% kg/m, e.g. "FT 75X40" at 7.14 kg/m = ISMC 75x40); the BOM note says what was mapped.
 * Bought-out lines start tagged Bought-out; everything else starts In scope.
 */
async function saveGroups(tx: Tx, bomId: number, groups: GroupDraft[], startSeq = 1, startRow = 1) {
  const gtp = await gtpKgm(tx);
  const notes = new Set<string>();
  let row = startRow;
  let seq = startSeq;
  for (const g of groups) {
    const grp = await tx.itemBomGroup.create({
      data: {
        bomId,
        seq: seq++,
        name: g.name.slice(0, 200) || `Structure ${seq - 1}`,
        drawingNo: g.drawingNo?.slice(0, 200) ?? null,
        drawingId: g.drawingId ?? null,
        sets: g.sets ?? null,
        siteSets: g.siteSets ? (g.siteSets as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });
    const data = lineData(g.lines).map((l) => {
      let key = l.sectionKey;
      if (l.category === 'STRUCTURE') {
        const r = resolveSection(key, l.kgPerM ?? null, gtp);
        if (r.note) notes.add(r.note);
        key = r.key;
      }
      return { ...l, sectionKey: key, rowNo: row++, bomId, groupId: grp.id, scope: l.category === 'BOUGHT_OUT' ? 'BOUGHT_OUT' : 'IN_SCOPE' };
    });
    if (data.length) await tx.itemBomLine.createMany({ data });
  }
  return [...notes];
}

async function newBom(
  tx: Tx,
  itemId: number,
  docketId: number | null,
  data: { source: string; drawingId?: number | null; drawingRef?: string | null; matchLevel?: string | null; fileName?: string | null; s3Key?: string | null; extractNote?: string | null; structureType: string | null },
  groups: GroupDraft[],
  user: AuthUser,
) {
  // Carry the costing choices over from the previous version.
  const prev = await tx.itemBom.findFirst({ where: { itemId }, orderBy: { id: 'desc' }, select: { fabType: true, galvanised: true, billingBasis: true } });
  const bom = await tx.itemBom.create({ data: { itemId, docketId, ...data, ...(prev ?? {}), createdById: user.id, createdByName: user.name } });
  const notes = await saveGroups(tx, bom.id, groups);
  if (notes.length) {
    await tx.itemBom.update({ where: { id: bom.id }, data: { extractNote: [data.extractNote, `Sections mapped: ${notes.join('; ')}.`].filter(Boolean).join(' ').slice(0, 2000) } });
  }
  const lines = groups.reduce((a, g) => a + g.lines.length, 0);
  await tx.editLog.create({
    data: {
      tableName: 'item_boms',
      recordId: bom.id,
      fieldName: 'ALL_FIELDS',
      oldValue: 'NONE (New Record)',
      newValue: JSON.stringify({ itemId, docketId, source: data.source, drawingRef: data.drawingRef ?? null, matchLevel: data.matchLevel ?? null, fileName: data.fileName ?? null, structures: groups.length, lines }),
      ...auditUser(user),
    },
  });
  return bom;
}

const toGroups = (raw: unknown): GroupDraft[] =>
  (Array.isArray(raw) ? (raw as Record<string, unknown>[]) : []).map((g, i) => {
    const sets = g.sets === null || g.sets === undefined || g.sets === '' ? null : toNum(g.sets);
    if (sets !== null && sets < 0) throw new UserError('A set count cannot be negative.');
    return {
      name: String(g.name ?? `Structure ${i + 1}`).trim(),
      drawingNo: String(g.drawingNo ?? '').trim() || null,
      sets,
      siteSets: g.siteSets && typeof g.siteSets === 'object' ? (g.siteSets as Record<string, number>) : null,
      lines: cleanLines(Array.isArray(g.lines) ? (g.lines as Record<string, unknown>[]) : []),
    };
  });

/** Add a structure from the Approved Drawing Library to a draft BOM (building a mixed BOM). */
export async function addGroupFromDrawing(bomId: number, drawingId: number, sets: number | null, user: AuthUser) {
  const d = await prisma.approvedDrawing.findUnique({ where: { id: drawingId }, include: { lines: { orderBy: { rowNo: 'asc' } } } });
  if (!d) throw new UserError('Drawing not found.');
  if (d.status !== 'APPROVED') throw new UserError('Only an approved drawing can be used.');
  if (sets !== null && (!Number.isFinite(sets) || sets < 0)) throw new UserError('Enter the number of sets.');
  return prisma.$transaction(async (tx) => {
    const bom = await lockBom(tx, bomId);
    if (bom.status !== 'DRAFT') throw new UserError('This BOM is confirmed. Reopen it to edit.');
    const lastG = await tx.itemBomGroup.findFirst({ where: { bomId }, orderBy: { seq: 'desc' }, select: { seq: true } });
    const lastL = await tx.itemBomLine.findFirst({ where: { bomId }, orderBy: { rowNo: 'desc' }, select: { rowNo: true } });
    await saveGroups(tx, bomId, [{ name: d.itemType, drawingNo: `${d.drawingNo} rev ${d.revision}`, drawingId: d.id, sets, lines: drawingDrafts(d.lines) }], (lastG?.seq ?? 0) + 1, (lastL?.rowNo ?? 0) + 1);
    await tx.editLog.create({ data: { tableName: 'item_bom_groups', recordId: bomId, fieldName: 'ADDED', oldValue: null, newValue: JSON.stringify({ drawingId, drawingNo: d.drawingNo, sets }), ...auditUser(user) } });
    return { id: bomId };
  });
}

/** Structure name, drawing no. or set count. Set count may change while confirmed? No: it is the BOM. */
export async function updateGroup(groupId: number, field: string, value: string, user: AuthUser) {
  if (!['name', 'drawingNo', 'sets'].includes(field)) throw new UserError('This field cannot be edited.');
  return prisma.$transaction(async (tx) => {
    const g = await tx.itemBomGroup.findUnique({ where: { id: groupId } });
    if (!g) throw new UserError('Structure not found.');
    const bom = await lockBom(tx, g.bomId);
    if (bom.status !== 'DRAFT') throw new UserError('This BOM is confirmed. Reopen it to edit.');
    const v = value.trim();
    const data: Prisma.ItemBomGroupUpdateInput = {};
    if (field === 'sets') {
      const n = v === '' ? null : toNum(v);
      if (v !== '' && (n === null || n < 0)) throw new UserError('Enter the number of sets (0 or more).');
      data.sets = n;
    } else if (field === 'name') {
      if (!v) throw new UserError('Structure name is required.');
      data.name = v.slice(0, 200);
    } else data.drawingNo = v.slice(0, 200) || null;
    await tx.itemBomGroup.update({ where: { id: groupId }, data });
    const old = (g as Record<string, unknown>)[field];
    await tx.editLog.create({ data: { tableName: 'item_bom_groups', recordId: groupId, fieldName: field, oldValue: old === null || old === undefined ? '' : String(old), newValue: v, ...auditUser(user) } });
    return { id: groupId };
  });
}

export async function deleteGroup(groupId: number, user: AuthUser) {
  return prisma.$transaction(async (tx) => {
    const g = await tx.itemBomGroup.findUnique({ where: { id: groupId } });
    if (!g) throw new UserError('Structure not found.');
    const bom = await lockBom(tx, g.bomId);
    if (bom.status !== 'DRAFT') throw new UserError('This BOM is confirmed. Reopen it to edit.');
    const n = await tx.itemBomLine.deleteMany({ where: { groupId } });
    await tx.itemBomGroup.delete({ where: { id: groupId } });
    await tx.editLog.create({ data: { tableName: 'item_bom_groups', recordId: groupId, fieldName: 'DELETED', oldValue: JSON.stringify({ ...g, lines: n.count }), newValue: null, ...auditUser(user) } });
    return { id: groupId };
  });
}

/** (a) BOM from the drawing that came with the enquiry (lines already checked by the user), or typed in. */
export async function createBomFromLines(
  itemId: number,
  input: { source: 'ENQUIRY_DRAWING' | 'MANUAL'; lines: unknown; groups?: unknown; fileName?: string | null; s3Key?: string | null; drawingRef?: string | null; note?: string | null; structureType?: string | null },
  user: AuthUser,
) {
  const { item, docket } = await loadItem(itemId);
  const structureType = String(input.structureType ?? '').trim().slice(0, 200) || item.ourItemName;
  // Mixed BOM: several structures with their own set counts. Otherwise one structure.
  let groups = toGroups(input.groups).filter((g) => g.lines.length > 0);
  if (groups.length === 0) {
    const lines = cleanLines(Array.isArray(input.lines) ? (input.lines as Record<string, unknown>[]) : []);
    groups = [{ name: structureType || 'Structure', drawingNo: String(input.drawingRef ?? '').trim() || null, sets: null, lines }];
  }
  const lineCount = groups.reduce((a, g) => a + g.lines.length, 0);
  if (input.source !== 'MANUAL' && lineCount === 0) throw new UserError('No BOM lines to save.');
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
        structureType,
      },
      groups,
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
  const lines = drawingDrafts(d.lines);
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
      [{ name: d.itemType, drawingNo: `${d.drawingNo} rev ${d.revision}`, drawingId: d.id, sets: null, lines }],
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

export async function addBomLine(bomId: number, groupId: number | null, user: AuthUser) {
  return prisma.$transaction(async (tx) => {
    const bom = await lockBom(tx, bomId);
    if (bom.status !== 'DRAFT') throw new UserError('This BOM is confirmed. Reopen it to edit.');
    const last = await tx.itemBomLine.findFirst({ where: { bomId }, orderBy: { rowNo: 'desc' }, select: { rowNo: true } });
    let gid = groupId;
    if (gid !== null) {
      const g = await tx.itemBomGroup.findUnique({ where: { id: gid }, select: { bomId: true } });
      if (g?.bomId !== bomId) throw new UserError('Structure not found.');
    } else {
      gid = (await tx.itemBomGroup.findFirst({ where: { bomId }, orderBy: { seq: 'desc' }, select: { id: true } }))?.id ?? null;
      if (gid === null) gid = (await tx.itemBomGroup.create({ data: { bomId, seq: 1, name: bom.structureType || 'Structure' } })).id;
    }
    const line = await tx.itemBomLine.create({ data: { bomId, groupId: gid, rowNo: (last?.rowNo ?? 0) + 1 } });
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
    // Mixed BOM: every structure needs its own set count (only a single structure may take it from the kg quantity).
    const groups = await tx.itemBomGroup.findMany({ where: { bomId }, orderBy: { seq: 'asc' } });
    if (groups.length > 1) {
      const noSets = groups.filter((g) => g.sets === null);
      if (noSets.length) throw new UserError(`Set count is blank for: ${noSets.map((g) => g.name).slice(0, 5).join('; ')}${noSets.length > 5 ? ` and ${noSets.length - 5} more` : ''}.`);
    }
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

/**
 * Save this item BOM's structures to the Approved Drawing Library (e.g. after the client approved
 * them): one drawing per structure, numbered by the structure's drawing no. Structures without a
 * drawing no. take the one given in the header (single-structure BOMs). Drawings already in the
 * library (same no. + revision) are skipped and listed.
 */
export async function addBomToLibrary(bomId: number, header: Record<string, unknown>, user: AuthUser) {
  const bom = await prisma.itemBom.findUnique({ where: { id: bomId }, include: { lines: { orderBy: { rowNo: 'asc' } }, groups: { orderBy: { seq: 'asc' } } } });
  if (!bom) throw new UserError('BOM not found.');
  if (bom.status !== 'CONFIRMED') throw new UserError('Confirm the BOM first.');
  const { docket } = await loadItem(bom.itemId);
  const groups = bom.groups.length ? bom.groups : [{ id: -1, name: bom.structureType ?? 'Structure', drawingNo: null }];
  const added: string[] = [];
  const skipped: string[] = [];
  for (const g of groups) {
    const lines = bom.lines
      .filter((l) => (g.id === -1 || l.groupId === g.id) && l.scope !== 'NOT_IN_SCOPE')
      .map((l) => ({ markNo: l.markNo, description: l.description, section: l.section, lengthMm: l.lengthMm, qtyPerSet: dec(l.qtyPerSet), kgPerM: dec(l.kgPerM), unitWtKg: dec(l.unitWtKg), category: l.category, nonBillable: l.nonBillable }));
    if (lines.length === 0) continue;
    // "EPC-PD-2023-HT-011 rev 1" -> drawing no + revision.
    const raw = String(g.drawingNo ?? header.drawingNo ?? '').trim();
    const m = raw.match(/^(.*?)\s+rev\.?\s*(\S+)$/i);
    const drawingNo = (m ? m[1] : raw) || null;
    if (!drawingNo) {
      skipped.push(`${g.name} (no drawing no.)`);
      continue;
    }
    const revision = m ? m[2] : String(header.revision ?? '0');
    const exists = await prisma.approvedDrawing.findUnique({ where: { drawingNo_revision: { drawingNo, revision } } });
    if (exists) {
      skipped.push(`${drawingNo} rev ${revision} (already in library)`);
      continue;
    }
    await createDrawing(
      { utility: docket?.utility, state: docket?.deliveryLocation || docket?.state, ...header, itemType: groups.length > 1 ? g.name : header.itemType || g.name, drawingNo, revision },
      lines,
      user,
      bomId,
    );
    added.push(`${drawingNo} rev ${revision}`);
  }
  if (added.length === 0 && skipped.length === 0) throw new UserError('Nothing to add.');
  return { added, skipped };
}
