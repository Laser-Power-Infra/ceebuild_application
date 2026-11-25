import 'server-only';
import { prisma } from '@/lib/prisma';
import { auditUser, type AuthUser } from '@/lib/auth/server';
import { UserError } from '@/lib/actionResult';
import { mergeStandards, STANDARD_KINDS, type DrawingStandard, type StandardKind } from '@/lib/fabdrawing/standards';

export interface DrawingStandardRow extends DrawingStandard {
  id: number;
  sortOrder: number;
  active: boolean;
  updatedByName: string | null;
  updatedAt: string;
}

const isKind = (v: unknown): v is StandardKind => (STANDARD_KINDS as readonly string[]).includes(String(v));

export async function listDrawingStandards(): Promise<DrawingStandardRow[]> {
  const rows = await prisma.drawingStandard.findMany({ orderBy: [{ sortOrder: 'asc' }, { kind: 'asc' }, { key: 'asc' }] });
  return rows.map((r) => ({
    id: r.id,
    kind: isKind(r.kind) ? r.kind : 'MATERIAL',
    key: r.key,
    numValue: r.numValue === null ? null : r.numValue.toNumber(),
    textValue: r.textValue,
    unit: r.unit,
    note: r.note,
    sortOrder: r.sortOrder,
    active: r.active,
    updatedByName: r.updatedByName,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

/** Active master rows over the built-in defaults (a missing table row falls back to the default). */
export async function activeStandards(): Promise<DrawingStandard[]> {
  const rows = await listDrawingStandards();
  return mergeStandards(rows.filter((r) => r.active).map(({ kind, key, numValue, textValue, unit, note }) => ({ kind, key, numValue, textValue, unit, note })));
}

/** Admin-only edit of one rule's value / note / active flag; every change goes to the audit log. */
export async function updateDrawingStandard(id: number, input: Record<string, unknown>, user: AuthUser): Promise<DrawingStandardRow> {
  const row = await prisma.drawingStandard.findUnique({ where: { id } });
  if (!row) throw new UserError('Standard not found.');
  const data: { numValue?: number | null; textValue?: string | null; note?: string | null; active?: boolean } = {};
  if ('numValue' in input) {
    const s = String(input.numValue ?? '').trim();
    if (s === '') data.numValue = null;
    else {
      const n = Number(s);
      if (!Number.isFinite(n) || n < 0 || n > 100000) throw new UserError('Value must be a number from 0 to 100000.');
      data.numValue = Math.round(n * 1000) / 1000;
    }
  }
  if ('textValue' in input) data.textValue = String(input.textValue ?? '').trim().slice(0, 1000) || null;
  if ('note' in input) data.note = String(input.note ?? '').trim().slice(0, 500) || null;
  if ('active' in input) data.active = input.active !== false;
  const numAfter = 'numValue' in data ? data.numValue : row.numValue?.toNumber() ?? null;
  const textAfter = 'textValue' in data ? data.textValue : row.textValue;
  if (numAfter === null && !textAfter) throw new UserError('A standard needs a number or a text value.');

  const before: Record<string, unknown> = { numValue: row.numValue?.toNumber() ?? null, textValue: row.textValue, note: row.note, active: row.active };
  const changed = Object.entries(data).filter(([k, v]) => String(before[k] ?? '') !== String(v ?? ''));
  if (changed.length) {
    await prisma.$transaction([
      prisma.drawingStandard.update({ where: { id }, data: { ...data, updatedByName: user.name } }),
      prisma.editLog.createMany({
        data: changed.map(([k, v]) => ({
          tableName: 'drawing_standards',
          recordId: id,
          fieldName: `${row.kind}:${row.key}.${k}`,
          oldValue: String(before[k] ?? ''),
          newValue: String(v ?? ''),
          ...auditUser(user),
        })),
      }),
    ]);
  }
  return (await listDrawingStandards()).find((r) => r.id === id)!;
}
