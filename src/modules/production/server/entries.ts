import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { auditUser, type AuthUser } from '@/lib/auth/server';
import { UserError } from '@/lib/actionResult';
import { cuttingGate } from '@/modules/fabdrawings/server/sets';
import { fetchFacet, fetchPage, plain, type FieldSql, type TableSpec } from '@/lib/serverTable';
import { isOperation, operationsOf, OPERATION_LABELS, unitsPerPiece, type Operation } from '@/lib/planning/machines';
import type { TablePage, TableQuery } from '@/components/data-table/types';
import { SHIFTS, type EntriesMeta, type EntryOptions, type EntryRow } from '../columns';
import { effectiveRouting, loadBoms, loadSavedRoutings, normMark } from './data';

const sql = Prisma.sql;
type Tx = Prisma.TransactionClient;

const txt = (e: Prisma.Sql): FieldSql => ({ text: e, kind: 'text' });
const numf = (e: Prisma.Sql): FieldSql => ({ text: sql`round((${e})::numeric, 3)::text`, raw: sql`round((${e})::numeric, 3)::float`, kind: 'number', searchable: false });

// Unit weight of the entry's mark in the order's current BOM (for MT cut).
const UNIT_WT = sql`LEFT JOIN LATERAL (SELECT max(p.unit_wt_kg) AS wt FROM bom_pieces p
  WHERE p.upload_id = (SELECT max(u.id) FROM bom_uploads u WHERE u.order_id = e.order_id)
    AND upper(btrim(p.mark_no)) = e.mark_no) uw ON TRUE`;

const CUT_OPS_SQL = sql`e.operation IN ('CROPPING', 'SHEARING')`;

function spec(orderId: number | null): TableSpec {
  return {
    from: sql`production_entries e JOIN orders o ON o.id = e.order_id JOIN "docket-party-name" d ON d.id = o.docket_id
      JOIN machines m ON m.id = e.machine_id ${UNIT_WT}`,
    scope: orderId ? sql`e.order_id = ${orderId}` : undefined,
    fallbackOrder: sql`e.entry_date DESC, e.id DESC`,
    fields: {
      id: { text: sql`e.id::text`, raw: sql`e.id`, kind: 'number', searchable: false },
      orderId: { text: sql`e.order_id::text`, raw: sql`e.order_id`, kind: 'number', searchable: false },
      poNumber: txt(sql`o.po_number`),
      client: txt(sql`coalesce(nullif(o.client, ''), d.party_name)`),
      entryDate: { text: sql`to_char(e.entry_date, 'YYYY-MM-DD')`, raw: sql`e.entry_date`, kind: 'date', searchable: false },
      shift: txt(sql`e.shift`),
      machineCode: txt(sql`m.code`),
      operation: txt(sql`e.operation`),
      markNo: txt(sql`e.mark_no`),
      pieces: numf(sql`e.pieces`),
      wtKg: numf(sql`e.pieces * uw.wt`),
      operatorName: txt(sql`e.operator_name`),
      remarks: txt(sql`e.remarks`),
      createdByName: txt(sql`e.created_by_name`),
    },
  };
}

const AGG = sql`count(*)::int AS total, coalesce(sum(e.pieces), 0)::float AS pieces,
  coalesce(sum(e.pieces) FILTER (WHERE e.entry_date = current_date), 0)::float AS "piecesToday",
  coalesce(sum(e.pieces * uw.wt) FILTER (WHERE ${CUT_OPS_SQL}), 0)::float AS "cutKg"`;

export async function listEntries(orderId: number | null, query: TableQuery): Promise<TablePage<EntryRow, EntriesMeta>> {
  const { rows, agg } = await fetchPage<EntryRow, EntriesMeta & { total: number }>(spec(orderId), query, AGG);
  const { total, ...meta } = agg;
  return { rows: plain(rows), total, meta };
}

export const listEntriesFacet = (orderId: number | null, key: string, query: TableQuery) => fetchFacet(spec(orderId), key, query);

/** Pick-lists for the entry form: the order's BOM marks (with the operations each needs) and active machines. */
export async function entryOptions(orderId: number): Promise<EntryOptions> {
  const [boms, saved, machines, gate] = await Promise.all([
    loadBoms([orderId]),
    loadSavedRoutings([orderId]),
    prisma.machine.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }], select: { id: true, code: true, name: true, operation: true } }),
    cuttingGate(orderId),
  ]);
  const bom = boms.get(orderId);
  return {
    marks: (bom?.marks ?? []).map((m) => ({ markNo: m.markNo, qty: m.qty, operations: operationsOf(effectiveRouting(m, saved.get(orderId)).routing) })),
    machines: machines.filter((m) => isOperation(m.operation)).map((m) => ({ ...m, operation: m.operation as Operation })),
    cuttingHeld: gate.ok ? null : gate.reason,
  };
}

/** Orders for the cross-order entry form: PO / client / docket contains `q`, newest first. */
export async function searchOrders(q: string) {
  const term = q.trim().slice(0, 100);
  const like = `%${term.replace(/([\\%_])/g, '\\$1')}%`;
  return prisma.$queryRaw<{ id: number; poNumber: string; client: string | null; docketNo: string | null }[]>(sql`
    SELECT o.id, o.po_number AS "poNumber", coalesce(nullif(o.client, ''), d.party_name) AS client,
      coalesce(d.docket_no_qtn_no, o.docket_no) AS "docketNo"
    FROM orders o JOIN "docket-party-name" d ON d.id = o.docket_id
    WHERE EXISTS (SELECT 1 FROM bom_uploads u WHERE u.order_id = o.id)
      AND (${term} = '' OR o.po_number ILIKE ${like} OR coalesce(o.client, d.party_name, '') ILIKE ${like} OR coalesce(d.docket_no_qtn_no, '') ILIKE ${like})
    ORDER BY o.po_date DESC, o.id DESC LIMIT 20`);
}

const str = (v: unknown, max: number) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};

function parseDate(v: unknown) {
  const s = String(v ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new UserError('Date is required.');
  const d = new Date(`${s}T00:00:00Z`);
  // Allow "today" in any Indian/UTC offset, but no later.
  if (d.getTime() > Date.now() + 36 * 3600_000) throw new UserError('Production date cannot be in the future.');
  if (d.getUTCFullYear() < 2020) throw new UserError('Production date is too far in the past.');
  return d;
}

async function lockOrder(tx: Tx, orderId: number) {
  const rows = await tx.$queryRaw<{ id: number }[]>(sql`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`);
  if (rows.length === 0) throw new UserError('Order not found.');
}

/**
 * Record production of one mark on one machine. Under the order-row lock (so two saves cannot both
 * pass): the mark must be in the current BOM, its routing must need the machine's operation, and
 * cumulative pieces for (mark, operation) may not exceed the BOM quantity.
 */
export async function addEntry(orderId: number, i: Record<string, unknown>, user: AuthUser) {
  const entryDate = parseDate(i.date);
  const shift = String(i.shift ?? 'A').toUpperCase();
  if (!(SHIFTS as readonly string[]).includes(shift)) throw new UserError('Shift must be A, B or C.');
  const machineId = Number(i.machineId);
  if (!Number.isSafeInteger(machineId) || machineId <= 0) throw new UserError('Choose a machine.');
  const markNo = normMark(i.markNo);
  if (!markNo) throw new UserError('Mark no is required.');
  const pieces = Number(String(i.pieces ?? '').trim());
  if (!Number.isInteger(pieces) || pieces <= 0 || pieces > 1_000_000) throw new UserError('Pieces must be a whole number above 0.');

  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const machine = await tx.machine.findUnique({ where: { id: machineId } });
    if (!machine) throw new UserError('Machine not found.');
    if (!machine.active) throw new UserError(`Machine ${machine.code} is inactive.`);
    if (!isOperation(machine.operation)) throw new UserError(`Machine ${machine.code} has an unknown operation.`);
    const op = machine.operation;

    // M14 part 2 cutting gate: cropping / shearing only after production confirmed the fabrication
    // drawing (orders whose docket has drawings). Admin may override with a reason (audited).
    let gateOverride: string | null = null;
    if (op === 'CROPPING' || op === 'SHEARING') {
      const gate = await cuttingGate(orderId);
      if (!gate.ok) {
        const why = String(i.overrideReason ?? '').trim();
        if (user.role !== 'Admin' || !why) throw new UserError(`${gate.reason} Cutting is held${user.role === 'Admin' ? ' – give an override reason to record it anyway' : ' until production confirms the drawing (or an Admin overrides with a reason)'}.`);
        gateOverride = `${gate.reason} Override: ${why}`.slice(0, 1000);
      }
    }

    const bom = (await loadBoms([orderId])).get(orderId);
    const mark = bom?.marks.find((m) => m.markNo === markNo);
    if (!mark) throw new UserError(`Mark ${markNo} is not in the order's current BOM.`);
    const { routing } = effectiveRouting(mark, (await loadSavedRoutings([orderId])).get(orderId));
    if (unitsPerPiece(routing, op) <= 0) {
      const needs = operationsOf(routing).map((o) => OPERATION_LABELS[o]).join(', ') || 'no operations';
      throw new UserError(`Mark ${markNo} does not need ${OPERATION_LABELS[op]} (${machine.code}); its routing is: ${needs}. Fix the routing first if this is wrong.`);
    }
    const [done] = await tx.$queryRaw<{ pieces: number }[]>(sql`SELECT coalesce(sum(pieces), 0)::int AS pieces FROM production_entries
      WHERE order_id = ${orderId} AND mark_no = ${markNo} AND operation = ${op}`);
    const required = Math.floor(mark.qty);
    if (done.pieces + pieces > required) {
      throw new UserError(
        `Mark ${markNo} ${OPERATION_LABELS[op]}: ${done.pieces} of ${required} pieces already recorded; ${pieces} more would exceed the BOM (max ${Math.max(0, required - done.pieces)}).`,
      );
    }
    const row = await tx.productionEntry.create({
      data: {
        orderId,
        entryDate,
        shift,
        machineId,
        operation: op,
        markNo,
        pieces,
        operatorName: str(i.operatorName, 100),
        remarks: str(i.remarks, 1000),
        createdById: user.id,
        createdByName: user.name,
      },
    });
    await tx.editLog.create({
      data: {
        tableName: 'production_entries',
        recordId: row.id,
        fieldName: 'CREATED',
        oldValue: null,
        newValue: JSON.stringify({ orderId, date: i.date, shift, machine: machine.code, operation: op, markNo, pieces }),
        ...auditUser(user),
      },
    });
    if (gateOverride) {
      await tx.editLog.create({ data: { tableName: 'production_entries', recordId: row.id, fieldName: 'CUTTING_GATE_OVERRIDE', oldValue: null, newValue: gateOverride, ...auditUser(user) } });
    }
    return { id: row.id, remaining: required - done.pieces - pieces };
  });
}

export async function deleteEntry(id: number, user: AuthUser) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.productionEntry.findUnique({ where: { id } });
    if (!row) throw new UserError('Entry not found.');
    await lockOrder(tx, row.orderId);
    await tx.productionEntry.delete({ where: { id } });
    await tx.editLog.create({
      data: { tableName: 'production_entries', recordId: id, fieldName: 'DELETED', oldValue: JSON.stringify(row), newValue: null, ...auditUser(user) },
    });
    return { id };
  });
}
