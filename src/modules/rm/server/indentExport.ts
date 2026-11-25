import 'server-only';
import { prisma } from '@/lib/prisma';
import { UserError } from '@/lib/actionResult';
import type { BarPattern, IndentLine, SectionInfo, StockUse } from '@/lib/planning/cutting';
import { buildIndentWorkbook, defaultIndentNotes, writeIndentXlsx } from '@/lib/planning/indentExcel';
import type { IndentSettingsSnapshot } from '../columns';

const ddmmyyyy = (d: Date) => `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
const num = (v: { toNumber(): number } | null) => (v === null ? 0 : v.toNumber());

/** One indent as the Rev 2 Excel workbook (INDENT, SECTION SUMMARY, CHANGES-HOLD, OFFCUT USED, NOTES). */
export async function exportIndentExcel(id: number): Promise<{ fileName: string; base64: string }> {
  const ind = await prisma.rmIndent.findUnique({
    where: { id },
    include: {
      lines: { orderBy: { id: 'asc' } },
      order: { select: { poNumber: true, poDate: true, client: true, docket: { select: { partyName: true } } } },
    },
  });
  if (!ind) throw new UserError('Indent not found.');
  const settings = ind.settings as unknown as IndentSettingsSnapshot;
  const stored = (ind.plan ?? {}) as { patterns?: BarPattern[]; warnings?: string[]; stock?: StockUse[] };

  const lines: IndentLine[] = ind.lines.map((l) => ({
    sectionKey: l.sectionKey,
    sectionLabel: l.sectionLabel ?? l.sectionKey,
    barLengthMm: l.barLengthMm,
    lineType: l.lineType as IndentLine['lineType'],
    forMark: l.forMark,
    piecesPerBar: l.piecesPerBar,
    bars: l.bars,
    bufferBars: l.bufferBars,
    kgPerM: num(l.kgPerM),
    wtKg: num(l.wtKg),
  }));

  const pieces = ind.bomUploadId
    ? await prisma.bomPiece.findMany({
        where: { uploadId: ind.bomUploadId },
        orderBy: { rowNo: 'asc' },
        select: { rowNo: true, markNo: true, description: true, sectionKey: true, lengthMm: true, totalQty: true },
      })
    : [];
  const bom = pieces
    .filter((p) => p.sectionKey && p.lengthMm && p.totalQty && p.totalQty.toNumber() > 0)
    .map((p) => ({ markNo: (p.markNo?.trim() || `ROW ${p.rowNo}`).toUpperCase(), sectionKey: p.sectionKey!, lengthMm: p.lengthMm!, qty: p.totalQty!.toNumber(), description: p.description }));

  const keys = [...new Set([...bom.map((p) => p.sectionKey), ...lines.map((l) => l.sectionKey)])];
  const masters = await prisma.sectionMaster.findMany({ where: { sectionKey: { in: keys } }, select: { sectionKey: true, label: true, grade: true, kgPerM: true, maxBarMm: true } });
  const sections: Record<string, SectionInfo> = {};
  for (const l of lines) sections[l.sectionKey] ??= { label: l.sectionLabel, kgPerM: l.kgPerM, maxBarMm: null };
  // Section / specification column: GTP label with its grade.
  for (const m of masters) sections[m.sectionKey] = { label: m.grade ? `${m.label} (${m.grade})` : m.label, kgPerM: sections[m.sectionKey]?.kgPerM ?? m.kgPerM.toNumber(), maxBarMm: m.maxBarMm };

  const party = ind.order.client?.trim() || ind.order.docket.partyName || '';
  const status =
    ind.status === 'CANCELLED' ? 'CANCELLED – superseded, do not order' : ind.status === 'ISSUED' ? `Issued ${ind.issuedAt ? ddmmyyyy(ind.issuedAt) : ''}`.trim() : 'DRAFT – not issued';
  const revisionLine = [
    `${ind.indentNo} (${ind.kind === 'SUPPLEMENTARY' ? 'Supplementary' : 'Primary'}, ${ind.strategy === 'STANDARD' ? '6 m only' : 'Mixed custom + 6 m'})`,
    `Indent date: ${ddmmyyyy(ind.createdAt)}`,
    status,
    ind.remarks ? `Reason: ${ind.remarks}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const notes = [
    ...defaultIndentNotes(settings),
    ...(settings.confirmed ? [] : ['Planning settings are not yet confirmed by the plant.']),
    ...(stored.warnings ?? []),
  ];

  const book = buildIndentWorkbook({
    orderLine: `Order: ${party} PO No. ${ind.order.poNumber} dt ${ddmmyyyy(ind.order.poDate)}`,
    revisionLine,
    plan: { lines, patterns: stored.patterns ?? [], stock: stored.stock },
    settings,
    sections,
    bom,
    notes,
  });
  return { fileName: `${ind.indentNo}.xlsx`, base64: writeIndentXlsx(book, 'base64') };
}
