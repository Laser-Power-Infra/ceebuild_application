import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { UserError } from '@/lib/actionResult';
import { getGeminiModel, parseGeminiAnswer } from '@/lib/gemini';
import { searchMailThreads, type MailThread } from '@/lib/mailDb';
import { nextDocketNumber, isUniqueViolation } from '@/lib/docketNumber';
import { classifyMail, enquiryNoKey, ENQUIRY_SEARCH_WORDS, MAIL_CLASSES, partyKey, type MailClass } from '@/lib/enquiry/classify';

// Rev 2 §2 stage 1 (E1-E3, E6 tracker): n8n lists new mails of info@ that look like enquiries
// (mail archive search), reads each with Gemini (same paid key as PO intake) and posts the answer
// here. An ENQUIRY creates a docket with its items (or links to the docket that already exists for
// the same party / enquiry no. within 60 days); anything else is recorded so it is not read again.
// Stage 2 (E4-E5: BOM, costing, draft offer + reply, escalations) builds on these rows.

const S = { type: 'STRING', nullable: true } as const;

export const ENQUIRY_SCHEMA = {
  type: 'OBJECT',
  properties: {
    mailClass: { type: 'STRING', enum: [...MAIL_CLASSES] },
    party: S,
    partyAddress: S,
    contactName: S,
    contactEmail: S,
    contactPhone: S,
    project: S,
    utility: S,
    billingState: S,
    deliveryState: S,
    deliveryLocation: S,
    enquiryNo: S,
    enquiryDate: S,
    dueDate: S,
    tender: { type: 'BOOLEAN' },
    terms: S,
    items: { type: 'ARRAY', items: { type: 'OBJECT', properties: { description: { type: 'STRING' }, unit: S, qty: S, note: S }, required: ['description'] } },
    documents: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, type: { type: 'STRING', enum: ['BOQ', 'BOM', 'DRAWING', 'GTP', 'SPECIFICATION', 'OFFER', 'OTHER'] } }, required: ['name', 'type'] } },
    notes: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['mailClass', 'items', 'documents', 'notes'],
};

export function enquiryPrompt(today: string) {
  return `You are reading a mail thread received by CEEBUILD COMPANY (info@ceebuildcompany.com), a maker of galvanised steel
fabricated structures for power distribution / transmission (cross arms, channels, clamps, earthing, fencing, stay sets ...).
Its group company is LASER POWER & INFRA LIMITED. Attached documents (BOQ, drawings, GTP, specifications) may be scanned: read
them by OCR. Today is ${today}. Return JSON matching the schema.

mailClass: ENQUIRY = someone asks Ceebuild for a price / offer / quotation / bid (RFQ, BOQ to quote, tender or GeM bid, "best
offer", "requirement" with quantities) - including enquiries forwarded internally (e.g. Laser's purchase or management team
forwarding their project's requirement to Ceebuild: then the party is LASER POWER & INFRA LTD. and the utility / project is the
end client). NOT an enquiry: Laser's or Ceebuild's own purchase enquiries to OTHER suppliers (cables, conductors, wires,
pipes ... asked from vendors, with Ceebuild only copied or forwarding) - that is OTHER. PO = a purchase / work order or LOA. AMENDMENT = a revised BOQ / corrigendum / amendment to an earlier enquiry or
order. CLARIFICATION = questions or answers about an earlier enquiry or offer. OTHER = anything else, including OUR OWN offers
and quotations sent out by Ceebuild / Laser, invoices, payments, internal mails.

For an ENQUIRY (else leave the fields null and items empty):
- party = the organisation asking for the price (never Ceebuild; Laser only when Laser itself is the buyer). partyAddress.
- contactName / contactEmail / contactPhone = the customer's own person (signature of the enquiring mail) - NEVER our people
  (anyone @ceebuildcompany.com, and Laser people unless Laser is the buyer).
- project, utility (end client / DISCOM, e.g. KESCo, SBPDCL, JSW Mahanadi), billingState (party's state), deliveryState and
  deliveryLocation (site / store), enquiryNo, enquiryDate and dueDate (bid / reply due date) as dd-mm-yyyy.
- tender = true for a tender / GeM / e-procurement bid, false for a direct purchase enquiry.
- terms = the terms asked, one line: price basis (ex-works / FOR / DAP), taxes, freight, delivery period, payment, LD.
- items = every line of the BOQ / requirement: description as printed (short form ok), unit as printed (Sqm, Set, Nos, Kg,
  MT, Km), qty, note (e.g. "mesh 50x50 for 7.08"). Skip total rows. Do not invent lines.
- documents = one entry per attached document (name exactly as in "Document n: name"): BOQ, BOM, DRAWING, GTP,
  SPECIFICATION, OFFER (our own) or OTHER.
- notes = anything the costing team must know (options asked, galvanised vs painted, drawings still to come, open queries).`;
}

export function enquiryRequestSpec() {
  return { model: getGeminiModel(), prompt: enquiryPrompt(new Date().toISOString().slice(0, 10)), schema: ENQUIRY_SCHEMA };
}

export const threadRef = (threadId: string) => `thread:${threadId}`;
const MAX_FAILS = 3;
const OWN_SENDER = /@ceebuildcompany\.com/i;

/** Threads already handled (any status but FAILED, or FAILED 3 times). */
async function handledThreads(ids: string[]) {
  if (!ids.length) return new Set<string>();
  const rows = await prisma.enquiryIntake.findMany({ where: { threadRef: { in: ids.map(threadRef) } }, select: { threadRef: true, status: true } });
  const fails = new Map<string, number>();
  const done = new Set<string>();
  for (const r of rows) {
    const id = r.threadRef.slice('thread:'.length);
    if (r.status === 'FAILED') fails.set(id, (fails.get(id) ?? 0) + 1);
    else done.add(id);
  }
  for (const [id, n] of fails) if (n >= MAX_FAILS) done.add(id);
  return done;
}

const forN8n = (t: MailThread, cls: MailClass) => ({
  threadId: t.threadId,
  subject: t.subject,
  sender: t.sender,
  date: t.date,
  preClass: cls,
  mailText: t.text.slice(0, 8000),
  files: t.files
    .filter((f) => f.kind !== 'SKIP' && f.driveId)
    .slice(0, 12)
    .map((f) => ({ name: f.name, driveId: f.driveId, kind: f.kind, link: f.link })),
});

/** For n8n: mails of the last `days` days that look like enquiries and were not read yet (oldest first). */
export async function n8nEnquiryMails(days: number, limit: number, backfill = false) {
  const since = Date.now() - days * 86400000;
  const seen = new Map<string, MailThread>();
  // One archive search per word, run together (each takes a few seconds).
  const found = await Promise.all(ENQUIRY_SEARCH_WORDS.map((w) => searchMailThreads(w, 100)));
  for (const list of found) for (const t of list) if (!seen.has(t.threadId)) seen.set(t.threadId, t);
  const cands = [...seen.values()]
    .filter((t) => t.date && new Date(t.date.replace(' ', 'T') + '+05:30').getTime() >= since)
    // Our own outgoing mails (offers / quotations from info@) are not enquiries; forwards to us are.
    .filter((t) => !(OWN_SENDER.test(t.sender ?? '') && !/^\s*(fw|fwd)\s*:/i.test(t.subject ?? '')))
    .map((t) => ({ t, cls: classifyMail(t.subject, t.text) }))
    .filter((x) => x.cls === 'ENQUIRY' || x.cls === 'AMENDMENT' || x.cls === 'CLARIFICATION');
  const done = await handledThreads(cands.map((c) => c.t.threadId));
  const mails = cands
    .filter((c) => !done.has(c.t.threadId))
    .sort((a, b) => String(a.t.date).localeCompare(String(b.t.date)))
    .slice(0, limit)
    .map((c) => forN8n(c.t, c.cls));
  return { ...enquiryRequestSpec(), backfill, candidates: cands.length, mails };
}

interface RawEnquiry {
  mailClass?: string;
  party?: string | null;
  partyAddress?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  project?: string | null;
  utility?: string | null;
  billingState?: string | null;
  deliveryState?: string | null;
  deliveryLocation?: string | null;
  enquiryNo?: string | null;
  enquiryDate?: string | null;
  dueDate?: string | null;
  tender?: boolean;
  terms?: string | null;
  items?: { description?: string; unit?: string | null; qty?: string | null; note?: string | null }[];
  documents?: { name?: string; type?: string }[];
  notes?: string[];
}

export interface N8nEnquiryPayload {
  threadId?: string;
  subject?: string | null;
  sender?: string | null;
  date?: string | null;
  files?: { name?: string; kind?: string; link?: string | null; error?: string | null }[];
  gemini?: { status?: number; text?: string } | null;
  model?: string | null;
  note?: string | null;
  /** 90-day backfill: an enquiry with no docket is listed (BACKLOG), no docket is created. */
  backfill?: boolean;
}

const str = (v: unknown, n = 300) => {
  const s = String(v ?? '').trim();
  return s && s.toLowerCase() !== 'null' ? s.slice(0, n) : null;
};
/** dd-mm-yyyy / yyyy-mm-dd / "18 Sep 2026" -> Date (UTC midnight) or null. */
function dateOf(v: unknown): Date | null {
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) return new Date(Date.UTC(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2] - 1, +m[1]));
  const d = new Date(s);
  return s && !Number.isNaN(d.getTime()) ? new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) : null;
}
const qtyOf = (v: unknown) => {
  const m = String(v ?? '').replace(/,/g, '').match(/\d+(\.\d+)?/);
  return m ? m[0] : null;
};

/** Docket of the same party (and enquiry no. / utility when known) made from 60 days before the mail on. */
async function existingDocket(e: RawEnquiry, mailDate: Date | null) {
  const no = enquiryNoKey(e.enquiryNo);
  if (no) {
    const prev = await prisma.enquiryIntake.findFirst({ where: { enquiryNo: { not: null }, docketId: { not: null } }, orderBy: { id: 'desc' }, select: { enquiryNo: true, docketId: true } });
    if (prev && enquiryNoKey(prev.enquiryNo) === no) return prev.docketId;
  }
  const key = partyKey(e.party);
  if (!key) return null;
  const from = new Date((mailDate ?? new Date()).getTime() - 60 * 86400000);
  const dockets = await prisma.dockerPartyName.findMany({ where: { createdAt: { gte: from } }, orderBy: { id: 'desc' }, select: { id: true, partyName: true, utility: true } });
  const uKey = partyKey(e.utility);
  const same = dockets.filter((d) => partyKey(d.partyName) === key);
  // Same party with several dockets (e.g. Laser: KESCo and KUSUM): the utility decides.
  const hit = uKey ? (same.find((d) => partyKey(d.utility) === uKey) ?? (same.length === 1 && !same[0].utility ? same[0] : null)) : (same[0] ?? null);
  return hit?.id ?? null;
}

/** n8n posts back one mail it read. Idempotent per thread (a FAILED read may be retried). */
export async function ingestEnquiry(p: N8nEnquiryPayload) {
  const threadId = String(p.threadId ?? '').trim();
  if (!/^[0-9a-zA-Z_-]{6,64}$/.test(threadId)) throw new UserError('threadId is missing or invalid.');
  const ref = threadRef(threadId);
  const existing = await prisma.enquiryIntake.findFirst({ where: { threadRef: ref, status: { not: 'FAILED' } }, orderBy: { id: 'desc' } });
  if (existing) return { id: existing.id, status: existing.status, docketId: existing.docketId, docketNo: existing.docketNo, duplicate: true };

  const base = {
    threadRef: ref,
    subject: str(p.subject, 500),
    sender: str(p.sender, 300),
    mailDate: p.date ? new Date(String(p.date).replace(' ', 'T') + '+05:30') : null,
    files: (p.files ?? []).map((f) => ({ name: str(f.name, 200), kind: str(f.kind, 20), link: str(f.link, 500), error: str(f.error, 200) })) as Prisma.InputJsonValue,
    model: str(p.model, 100),
  };
  if (base.mailDate && Number.isNaN(base.mailDate.getTime())) base.mailDate = null;

  let e: RawEnquiry;
  try {
    if (!p.gemini) throw new UserError(p.note || 'The mail was not read by the AI.');
    e = parseGeminiAnswer<RawEnquiry>(Number(p.gemini.status) || 0, String(p.gemini.text ?? ''));
  } catch (err) {
    const row = await prisma.enquiryIntake.create({ data: { ...base, classification: 'OTHER', status: 'FAILED', error: (err as Error).message.slice(0, 1000) } });
    return { id: row.id, status: row.status, docketId: null, docketNo: null };
  }
  const cls = (MAIL_CLASSES as readonly string[]).includes(String(e.mailClass)) ? (e.mailClass as MailClass) : 'OTHER';
  const extracted = e as unknown as Prisma.InputJsonValue;
  const common = { ...base, classification: cls, extracted, partyName: str(e.party, 300), enquiryNo: str(e.enquiryNo, 100), dueDate: dateOf(e.dueDate) };
  if (cls !== 'ENQUIRY') {
    const row = await prisma.enquiryIntake.create({ data: { ...common, status: 'NOT_ENQUIRY' } });
    return { id: row.id, status: row.status, classification: cls, docketId: null, docketNo: null };
  }

  const linkId = await existingDocket(e, base.mailDate);
  if (linkId) {
    const d = await prisma.dockerPartyName.findUnique({ where: { id: linkId }, select: { docketNoQtnNo: true } });
    const row = await prisma.enquiryIntake.create({ data: { ...common, status: 'LINKED', docketId: linkId, docketNo: d?.docketNoQtnNo ?? null } });
    return { id: row.id, status: row.status, docketId: linkId, docketNo: d?.docketNoQtnNo ?? null };
  }
  // 90-day backfill (E1): list the old enquiry with no docket; no docket number is taken without approval.
  if (p.backfill) {
    const row = await prisma.enquiryIntake.create({ data: { ...common, status: 'BACKLOG' } });
    return { id: row.id, status: row.status, docketId: null, docketNo: null };
  }

  // New docket "Enquiry – to cost", items from the BOQ.
  const items = (e.items ?? []).filter((i) => str(i.description)).slice(0, 200);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const out = await prisma.$transaction(async (tx) => {
        const { nextDocketNo } = await nextDocketNumber(tx);
        const d = await tx.dockerPartyName.create({
          data: {
            docketNoQtnNo: nextDocketNo,
            partyName: (str(e.party, 300) ?? 'UNKNOWN PARTY').toUpperCase(),
            address: str(e.partyAddress, 500),
            state: str(e.billingState, 100),
            deliveryState: str(e.deliveryState, 100),
            deliveryLocation: str(e.deliveryLocation, 300),
            utility: str(e.utility, 100),
            type: e.tender ? 'Tender' : 'Purchase',
          },
        });
        if (items.length)
          await tx.itemTable.createMany({
            data: items.map((i) => ({
              docketNoQtnNo: nextDocketNo,
              itemNameParty: [str(i.description, 400), str(i.note, 200)].filter(Boolean).join(' – '),
              uom: str(i.unit, 30),
              qty: qtyOf(i.qty),
            })),
          });
        const row = await tx.enquiryIntake.create({ data: { ...common, status: 'CREATED', docketId: d.id, docketNo: nextDocketNo } });
        await tx.editLog.create({
          data: {
            tableName: 'docket-party-name',
            recordId: d.id,
            fieldName: 'ALL_FIELDS',
            oldValue: 'NONE (New Record)',
            newValue: JSON.stringify({ docketNo: nextDocketNo, source: 'Enquiry intake (n8n)', enquiryIntakeId: row.id, subject: base.subject, items: items.length }),
            userName: 'n8n enquiry intake',
          },
        });
        return { id: row.id, status: row.status, docketId: d.id, docketNo: nextDocketNo };
      });
      return out;
    } catch (err) {
      if (!isUniqueViolation(err) || attempt === 2) throw err;
    }
  }
  throw new Error('Could not get a docket number.');
}

export interface EnquiryRow {
  id: number;
  status: string;
  classification: string;
  subject: string | null;
  sender: string | null;
  partyName: string | null;
  enquiryNo: string | null;
  mailDate: string | null;
  dueDate: string | null;
  docketId: number | null;
  docketNo: string | null;
  items: number;
  bomReady: number;
  costed: number;
  quoted: string | null;
  sentOn: string | null;
  ordered: boolean;
  outcome: string | null;
  daysToDue: number | null;
  stage: string;
}

const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** E6 tracker: each enquiry with its stage (received -> docket -> BOM -> costed -> offer -> sent -> PO / lost). */
export async function enquiryTracker(): Promise<EnquiryRow[]> {
  const rows = await prisma.enquiryIntake.findMany({ where: { status: { in: ['CREATED', 'LINKED', 'BACKLOG'] } }, orderBy: { id: 'desc' }, take: 300 });
  const ids = [...new Set(rows.map((r) => r.docketId).filter((x): x is number => !!x))];
  const dockets = ids.length ? await prisma.dockerPartyName.findMany({ where: { id: { in: ids } }, select: { id: true, docketNoQtnNo: true } }) : [];
  const nos = dockets.map((d) => d.docketNoQtnNo).filter((x): x is string => !!x);
  const [items, boms, costs, snaps, orders] = await Promise.all([
    nos.length ? prisma.itemTable.findMany({ where: { docketNoQtnNo: { in: nos } }, select: { id: true, docketNoQtnNo: true } }) : [],
    ids.length ? prisma.itemBom.findMany({ where: { docketId: { in: ids } }, select: { docketId: true, itemId: true } }) : [],
    ids.length ? prisma.itemCosting.findMany({ where: { docketId: { in: ids } }, select: { docketId: true, itemId: true } }) : [],
    ids.length ? prisma.quotationSnapshot.findMany({ where: { docketId: { in: ids } }, select: { docketId: true, status: true, quotedOn: true } }) : [],
    ids.length ? prisma.order.findMany({ where: { docketId: { in: ids } }, select: { docketId: true } }) : [],
  ]);
  const today = Date.now();
  return rows.map((r) => {
    const no = dockets.find((d) => d.id === r.docketId)?.docketNoQtnNo ?? r.docketNo;
    const its = items.filter((i) => i.docketNoQtnNo === no);
    const bomReady = new Set(boms.filter((b) => b.docketId === r.docketId).map((b) => b.itemId)).size;
    const costed = new Set(costs.filter((c) => c.docketId === r.docketId).map((c) => c.itemId)).size;
    const sn = snaps.filter((s) => s.docketId === r.docketId);
    const sent = sn.find((s) => s.status === 'SENT');
    const ordered = orders.some((o) => o.docketId === r.docketId);
    const stage = r.outcome
      ? r.outcome
      : ordered
        ? 'PO received'
        : sent
          ? 'Offer sent'
          : sn.length
            ? 'Offer approved'
            : its.length && costed >= its.length
              ? 'Costed – offer to draft'
              : its.length && bomReady >= its.length
                ? 'BOM ready – to cost'
                : r.docketId
                  ? 'Docket – BOM to make'
                  : r.status === 'BACKLOG'
                    ? 'Backlog – no docket (approve to create)'
                    : 'Received';
    return {
      id: r.id,
      status: r.status,
      classification: r.classification,
      subject: r.subject,
      sender: r.sender,
      partyName: r.partyName,
      enquiryNo: r.enquiryNo,
      mailDate: ymd(r.mailDate),
      dueDate: ymd(r.dueDate),
      docketId: r.docketId,
      docketNo: no,
      items: its.length,
      bomReady,
      costed,
      quoted: ymd(sn[0]?.quotedOn ?? null),
      sentOn: ymd(sent?.quotedOn ?? null),
      ordered,
      outcome: r.outcome,
      daysToDue: r.dueDate ? Math.ceil((r.dueDate.getTime() - today) / 86400000) : null,
      stage,
    };
  });
}

/** Counts of the last run for n8n's run log. */
export async function enquiryIntakeCounts() {
  const g = await prisma.enquiryIntake.groupBy({ by: ['status'], _count: true });
  return Object.fromEntries(g.map((x) => [x.status, x._count]));
}
