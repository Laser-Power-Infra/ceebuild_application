import 'server-only';
import { Prisma } from '@prisma/client';
import { auditUser, type AuthUser } from '@/lib/auth/server';
import { checkPieces, type SectionStd } from '@/lib/bom/checks';

type Tx = Prisma.TransactionClient;
const dec = (d: Prisma.Decimal | null) => (d === null ? null : d.toNumber());
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * M14 step 7 - one BOM end to end. When an order is created from a docket, the docket items'
 * confirmed BOMs (the ones the quotation was costed on) become the order's first BOM upload
 * (source QUOTATION, status DRAFT). From there the existing order flow applies unchanged: the GTP
 * checks run, "✓ Correct BOM" locks it, and RM Indent / cutting plan / Machine Plan read the same
 * pieces. A client BOM uploaded later becomes a newer version, as before.
 *
 * Only fabricated structure lines in the purchase scope go in (nuts & bolts and bought-out items
 * are not cut or fabricated); non-billable pieces are supplied, so they are fabricated too.
 * Sets: a mixed BOM uses each structure's own set count; a single structure uses its count, or
 * the costing's sets (from a KG quantity). Fractions are rounded up to a whole set. Marks are
 * prefixed "<item>.<structure>-" when there is more than one, so two structures' "R01" stay apart.
 */
export async function copyQuotationBomToOrder(tx: Tx, orderId: number, itemIds: number[], user: AuthUser) {
  if (itemIds.length === 0) return null;
  const boms = await tx.itemBom.findMany({ where: { itemId: { in: itemIds } }, orderBy: { id: 'desc' }, include: { lines: { orderBy: { rowNo: 'asc' } }, groups: true } });
  const latest = new Map<number, (typeof boms)[number]>();
  for (const b of boms) if (!latest.has(b.itemId)) latest.set(b.itemId, b);
  const confirmed = itemIds.map((id) => latest.get(id)).filter((b): b is (typeof boms)[number] => !!b && b.status === 'CONFIRMED');
  if (confirmed.length === 0) return null;

  const costings = await tx.itemCosting.findMany({ where: { bomId: { in: confirmed.map((b) => b.id) }, applied: true }, orderBy: { id: 'desc' } });
  const sectionRows = await tx.sectionMaster.findMany({ select: { sectionKey: true, kgPerM: true, approved: true } });
  const gtp = new Map(sectionRows.map((s) => [s.sectionKey, s.kgPerM.toNumber()]));
  const master = new Map<string, SectionStd>(sectionRows.map((s) => [s.sectionKey, { kgPerM: s.kgPerM.toNumber(), approved: s.approved }]));

  const multiItem = confirmed.length > 1;
  const used: { itemBomId: number; costingId: number | null; sets: number | Record<string, number> }[] = [];
  const pieces: Omit<Prisma.BomPieceCreateManyInput, 'uploadId' | 'orderId'>[] = [];
  let rowNo = 0;
  confirmed.forEach((b, idx) => {
    const c = costings.find((x) => x.bomId === b.id);
    const multiGroup = b.groups.length > 1;
    const costSets = c ? Math.ceil(c.sets.toNumber() - 1e-9) : 0;
    const setsOf = (groupId: number | null) => {
      const g = b.groups.find((x) => x.id === groupId);
      const n = g?.sets ? g.sets.toNumber() : multiGroup ? 0 : costSets;
      return Math.ceil(n - 1e-9);
    };
    used.push({ itemBomId: b.id, costingId: c?.id ?? null, sets: multiGroup ? Object.fromEntries(b.groups.map((g) => [g.name, setsOf(g.id)])) : setsOf(b.groups[0]?.id ?? null) });
    for (const l of b.lines) {
      if (l.category !== 'STRUCTURE' || l.scope !== 'IN_SCOPE') continue;
      const sets = setsOf(l.groupId);
      if (!(sets > 0)) continue;
      const g = b.groups.find((x) => x.id === l.groupId);
      const prefix = [multiItem ? idx + 1 : null, multiGroup && g ? g.seq : null].filter((x) => x !== null).join('.');
      const q = dec(l.qtyPerSet);
      const kgm = (l.sectionKey ? gtp.get(l.sectionKey) : undefined) ?? dec(l.kgPerM);
      const total = q !== null && sets > 0 ? r3(q * sets) : null;
      pieces.push({
        rowNo: ++rowNo,
        markNo: l.markNo ? (prefix ? `${prefix}-${l.markNo}` : l.markNo) : prefix ? `${prefix}-ROW${l.rowNo}` : null,
        description: l.description,
        section: l.section,
        sectionKey: l.sectionKey,
        lengthMm: l.lengthMm,
        qtyPerSet: q,
        sets: sets > 0 ? sets : null,
        totalQty: total,
        kgPerM: kgm ?? null,
        unitWtKg: kgm && l.lengthMm ? r3((kgm * l.lengthMm) / 1000) : dec(l.unitWtKg),
        totalWtKg: kgm && l.lengthMm && total !== null ? r3((kgm * l.lengthMm * total) / 1000) : null,
        raw: { itemBomId: b.id, itemBomLineId: l.id, structure: g?.name ?? null, drawingNo: g?.drawingNo ?? b.drawingRef, nonBillable: l.nonBillable } as Prisma.InputJsonValue,
      });
    }
  });
  if (pieces.length === 0) return null;

  const flags = checkPieces(
    pieces.map((p) => ({ markNo: p.markNo ?? null, sectionKey: p.sectionKey ?? null, lengthMm: p.lengthMm ?? null, qtyPerSet: p.qtyPerSet as number | null, sets: p.sets as number | null, totalQty: p.totalQty as number | null, kgPerM: p.kgPerM as number | null, unitWtKg: p.unitWtKg as number | null })),
    master,
  );
  const upload = await tx.bomUpload.create({
    data: {
      orderId,
      fileName: `Quotation BOM (${confirmed.map((b) => b.drawingRef || b.fileName || `item BOM #${b.id}`).join('; ')})`.slice(0, 255),
      source: 'QUOTATION',
      columnMap: { source: 'QUOTATION', itemBomIds: used.map((u) => u.itemBomId), detail: used } as Prisma.InputJsonValue,
      rowCount: pieces.length,
      uploadedById: user.id,
      uploadedByName: user.name,
    },
  });
  await tx.bomPiece.createMany({ data: pieces.map((p, i) => ({ ...p, uploadId: upload.id, orderId, ...flags[i] })) });
  await tx.editLog.create({
    data: {
      tableName: 'bom_uploads',
      recordId: upload.id,
      fieldName: 'ALL_FIELDS',
      oldValue: 'NONE (New Record)',
      newValue: JSON.stringify({ orderId, source: 'QUOTATION', rows: pieces.length, itemBoms: used }),
      ...auditUser(user),
    },
  });
  return { uploadId: upload.id, rows: pieces.length, missingSets: used.filter((u) => u.sets === 0).length };
}
