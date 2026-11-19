import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { auditUser, type AuthUser } from '@/lib/auth/server';
import { UserError } from '@/lib/actionResult';
import { defaultRouting, isCutOp, operationsOf, OPERATION_LABELS, unitsPerPiece, type Operation, type Routing } from '@/lib/planning/machines';
import type { ProgressRow, RoutingInput, RoutingRow } from '../columns';
import { effectiveRouting, loadBoms, loadProduced, loadSavedRoutings, normMark } from './data';

type Tx = Prisma.TransactionClient;
const sql = Prisma.sql;
const COUNT_FIELDS = ['holes', 'notches', 'bends', 'welds', 'threads'] as const;
const MAX_COUNT = 999;

/** Every mark of the order's current BOM with its effective routing. */
export async function listRouting(orderId: number): Promise<{ bomStatus: string | null; rows: RoutingRow[] }> {
  const [boms, saved] = await Promise.all([loadBoms([orderId]), loadSavedRoutings([orderId])]);
  const bom = boms.get(orderId);
  if (!bom) return { bomStatus: null, rows: [] };
  return {
    bomStatus: bom.status,
    rows: bom.marks.map((m) => {
      const { routing, saved: isSaved } = effectiveRouting(m, saved.get(orderId));
      return { markNo: m.markNo, section: m.section, description: m.description, qty: m.qty, routing, saved: isSaved, operations: operationsOf(routing) };
    }),
  };
}

/** Per mark, pieces produced on each operation the mark needs (required = BOM qty). */
export async function orderProgress(orderId: number): Promise<ProgressRow[]> {
  const [boms, saved, produced] = await Promise.all([loadBoms([orderId]), loadSavedRoutings([orderId]), loadProduced([orderId])]);
  const bom = boms.get(orderId);
  if (!bom) return [];
  return bom.marks.map((m) => {
    const { routing } = effectiveRouting(m, saved.get(orderId));
    const done = produced.get(orderId)?.get(m.markNo) ?? {};
    const ops: ProgressRow['ops'] = {};
    for (const op of operationsOf(routing)) ops[op] = done[op] ?? 0;
    // Work already booked on an operation the routing no longer has stays visible.
    for (const [op, n] of Object.entries(done)) if (!(op in ops) && n) ops[op as Operation] = n;
    return { markNo: m.markNo, section: m.section, qty: m.qty, ops };
  });
}

function parseRouting(r: Record<string, unknown>): RoutingInput {
  const markNo = normMark(r.markNo);
  if (!markNo) throw new UserError('Mark no is required.');
  if (!isCutOp(r.cutOp)) throw new UserError(`Mark ${markNo}: choose Cropping, Shearing or None for cutting.`);
  const out = { markNo, cutOp: r.cutOp, numbering: r.numbering === true || r.numbering === 'true' } as RoutingInput;
  for (const f of COUNT_FIELDS) {
    const raw = String(r[f] ?? '0').trim() || '0';
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > MAX_COUNT) throw new UserError(`Mark ${markNo}: ${f} must be a whole number from 0 to ${MAX_COUNT}.`);
    out[f] = n;
  }
  return out;
}

async function lockOrder(tx: Tx, orderId: number) {
  const rows = await tx.$queryRaw<{ id: number }[]>(sql`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`);
  if (rows.length === 0) throw new UserError('Order not found.');
}

/** Operations with production already booked that `next` would drop (blocked: the record would be orphaned). */
async function droppedOperationsWithWork(tx: Tx, orderId: number, markNo: string, next: Routing) {
  const rows = await tx.$queryRaw<{ operation: Operation; pieces: number }[]>(sql`SELECT operation, sum(pieces)::int AS pieces
    FROM production_entries WHERE order_id = ${orderId} AND upper(btrim(mark_no)) = ${markNo} GROUP BY operation`);
  return rows.filter((r) => unitsPerPiece(next, r.operation) <= 0);
}

const routingOf = (r: RoutingInput): Routing => ({ cutOp: r.cutOp, holes: r.holes, notches: r.notches, bends: r.bends, welds: r.welds, threads: r.threads, numbering: r.numbering });

/** Save routing rows (upsert per mark) for marks of the current BOM; each changed field is audited. */
export async function saveRoutings(orderId: number, input: unknown, user: AuthUser) {
  const list = (Array.isArray(input) ? input : []).slice(0, 5000).map((r) => parseRouting((r ?? {}) as Record<string, unknown>));
  if (list.length === 0) throw new UserError('Nothing to save.');
  const boms = await loadBoms([orderId]);
  const bom = boms.get(orderId);
  if (!bom) throw new UserError('Upload the BOM before entering routings.');
  const marks = new Map(bom.marks.map((m) => [m.markNo, m]));
  const unknown = list.filter((r) => !marks.has(r.markNo)).map((r) => r.markNo);
  if (unknown.length) throw new UserError(`Not in the current BOM: ${unknown.slice(0, 10).join(', ')}`);

  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    let changed = 0;
    for (const r of list) {
      const next = routingOf(r);
      const blocked = await droppedOperationsWithWork(tx, orderId, r.markNo, next);
      if (blocked.length) {
        throw new UserError(
          `Mark ${r.markNo}: production is already recorded on ${blocked.map((b) => `${OPERATION_LABELS[b.operation]} (${b.pieces} pcs)`).join(', ')}; that operation cannot be removed from its routing.`,
        );
      }
      const existing = await tx.pieceRouting.findUnique({ where: { orderId_markNo: { orderId, markNo: r.markNo } } });
      const before: Routing = existing
        ? { cutOp: isCutOp(existing.cutOp) ? existing.cutOp : 'SHEARING', holes: existing.holes, notches: existing.notches, bends: existing.bends, welds: existing.welds, threads: existing.threads, numbering: existing.numbering }
        : defaultRouting(marks.get(r.markNo)!.section);
      const diffs = (Object.keys(next) as (keyof Routing)[]).filter((k) => String(before[k]) !== String(next[k]));
      if (existing && diffs.length === 0) continue;
      const row = await tx.pieceRouting.upsert({
        where: { orderId_markNo: { orderId, markNo: r.markNo } },
        create: { orderId, ...r, updatedByName: user.name },
        update: { ...next, updatedByName: user.name },
      });
      changed++;
      await tx.editLog.createMany({
        data: (diffs.length ? diffs : (['cutOp'] as (keyof Routing)[])).map((k) => ({
          tableName: 'piece_routings',
          recordId: row.id,
          fieldName: `${r.markNo}.${k}`,
          oldValue: String(before[k]),
          newValue: String(next[k]),
          ...auditUser(user),
        })),
      });
    }
    return { changed };
  });
}

/** Drop a mark's saved routing so the section default applies again. */
export async function resetRouting(orderId: number, markNoRaw: unknown, user: AuthUser) {
  const markNo = normMark(markNoRaw);
  if (!markNo) throw new UserError('Mark no is required.');
  const bom = (await loadBoms([orderId])).get(orderId);
  const mark = bom?.marks.find((m) => m.markNo === markNo);
  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const existing = await tx.pieceRouting.findUnique({ where: { orderId_markNo: { orderId, markNo } } });
    if (!existing) return { reset: false };
    const blocked = await droppedOperationsWithWork(tx, orderId, markNo, defaultRouting(mark?.section));
    if (blocked.length) {
      throw new UserError(`Mark ${markNo}: production is already recorded on ${blocked.map((b) => OPERATION_LABELS[b.operation]).join(', ')}, which the default routing does not have.`);
    }
    await tx.pieceRouting.delete({ where: { id: existing.id } });
    await tx.editLog.create({
      data: { tableName: 'piece_routings', recordId: existing.id, fieldName: 'RESET_TO_DEFAULT', oldValue: JSON.stringify(existing), newValue: null, ...auditUser(user) },
    });
    return { reset: true };
  });
}
