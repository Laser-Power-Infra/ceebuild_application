import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { fetchFacet, fetchPage, plain, type TableSpec } from '@/lib/serverTable';
import type { TablePage, TableQuery } from '@/components/data-table/types';
import { FLAGS, type FlagKey, type PieceRow, type PiecesMeta } from '../columns';

const sql = Prisma.sql;

const numField = (col: string) => ({
  text: sql`${Prisma.raw(`p.${col}`)}::text`,
  raw: sql`${Prisma.raw(`p.${col}`)}::float`,
  kind: 'number' as const,
  searchable: false,
});

const ANY_FLAG = sql`(${Prisma.join(FLAGS.map((f) => Prisma.raw(`p.${f.column}`)), ' OR ')})`;

const piecesSpec = (uploadId: number): TableSpec => ({
  from: sql`bom_pieces p`,
  scope: sql`p.upload_id = ${uploadId}`,
  fallbackOrder: sql`p.row_no ASC, p.id ASC`,
  fields: {
    id: { text: sql`p.id::text`, raw: sql`p.id`, kind: 'number', searchable: false },
    rowNo: { text: sql`p.row_no::text`, raw: sql`p.row_no`, kind: 'number', searchable: false },
    markNo: { text: sql`p.mark_no`, kind: 'text' },
    description: { text: sql`p.description`, kind: 'text' },
    section: { text: sql`p.section`, kind: 'text' },
    lengthMm: { text: sql`p.length_mm::text`, raw: sql`p.length_mm`, kind: 'number' },
    qtyPerSet: numField('qty_per_set'),
    sets: numField('sets'),
    totalQty: numField('total_qty'),
    kgPerM: numField('kg_per_m'),
    unitWtKg: numField('unit_wt_kg'),
    totalWtKg: numField('total_wt_kg'),
    flagged: { text: sql`(CASE WHEN ${ANY_FLAG} THEN 'Yes' ELSE 'No' END)`, raw: ANY_FLAG, kind: 'boolean', searchable: false },
    issues: { text: sql`p.issues`, kind: 'text' },
  },
});

/** "flag" quick filter from the KPI tiles: one flag key, or "any". */
function flagPredicate(query: TableQuery): Prisma.Sql[] {
  const flag = String(query.extra?.flag ?? '');
  if (flag === 'any') return [ANY_FLAG];
  const f = FLAGS.find((x) => x.key === flag);
  return f ? [sql`${Prisma.raw(`p.${f.column}`)}`] : [];
}

const AGG = sql`count(*)::int AS total, coalesce(sum(p.total_wt_kg), 0)::float AS "totalWtKg",
  count(*) FILTER (WHERE ${ANY_FLAG})::int AS flagged,
  ${Prisma.join(FLAGS.map((f) => sql`count(*) FILTER (WHERE ${Prisma.raw(`p.${f.column}`)})::int AS ${Prisma.raw(`"${f.key}"`)}`), ', ')}`;

export async function listPieces(uploadId: number, query: TableQuery): Promise<TablePage<PieceRow, PiecesMeta>> {
  const spec = piecesSpec(uploadId);
  // Flag counts ignore the flag toggle itself so every tile keeps its number.
  const [{ rows, agg }, counts] = await Promise.all([
    fetchPage<PieceRow, { total: number; totalWtKg: number; flagged: number }>(spec, query, sql`count(*)::int AS total,
      coalesce(sum(p.total_wt_kg), 0)::float AS "totalWtKg", count(*) FILTER (WHERE ${ANY_FLAG})::int AS flagged`, flagPredicate(query)),
    fetchPage<never, { total: number } & Record<FlagKey, number>>(spec, { ...query, page: 1, pageSize: 1 }, AGG),
  ]);
  const flagCounts = Object.fromEntries(FLAGS.map((f) => [f.key, counts.agg[f.key] ?? 0])) as Record<FlagKey, number>;
  return { rows: plain(rows), total: agg.total, meta: { totalWtKg: agg.totalWtKg, flagged: agg.flagged, flagCounts } };
}

export const listPiecesFacet = (uploadId: number, key: string, query: TableQuery) =>
  fetchFacet(piecesSpec(uploadId), key, query, flagPredicate(query));

export interface UploadSummary {
  id: number;
  fileName: string;
  sheetName: string | null;
  archived: boolean;
  status: 'DRAFT' | 'CORRECT';
  rowCount: number;
  uploadedByName: string | null;
  createdAt: string;
  confirmedByName: string | null;
  confirmedAt: string | null;
  overrideNote: string | null;
  flagged: number;
  totalWtKg: number;
  sectionMasterCount: number;
  previousUploads: number;
}

/** The order's current BOM (latest upload) with its headline numbers, or null if none yet. */
export async function currentUpload(orderId: number): Promise<UploadSummary | null> {
  const [u, sectionMasterCount] = await Promise.all([
    prisma.bomUpload.findFirst({ where: { orderId }, orderBy: { id: 'desc' } }),
    prisma.sectionMaster.count({ where: { approved: true } }),
  ]);
  if (!u) return null;
  const [stats] = await prisma.$queryRaw<{ flagged: number; wt: number }[]>(sql`SELECT
      count(*) FILTER (WHERE ${ANY_FLAG})::int AS flagged, coalesce(sum(p.total_wt_kg), 0)::float AS wt
    FROM bom_pieces p WHERE p.upload_id = ${u.id}`);
  const previousUploads = await prisma.bomUpload.count({ where: { orderId, id: { lt: u.id } } });
  return {
    id: u.id,
    fileName: u.fileName,
    sheetName: u.sheetName,
    archived: !!u.s3Key,
    status: u.status === 'CORRECT' ? 'CORRECT' : 'DRAFT',
    rowCount: u.rowCount,
    uploadedByName: u.uploadedByName,
    createdAt: u.createdAt.toISOString(),
    confirmedByName: u.confirmedByName,
    confirmedAt: u.confirmedAt?.toISOString() ?? null,
    overrideNote: u.overrideNote,
    flagged: stats.flagged,
    totalWtKg: stats.wt,
    sectionMasterCount,
    previousUploads,
  };
}
