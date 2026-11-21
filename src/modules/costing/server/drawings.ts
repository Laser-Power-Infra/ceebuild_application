import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { auditUser, type AuthUser } from '@/lib/auth/server';
import { UserError } from '@/lib/actionResult';
import { sectionKey } from '@/lib/bom/parse';
import { cleanLines, type BomLineDraft } from '@/lib/costing/drawings';

// Approved Drawing Library. Editors add drawings (each new client approval is added here so the
// next enquiry can reuse it); Admins delete. Superseded drawings stay for history but are never
// offered for a new BOM.

export interface DrawingRow {
  id: number;
  utility: string;
  state: string | null;
  itemType: string;
  drawingNo: string;
  revision: string;
  approvalLetterNo: string | null;
  approvalDate: string | null;
  status: string;
  fileLink: string | null;
  remarks: string | null;
  lineCount: number;
  setWtKg: number;
  usedBy: number;
  createdByName: string | null;
  createdAt: string;
  approvedByName: string | null;
}

export interface DrawingLineRow {
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
  rateKey: string | null;
  nonBillable: boolean;
  /** Weight per set (kg): qty x length x kg/m (GTP first), or qty x unit wt. */
  kg: number | null;
}

const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const dec = (d: Prisma.Decimal | null) => (d === null ? null : d.toNumber());
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function lineKg(l: { lengthMm: number | null; qtyPerSet: number | null; kgPerM: number | null; unitWtKg: number | null }, gtpKgm?: number | null) {
  const q = l.qtyPerSet ?? 0;
  const kgm = gtpKgm ?? l.kgPerM;
  if (l.lengthMm && kgm) return r3((q * l.lengthMm * kgm) / 1000);
  if (l.unitWtKg) return r3(q * l.unitWtKg);
  return null;
}

async function gtpMap() {
  const rows = await prisma.sectionMaster.findMany({ select: { sectionKey: true, kgPerM: true } });
  return new Map(rows.map((r) => [r.sectionKey, r.kgPerM.toNumber()]));
}

export async function listDrawings(): Promise<DrawingRow[]> {
  const [rows, gtp] = await Promise.all([
    prisma.approvedDrawing.findMany({ include: { lines: true, _count: { select: { itemBoms: true } } }, orderBy: [{ status: 'asc' }, { itemType: 'asc' }, { approvalDate: 'desc' }] }),
    gtpMap(),
  ]);
  return rows.map((d) => ({
    id: d.id,
    utility: d.utility,
    state: d.state,
    itemType: d.itemType,
    drawingNo: d.drawingNo,
    revision: d.revision,
    approvalLetterNo: d.approvalLetterNo,
    approvalDate: ymd(d.approvalDate),
    status: d.status,
    fileLink: d.fileLink,
    remarks: d.remarks,
    lineCount: d.lines.length,
    setWtKg: r3(
      d.lines
        .filter((l) => l.category === 'STRUCTURE')
        .reduce((a, l) => a + (lineKg({ lengthMm: l.lengthMm, qtyPerSet: dec(l.qtyPerSet), kgPerM: dec(l.kgPerM), unitWtKg: dec(l.unitWtKg) }, l.sectionKey ? gtp.get(l.sectionKey) : null) ?? 0), 0),
    ),
    usedBy: d._count.itemBoms,
    createdByName: d.createdByName,
    createdAt: d.createdAt.toISOString(),
    approvedByName: d.approvedByName,
  }));
}

export async function drawingLines(id: number): Promise<DrawingLineRow[]> {
  const [lines, gtp] = await Promise.all([prisma.approvedDrawingLine.findMany({ where: { drawingId: id }, orderBy: { rowNo: 'asc' } }), gtpMap()]);
  return lines.map((l) => {
    const row = { lengthMm: l.lengthMm, qtyPerSet: dec(l.qtyPerSet), kgPerM: dec(l.kgPerM), unitWtKg: dec(l.unitWtKg) };
    return { id: l.id, rowNo: l.rowNo, markNo: l.markNo, description: l.description, section: l.section, sectionKey: l.sectionKey, ...row, category: l.category, rateKey: l.rateKey, nonBillable: l.nonBillable, kg: lineKg(row, l.sectionKey ? gtp.get(l.sectionKey) : null) };
  });
}

const t = (v: unknown, max = 200) => String(v ?? '').trim().slice(0, max) || null;

export interface DrawingHeader {
  utility: string;
  state: string | null;
  itemType: string;
  drawingNo: string;
  revision: string;
  approvalLetterNo: string | null;
  approvalDate: Date | null;
  fileLink: string | null;
  remarks: string | null;
}

export function drawingHeader(input: Record<string, unknown>): DrawingHeader {
  const utility = t(input.utility, 200);
  const itemType = t(input.itemType, 200);
  const drawingNo = t(input.drawingNo, 100);
  if (!utility) throw new UserError('Utility is required.');
  if (!itemType) throw new UserError('Item / structure type is required.');
  if (!drawingNo) throw new UserError('Drawing no. is required.');
  const date = t(input.approvalDate, 10);
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)))) throw new UserError('Approval date must be a date.');
  const link = t(input.fileLink, 1000);
  if (link && !/^https?:\/\//i.test(link)) throw new UserError('File link must start with http:// or https:// (Laser Drive link).');
  return {
    utility,
    state: t(input.state, 100),
    itemType,
    drawingNo,
    revision: t(input.revision, 20) ?? '0',
    approvalLetterNo: t(input.approvalLetterNo, 200),
    approvalDate: date ? new Date(`${date}T00:00:00Z`) : null,
    fileLink: link,
    remarks: t(input.remarks, 1000),
  };
}

export function lineData(lines: BomLineDraft[]) {
  return lines.map((l, i) => ({
    rowNo: i + 1,
    markNo: l.markNo,
    description: l.description,
    section: l.section,
    sectionKey: l.category === 'STRUCTURE' ? (l.sectionKey ?? sectionKey(l.section)) : null,
    lengthMm: l.lengthMm,
    qtyPerSet: l.qtyPerSet,
    kgPerM: l.kgPerM,
    unitWtKg: l.unitWtKg,
    category: l.category,
    rateKey: l.rateKey,
    nonBillable: !!l.nonBillable,
  }));
}

/** Admin, or a named technical user (users.drawing_editor), may add drawings. */
export async function canAddDrawings(user: AuthUser) {
  if (user.role === 'Admin') return true;
  const u = await prisma.user.findUnique({ where: { id: user.id }, select: { drawingEditor: true } });
  return !!u?.drawingEditor;
}

/**
 * New drawing (with its BOM lines). Adding the same drawing no + revision again is refused. When
 * `supersedePrevious`, other APPROVED revisions of the same drawing no become SUPERSEDED.
 */
export async function createDrawing(input: Record<string, unknown>, rawLines: unknown, user: AuthUser, fromItemBomId: number | null = null) {
  if (!(await canAddDrawings(user))) throw new UserError('Only an Admin or a named technical user can add drawings.');
  const h = drawingHeader(input);
  // Admin-added drawings are approved at once; a technical user's addition waits for an Admin.
  const isAdmin = user.role === 'Admin';
  const lines = cleanLines(Array.isArray(rawLines) ? (rawLines as Record<string, unknown>[]) : []);
  if (lines.length === 0) throw new UserError('Add the BOM lines of the drawing (at least one).');
  const supersede = input.supersedePrevious !== false && input.supersedePrevious !== 'false';
  return prisma.$transaction(async (tx) => {
    const clash = await tx.approvedDrawing.findUnique({ where: { drawingNo_revision: { drawingNo: h.drawingNo, revision: h.revision } } });
    if (clash) throw new UserError(`Drawing ${h.drawingNo} rev ${h.revision} is already in the library.`);
    const d = await tx.approvedDrawing.create({
      data: {
        ...h,
        status: isAdmin ? 'APPROVED' : 'PENDING',
        approvedByName: isAdmin ? user.name : null,
        approvedAt: isAdmin ? new Date() : null,
        fromItemBomId,
        createdById: user.id,
        createdByName: user.name,
        lines: { create: lineData(lines) },
      },
    });
    let superseded = 0;
    if (supersede && isAdmin) {
      const r = await tx.approvedDrawing.updateMany({ where: { drawingNo: h.drawingNo, status: 'APPROVED', id: { not: d.id } }, data: { status: 'SUPERSEDED' } });
      superseded = r.count;
    }
    await tx.editLog.create({
      data: {
        tableName: 'approved_drawings',
        recordId: d.id,
        fieldName: 'ALL_FIELDS',
        oldValue: 'NONE (New Record)',
        newValue: JSON.stringify({ ...h, lines: lines.length, superseded, fromItemBomId }),
        ...auditUser(user),
      },
    });
    return { id: d.id, superseded, status: d.status };
  });
}

/** Admin approves a drawing a technical user added (older revisions of the same no. are superseded). */
export async function approveDrawing(id: number, user: AuthUser) {
  return prisma.$transaction(async (tx) => {
    const d = await tx.approvedDrawing.findUnique({ where: { id } });
    if (!d) throw new UserError('Drawing not found.');
    if (d.status !== 'PENDING') throw new UserError('Only a pending drawing can be approved.');
    await tx.approvedDrawing.update({ where: { id }, data: { status: 'APPROVED', approvedByName: user.name, approvedAt: new Date() } });
    const r = await tx.approvedDrawing.updateMany({ where: { drawingNo: d.drawingNo, status: 'APPROVED', id: { not: id } }, data: { status: 'SUPERSEDED' } });
    await tx.editLog.create({ data: { tableName: 'approved_drawings', recordId: id, fieldName: 'status', oldValue: 'PENDING', newValue: `APPROVED${r.count ? ` (${r.count} older superseded)` : ''}`, ...auditUser(user) } });
    return { id };
  });
}

export async function listTechnicalUsers() {
  const users = await prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true, username: true, role: true, drawingEditor: true }, orderBy: { name: 'asc' } });
  return users;
}

/** Admin names the technical users who may add drawings. */
export async function setDrawingEditor(userId: number, on: boolean, user: AuthUser) {
  return prisma.$transaction(async (tx) => {
    const u = await tx.user.findUnique({ where: { id: userId } });
    if (!u) throw new UserError('User not found.');
    await tx.user.update({ where: { id: userId }, data: { drawingEditor: on } });
    await tx.editLog.create({ data: { tableName: 'users', recordId: userId, fieldName: 'drawing_editor', oldValue: String(u.drawingEditor), newValue: String(on), ...auditUser(user) } });
    return { id: userId };
  });
}

const EDITABLE = ['utility', 'state', 'itemType', 'approvalLetterNo', 'approvalDate', 'fileLink', 'remarks', 'status'] as const;

export async function updateDrawingField(id: number, field: string, value: string, user: AuthUser) {
  if (!(EDITABLE as readonly string[]).includes(field)) throw new UserError('This field cannot be edited.');
  if (!(await canAddDrawings(user))) throw new UserError('Only an Admin or a named technical user can edit drawings.');
  return prisma.$transaction(async (tx) => {
    const d = await tx.approvedDrawing.findUnique({ where: { id } });
    if (!d) throw new UserError('Drawing not found.');
    const data: Prisma.ApprovedDrawingUpdateInput = {};
    const v = value.trim();
    if (field === 'status') {
      if (v !== 'APPROVED' && v !== 'SUPERSEDED') throw new UserError('Status is Approved or Superseded.');
      if (user.role !== 'Admin') throw new UserError('Only an Admin can approve or supersede a drawing.');
      data.status = v;
    } else if (field === 'approvalDate') {
      if (v && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v)))) throw new UserError('Enter a date.');
      data.approvalDate = v ? new Date(`${v}T00:00:00Z`) : null;
    } else if (field === 'fileLink') {
      if (v && !/^https?:\/\//i.test(v)) throw new UserError('File link must start with http(s)://');
      data.fileLink = v || null;
    } else if (field === 'utility' || field === 'itemType') {
      if (!v) throw new UserError('This field is required.');
      data[field] = v.slice(0, 200);
    } else data[field as 'state' | 'approvalLetterNo' | 'remarks'] = v.slice(0, 1000) || null;
    await tx.approvedDrawing.update({ where: { id }, data });
    const old = (d as Record<string, unknown>)[field];
    await tx.editLog.create({
      data: { tableName: 'approved_drawings', recordId: id, fieldName: field, oldValue: old instanceof Date ? ymd(old) : old === null ? '' : String(old), newValue: v, ...auditUser(user) },
    });
    return { id };
  });
}

export async function deleteDrawing(id: number, user: AuthUser) {
  return prisma.$transaction(async (tx) => {
    const d = await tx.approvedDrawing.findUnique({ where: { id }, include: { lines: true } });
    if (!d) throw new UserError('Drawing not found.');
    await tx.approvedDrawing.delete({ where: { id } });
    await tx.editLog.create({ data: { tableName: 'approved_drawings', recordId: id, fieldName: 'DELETED', oldValue: JSON.stringify(d), newValue: null, ...auditUser(user) } });
    return { id };
  });
}
