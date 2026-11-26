import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { auditUser, type AuthUser } from '@/lib/auth/server';
import { UserError } from '@/lib/actionResult';
import { parseFeature, type FabFeature, type FeatureKind, type FeatureSource } from '@/lib/fabdrawing/geometry';

// Part 2: holes / slots / bends / welds / notches per mark of an item BOM. Entered once per approved
// drawing: a later BOM of the same approved drawing with no geometry of its own reuses it.

type Row = Prisma.DrawingFeatureGetPayload<object>;
const n = (v: Prisma.Decimal | null) => (v === null ? null : v.toNumber());

export function toFeature(r: Row): FabFeature {
  return {
    id: r.id,
    markNo: r.markNo,
    kind: r.kind as FeatureKind,
    positionsMm: r.positions ? r.positions.split(',').map(Number).filter((x) => Number.isFinite(x)) : [],
    diaMm: n(r.diaMm),
    offsetMm: n(r.offsetMm),
    face: r.face,
    count: r.count,
    bendAngle: n(r.bendAngle),
    bendRadius: n(r.bendRadius),
    weldType: r.weldType,
    weldSize: n(r.weldSize),
    weldLength: n(r.weldLength),
    weldPitch: n(r.weldPitch),
    source: r.source as FeatureSource,
    toConfirm: r.toConfirm,
    note: r.note,
  };
}

/** Geometry used for a BOM: its own rows, else the rows entered on another BOM of the same approved drawing. */
export async function featuresForBom(bomId: number): Promise<{ features: FabFeature[]; reusedFrom: number | null }> {
  const own = await prisma.drawingFeature.findMany({ where: { itemBomId: bomId }, orderBy: [{ markNo: 'asc' }, { id: 'asc' }] });
  if (own.length) return { features: own.map(toFeature), reusedFrom: null };
  const bom = await prisma.itemBom.findUnique({ where: { id: bomId }, select: { drawingId: true } });
  if (!bom?.drawingId) return { features: [], reusedFrom: null };
  const lib = await prisma.drawingFeature.findMany({ where: { drawingId: bom.drawingId }, orderBy: [{ itemBomId: 'desc' }, { markNo: 'asc' }, { id: 'asc' }] });
  if (!lib.length) return { features: [], reusedFrom: null };
  const from = lib[0].itemBomId;
  return { features: lib.filter((r) => r.itemBomId === from).map(toFeature), reusedFrom: from };
}

export interface FeatureEditorData {
  bomId: number;
  bomStatus: string;
  drawingRef: string | null;
  marks: { markNo: string; section: string; lengthMm: number | null; description: string }[];
  features: FabFeature[];
  reusedFrom: number | null;
}

/** Marks of the BOM (structure lines in scope) and the geometry entered. */
export async function featureEditorData(bomId: number): Promise<FeatureEditorData> {
  const bom = await prisma.itemBom.findUnique({ where: { id: bomId }, include: { lines: { orderBy: { rowNo: 'asc' } }, drawing: true } });
  if (!bom) throw new UserError('BOM not found.');
  const seen = new Set<string>();
  const marks: FeatureEditorData['marks'] = [];
  for (const l of bom.lines) {
    if (l.category !== 'STRUCTURE' || ['NOT_IN_SCOPE', 'CLIENT_SUPPLY', 'BOUGHT_OUT'].includes(l.scope)) continue;
    const markNo = ((l.markNo ?? '').trim() || `R${l.rowNo}`).toUpperCase();
    if (seen.has(markNo)) continue;
    seen.add(markNo);
    marks.push({ markNo, section: l.section ?? '', lengthMm: l.lengthMm, description: l.description ?? '' });
  }
  const { features, reusedFrom } = await featuresForBom(bomId);
  return { bomId, bomStatus: bom.status, drawingRef: bom.drawing ? `${bom.drawing.drawingNo} Rev ${bom.drawing.revision}` : bom.drawingRef, marks, features, reusedFrom };
}

const dec = (v: number | null) => (v === null ? null : new Prisma.Decimal(v));

/** Add (id absent) or replace one feature row of the BOM. */
export async function saveFeature(bomId: number, input: Record<string, unknown>, user: AuthUser) {
  const bom = await prisma.itemBom.findUnique({ where: { id: bomId }, include: { lines: { select: { markNo: true, rowNo: true, lengthMm: true } } } });
  if (!bom) throw new UserError('BOM not found.');
  const markNo = String(input.markNo ?? '').trim().toUpperCase();
  const line = bom.lines.find((l) => ((l.markNo ?? '').trim() || `R${l.rowNo}`).toUpperCase() === markNo);
  if (!line) throw new UserError(`Mark ${markNo || '?'} is not in this BOM.`);
  const parsed = parseFeature(input, line.lengthMm);
  if ('error' in parsed) throw new UserError(parsed.error);
  const f = parsed.feature;
  const data = {
    itemBomId: bomId,
    drawingId: bom.drawingId,
    markNo: f.markNo,
    kind: f.kind,
    positions: f.positionsMm.length ? f.positionsMm.join(',') : null,
    diaMm: dec(f.diaMm),
    offsetMm: dec(f.offsetMm),
    face: f.face,
    count: f.count,
    bendAngle: dec(f.bendAngle),
    bendRadius: dec(f.bendRadius),
    weldType: f.weldType,
    weldSize: dec(f.weldSize),
    weldLength: dec(f.weldLength),
    weldPitch: dec(f.weldPitch),
    source: f.source,
    toConfirm: f.toConfirm,
    note: f.note,
  };
  const id = Number(input.id);
  return prisma.$transaction(async (tx) => {
    // First own row on a BOM that was reusing another BOM's geometry: copy the library rows first,
    // so editing one row does not drop the others.
    if (!id && !(await tx.drawingFeature.count({ where: { itemBomId: bomId } }))) {
      const { features, reusedFrom } = await featuresForBom(bomId);
      if (reusedFrom) {
        for (const r of features) {
          await tx.drawingFeature.create({
            data: { ...data, markNo: r.markNo, kind: r.kind, positions: r.positionsMm.join(',') || null, diaMm: dec(r.diaMm), offsetMm: dec(r.offsetMm), face: r.face, count: r.count, bendAngle: dec(r.bendAngle), bendRadius: dec(r.bendRadius), weldType: r.weldType, weldSize: dec(r.weldSize), weldLength: dec(r.weldLength), weldPitch: dec(r.weldPitch), source: r.source, toConfirm: r.toConfirm, note: r.note, createdByName: `${user.name} (copied from BOM #${reusedFrom})` },
          });
        }
      }
    }
    const before = id ? await tx.drawingFeature.findFirst({ where: { id, itemBomId: bomId } }) : null;
    if (id && !before) throw new UserError('That row is not on this BOM.');
    const row = before ? await tx.drawingFeature.update({ where: { id }, data }) : await tx.drawingFeature.create({ data: { ...data, createdByName: user.name } });
    await tx.editLog.create({
      data: { tableName: 'drawing_features', recordId: row.id, fieldName: before ? 'ALL_FIELDS (updated)' : 'ALL_FIELDS', oldValue: before ? JSON.stringify(toFeature(before)) : 'NONE (New Record)', newValue: JSON.stringify(f), ...auditUser(user) },
    });
    return { id: row.id };
  });
}

export async function deleteFeature(bomId: number, id: number, user: AuthUser) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.drawingFeature.findFirst({ where: { id, itemBomId: bomId } });
    if (!row) throw new UserError('That row is not on this BOM.');
    await tx.drawingFeature.delete({ where: { id } });
    await tx.editLog.create({ data: { tableName: 'drawing_features', recordId: id, fieldName: 'DELETED', oldValue: JSON.stringify(toFeature(row)), newValue: null, ...auditUser(user) } });
    return { id };
  });
}
