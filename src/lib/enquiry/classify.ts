// Rev 2 §2 (E1): first-pass classification of a mail to info@ceebuildcompany.com, and the duplicate
// key of an enquiry's party. Pure (tests/costing.test.ts). The AI makes the final call; this only
// picks which mails are worth sending to it.

export const MAIL_CLASSES = ['ENQUIRY', 'PO', 'AMENDMENT', 'CLARIFICATION', 'OTHER'] as const;
export type MailClass = (typeof MAIL_CLASSES)[number];

/**
 * Words that make a mail worth reading as an enquiry when they appear (as part of a word) in its subject,
 * sender or attachment names. "enq" also covers "Pur Enq ...", "require" covers "Required ..." /
 * "Requirement"; RFX / ITT are e-tender invitations.
 */
export const ENQUIRY_SEARCH_WORDS = ['enq', 'inquiry', 'RFQ', 'RFX', 'ITT', 'quotation', 'quote', 'BOQ', 'offer', 'tender', 'GeM', 'require'];

const ENQ = /\b(enquiry|enquiries|inquiry|rfq|r\.f\.q|request\s+for\s+(quotation|quote|proposal)|boq|bill\s+of\s+quantit|best\s+(offer|price|rate)|quote|quotation|tender|nit\b|e-?tender|gem\b|bid\b|requirement|rate\s+contract|enq\b|rfx\b|itt\b)/i;
/** Subject only (too common in mail text): "Require 33 KV line material", "Required GS Structure ...". */
const REQ = /\brequire(d|ment|ments)?\b/i;
const PO = /\b(purchase|work|revised|amended)\s+order\b|order\s+confirmation|letter\s+of\s+(award|intent)|\b(p\.?o\.?|loa|loi|wo)\b\s*(no|number|#|:|-)/i;
const AMEND = /\b(amendment|corrigendum|revision|revised\s+(boq|drawing|qty|quantity|specification)|addendum)\b/i;
const CLAR = /\b(clarification|query|queries|deviation|technical\s+query|tq\b)/i;
// Our own outgoing mails / internal noise that also say "offer" or "quotation".
const OWN = /^\s*((re|fw|fwd)\s*:\s*)*M\d{2}\s*[–-]|\b(our\s+offer|offer\s+(sent|submitted)|payment\s+request|cash\s+status|scrap\s+sale|po\s+creation|po\s+for\s+supply\s+to\s+ceebuild|p\.?\s?o\.?\s+required|request\s+for\s+p\.?\s?o\b|inputs?\s+required|salary|leave|attendance|invoice\s+no)\b/i;

export function classifyMail(subject: string | null, text: string | null): MailClass {
  const s = String(subject ?? '');
  const t = `${s}\n${String(text ?? '').slice(0, 4000)}`;
  if (OWN.test(s)) return 'OTHER';
  if (PO.test(s)) return AMEND.test(s) ? 'AMENDMENT' : 'PO';
  if (AMEND.test(s) && /\b(boq|tender|enquiry|rfq)\b/i.test(t)) return 'AMENDMENT';
  if (ENQ.test(s)) return 'ENQUIRY';
  if (CLAR.test(s)) return 'CLARIFICATION';
  if (REQ.test(s)) return 'ENQUIRY';
  if (ENQ.test(t)) return 'ENQUIRY';
  return 'OTHER';
}

/** Our own outgoing / internal mails (task mails "M14 – ...", payment requests, PO required ...). */
export const isOwnMail = (subject: string | null) => OWN.test(String(subject ?? ''));

/** Worth sending to the AI as a possible enquiry: a search word in subject / sender / file names, or an enquiry subject. */
export function enquiryCandidate(subject: string | null, sender: string | null, fileNames: string | null): boolean {
  const s = String(subject ?? '');
  const hay = `${s} ${sender ?? ''} ${fileNames ?? ''}`.toLowerCase();
  return ENQUIRY_SEARCH_WORDS.some((w) => hay.includes(w.toLowerCase())) || ENQ.test(s) || REQ.test(s);
}

const STOP = new Set(['LTD', 'LIMITED', 'PVT', 'PRIVATE', 'CO', 'COMPANY', 'CORP', 'CORPORATION', 'THE', 'M/S', 'MS', 'AND', 'INDIA', 'LLP', 'INC']);

/** Party key for duplicate checks: the first two significant words, upper case ("JSW Mahanadi Power Co. Ltd" -> "JSW MAHANADI"). */
export function partyKey(name: string | null | undefined): string | null {
  const words = String(name ?? '')
    .toUpperCase()
    .replace(/^\s*M\s*\/\s*S\.?\s+/, '')
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w));
  // "N K C Project" = "NKC Projects": join runs of single letters, drop a plural S.
  const joined: string[] = [];
  let prevSingle = false;
  for (const w of words) {
    if (w.length === 1 && prevSingle) joined[joined.length - 1] += w;
    else joined.push(w);
    prevSingle = w.length === 1;
  }
  const out = joined.map((w) => (w.length > 3 ? w.replace(/S$/, '') : w));
  return out.length ? out.slice(0, 2).join(' ') : null;
}

/** Enquiry number key ("RFQ No. 4937002082" / "4937002082" -> "4937002082"). */
export const enquiryNoKey = (v: string | null | undefined) => {
  const k = String(v ?? '').toUpperCase().replace(/^(RFQ|ENQ(UIRY)?|TENDER|NIT|REF)\s*(NO\.?|NUMBER)?\s*[:.-]?\s*/i, '').replace(/[^0-9A-Z]/g, '');
  return k.length >= 4 ? k : null;
};
