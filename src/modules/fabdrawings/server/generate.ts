import 'server-only';
import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { auditUser, type AuthUser } from '@/lib/auth/server';
import { UserError } from '@/lib/actionResult';
import { classifyFab } from '@/lib/costing/fab';
import { buildFabModel, codeOf, itemCodeOf, type FabBom, type FabModel } from '@/lib/fabdrawing/model';
import { renderFabPdf, sheetPlan } from '@/lib/fabdrawing/render';
import { activeStandards } from './standards';

const COMPANY = 'Ceebuild Company Pvt. Ltd.';

/** DD-MM-YYYY in India time. */
function todayIst(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${get('day')}-${get('month')}-${get('year')}`;
}

/** sha256 of the cutting list (what production cuts): mark, section, length, qty/set, total. */
export function cuttingHash(model: FabModel) {
  const rows = model.cutting.flatMap((g) => g.rows.map((r) => [g.name, r.markNo, r.section, r.lengthMm, r.qtyPerSet, r.totalQty]));
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

/**
 * Generate the fabrication drawing PDF of a confirmed item BOM. The latest DRAFT revision of the
 * same drawing no. is overwritten; after an ISSUED / CONFIRMED one a new Rev is made.
 * Hole positions etc. are not entered yet (drawing_features, later phase): the PDF lists them as
 * "to be confirmed by production".
 */
export async function generateFabDrawings(bomId: number, opts: { itemCode?: unknown; changeNote?: unknown }, user: AuthUser) {
  const bom = await prisma.itemBom.findUnique({
    where: { id: bomId },
    include: { lines: { orderBy: { rowNo: 'asc' } }, groups: { orderBy: { seq: 'asc' } }, drawing: true },
  });
  if (!bom) throw new UserError('BOM not found.');
  if (bom.status !== 'CONFIRMED') throw new UserError('Confirm the BOM first: fabrication drawings are made from a confirmed BOM only.');
  const item = await prisma.itemTable.findUnique({ where: { id: bom.itemId } });
  const docket = bom.docketId ? await prisma.dockerPartyName.findUnique({ where: { id: bom.docketId } }) : null;

  const structureType = bom.structureType ?? item?.ourItemName ?? null;
  const clientCode = codeOf(docket?.utility || docket?.partyName?.split(/\s+/)[0], 'CLIENT');
  const itemCode = String(opts.itemCode ?? '').trim() ? codeOf(String(opts.itemCode).toUpperCase(), 'STR').slice(0, 6) : itemCodeOf(structureType);
  const drawingNoBase = `CB/${clientCode}/${itemCode}`;

  const latest = await prisma.fabDrawingSet.findFirst({ where: { drawingNo: drawingNoBase }, orderBy: { rev: 'desc' } });
  const reuse = latest && latest.status === 'DRAFT' ? latest : null;
  const rev = reuse ? reuse.rev : latest ? latest.rev + 1 : 0;
  const changeNote = String(opts.changeNote ?? '').trim().slice(0, 500) || null;
  if (rev > 0 && !reuse && !changeNote) throw new UserError(`Rev ${rev - 1} of ${drawingNoBase} is ${latest!.status.toLowerCase()}: give a change note for Rev ${rev}.`);

  const groupName = (id: number | null) => bom.groups.find((g) => g.id === id)?.name ?? null;
  const fabBom: FabBom = {
    structureType,
    drawingRef: bom.drawingRef,
    galvanised: bom.galvanised,
    painted: bom.painted,
    fabType: bom.fabType,
    groups: bom.groups.map((g) => ({ id: g.id, name: g.name, drawingNo: g.drawingNo, sets: g.sets === null ? null : g.sets.toNumber() })),
    lines: bom.lines.map((l) => ({
      groupId: l.groupId,
      rowNo: l.rowNo,
      markNo: l.markNo,
      description: l.description,
      section: l.section,
      lengthMm: l.lengthMm,
      qtyPerSet: l.qtyPerSet === null ? null : l.qtyPerSet.toNumber(),
      category: l.category,
      scope: l.scope,
      fabCat:
        l.fabCat ??
        (l.category === 'STRUCTURE'
          ? classifyFab({ sectionKey: l.sectionKey, section: l.section, description: l.description, lengthMm: l.lengthMm, structureType: (bom.groups.length > 1 ? groupName(l.groupId) : null) ?? structureType })
          : null),
    })),
  };
  const standards = await activeStandards();
  const basis = [bom.drawing ? `${bom.drawing.drawingNo} Rev ${bom.drawing.revision}${bom.drawing.approvalLetterNo ? ` (${bom.drawing.approvalLetterNo})` : ''}` : bom.drawingRef, `item BOM #${bom.id}`]
    .filter(Boolean)
    .join('; ');
  const project = [docket?.utility, docket?.partyName, item?.itemNameParty ?? structureType].filter(Boolean).join(' – ') || (structureType ?? 'Fabrication');
  const model = buildFabModel({
    bom: fabBom,
    standards,
    header: { company: COMPANY, project, clientCode, itemCode, rev, date: todayIst(), basis, preparedBy: user.name, checkedBy: null, approvedBy: null, status: 'DRAFT' },
  });
  const bytes = await renderFabPdf(model);
  const pageCount = sheetPlan(model).total;
  const hash = cuttingHash(model);
  const snapshot = { standards, decisions: model.decisions, toConfirm: model.toConfirm } as object;

  const data = {
    itemBomId: bom.id,
    itemId: bom.itemId,
    docketId: bom.docketId,
    clientCode,
    itemCode,
    basisRef: basis.slice(0, 500),
    pageCount,
    cuttingHash: hash,
    snapshot,
    preparedByName: user.name,
  };
  const set = await prisma.$transaction(async (tx) => {
    const s = reuse
      ? await tx.fabDrawingSet.update({ where: { id: reuse.id }, data: { ...data, ...(changeNote ? { changeNote } : {}) } })
      : await tx.fabDrawingSet.create({ data: { ...data, drawingNo: drawingNoBase, rev, status: 'DRAFT', changeNote, createdById: user.id, createdByName: user.name } });
    await tx.editLog.create({
      data: {
        tableName: 'fab_drawing_sets',
        recordId: s.id,
        fieldName: reuse ? 'REGENERATED' : 'ALL_FIELDS',
        oldValue: reuse ? reuse.cuttingHash : 'NONE (New Record)',
        newValue: JSON.stringify({ drawingNo: drawingNoBase, rev, bomId: bom.id, pages: pageCount, cuttingHash: hash }),
        ...auditUser(user),
      },
    });
    return s;
  });

  const fileName = `${drawingNoBase.replace(/\//g, '_')}_Rev${rev}_${todayIst()}.pdf`;
  return { setId: set.id, drawingNo: drawingNoBase, rev, pageCount, toConfirm: model.toConfirm.length, fileName, base64: Buffer.from(bytes).toString('base64') };
}
