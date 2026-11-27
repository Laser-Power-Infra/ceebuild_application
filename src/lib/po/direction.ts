/**
 * Which way a PO mail goes. Only POs a party sent TO Ceebuild (received) become orders; the POs
 * Ceebuild's purchase team sends to its own suppliers ("P.O-125/Durga Trading Company/...",
 * PO no. "CB-PO/125/2026-27", material delivered to our works) and mail bounces are left out.
 * Pure functions: used on the mail list (subject / sender only) and after the AI read the PO.
 */

/** Bounce / auto-reply mails: never a PO, whatever is quoted inside. */
const BOUNCE_SUBJECT = /delivery status notification|undeliver(able|ed)|mail delivery (failed|failure|subsystem)|returned mail|failure notice|auto(matic)?[- ]?reply|out of office/i;
const BOUNCE_SENDER = /mailer-daemon|postmaster|mail delivery subsystem/i;

/** Our purchase team's subject style: "P.O-125/Durga Trading Company/FLAT AND SQUARE BAR/5-11-26", "CEEBUILD-P.O REQUIRED-...". */
const OUR_PO_SUBJECT = /^(\s*(re|fwd?|fw)\s*:\s*)*P\.\s*O\.?\s*-?\s*\d{1,5}\s*\//i;
const PO_REQUIRED_SUBJECT = /\bP\.?\s*O\.?\s+REQUIRED\b/i;
/** Our internal task mails ("M14 – Correction to E5 ...") quote "purchase order" but are never one. */
const INTERNAL_TASK_SUBJECT = /^(\s*(re|fwd?|fw)\s*:\s*)*M\d{2}\s*[–-]/i;
/** Our own PO numbers: CB-PO/125/2026-27, CB/PO/..., CEEBUILD/PO/... */
const OUR_PO_NO = /^\s*(CB|CEE\s*BUILD|CEEBUILD|CBCPL)\s*[-/ ]\s*P\.?\s*O\b/i;
/** Our works (Clipcon Complex, NH-6/16, Dhulagarh, Sankrail, Howrah). */
const OUR_WORKS = /DHULAG(A|O)R|CLIPCON|CILPCON|SANKRAIL|SANKARIL/i;

export type MailSkip = { skip: true; reason: string } | { skip: false };

/** From the subject and sender only (before reading): bounces and our own outgoing POs. */
export function mailSkipReason(subject: string | null | undefined, sender?: string | null): MailSkip {
  const s = String(subject ?? '');
  const from = String(sender ?? '');
  if (BOUNCE_SUBJECT.test(s) || BOUNCE_SENDER.test(from)) return { skip: true, reason: 'Bounce / auto-reply mail, not a PO.' };
  if (OUR_PO_SUBJECT.test(s) || PO_REQUIRED_SUBJECT.test(s)) return { skip: true, reason: 'Our own PO to a supplier (purchase), not a customer PO.' };
  if (INTERNAL_TASK_SUBJECT.test(s)) return { skip: true, reason: 'Internal task mail, not a customer PO.' };
  return { skip: false };
}

export interface ReadPo {
  poNumber: string | null;
  customerName: string | null;
  deliveryAddress: string | null;
  endClient: string | null;
  project: string | null;
}

/**
 * After the AI read the PO: is it one Ceebuild ISSUED (to a supplier)? Returns the reason or null.
 * Delivery to our own works with no project / end client is our purchase (customers deliver to sites).
 */
export function issuedByUs(po: ReadPo, subject?: string | null, sender?: string | null): string | null {
  const pre = mailSkipReason(subject, sender);
  if (pre.skip) return pre.reason;
  if (po.poNumber && OUR_PO_NO.test(po.poNumber)) return `PO no. ${po.poNumber} is our own PO number (Ceebuild purchase), not a customer PO.`;
  if (po.deliveryAddress && OUR_WORKS.test(po.deliveryAddress) && !po.endClient && !po.project)
    return `Material is delivered to our own works (${po.deliveryAddress.slice(0, 60)}) – this is our purchase from ${po.customerName ?? 'a supplier'}, not a customer PO.`;
  return null;
}

/**
 * The party's name from the mail sender when the PO did not give the buyer clearly, e.g.
 * "Lanarsy Infra Limited <anup@lanarsy.com>" -> "Lanarsy Infra Limited". Our own senders give null.
 */
export function customerFromSender(sender: string | null | undefined): string | null {
  const s = String(sender ?? '').trim();
  const m = s.match(/^\s*"?([^"<]+?)"?\s*<([^>]+)>/);
  if (!m) return null;
  const [, name, email] = m;
  if (/ceebuildcompany\.com|laserpowerinfra\.com|gmail\.com|yahoo\.|outlook\.com|hotmail\.com|rediffmail\.com/i.test(email)) return null;
  // A company-looking display name only (a person's name is not the customer).
  return /\b(LIMITED|LTD|PVT|PRIVATE|INFRA|ENGINEERING|COMPANY|CORPORATION|CORP|INDUSTRIES|VENTURES|PROJECTS|POWER|ENTERPRISES?|LLP)\b/i.test(name) ? name.trim() : null;
}

/** "Read by n8n from the mail "..." (Name <email>)." warning -> the sender part. */
export function senderFromWarnings(warnings: string[] | null | undefined): string | null {
  for (const w of warnings ?? []) {
    const m = w.match(/^Read by n8n from the mail ".*" \((.+)\)\.$/);
    if (m) return m[1];
  }
  return null;
}
