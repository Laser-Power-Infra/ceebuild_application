import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { auditUser, type AuthUser } from '@/lib/auth/server';
import { UserError } from '@/lib/actionResult';
import { toNum } from '@/lib/bom/parse';
import type { RegisterKey } from '../columns';

type Input = Record<string, unknown>;
type Tx = Prisma.TransactionClient;
const sql = Prisma.sql;

const str = (v: unknown, max = 200) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};
const reqStr = (v: unknown, label: string, max = 100) => {
  const s = str(v, max);
  if (!s) throw new UserError(`${label} is required.`);
  return s;
};
const reqDate = (v: unknown, label: string) => {
  const s = String(v ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new UserError(`${label} is required.`);
  return new Date(`${s}T00:00:00Z`);
};
const optNum = (v: unknown, label: string) => {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = toNum(v);
  if (n === null || n < 0) throw new UserError(`${label} must be a positive number.`);
  return n;
};
const optInt = (v: unknown, label: string) => {
  const n = optNum(v, label);
  if (n !== null && !Number.isInteger(n)) throw new UserError(`${label} must be a whole number.`);
  return n;
};

/**
 * Lock the order row for the rest of the transaction. Galvanising saves and deletes for one order
 * take this lock first, so the "IN can't exceed OUT" check and the write that follows it can never
 * interleave with another save. Throws when the order does not exist.
 */
async function lockOrder(tx: Tx, orderId: number) {
  const rows = await tx.$queryRaw<{ id: number }[]>(sql`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`);
  if (rows.length === 0) throw new UserError('Order not found.');
}

const created = (user: AuthUser) => ({ createdById: user.id, createdByName: user.name });

/** OUT / IN piece totals per (upper-cased) mark for the given marks of one order. */
async function galvTotals(tx: Tx, orderId: number, marks: string[]) {
  if (marks.length === 0) return new Map<string, { out: number; inn: number }>();
  const totals = await tx.$queryRaw<{ mark: string; out: number; inn: number }[]>(sql`SELECT upper(l.mark_no) AS mark,
      coalesce(sum(l.pieces) FILTER (WHERE c.direction = 'OUT'), 0)::int AS out,
      coalesce(sum(l.pieces) FILTER (WHERE c.direction = 'IN'), 0)::int AS inn
    FROM galv_challan_lines l JOIN galv_challans c ON c.id = l.challan_id
    WHERE c.order_id = ${orderId} AND upper(l.mark_no) IN (${Prisma.join(marks)}) GROUP BY 1`);
  return new Map(totals.map((t) => [t.mark, { out: t.out, inn: t.inn }]));
}

/** Galvanising challan. Pieces coming back IN for a mark can never exceed what went OUT for it. */
async function addGalv(tx: Tx, orderId: number, i: Input, user: AuthUser) {
  const direction = i.direction === 'IN' ? 'IN' : i.direction === 'OUT' ? 'OUT' : null;
  if (!direction) throw new UserError('Choose Out or In.');
  const lines = (Array.isArray(i.lines) ? i.lines : [])
    .map((l: Input) => ({ markNo: str(l?.markNo, 100), pieces: optInt(l?.pieces, 'Pieces') }))
    .filter((l) => l.markNo || l.pieces);
  if (lines.some((l) => !l.markNo || !l.pieces)) throw new UserError('Each line needs a mark no and pieces.');
  const merged = new Map<string, number>();
  for (const l of lines) merged.set(l.markNo!.toUpperCase(), (merged.get(l.markNo!.toUpperCase()) ?? 0) + l.pieces!);

  // The order row is already locked by addRegisterEntry, so this check and the insert are atomic.
  if (direction === 'IN' && merged.size) {
    const byMark = await galvTotals(tx, orderId, [...merged.keys()]);
    const over = [...merged].filter(([m, p]) => (byMark.get(m)?.inn ?? 0) + p > (byMark.get(m)?.out ?? 0));
    if (over.length) {
      throw new UserError(
        'More pieces back in than sent out for: ' +
          over.map(([m, p]) => `${m} (out ${byMark.get(m)?.out ?? 0}, in ${byMark.get(m)?.inn ?? 0} + ${p})`).join(', '),
      );
    }
  }
  return tx.galvChallan.create({
    data: {
      orderId,
      challanNo: reqStr(i.challanNo, 'Challan no'),
      direction,
      challanDate: reqDate(i.date, 'Date'),
      jobWorker: str(i.jobWorker),
      blackWtKg: optNum(i.blackWtKg, 'Black wt'),
      galvWtKg: optNum(i.galvWtKg, 'Galv wt'),
      remarks: str(i.remarks, 1000),
      ...created(user),
      lines: { create: [...merged].map(([markNo, pieces]) => ({ markNo, pieces })) },
    },
  });
}

async function addInspection(tx: Tx, orderId: number, i: Input, user: AuthUser) {
  return tx.inspection.create({
    data: {
      orderId,
      inspectionNo: reqStr(i.inspectionNo, 'Inspection no'),
      mcNo: str(i.mcNo, 100),
      inspectionDate: reqDate(i.date, 'Date'),
      piecesCleared: optInt(i.piecesCleared, 'Pieces cleared'),
      wtClearedKg: optNum(i.wtClearedKg, 'Wt cleared'),
      remarks: str(i.remarks, 1000),
      ...created(user),
    },
  });
}

async function addDi(tx: Tx, orderId: number, i: Input, user: AuthUser) {
  return tx.dispatchInstruction.create({
    data: {
      orderId,
      diNo: reqStr(i.diNo, 'DI no'),
      diDate: reqDate(i.date, 'Date'),
      pieces: optInt(i.pieces, 'Pieces'),
      wtKg: optNum(i.wtKg, 'Wt'),
      remarks: str(i.remarks, 1000),
      ...created(user),
    },
  });
}

async function addDispatch(tx: Tx, orderId: number, i: Input, user: AuthUser) {
  let diId: number | null = null;
  if (i.diId !== null && i.diId !== undefined && i.diId !== '') {
    const wanted = Number(i.diId);
    if (!Number.isSafeInteger(wanted) || wanted <= 0) throw new UserError('That DI is not on this order.');
    const di = await tx.dispatchInstruction.findUnique({ where: { id: wanted }, select: { id: true, orderId: true } });
    if (!di || di.orderId !== orderId) throw new UserError('That DI is not on this order.');
    diId = di.id;
  }
  return tx.dispatch.create({
    data: {
      orderId,
      diId,
      invoiceNo: str(i.invoiceNo, 100),
      lrNo: str(i.lrNo, 100),
      vehicleNo: str(i.vehicleNo, 50),
      dispatchDate: reqDate(i.date, 'Date'),
      pieces: optInt(i.pieces, 'Pieces'),
      wtKg: optNum(i.wtKg, 'Wt'),
      remarks: str(i.remarks, 1000),
      ...created(user),
    },
  });
}

const TABLE: Record<RegisterKey, string> = { galv: 'galv_challans', inspection: 'inspections', di: 'dispatch_instructions', dispatch: 'dispatches' };

/** Entry and its audit row are saved in one transaction: a failed log write saves nothing (no duplicate on retry). */
export async function addRegisterEntry(key: RegisterKey, orderId: number, input: Input, user: AuthUser) {
  const row = await prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const r =
      key === 'galv' ? await addGalv(tx, orderId, input, user)
      : key === 'inspection' ? await addInspection(tx, orderId, input, user)
      : key === 'di' ? await addDi(tx, orderId, input, user)
      : await addDispatch(tx, orderId, input, user);
    await tx.editLog.create({
      data: {
        tableName: TABLE[key],
        recordId: r.id,
        fieldName: 'ALL_FIELDS',
        oldValue: 'NONE (New Record)',
        newValue: JSON.stringify({ orderId, ...input }),
        ...auditUser(user),
      },
    });
    return r;
  });
  return { id: row.id, warning: key === 'dispatch' ? await dispatchWarning(orderId) : null };
}

/** Dispatched weight above the inspected weight is allowed but worth a warning. */
async function dispatchWarning(orderId: number): Promise<string | null> {
  const [d, i] = await Promise.all([
    prisma.dispatch.aggregate({ where: { orderId }, _sum: { wtKg: true } }),
    prisma.inspection.aggregate({ where: { orderId }, _sum: { wtClearedKg: true } }),
  ]);
  const dispatched = d._sum.wtKg?.toNumber() ?? 0;
  const inspected = i._sum.wtClearedKg?.toNumber() ?? 0;
  return dispatched > inspected
    ? `Dispatched weight (${dispatched.toLocaleString('en-IN')} kg) is more than the inspected/cleared weight (${inspected.toLocaleString('en-IN')} kg).`
    : null;
}

const notFound = (err: unknown): never => {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') throw new UserError('Entry not found.');
  throw err;
};

/** Delete a galvanising challan. Deleting an OUT is refused if it would leave more pieces IN than OUT for a mark. */
async function deleteGalv(tx: Tx, id: number) {
  const ref = await tx.galvChallan.findUnique({ where: { id }, select: { orderId: true } });
  if (!ref) throw new UserError('Entry not found.');
  await lockOrder(tx, ref.orderId);
  const row = await tx.galvChallan.findUnique({ where: { id }, include: { lines: true } });
  if (!row) throw new UserError('Entry not found.');
  await tx.galvChallan.delete({ where: { id } });
  if (row.direction === 'OUT' && row.lines.length) {
    const marks = [...new Set(row.lines.map((l) => l.markNo.toUpperCase()))];
    const byMark = await galvTotals(tx, row.orderId, marks);
    const short = marks.filter((m) => (byMark.get(m)?.inn ?? 0) > (byMark.get(m)?.out ?? 0));
    if (short.length) {
      throw new UserError(
        'Cannot delete this OUT challan: more pieces have come back in than would remain sent out for: ' +
          short.map((m) => `${m} (out ${byMark.get(m)?.out ?? 0}, in ${byMark.get(m)?.inn ?? 0})`).join(', ') +
          '. Delete the matching IN challan first.',
      );
    }
  }
  return row;
}

/** Admin only (checked by the action). Delete and audit row (with a snapshot) in one transaction. */
export async function deleteRegisterEntry(key: RegisterKey, id: number, user: AuthUser) {
  return prisma.$transaction(async (tx) => {
    const row =
      key === 'galv' ? await deleteGalv(tx, id)
      : key === 'inspection' ? await tx.inspection.delete({ where: { id } }).catch(notFound)
      : key === 'di' ? await tx.dispatchInstruction.delete({ where: { id } }).catch(notFound)
      : await tx.dispatch.delete({ where: { id } }).catch(notFound);
    await tx.editLog.create({
      data: { tableName: TABLE[key], recordId: id, fieldName: 'DELETED', oldValue: JSON.stringify(row), newValue: null, ...auditUser(user) },
    });
    return { id };
  });
}
