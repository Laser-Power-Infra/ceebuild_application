/**
 * Order mail check: what the order's mail threads say (read by n8n + Gemini) and, from that plus the
 * order itself, what is still needed and from whom. Pure (unit-tested in tests/orderMailCheck.test.ts).
 */

// ------------------------------------------------------------------ attachments in the order's mails

export type OrderFileKind = 'PO' | 'MC' | 'DI' | 'DRAWING' | 'BOM' | 'INSPECTION' | 'OFFER' | 'OTHER' | 'SKIP';

/** What an attachment of an order mail is, from its name. */
export function orderFileKind(name: string): OrderFileKind {
  const n = name.toLowerCase();
  const ext = n.match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  if (/^(image\d*|icon|logo|outlook|signature|banner)[\w-]*\.(png|jpe?g|gif)$/.test(n) || ['gif', 'ics', 'htm', 'html'].includes(ext)) return 'SKIP';
  if (/mfg[\s_-]*clear|manufactur\w*[\s_-]*clear|(?<![a-z])mc(?![a-z])|clearance/.test(n)) return 'MC';
  if (/disp\w*[\s_-]*instr|dispatch[\s_-]*clear|(?<![a-z])di(?![a-z])/.test(n)) return 'DI';
  if (/inspect|(?<![a-z])ic(?![a-z])|(?<![a-z])mdcc(?![a-z])|test[\s_-]*cert/.test(n)) return 'INSPECTION';
  if (['xlsx', 'xlsm', 'xls', 'csv'].includes(ext) && /bom|bill of mat|cutting|piece|fab|structure|schedule/.test(n)) return 'BOM';
  if (/\bbom\b|bill[\s_-]*of[\s_-]*mat/.test(n)) return 'BOM';
  if (/\bdrg\b|drawing|dwg|gtp|layout|(?<![a-z])ga(?![a-z])/.test(n) || ['rar', 'zip', 'dwg', 'dxf'].includes(ext)) return 'DRAWING';
  if (/(?<![a-z])p\.?o(?![a-z])|purchase|order|amend|(?<![a-z])loa(?![a-z])/.test(n)) return 'PO';
  if (/price|offer|quot|proforma|cee-?\d{4,}/.test(n)) return 'OFFER';
  return ['pdf', 'xlsx', 'xls', 'png', 'jpg', 'jpeg'].includes(ext) ? 'OTHER' : 'SKIP';
}

/** Order document kind (orders.documents.kind) a mail file is kept under. */
export const docKindOf = (k: OrderFileKind): 'PO' | 'BOM' | 'DRAWING' | 'OFFER' | 'OTHER' =>
  k === 'PO' || k === 'BOM' || k === 'DRAWING' || k === 'OFFER' ? k : 'OTHER';

// ------------------------------------------------------------------ what the AI reads from the mails

export type CheckState = 'DONE' | 'PENDING' | 'NOT_NEEDED' | 'UNKNOWN';
export interface CheckItem {
  status: CheckState;
  date: string | null;
  ref: string | null;
  note: string | null;
}
export const MAIL_TOPICS = ['mc', 'drawing', 'bom', 'dispatchInstruction', 'inspection', 'advance'] as const;
export type MailTopic = (typeof MAIL_TOPICS)[number];
export interface OrderMailStatus {
  model: string;
  at: string;
  threads: number;
  topics: Record<MailTopic, CheckItem>;
  pending: { item: string; who: string | null; since: string | null }[];
  latest: string | null;
}

const ITEM = {
  type: 'OBJECT',
  properties: {
    status: { type: 'STRING', enum: ['DONE', 'PENDING', 'NOT_NEEDED', 'UNKNOWN'] },
    date: { type: 'STRING', nullable: true },
    ref: { type: 'STRING', nullable: true },
    note: { type: 'STRING', nullable: true },
  },
  required: ['status'],
};
export const ORDER_MAIL_SCHEMA = {
  type: 'OBJECT',
  properties: {
    ...Object.fromEntries(MAIL_TOPICS.map((t) => [t, ITEM])),
    pending: { type: 'ARRAY', items: { type: 'OBJECT', properties: { item: { type: 'STRING' }, who: { type: 'STRING', nullable: true }, since: { type: 'STRING', nullable: true } }, required: ['item'] } },
    latest: { type: 'STRING', nullable: true },
  },
  required: [...MAIL_TOPICS, 'pending'],
};

export function orderMailPrompt(order: { poNumber: string; client: string | null; project: string | null; endClient: string | null; poDate: string }, today: string) {
  return `You read the mail threads about ONE customer purchase order placed on CEEBUILD COMPANY (supplier of galvanised steel
fabricated structures; its group company Laser Power & Infra may be the buyer). Order: PO ${order.poNumber} dated ${order.poDate},
customer ${order.client ?? '?'}, project ${order.project ?? '?'}, end client ${order.endClient ?? '?'}. Today is ${today}.
The threads are listed oldest first; within a thread messages are in date order and the (LATEST) one decides the status.
Attachment names are listed per thread - a file called e.g. "A126Y-033_MFG_CLEARANCE_..." means that document WAS sent.

For each topic give status DONE / PENDING / NOT_NEEDED / UNKNOWN, the date (dd-mm-yyyy) of the deciding mail, a reference no.
if one is given (MC no., DI no., drawing / approval letter no.), and a short note (who said what):
- mc: manufacturing clearance (MC / "go ahead for manufacturing") from the customer. DONE when an MC was issued.
- drawing: drawing / GTP approval by the customer (or end client). DONE = approved / "approved for manufacturing"; PENDING =
  awaiting approval or comments open.
- bom: bill of materials / cutting list from the customer. DONE when given (attached or confirmed); NOT_NEEDED when the PO
  is for standard items with no BOM.
- dispatchInstruction: dispatch instruction (DI) with delivery locations / quantities. DONE when a DI was issued.
- inspection: inspection of the material (call, inspection done, MDCC / waiver). DONE = inspection done or waived;
  PENDING = call raised / awaited.
- advance: advance payment if the PO has one. DONE = received; NOT_NEEDED = PO has no advance.
pending: every point still open at the latest mail (one line each: item, who must act, since dd-mm-yyyy) - e.g. "Signed PO copy"
(Ceebuild), "Revised delivery schedule" (customer). Leave out anything a later mail closed.
latest: one or two sentences, the position at the latest mail, starting with its date.
Use only what the mails say; UNKNOWN when they say nothing. Never invent references or dates.`;
}

const STATES = new Set<CheckState>(['DONE', 'PENDING', 'NOT_NEEDED', 'UNKNOWN']);
const s = (v: unknown, max = 300) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

export function normaliseMailStatus(raw: unknown, meta: { model: string; at: string; threads: number }): OrderMailStatus {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const topic = (v: unknown): CheckItem => {
    const t = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    const st = String(t.status ?? '').toUpperCase() as CheckState;
    return { status: STATES.has(st) ? st : 'UNKNOWN', date: s(t.date, 20), ref: s(t.ref, 120), note: s(t.note) };
  };
  return {
    ...meta,
    topics: Object.fromEntries(MAIL_TOPICS.map((k) => [k, topic(o[k])])) as Record<MailTopic, CheckItem>,
    pending: (Array.isArray(o.pending) ? o.pending : [])
      .map((p) => (p && typeof p === 'object' ? (p as Record<string, unknown>) : {}))
      .map((p) => ({ item: s(p.item, 200) ?? '', who: s(p.who, 80), since: s(p.since, 20) }))
      .filter((p) => p.item)
      .slice(0, 20),
    latest: s(o.latest, 600),
  };
}

// ------------------------------------------------------------------ what is still needed

export interface OrderFacts {
  poNumber: string;
  client: string | null;
  docketNo: string | null;
  docketParty: string | null;
  docketUtility: string | null;
  endClient: string | null;
  project: string | null;
  deliveryDue: string | null;
  contractValue: number | null;
  gstPct: number | null;
  paymentTerms: string | null;
  advancePct: number | null;
  contactPerson: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  deliveryAddress: string | null;
  customerGstin: string | null;
  drawingStatus: string | null;
  onHold: boolean;
  holdReason: string | null;
  jobStatus: string | null;
  jobNote: string | null;
  bomConfirmed: boolean;
  bomUploads: number;
  documents: { kind: string; fileName: string }[];
  /** Other orders on the same docket (PO numbers). */
  sameDocketOrders: string[];
}

export type NeedFrom = 'Customer' | 'Puja (Admin)' | 'Drawing team' | 'Production' | 'Dashboard';
export interface Need {
  item: string;
  from: NeedFrom;
  note: string;
}
export interface OrderNeeds {
  have: string[];
  needs: Need[];
}

const norm = (v: string | null | undefined) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const words = (v: string | null | undefined) => new Set(String(v ?? '').toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w.length >= 3 && !['LTD', 'LIMITED', 'PVT', 'PRIVATE', 'THE', 'AND', 'COMPANY', 'INFRA', 'PROJECT'].includes(w)));
const overlap = (a: string | null, b: string | null) => [...words(a)].some((w) => words(b).has(w));
const hasFile = (f: OrderFacts, re: RegExp, kind?: string) => f.documents.some((d) => (kind && d.kind === kind) || re.test(d.fileName));
const when = (c: CheckItem) => [c.date, c.ref].filter(Boolean).join(', ');

/** The checklist: what we already have (from the PO and mails) and what is still needed, from whom. */
export function orderNeeds(f: OrderFacts, m: OrderMailStatus | null): OrderNeeds {
  const have: string[] = [];
  const needs: Need[] = [];
  const t = m?.topics;

  // Docket (offer) must fit the PO.
  const firstWord = (v: string) => String(v).toUpperCase().replace(/^M\/S\.?\s*/, '').split(/[^A-Z0-9]+/).find((w) => w.length >= 2) ?? '';
  if (f.docketParty && f.client && firstWord(f.docketParty) !== firstWord(f.client))
    needs.push({ item: 'Customer name vs docket', from: 'Puja (Admin)', note: `Order says "${f.client}", docket ${f.docketNo} is for "${f.docketParty}" – correct the customer or the docket.` });
  if (f.endClient || f.project) {
    const target = `${f.endClient ?? ''} ${f.project ?? ''}`;
    if (!f.docketUtility) needs.push({ item: 'Docket check', from: 'Puja (Admin)', note: `Docket ${f.docketNo} has no utility / project, the PO is for ${target.trim()} – is it the right offer?` });
    else if (!overlap(f.docketUtility, target) && !norm(target).includes(norm(f.docketUtility).slice(0, 5)))
      needs.push({ item: 'Docket check', from: 'Puja (Admin)', note: `Docket ${f.docketNo} is for "${f.docketUtility}", the PO is for ${target.trim()}.` });
  }
  if (f.sameDocketOrders.length) needs.push({ item: 'Same docket on other orders', from: 'Puja (Admin)', note: `Docket ${f.docketNo} is also on PO ${f.sameDocketOrders.join(', ')} – check each PO has its own offer.` });

  // PO data.
  const missing: string[] = [];
  if (!f.deliveryDue) missing.push('delivery / completion date');
  if (f.contractValue === null) missing.push('PO value');
  if (f.gstPct === null) missing.push('GST %');
  if (!f.paymentTerms) missing.push('payment terms');
  if (!f.contactPerson && !f.contactEmail && !f.contactPhone) missing.push('customer contact person');
  if (!f.deliveryAddress) missing.push('delivery address');
  if (!f.customerGstin) missing.push('customer GSTIN');
  if (missing.length) needs.push({ item: 'PO details not on the PO / not read', from: 'Customer', note: `Missing: ${missing.join(', ')}. Ask the customer or fill them on the PO tab.` });
  else have.push('PO details complete');

  // Manufacturing clearance.
  if (t?.mc.status === 'DONE' || hasFile(f, /mfg[\s_-]*clear|clearance/i)) have.push(`Manufacturing clearance${t?.mc.status === 'DONE' && when(t.mc) ? ` (${when(t.mc)})` : ''}`);
  else if (t?.mc.status === 'PENDING') needs.push({ item: 'Manufacturing clearance (MC)', from: 'Customer', note: t.mc.note ?? 'MC awaited.' });
  else if (t?.mc.status !== 'NOT_NEEDED') needs.push({ item: 'Manufacturing clearance (MC)', from: 'Customer', note: 'No MC found in the mails – confirm we may start manufacturing.' });

  // Drawing approval.
  if (t?.drawing.status === 'DONE' || f.drawingStatus === 'APPROVED') have.push(`Drawing / GTP approved${t?.drawing.status === 'DONE' && when(t.drawing) ? ` (${when(t.drawing)})` : ''}`);
  else needs.push({ item: 'Drawing / GTP approval', from: t?.drawing.status === 'PENDING' && /our|ceebuild|submit/i.test(t.drawing.note ?? '') ? 'Drawing team' : 'Customer', note: t?.drawing.note ?? 'No approval found in the mails or on the PO.' });

  // BOM.
  if (f.bomConfirmed) have.push('BOM confirmed on the dashboard');
  else if (f.bomUploads || t?.bom.status === 'DONE' || hasFile(f, /bom|bill[\s_-]*of[\s_-]*mat/i, 'BOM'))
    needs.push({ item: 'BOM to confirm', from: 'Puja (Admin)', note: 'The BOM is with us (mail / upload) but not confirmed on the BOM tab.' });
  else if (t?.bom.status !== 'NOT_NEEDED') needs.push({ item: 'BOM', from: 'Customer', note: t?.bom.note ?? 'No BOM / cutting list in the mails.' });

  // Hold and the indent job.
  if (f.onHold) {
    // MC and drawing approval are in the mails: what still holds the order is our own work (inspection call, dispatch).
    if (t?.mc.status === 'DONE' && (t.drawing.status === 'DONE' || f.drawingStatus === 'APPROVED'))
      needs.push({ item: 'Release the hold', from: 'Puja (Admin)', note: `MC and drawing approval are now in the mails. The hold says "${(f.holdReason ?? '').slice(0, 160)}" – if that is done or is our own work, release the hold on the PO tab so the indent can run.` });
    else needs.push({ item: 'Order on hold', from: 'Customer', note: f.holdReason ?? 'On hold.' });
  }
  if (f.jobStatus === 'INDENT_DRAFTED') have.push('RM indent drafted');
  else if (!f.onHold) needs.push({ item: 'RM indent', from: 'Dashboard', note: f.jobNote ?? 'Indent not drafted yet.' });

  // Advance.
  if ((f.advancePct ?? 0) > 0) {
    if (t?.advance.status === 'DONE') have.push(`Advance received${when(t.advance) ? ` (${when(t.advance)})` : ''}`);
    else needs.push({ item: `Advance ${f.advancePct}%`, from: 'Customer', note: t?.advance.note ?? 'Advance not seen in the mails.' });
  }

  // Later stages: shown as information.
  if (t?.dispatchInstruction.status === 'DONE' || hasFile(f, /disp\w*[\s_-]*instr/i)) {
    const w = t ? when(t.dispatchInstruction) : '';
    have.push(`Dispatch instruction${w ? ` (${w})` : ''}`);
  }
  if (t?.inspection.status === 'DONE') have.push(`Inspection done${when(t.inspection) ? ` (${when(t.inspection)})` : ''}`);
  else if (t?.inspection.status === 'PENDING') {
    const ours = /(send|raise|offer)\w*\s.*inspection call|request\w*\s.*(ceebuild|supplier|souvik|us)|from (ceebuild|souvik)/i.test(t.inspection.note ?? '');
    needs.push({ item: 'Inspection', from: ours ? 'Puja (Admin)' : 'Customer', note: `${t.inspection.note ?? 'Inspection open.'}${ours ? ' – we raise the inspection call.' : ''}` });
  }

  // Open points the latest mail names that are not covered above.
  const said = `${needs.map((n) => `${n.item} ${n.note}`).join(' ')} ${have.join(' ')}`.toLowerCase();
  for (const p of m?.pending ?? []) {
    // Already covered above (same key word, e.g. "Inspection call request" vs the inspection point).
    const keys = p.item.toLowerCase().match(/[a-z]{5,}/g) ?? [];
    if (keys.some((k) => !['request', 'issue', 'issuance', 'pending', 'materials', 'material', 'revised', 'revision'].includes(k) && said.includes(k.replace(/s$/, '')))) continue;
    const ours = /ceebuild|laser|puja|our|us\b/i.test(p.who ?? '');
    needs.push({ item: p.item, from: ours ? 'Puja (Admin)' : 'Customer', note: `Open at the latest mail${p.since ? ` (${p.since})` : ''}${p.who ? ` – ${p.who} to act` : ''}.` });
  }
  if (!m) needs.push({ item: 'Mail check', from: 'Dashboard', note: 'The order mails have not been read yet (n8n reads them every hour).' });
  return { have, needs };
}
