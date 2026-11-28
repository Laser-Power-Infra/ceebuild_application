import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { UserError } from '@/lib/actionResult';
import { getGeminiModel, parseGeminiAnswer } from '@/lib/gemini';
import { recentCeebuildThreads, type MailThread } from '@/lib/mailDb';
import { missedMails, missedMailsText, type MissedMail } from '@/lib/mailCoverage';
import { countsAsFail } from '@/lib/po/threadHandled';
import { nextDocketNumber, isUniqueViolation } from '@/lib/docketNumber';
import { autoCostEnquiry } from './autoCost';
import { classifyMail, enquiryCandidate, enquiryNoKey, MAIL_CLASSES, partyKey, type MailClass } from '@/lib/enquiry/classify';

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
    items: { type: 'ARRAY', items: { type: 'OBJECT', properties: { description: { type: 'STRING' }, unit: S, qty: S, note: S, ourItem: S, libraryType: S }, required: ['description'] } },
    documents: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, type: { type: 'STRING', enum: ['BOQ', 'BOM', 'DRAWING', 'GTP', 'SPECIFICATION', 'OFFER', 'OTHER'] } }, required: ['name', 'type'] } },
    notes: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['mailClass', 'items', 'documents', 'notes'],
};

export function enquiryPrompt(today: string, ourItems: string[] = [], libraryTypes: string[] = []) {
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
and quotations sent out by Ceebuild / Laser on their own, invoices, payments, internal mails.
Classify the THREAD by the request that started it: a customer's RFQ / enquiry followed by our offer or our questions in
later messages is still an ENQUIRY (read party, items and terms from the customer's request).

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
  ourItem = the one of OUR ITEM NAMES below that the line is (exactly as written there), else null.
  libraryType = the one of APPROVED DRAWING TYPES below that is the same structure (same voltage, pole type and
  arrangement), exactly as written there, else null. Only when it is clearly the same structure.
- documents = one entry per attached document (name exactly as in "Document n: name"): BOQ, BOM, DRAWING, GTP,
  SPECIFICATION, OFFER (our own) or OTHER.
- notes = anything the costing team must know (options asked, galvanised vs painted, drawings still to come, open queries).

OUR ITEM NAMES: ${ourItems.join(' | ') || '(none)'}
APPROVED DRAWING TYPES: ${libraryTypes.join(' | ') || '(none)'}`;
}

/** Our item names in use and the approved drawing types, for the AI to map enquiry lines onto. */
async function mappingLists() {
  const [names, types] = await Promise.all([
    prisma.itemTable.groupBy({ by: ['ourItemName'], where: { ourItemName: { not: null } }, _count: true, orderBy: { _count: { ourItemName: 'desc' } }, take: 30 }),
    prisma.approvedDrawing.findMany({ where: { status: 'APPROVED' }, select: { itemType: true }, distinct: ['itemType'] }),
  ]);
  return {
    ourItems: names.map((n) => String(n.ourItemName ?? '').trim()).filter((n) => n && n.toUpperCase() !== 'OTHERS'),
    libraryTypes: types.map((t) => t.itemType).filter(Boolean),
  };
}

export async function enquiryRequestSpec() {
  const { ourItems, libraryTypes } = await mappingLists();
  return { model: getGeminiModel(), prompt: enquiryPrompt(new Date().toISOString().slice(0, 10), ourItems, libraryTypes), schema: ENQUIRY_SCHEMA };
}

export const threadRef = (threadId: string) => `thread:${threadId}`;
const MAX_FAILS = 3;
const OWN_SENDER = /@ceebuildcompany\.com/i;

/** Threads already handled (any status but FAILED, or FAILED 3 times). */
async function handledThreads(ids: string[]) {
  if (!ids.length) return new Set<string>();
  const rows = await prisma.enquiryIntake.findMany({ where: { threadRef: { in: ids.map(threadRef) } }, select: { threadRef: true, status: true, error: true } });
  const fails = new Map<string, number>();
  const done = new Set<string>();
  for (const r of rows) {
    const id = r.threadRef.slice('thread:'.length);
    if (r.status === 'FAILED') {
      if (countsAsFail(r)) fails.set(id, (fails.get(id) ?? 0) + 1);
    }
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
  // Every Ceebuild thread of the period, WITH OR WITHOUT attachments: many enquiries carry the BOQ in
  // the mail text only ("Tender Enquiry for Earthmat ...", "Require 33 KV line material").
  const cands = (await recentCeebuildThreads(days))
    .filter((t) => t.date && new Date(t.date.replace(' ', 'T') + '+05:30').getTime() >= since)
    .filter((t) => enquiryCandidate(t.subject, t.sender, t.files.map((f) => f.name).join(', ')))
    // Our own quotation mails ("Quotation CEE-000534 ...") are not enquiries. A customer's RFQ thread whose
    // latest message is our reply still is (the archive shows the latest sender).
    .filter((t) => !(OWN_SENDER.test(t.sender ?? '') && /CEE-?\d{4,}/i.test(t.subject ?? '') && !/\b(rfq|enquiry|inquiry|boq)\b/i.test(t.subject ?? '')))
    .map((t) => ({ t, cls: classifyMail(t.subject, t.text) }))
    .filter((x) => x.cls === 'ENQUIRY' || x.cls === 'AMENDMENT' || x.cls === 'CLARIFICATION');
  const done = await handledThreads(cands.map((c) => c.t.threadId));
  const mails = cands
    .filter((c) => !done.has(c.t.threadId))
    .sort((a, b) => String(a.t.date).localeCompare(String(b.t.date)))
    .slice(0, limit)
    .map((c) => forN8n(c.t, c.cls));
  return { ...(await enquiryRequestSpec()), backfill, candidates: cands.length, mails };
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
  items?: { description?: string; unit?: string | null; qty?: string | null; note?: string | null; ourItem?: string | null; libraryType?: string | null }[];
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
const stateKey = (s: string | null | undefined) => String(s ?? '').trim().toUpperCase().replace(/[^A-Z]/g, '') || null;

/**
 * The docket this mail belongs to, or null. In order: the enquiry no. (earlier intake, or in a docket's
 * attachment names, e.g. the JSW RFQ no. in its PDF name); same party + same utility; the only docket
 * of that utility; same party + same delivery state; the party's only docket. Window: dockets made
 * from 60 days before the mail on.
 */
async function existingDocket(e: RawEnquiry, mailDate: Date | null, subject: string | null, excludeIntakeId?: number) {
  const from = new Date((mailDate ?? new Date()).getTime() - 60 * 86400000);
  const dockets = await prisma.dockerPartyName.findMany({
    where: { createdAt: { gte: from } },
    orderBy: { id: 'desc' },
    select: { id: true, partyName: true, utility: true, state: true, deliveryState: true, attachments: true },
  });
  const no = enquiryNoKey(e.enquiryNo) ?? enquiryNoKey(String(subject ?? '').match(/\b\d{8,12}\b/)?.[0]);
  if (no) {
    const prev = await prisma.enquiryIntake.findMany({
      where: { enquiryNo: { not: null }, docketId: { not: null }, ...(excludeIntakeId ? { id: { not: excludeIntakeId } } : {}) },
      select: { enquiryNo: true, docketId: true },
    });
    const p = prev.find((x) => enquiryNoKey(x.enquiryNo) === no);
    if (p) return p.docketId;
    const byFile = dockets.find((d) => String(d.attachments ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '').includes(no));
    if (byFile) return byFile.id;
  }
  const pKey = partyKey(e.party);
  const uKey = partyKey(e.utility);
  const sKey = stateKey(e.deliveryState);
  const same = pKey ? dockets.filter((d) => partyKey(d.partyName) === pKey) : [];
  // A docket of the same utility counts only for the same customer (or when the utility is the customer
  // itself, e.g. JSW): another contractor's docket for the same DISCOM is a different enquiry.
  const ofUtility = uKey ? dockets.filter((d) => (partyKey(d.utility) === uKey && (!pKey || partyKey(d.partyName) === pKey)) || partyKey(d.partyName) === uKey) : [];
  const sameState = sKey ? same.filter((d) => stateKey(d.deliveryState ?? d.state) === sKey) : [];
  const hit =
    (uKey ? same.find((d) => partyKey(d.utility) === uKey) : undefined) ??
    (ofUtility.length === 1 ? ofUtility[0] : undefined) ??
    (sameState.length === 1 ? sameState[0] : undefined) ??
    // The party's only docket, unless it is clearly for another utility.
    (same.length === 1 && (!uKey || !same[0].utility) ? same[0] : undefined);
  return hit?.id ?? null;
}

/** Re-check the link of rows already read (after the matching rules change). CREATED rows are left alone. */
export async function relinkEnquiries() {
  const rows = await prisma.enquiryIntake.findMany({ where: { status: { in: ['LINKED', 'BACKLOG', 'NOT_ENQUIRY'] }, classification: { in: ['ENQUIRY', 'AMENDMENT', 'CLARIFICATION'] } } });
  const changes: string[] = [];
  for (const r of rows) {
    const e = (r.extracted ?? {}) as RawEnquiry;
    const id = await existingDocket(e, r.mailDate, r.subject, r.id);
    const status = id ? 'LINKED' : r.classification === 'ENQUIRY' ? 'BACKLOG' : 'NOT_ENQUIRY';
    if (id === r.docketId && status === r.status) continue;
    const d = id ? await prisma.dockerPartyName.findUnique({ where: { id }, select: { docketNoQtnNo: true } }) : null;
    await prisma.enquiryIntake.update({ where: { id: r.id }, data: { status, docketId: id, docketNo: d?.docketNoQtnNo ?? null } });
    changes.push(`${r.id} ${r.status}${r.docketNo ? ` ${r.docketNo}` : ''} -> ${status}${d?.docketNoQtnNo ? ` ${d.docketNoQtnNo}` : ''} (${String(r.subject ?? '').slice(0, 60)})`);
  }
  return changes;
}

/** n8n posts back one mail it read. Idempotent per thread (a FAILED read may be retried). */
const OUR_DOMAIN = /@ceebuildcompany.com/i;
const REGRET_NOTE = /unable to (quote|offer|participate)|regret|not (an )?approved vendor|not in (our )?(manufacturing )?scope|out of (our )?scope|cannot (quote|offer)|not interested|do not manufacture/i;

/** An enquiry mail with no item list and no files: no docket. Returns the intake fields, or null. */
export function noItemsHold(e: { items?: unknown; notes?: unknown }, sender: string | null, fileCount: number) {
  if ((Array.isArray(e.items) && e.items.length) || fileCount > 0) return null;
  const notes = (Array.isArray(e.notes) ? e.notes : [e.notes]).filter(Boolean).map(String).join('; ');
  if (OUR_DOMAIN.test(sender ?? '') && REGRET_NOTE.test(notes))
    return { outcome: 'REGRET', outcomeNote: `Auto: our reply regretted it – ${notes}`.slice(0, 500), error: null };
  return { outcome: null, outcomeNote: null, error: `No item list in the mail${notes ? ` – ${notes}` : ''}`.slice(0, 1000) };
}

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
  // An amendment / clarification belongs to its docket (a revised BOQ updates the existing docket, E2).
  const linkId = cls === 'ENQUIRY' || cls === 'AMENDMENT' || cls === 'CLARIFICATION' ? await existingDocket(e, base.mailDate, base.subject) : null;
  if (cls !== 'ENQUIRY' && !linkId) {
    const row = await prisma.enquiryIntake.create({ data: { ...common, status: 'NOT_ENQUIRY' } });
    return { id: row.id, status: row.status, classification: cls, docketId: null, docketNo: null };
  }

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

  // No item list and no files: no docket (the number is the Quotation No.). It waits in the
  // tracker; if our own reply already regretted it, it is closed as REGRET.
  const hold = noItemsHold(e, base.sender, (p.files ?? []).length);
  if (hold) {
    const row = await prisma.enquiryIntake.create({ data: { ...common, status: 'BACKLOG', ...hold } });
    return { id: row.id, status: row.status, outcome: row.outcome, docketId: null, docketNo: null };
  }

  // New docket "Enquiry – to cost", items from the BOQ.
  const row = await prisma.enquiryIntake.create({ data: { ...common, status: 'BACKLOG' } });
  return createDocketForIntake(row.id, 'n8n enquiry intake');
}

/**
 * Docket + items for an enquiry row (new mail, or a BACKLOG enquiry approved by an Admin), then the
 * same-day draft prices. The docket number is the Quotation No., so this runs only for a new
 * enquiry or on approval.
 */
export async function createDocketForIntake(intakeId: number, byName: string) {
  const intake = await prisma.enquiryIntake.findUnique({ where: { id: intakeId } });
  if (!intake) throw new UserError('Enquiry not found.');
  if (intake.docketId) return { id: intake.id, status: intake.status, docketId: intake.docketId, docketNo: intake.docketNo };
  const e = (intake.extracted ?? {}) as RawEnquiry;
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
              ourItemName: str(i.ourItem, 100),
            })),
          });
        await tx.enquiryIntake.update({ where: { id: intakeId }, data: { status: 'CREATED', docketId: d.id, docketNo: nextDocketNo } });
        await tx.editLog.create({
          data: {
            tableName: 'docket-party-name',
            recordId: d.id,
            fieldName: 'ALL_FIELDS',
            oldValue: 'NONE (New Record)',
            newValue: JSON.stringify({ docketNo: nextDocketNo, source: 'Enquiry intake', enquiryIntakeId: intakeId, subject: intake.subject, items: items.length, by: byName }),
            userName: byName,
          },
        });
        return { id: intakeId, status: 'CREATED', docketId: d.id, docketNo: nextDocketNo };
      });
      // Stage 2: draft prices the same day (best effort; the docket is kept even if costing fails).
      await autoCostEnquiry(out.id).catch((err) => console.error('[enquiry auto-cost]', out.id, err));
      return out;
    } catch (err) {
      if (!isUniqueViolation(err) || attempt === 2) throw err;
    }
  }
  throw new Error('Could not get a docket number.');
}

export const OUTCOMES = ['PO', 'LOST', 'REGRET'] as const;
type Actor = { id: number; name: string; role: string };

/**
 * E5 exits: an enquiry is closed only by "PO received", "Lost" or a "Regret" with a reason approved
 * by an Admin (Puja). Reopen (outcome null) clears it. Every change is in the edit log.
 */
export async function setEnquiryOutcome(intakeId: number, outcome: string | null, note: string | null, user: Actor) {
  if (user.role !== 'Admin') throw new UserError('Only an Admin can close or reopen an enquiry.');
  const r = await prisma.enquiryIntake.findUnique({ where: { id: intakeId } });
  if (!r) throw new UserError('Enquiry not found.');
  const o = outcome && (OUTCOMES as readonly string[]).includes(outcome) ? outcome : null;
  if (outcome && !o) throw new UserError('Outcome is PO, LOST or REGRET.');
  const reason = String(note ?? '').trim().slice(0, 500) || null;
  if ((o === 'REGRET' || o === 'LOST') && !reason) throw new UserError(`Give the reason for ${o === 'REGRET' ? 'the regret' : 'losing it'}.`);
  const stamp = `${user.name} ${new Date().toISOString().slice(0, 10)}`;
  await prisma.enquiryIntake.update({ where: { id: intakeId }, data: { outcome: o, outcomeNote: o ? (reason ? `${reason} – ${stamp}` : stamp) : null } });
  await prisma.editLog.create({
    data: { tableName: 'enquiry_intakes', recordId: intakeId, fieldName: 'outcome', oldValue: r.outcome ?? '', newValue: o ? `${o}${reason ? `: ${reason}` : ''}` : 'reopened', userId: user.id, userName: user.name },
  });
  return { id: intakeId, outcome: o };
}

/** Admin approves a BACKLOG enquiry: it gets its docket (Quotation No.) and draft prices. */
export async function approveBacklog(intakeId: number, user: Actor) {
  if (user.role !== 'Admin') throw new UserError('Only an Admin can give an enquiry its docket number.');
  const r = await prisma.enquiryIntake.findUnique({ where: { id: intakeId } });
  if (!r || r.status !== 'BACKLOG') throw new UserError('Only a backlog enquiry can be approved.');
  return createDocketForIntake(intakeId, user.name);
}

export interface ReminderRow {
  id: number;
  partyName: string | null;
  subject: string | null;
  docketNo: string | null;
  dueDate: string | null;
  daysToDue: number | null;
  reason: string;
  severity: 'RED' | 'AMBER' | 'INFO';
}

/** E5 escalation list for the daily n8n mail: due date passed, due within 2 days, drafts waiting, backlog. */
export async function enquiryReminders(): Promise<{ rows: ReminderRow[]; red: number; text: string; missed: MissedMail[] }> {
  const rows = (await enquiryTracker()).filter((r) => !r.outcome && !r.ordered && !r.sentOn);
  const out: ReminderRow[] = [];
  for (const r of rows) {
    const base = { id: r.id, partyName: r.partyName, subject: r.subject, docketNo: r.docketNo, dueDate: r.dueDate, daysToDue: r.daysToDue };
    // Backlog (90-day backfill) first: old enquiries are a decision list, not an alarm.
    if (r.status === 'BACKLOG') out.push({ ...base, reason: 'Old enquiry without a docket – approve (docket no.), Lost or Regret', severity: 'INFO' });
    else if (r.daysToDue !== null && r.daysToDue < 0) out.push({ ...base, reason: `Due date passed ${-r.daysToDue} day(s) ago without an offer sent`, severity: 'RED' });
    else if (r.daysToDue !== null && r.daysToDue <= 2) out.push({ ...base, reason: `Due in ${r.daysToDue} day(s) – offer not sent`, severity: 'RED' });
    else if (r.draftTotal !== null && !r.quoted) out.push({ ...base, reason: `Draft offer ready${r.budgetary ? ' (budgetary)' : ''} – waiting for approval`, severity: 'AMBER' });
    else if (!r.quoted) out.push({ ...base, reason: 'Docket open – BOM / costing to finish', severity: 'AMBER' });
  }
  const order = { RED: 0, AMBER: 1, INFO: 2 } as const;
  out.sort((a, b) => order[a.severity] - order[b.severity] || (a.daysToDue ?? 999) - (b.daysToDue ?? 999));
  const line = (x: ReminderRow) =>
    `- [${x.severity}] ${x.docketNo ?? 'no docket'} | ${x.partyName ?? '?'} | ${String(x.subject ?? '').slice(0, 80)}${x.dueDate ? ` | due ${x.dueDate}` : ''}\n  ${x.reason}`;
  // Safety net: PO / enquiry mails of the last 2 days that neither n8n reader recorded (listed first).
  let missed: MissedMail[] = [];
  try {
    missed = await missedMails(2);
  } catch (e) {
    console.error('[enquiry reminders] missed mails check', e);
  }
  const body = out.length ? out.map(line).join('\n') : 'No open enquiry needs action.';
  const text = missed.length ? `${missedMailsText(missed)}\n\n${body}` : body;
  return { rows: out, red: out.filter((x) => x.severity === 'RED').length + missed.length, text, missed };
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
  /** Stage 2 draft (never applied): total and whether any line is budgetary / estimated. */
  draftTotal: number | null;
  budgetary: boolean;
  needs: string[];
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
                  : r.status === 'BACKLOG' && r.error?.startsWith('No item list')
                    ? 'No item list – get BOQ, then approve'
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
      draftTotal: (r.autoCost as { total?: number | null } | null)?.total ?? null,
      budgetary: !!(r.autoCost as { budgetary?: boolean } | null)?.budgetary,
      needs: (r.autoCost as { needs?: string[] } | null)?.needs ?? [],
    };
  });
}

/** Counts of the last run for n8n's run log. */
export async function enquiryIntakeCounts() {
  const g = await prisma.enquiryIntake.groupBy({ by: ['status'], _count: true });
  return Object.fromEntries(g.map((x) => [x.status, x._count]));
}
