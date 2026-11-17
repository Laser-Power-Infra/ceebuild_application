import 'server-only';
import { prisma } from '@/lib/prisma';
import { auditUser, type AuthUser } from '@/lib/auth/server';
import { UserError } from '@/lib/actionResult';
import { toNum } from '@/lib/bom/parse';
import type { RegisterKey } from '../columns';

type Input = Record<string, unknown>;

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

async function orderExists(orderId: number) {
  const o = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true } });
  if (!o) throw new UserError('Order not found.');
}

const created = (user: AuthUser) => ({ createdById: user.id, createdByName: user.name });

async function audit(table: string, id: number, data: unknown, user: AuthUser) {
  await prisma.editLog.create({
    data: { tableName: table, recordId: id, fieldName: 'ALL_FIELDS', oldValue: 'NONE (New Record)', newValue: JSON.stringify(data), ...auditUser(user) },
  });
}

/** Galvanising challan. Pieces coming back IN for a mark can never exceed what went OUT for it. */
async function addGalv(orderId: number, i: Input, user: AuthUser) {
  const direction = i.direction === 'IN' ? 'IN' : i.direction === 'OUT' ? 'OUT' : null;
  if (!direction) throw new UserError('Choose Out or In.');
  const lines = (Array.isArray(i.lines) ? i.lines : [])
    .map((l: Input) => ({ markNo: str(l?.markNo, 100), pieces: optInt(l?.pieces, 'Pieces') }))
    .filter((l) => l.markNo || l.pieces);
  if (lines.some((l) => !l.markNo || !l.pieces)) throw new UserError('Each line needs a mark no and pieces.');
  const merged = new Map<string, number>();
  for (const l of lines) merged.set(l.markNo!.toUpperCase(), (merged.get(l.markNo!.toUpperCase()) ?? 0) + l.pieces!);

  return prisma.$transaction(async (tx) => {
    if (direction === 'IN' && merged.size) {
      const totals = await tx.$queryRaw<{ mark: string; out: number; inn: number }[]>`SELECT upper(l.mark_no) AS mark,
          coalesce(sum(l.pieces) FILTER (WHERE c.direction = 'OUT'), 0)::int AS out,
          coalesce(sum(l.pieces) FILTER (WHERE c.direction = 'IN'), 0)::int AS inn
        FROM galv_challan_lines l JOIN galv_challans c ON c.id = l.challan_id
        WHERE c.order_id = ${orderId} GROUP BY 1`;
      const byMark = new Map(totals.map((t) => [t.mark, t]));
      const over = [...merged].filter(([m, p]) => (byMark.get(m)?.inn ?? 0) + p > (byMark.get(m)?.out ?? 0));
      if (over.length) {
        throw new UserError(
          'More pieces back in than sent out for: ' +
            over.map(([m, p]) => `${m} (out ${byMark.get(m)?.out ?? 0}, in ${byMark.get(m)?.inn ?? 0} + ${p})`).join(', '),
        );
      }
    }
    const row = await tx.galvChallan.create({
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
    return row;
  });
}

async function addInspection(orderId: number, i: Input, user: AuthUser) {
  return prisma.inspection.create({
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

async function addDi(orderId: number, i: Input, user: AuthUser) {
  return prisma.dispatchInstruction.create({
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

async function addDispatch(orderId: number, i: Input, user: AuthUser) {
  let diId: number | null = null;
  if (i.diId) {
    const di = await prisma.dispatchInstruction.findUnique({ where: { id: Number(i.diId) }, select: { id: true, orderId: true } });
    if (!di || di.orderId !== orderId) throw new UserError('That DI is not on this order.');
    diId = di.id;
  }
  return prisma.dispatch.create({
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

export async function addRegisterEntry(key: RegisterKey, orderId: number, input: Input, user: AuthUser) {
  await orderExists(orderId);
  const row =
    key === 'galv' ? await addGalv(orderId, input, user)
    : key === 'inspection' ? await addInspection(orderId, input, user)
    : key === 'di' ? await addDi(orderId, input, user)
    : await addDispatch(orderId, input, user);
  await audit(TABLE[key], row.id, { orderId, ...input }, user);
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

/** Admin only (checked by the action). The audit row keeps a snapshot. */
export async function deleteRegisterEntry(key: RegisterKey, id: number, user: AuthUser) {
  const del = {
    galv: () => prisma.galvChallan.delete({ where: { id }, include: { lines: true } }),
    inspection: () => prisma.inspection.delete({ where: { id } }),
    di: () => prisma.dispatchInstruction.delete({ where: { id } }),
    dispatch: () => prisma.dispatch.delete({ where: { id } }),
  }[key];
  const row = await del().catch(() => {
    throw new UserError('Entry not found.');
  });
  await prisma.editLog.create({
    data: { tableName: TABLE[key], recordId: id, fieldName: 'DELETED', oldValue: JSON.stringify(row), newValue: null, ...auditUser(user) },
  });
  return { id };
}
