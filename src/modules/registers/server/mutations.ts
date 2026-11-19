import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { auditUser, type AuthUser } from '@/lib/auth/server';
import { UserError } from '@/lib/actionResult';
import { toNum } from '@/lib/bom/parse';
import { getPlanSettings } from '@/modules/settings/server';
import { COLLECTION_MODES, SECURITY_KINDS, SECURITY_STATUSES, type RegisterKey } from '../columns';

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
      ewayBillNo: str(i.ewayBillNo, 50),
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

const optDate = (v: unknown, label: string) => (v === null || v === undefined || String(v).trim() === '' ? null : reqDate(v, label));
const reqInt = (v: unknown, label: string) => {
  const n = optInt(v, label);
  if (n === null) throw new UserError(`${label} is required.`);
  return n;
};
const reqMoney = (v: unknown, label: string) => {
  const n = optNum(v, label);
  if (n === null) throw new UserError(`${label} is required.`);
  return Math.round(n * 100) / 100;
};
const optMoney = (v: unknown, label: string) => {
  const n = optNum(v, label);
  return n === null ? null : Math.round(n * 100) / 100;
};
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], label: string, fallback?: T): T => {
  const s = String(v ?? '').trim().toUpperCase();
  if (!s && fallback) return fallback;
  if (!(allowed as readonly string[]).includes(s)) throw new UserError(`${label} must be one of ${allowed.join(', ')}.`);
  return s as T;
};
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** In-house stage inspection; accepted + rejected can never exceed offered. */
async function addStage(tx: Tx, orderId: number, i: Input, user: AuthUser) {
  const offered = reqInt(i.piecesOffered, 'Pieces offered');
  const accepted = reqInt(i.piecesAccepted, 'Pieces accepted');
  const rejected = optInt(i.piecesRejected, 'Pieces rejected') ?? 0;
  if (offered <= 0) throw new UserError('Pieces offered must be more than 0.');
  if (accepted + rejected > offered) throw new UserError(`Accepted (${accepted}) + rejected (${rejected}) is more than offered (${offered}).`);
  return tx.stageInspection.create({
    data: {
      orderId,
      inspectionDate: reqDate(i.date, 'Date'),
      stage: reqStr(i.stage, 'Stage', 100),
      markNo: str(i.markNo, 100)?.toUpperCase() ?? null,
      piecesOffered: offered,
      piecesAccepted: accepted,
      piecesRejected: rejected,
      inspector: str(i.inspector, 100),
      remarks: str(i.remarks, 1000),
      ...created(user),
    },
  });
}

/** Invoice; optional link to a dispatch of the same order. Due date defaults to date + payment terms. */
async function addInvoice(tx: Tx, orderId: number, i: Input, user: AuthUser) {
  let dispatchId: number | null = null;
  let wtKg = optNum(i.wtKg, 'Wt');
  if (i.dispatchId !== null && i.dispatchId !== undefined && i.dispatchId !== '') {
    const wanted = Number(i.dispatchId);
    const d = Number.isSafeInteger(wanted) && wanted > 0 ? await tx.dispatch.findUnique({ where: { id: wanted }, select: { id: true, orderId: true, wtKg: true } }) : null;
    if (!d || d.orderId !== orderId) throw new UserError('That dispatch is not on this order.');
    dispatchId = d.id;
    if (wtKg === null && d.wtKg) wtKg = d.wtKg.toNumber();
  }
  const invoiceDate = reqDate(i.date, 'Invoice date');
  const total = reqMoney(i.totalAmount, 'Invoice total');
  const taxable = optMoney(i.taxableAmount, 'Taxable amount');
  if (taxable !== null && taxable > total) throw new UserError('Taxable amount cannot be more than the invoice total.');
  const due = optDate(i.dueDate, 'Due date') ?? addDays(invoiceDate, (await getPlanSettings()).paymentTermsDays);
  if (due < invoiceDate) throw new UserError('Due date cannot be before the invoice date.');
  const invoiceNo = reqStr(i.invoiceNo, 'Invoice no').toUpperCase();
  if (await tx.invoice.findUnique({ where: { invoiceNo }, select: { id: true } })) throw new UserError(`Invoice ${invoiceNo} is already entered.`);
  return tx.invoice.create({
    data: { orderId, dispatchId, invoiceNo, invoiceDate, wtKg, taxableAmount: taxable, totalAmount: total, dueDate: due, remarks: str(i.remarks, 1000), ...created(user) },
  });
}

/**
 * Payment received. Against an invoice of this order it can never take the invoice past fully paid
 * (amount + retention <= outstanding). The order row is locked, so two receipts can't both pass.
 */
async function addCollection(tx: Tx, orderId: number, i: Input, user: AuthUser) {
  const amount = reqMoney(i.amount, 'Amount');
  if (amount <= 0) throw new UserError('Amount must be more than 0.');
  // Retention: positive = withheld by the client on this receipt; negative = earlier retention now released.
  const retRaw = i.retention === null || i.retention === undefined || String(i.retention).trim() === '' ? null : toNum(i.retention);
  if (retRaw === null && String(i.retention ?? '').trim() !== '') throw new UserError('Retention must be a number.');
  const retention = retRaw === null ? null : Math.round(retRaw * 100) / 100;
  if (retention !== null && retention < 0 && !(i.invoiceId !== null && i.invoiceId !== undefined && i.invoiceId !== '')) {
    throw new UserError('A retention release must be entered against the invoice that withheld it.');
  }
  let invoiceId: number | null = null;
  if (i.invoiceId !== null && i.invoiceId !== undefined && i.invoiceId !== '') {
    const wanted = Number(i.invoiceId);
    const inv = Number.isSafeInteger(wanted) && wanted > 0 ? await tx.invoice.findUnique({ where: { id: wanted }, select: { id: true, orderId: true, invoiceNo: true, totalAmount: true } }) : null;
    if (!inv || inv.orderId !== orderId) throw new UserError('That invoice is not on this order.');
    const [done] = await tx.$queryRaw<{ amt: number; ret: number }[]>(sql`SELECT coalesce(sum(amount), 0)::float AS amt, coalesce(sum(retention), 0)::float AS ret
      FROM collections WHERE invoice_id = ${inv.id}`);
    const outstanding = Math.round((inv.totalAmount.toNumber() - done.amt - done.ret) * 100) / 100;
    if (retention !== null && retention < 0 && -retention > done.ret + 0.005) {
      throw new UserError(`Invoice ${inv.invoiceNo} has only Rs ${done.ret.toLocaleString('en-IN')} retention held; cannot release more.`);
    }
    if (amount + (retention ?? 0) > outstanding + 0.005) {
      throw new UserError(
        `Invoice ${inv.invoiceNo} has only Rs ${outstanding.toLocaleString('en-IN')} outstanding; this receipt (Rs ${(amount + (retention ?? 0)).toLocaleString('en-IN')} incl. retention) is more.`,
      );
    }
    invoiceId = inv.id;
  }
  return tx.collection.create({
    data: {
      orderId,
      invoiceId,
      receiptDate: reqDate(i.date, 'Receipt date'),
      amount,
      mode: oneOf(i.mode, COLLECTION_MODES, 'Mode', 'RTGS'),
      reference: str(i.reference, 100),
      retention,
      remarks: str(i.remarks, 1000),
      ...created(user),
    },
  });
}

/** PBG / ABG / LC / retention / security deposit held against the order. */
async function addSecurity(tx: Tx, orderId: number, i: Input, user: AuthUser) {
  const issueDate = optDate(i.issueDate, 'Issue date');
  const expiryDate = optDate(i.expiryDate, 'Expiry date');
  if (issueDate && expiryDate && expiryDate < issueDate) throw new UserError('Expiry date cannot be before the issue date.');
  const status = oneOf(i.status, SECURITY_STATUSES, 'Status', 'ACTIVE');
  return tx.orderSecurity.create({
    data: {
      orderId,
      kind: oneOf(i.kind, SECURITY_KINDS, 'Type'),
      refNo: str(i.refNo, 100),
      bank: str(i.bank, 100),
      amount: reqMoney(i.amount, 'Amount'),
      issueDate,
      expiryDate,
      status,
      releasedDate: status === 'ACTIVE' ? null : optDate(i.releasedDate, 'Released date'),
      remarks: str(i.remarks, 1000),
      ...created(user),
    },
  });
}

/** Change a security's status (inline edit). RELEASED/CLAIMED stamps today as the released date if blank. */
export async function updateSecurityStatus(id: number, value: unknown, user: AuthUser) {
  const status = oneOf(value, SECURITY_STATUSES, 'Status');
  return prisma.$transaction(async (tx) => {
    const before = await tx.orderSecurity.findUnique({ where: { id } });
    if (!before) throw new UserError('Entry not found.');
    if (before.status === status) return { id };
    const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    await tx.orderSecurity.update({
      where: { id },
      data: { status, releasedDate: status === 'ACTIVE' ? null : (before.releasedDate ?? today) },
    });
    await tx.editLog.create({
      data: { tableName: 'order_securities', recordId: id, fieldName: 'status', oldValue: before.status, newValue: status, ...auditUser(user) },
    });
    return { id };
  });
}

const TABLE: Record<RegisterKey, string> = {
  stage: 'stage_inspections',
  galv: 'galv_challans',
  inspection: 'inspections',
  di: 'dispatch_instructions',
  dispatch: 'dispatches',
  invoice: 'invoices',
  collection: 'collections',
  security: 'order_securities',
};

/** Entry and its audit row are saved in one transaction: a failed log write saves nothing (no duplicate on retry). */
export async function addRegisterEntry(key: RegisterKey, orderId: number, input: Input, user: AuthUser) {
  const row = await prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const r =
      key === 'galv' ? await addGalv(tx, orderId, input, user)
      : key === 'inspection' ? await addInspection(tx, orderId, input, user)
      : key === 'di' ? await addDi(tx, orderId, input, user)
      : key === 'stage' ? await addStage(tx, orderId, input, user)
      : key === 'invoice' ? await addInvoice(tx, orderId, input, user)
      : key === 'collection' ? await addCollection(tx, orderId, input, user)
      : key === 'security' ? await addSecurity(tx, orderId, input, user)
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
      : key === 'stage' ? await tx.stageInspection.delete({ where: { id } }).catch(notFound)
      : key === 'invoice' ? await tx.invoice.delete({ where: { id } }).catch(notFound)
      : key === 'collection' ? await tx.collection.delete({ where: { id } }).catch(notFound)
      : key === 'security' ? await tx.orderSecurity.delete({ where: { id } }).catch(notFound)
      : await tx.dispatch.delete({ where: { id } }).catch(notFound);
    await tx.editLog.create({
      data: { tableName: TABLE[key], recordId: id, fieldName: 'DELETED', oldValue: JSON.stringify(row), newValue: null, ...auditUser(user) },
    });
    return { id };
  });
}
