import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { UserError } from '@/lib/actionResult';
import { auditUser, type AuthUser } from '@/lib/auth/server';
import { getGeminiModel, parseGeminiAnswer } from '@/lib/gemini';
import { callN8n, N8N_USER } from '@/lib/n8n';
import { getMailThread, mailDbConfigured, searchMailThreads, type MailThread } from '@/lib/mailDb';
import {
  docKindOf,
  normaliseMailStatus,
  ORDER_MAIL_SCHEMA,
  orderFileKind,
  orderMailPrompt,
  orderNeeds,
  type OrderFacts,
  type OrderMailStatus,
  type OrderNeeds,
} from '@/lib/orders/mailCheck';

// Order mail check: n8n asks for the open orders' mail threads (GET /api/n8n/order-mails), downloads
// the files not attached yet from Drive onto the order, has Gemini read the threads and posts the
// answer back (POST /api/n8n/order-status). The checklist (have / needs) is worked out here.

const REFRESH_HOURS = 6;
const MAX_TEXT = 24_000;
const ATTACH_KINDS = new Set(['MC', 'DI', 'DRAWING', 'BOM', 'INSPECTION', 'PO']);
const ymd = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const key = (s: string) => s.toUpperCase().replace(/[^0-9A-Z]/g, '');

/** Distinct search words for a PO no.: the whole number, plus its last part when that is specific. */
function poSearchTerms(poNumber: string) {
  const terms = [poNumber.trim()];
  const last = poNumber.split(/[/\\]/).pop()?.trim() ?? '';
  if (last !== poNumber.trim() && key(last).length >= 6) terms.push(last);
  return terms;
}

/** The order's mail threads: the one its PO came from, plus every thread naming the PO no. */
async function orderThreads(order: { id: number; poNumber: string }): Promise<MailThread[]> {
  const refs = await prisma.poIntake.findMany({ where: { orderId: order.id, gmailMessageId: { startsWith: 'thread:' } }, select: { gmailMessageId: true } });
  const byId = new Map<string, MailThread>();
  for (const r of refs) {
    const t = await getMailThread(String(r.gmailMessageId).slice('thread:'.length));
    if (t) byId.set(t.threadId, t);
  }
  const want = key(order.poNumber);
  for (const q of poSearchTerms(order.poNumber)) {
    for (const t of await searchMailThreads(q, 15)) {
      if (byId.has(t.threadId)) continue;
      const hay = key(`${t.subject ?? ''} ${t.files.map((f) => f.name).join(' ')} ${t.text}`);
      if (hay.includes(want) || (q !== order.poNumber && hay.includes(key(q)))) byId.set(t.threadId, t);
    }
  }
  return [...byId.values()].sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(-8);
}

const threadBlock = (t: MailThread) =>
  `=== Thread "${t.subject ?? ''}" (${t.date ?? ''}, ${t.msgCount} message(s))\nAttachments: ${t.files.map((f) => f.name).join('; ') || 'none'}\n${t.text}`;

/** For n8n: open orders whose mails were not read in the last hours, with threads, files to attach and the Gemini request. */
export async function orderMailsForN8n(limit: number, orderIds?: number[]) {
  if (!mailDbConfigured()) throw new UserError('MAIL_API_URL is not set (mail archive).');
  const since = new Date(Date.now() - REFRESH_HOURS * 3600_000);
  const orders = await prisma.order.findMany({
    where: orderIds?.length ? { id: { in: orderIds } } : { OR: [{ mailStatusAt: null }, { mailStatusAt: { lt: since } }] },
    orderBy: [{ mailStatusAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
    take: limit,
    select: { id: true, poNumber: true, poDate: true, client: true, project: true, endClient: true, documents: { select: { fileName: true } } },
  });
  const today = ymd(new Date()) as string;
  const out = [];
  for (const o of orders) {
    const threads = await orderThreads(o);
    const intake = await prisma.poIntake.findFirst({ where: { orderId: o.id, source: 'N8N_MAIL' }, orderBy: { id: 'desc' }, select: { id: true } });
    const have = new Set(o.documents.map((d) => d.fileName.toLowerCase()));
    const seen = new Set<string>();
    const files = threads
      .flatMap((t) => t.files)
      .map((f) => ({ name: f.name, driveId: f.driveId, kind: orderFileKind(f.name) }))
      .filter((f) => f.driveId && ATTACH_KINDS.has(f.kind) && !have.has(f.name.toLowerCase()) && !seen.has(f.name.toLowerCase()) && seen.add(f.name.toLowerCase()))
      .slice(0, 12)
      .map((f) => ({ ...f, docKind: docKindOf(f.kind) }));
    let text = threads.map(threadBlock).join('\n\n');
    if (text.length > MAX_TEXT) text = text.slice(text.length - MAX_TEXT); // newest kept
    out.push({
      orderId: o.id,
      poNumber: o.poNumber,
      intakeId: intake?.id ?? null,
      threads: threads.length,
      files: intake ? files : [],
      geminiBody: threads.length
        ? {
            contents: [{ role: 'user', parts: [{ text: `Mail threads:\n${text}` }, { text: orderMailPrompt({ poNumber: o.poNumber, client: o.client, project: o.project, endClient: o.endClient, poDate: ymd(o.poDate) as string }, today) }] }],
            generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: ORDER_MAIL_SCHEMA, maxOutputTokens: 8192 },
          }
        : null,
    });
  }
  return { model: getGeminiModel(), orders: out };
}

/** n8n posts Gemini's answer for one order (or that no mail thread was found). */
export async function saveOrderMailStatus(p: { orderId?: unknown; threads?: unknown; model?: unknown; gemini?: { status?: unknown; text?: unknown } | null }) {
  const orderId = Number(p.orderId);
  if (!Number.isInteger(orderId) || orderId <= 0) throw new UserError('orderId is missing.');
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true } });
  if (!order) throw new UserError('Order not found.');
  const meta = { model: String(p.model ?? getGeminiModel()).slice(0, 80), at: new Date().toISOString(), threads: Number(p.threads) || 0 };
  const status: OrderMailStatus = p.gemini ? normaliseMailStatus(parseGeminiAnswer<unknown>(Number(p.gemini.status) || 0, String(p.gemini.text ?? '')), meta) : normaliseMailStatus({}, meta);
  await prisma.order.update({ where: { id: orderId }, data: { mailStatus: status as unknown as Prisma.InputJsonValue, mailStatusAt: new Date() } });
  await prisma.editLog.create({
    data: { tableName: 'orders', recordId: orderId, fieldName: 'MAIL_CHECK', oldValue: null, newValue: JSON.stringify({ threads: meta.threads, pending: status.pending.length, latest: status.latest }).slice(0, 5000), ...auditUser(N8N_USER) },
  });
  return { orderId, saved: true };
}

/** "Check mails now" on the dashboard: n8n reads these orders' mails at once. */
export async function requestOrderMailCheck(orderIds: number[], user: AuthUser) {
  await callN8n('ceebuild-order-mail-check', { orderIds: orderIds.slice(0, 20), requestedBy: user.name });
  return { queued: orderIds.length };
}

async function factsOf(orderIds?: number[]) {
  const orders = await prisma.order.findMany({
    where: orderIds ? { id: { in: orderIds } } : undefined,
    orderBy: { id: 'asc' },
    include: {
      docket: { select: { partyName: true, utility: true } },
      documents: { select: { kind: true, fileName: true } },
      bomUploads: { select: { status: true } },
    },
  });
  const byDocket = new Map<number, string[]>();
  for (const o of await prisma.order.findMany({ select: { docketId: true, poNumber: true } })) byDocket.set(o.docketId, [...(byDocket.get(o.docketId) ?? []), o.poNumber]);
  return orders.map((o) => {
    const facts: OrderFacts = {
      poNumber: o.poNumber,
      client: o.client,
      docketNo: o.docketNo,
      docketParty: o.docket.partyName,
      docketUtility: o.docket.utility,
      endClient: o.endClient,
      project: o.project,
      deliveryDue: ymd(o.deliveryDue),
      contractValue: o.contractValue?.toNumber() ?? null,
      gstPct: o.gstPct?.toNumber() ?? null,
      paymentTerms: o.paymentTerms,
      advancePct: o.advancePct?.toNumber() ?? null,
      contactPerson: o.contactPerson,
      contactEmail: o.contactEmail,
      contactPhone: o.contactPhone,
      deliveryAddress: o.deliveryAddress,
      customerGstin: o.customerGstin,
      drawingStatus: o.drawingStatus,
      onHold: o.onHold,
      holdReason: o.holdReason,
      jobStatus: o.jobStatus,
      jobNote: o.jobNote,
      bomConfirmed: o.bomUploads.some((b) => b.status === 'CORRECT'),
      bomUploads: o.bomUploads.length,
      documents: o.documents,
      sameDocketOrders: (byDocket.get(o.docketId) ?? []).filter((p) => p !== o.poNumber),
    };
    return { order: o, facts, mail: (o.mailStatus as unknown as OrderMailStatus | null) ?? null };
  });
}

export type OrderNeedsRow = OrderNeeds & {
  orderId: number;
  poNumber: string;
  client: string | null;
  docketNo: string | null;
  project: string | null;
  checkedAt: string | null;
  latest: string | null;
  threads: number;
};

/** The checklist for every order (or the given ones). */
export async function orderNeedsList(orderIds?: number[]): Promise<OrderNeedsRow[]> {
  return (await factsOf(orderIds)).map(({ order, facts, mail }) => ({
    orderId: order.id,
    poNumber: order.poNumber,
    client: order.client,
    docketNo: order.docketNo,
    project: order.project ?? order.endClient,
    checkedAt: order.mailStatusAt?.toISOString() ?? null,
    latest: mail?.latest ?? null,
    threads: mail?.threads ?? 0,
    ...orderNeeds(facts, mail),
  }));
}
