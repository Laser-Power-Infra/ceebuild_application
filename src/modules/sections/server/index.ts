import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { auditUser, type AuthUser } from '@/lib/auth/server';
import { UserError } from '@/lib/actionResult';
import { fetchFacet, fetchPage, plain, type TableSpec } from '@/lib/serverTable';
import { sectionKey, toNum, autoMapHeaders } from '@/lib/bom/parse';
import { recheckOpenUploads } from '@/modules/bom/server/mutations';
import { readWorkbook, sheetCells } from '@/modules/bom/server/workbook';
import type { TablePage, TableQuery } from '@/components/data-table/types';
import { EDITABLE_SECTION_FIELDS, type SectionRow } from '../columns';

const sql = Prisma.sql;

const SPEC: TableSpec = {
  from: sql`section_master s LEFT JOIN LATERAL (SELECT count(*)::int AS n FROM bom_pieces p WHERE p.section_key = s.section_key) u ON TRUE`,
  fallbackOrder: sql`s.label ASC, s.id ASC`,
  fields: {
    id: { text: sql`s.id::text`, raw: sql`s.id`, kind: 'number', searchable: false },
    label: { text: sql`s.label`, kind: 'text' },
    sectionKey: { text: sql`s.section_key`, kind: 'text' },
    kgPerM: { text: sql`s.kg_per_m::text`, raw: sql`s.kg_per_m::float`, kind: 'number', searchable: false },
    grade: { text: sql`s.grade`, kind: 'text' },
    approved: { text: sql`(CASE WHEN s.approved THEN 'Yes' ELSE 'No' END)`, kind: 'text', searchable: false },
    source: { text: sql`s.source`, kind: 'text' },
    usedInBoms: { text: sql`u.n::text`, raw: sql`u.n`, kind: 'number', searchable: false },
  },
};

export async function listSections(query: TableQuery): Promise<TablePage<SectionRow>> {
  const { rows, agg } = await fetchPage<SectionRow, { total: number }>(SPEC, query, sql`count(*)::int AS total`);
  return { rows: plain(rows), total: agg.total };
}
export const listSectionsFacet = (key: string, query: TableQuery) => fetchFacet(SPEC, key, query);

function parseKgm(v: unknown) {
  const n = toNum(v);
  if (n === null || n <= 0) throw new UserError('kg/m must be a positive number.');
  return n;
}

/** Add or replace by match key; then (after commit) re-checks every draft BOM. */
export async function upsertSection(input: Record<string, unknown>, user: AuthUser) {
  const label = String(input.label ?? '').trim().slice(0, 100);
  const key = sectionKey(label);
  if (!key) throw new UserError('Section is required.');
  const data = {
    label,
    kgPerM: parseKgm(input.kgPerM),
    grade: String(input.grade ?? '').trim().slice(0, 50) || null,
    approved: input.approved !== false && input.approved !== 'No',
    source: String(input.source ?? '').trim().slice(0, 200) || null,
  };
  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.sectionMaster.findUnique({ where: { sectionKey: key } });
    const row = await tx.sectionMaster.upsert({ where: { sectionKey: key }, create: { sectionKey: key, ...data }, update: data });
    await tx.editLog.create({
      data: {
        tableName: 'section_master',
        recordId: row.id,
        fieldName: before ? 'ALL_FIELDS (updated)' : 'ALL_FIELDS',
        oldValue: before ? JSON.stringify(before) : 'NONE (New Record)',
        newValue: JSON.stringify({ sectionKey: key, ...data }),
        ...auditUser(user),
      },
    });
    return { id: row.id };
  });
  await recheckOpenUploads(); // after commit: one short transaction per draft BOM
  return result;
}

export async function updateSectionField(id: number, field: string, value: string, user: AuthUser) {
  if (!(EDITABLE_SECTION_FIELDS as readonly string[]).includes(field)) throw new UserError('This column cannot be edited.');
  const result = await prisma.$transaction(async (tx) => {
    const row = await tx.sectionMaster.findUnique({ where: { id } });
    if (!row) throw new UserError('Section not found.');
    const text = value.trim();
    const data: Prisma.SectionMasterUpdateInput = {};
    if (field === 'label') {
      const key = sectionKey(text);
      if (!key) throw new UserError('Section is required.');
      const clash = await tx.sectionMaster.findUnique({ where: { sectionKey: key } });
      if (clash && clash.id !== id) throw new UserError(`${text} already exists.`);
      data.label = text.slice(0, 100);
      data.sectionKey = key;
    } else if (field === 'kgPerM') data.kgPerM = parseKgm(text);
    else if (field === 'approved') data.approved = text === 'Yes';
    else if (field === 'grade') data.grade = text.slice(0, 50) || null;
    else data.source = text.slice(0, 200) || null;
    await tx.sectionMaster.update({ where: { id }, data });
    const old = field === 'approved' ? (row.approved ? 'Yes' : 'No') : String((row as Record<string, unknown>)[field] ?? '');
    await tx.editLog.create({ data: { tableName: 'section_master', recordId: id, fieldName: field, oldValue: old, newValue: text, ...auditUser(user) } });
    return { id };
  });
  await recheckOpenUploads();
  return result;
}

export async function deleteSection(id: number, user: AuthUser) {
  const result = await prisma.$transaction(async (tx) => {
    const row = await tx.sectionMaster.findUnique({ where: { id } });
    if (!row) throw new UserError('Section not found.');
    await tx.sectionMaster.delete({ where: { id } });
    await tx.editLog.create({ data: { tableName: 'section_master', recordId: id, fieldName: 'DELETED', oldValue: JSON.stringify(row), newValue: null, ...auditUser(user) } });
    return { id };
  });
  await recheckOpenUploads();
  return result;
}

/**
 * Import a section list (xlsx/csv) with columns Section and kg/m, optionally Grade / Approved / Source.
 * Existing sections are updated by match key. Returns counts.
 */
export async function importSections(buffer: Buffer, fileName: string, user: AuthUser) {
  const { cells } = sheetCells(readWorkbook(buffer));
  const headerRow = cells.findIndex((r) => {
    const m = autoMapHeaders((r ?? []).map((c) => String(c ?? '').trim()));
    return m.section && m.kgPerM;
  });
  if (headerRow < 0) throw new UserError('Could not find a header row with Section and kg/m columns.');
  const headers = cells[headerRow].map((c) => String(c ?? '').trim());
  const map = autoMapHeaders(headers);
  const col = (re: RegExp) => headers.findIndex((h) => re.test(h.toLowerCase().replace(/\s/g, '')));
  const iSec = headers.indexOf(map.section!);
  const iKgm = headers.indexOf(map.kgPerM!);
  const iGrade = col(/^grade|material/);
  const iAppr = col(/^approved|gtp/);

  const rows: { key: string; label: string; kgPerM: number; grade: string | null; approved: boolean }[] = [];
  const skipped: number[] = [];
  for (let r = headerRow + 1; r < cells.length; r++) {
    const row = cells[r] ?? [];
    const label = String(row[iSec] ?? '').trim();
    const key = sectionKey(label);
    const kgPerM = toNum(row[iKgm]);
    if (!label && kgPerM === null) continue;
    if (!key || kgPerM === null || kgPerM <= 0) {
      skipped.push(r + 1);
      continue;
    }
    const appr = iAppr >= 0 ? String(row[iAppr] ?? '').trim().toLowerCase() : '';
    rows.push({ key, label, kgPerM, grade: iGrade >= 0 ? String(row[iGrade] ?? '').trim() || null : null, approved: !['no', 'n', 'false', '0'].includes(appr) });
  }
  if (rows.length === 0) throw new UserError('No valid section rows found.');

  const result = await prisma.$transaction(async (tx) => {
    let added = 0;
    let updated = 0;
    for (const s of rows) {
      const exists = await tx.sectionMaster.findUnique({ where: { sectionKey: s.key }, select: { id: true } });
      const data = { label: s.label, kgPerM: s.kgPerM, grade: s.grade, approved: s.approved, source: fileName.slice(0, 200) };
      await tx.sectionMaster.upsert({ where: { sectionKey: s.key }, create: { sectionKey: s.key, ...data }, update: data });
      if (exists) updated++;
      else added++;
    }
    await tx.editLog.create({
      data: { tableName: 'section_master', recordId: 0, fieldName: 'IMPORT', oldValue: null, newValue: JSON.stringify({ fileName, added, updated, skippedRows: skipped }), ...auditUser(user) },
    });
    return { added, updated, skipped };
  }, { timeout: 120_000 });
  await recheckOpenUploads();
  return result;
}
