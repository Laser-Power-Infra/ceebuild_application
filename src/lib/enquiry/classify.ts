// Rev 2 §2 (E1): first-pass classification of a mail to info@ceebuildcompany.com, and the duplicate
// key of an enquiry's party. Pure (tests/costing.test.ts). The AI makes the final call; this only
// picks which mails are worth sending to it.

export const MAIL_CLASSES = ['ENQUIRY', 'PO', 'AMENDMENT', 'CLARIFICATION', 'OTHER'] as const;
export type MailClass = (typeof MAIL_CLASSES)[number];

/** Search words for the mail archive (subject / sender / attachment names), one query each. */
export const ENQUIRY_SEARCH_WORDS = ['enquiry', 'inquiry', 'RFQ', 'quotation', 'quote', 'BOQ', 'offer', 'tender', 'GeM', 'requirement'];

const ENQ = /\b(enquiry|enquiries|inquiry|rfq|r\.f\.q|request\s+for\s+(quotation|quote|proposal)|boq|bill\s+of\s+quantit|best\s+(offer|price|rate)|quote|quotation|tender|nit\b|e-?tender|gem\b|bid\b|requirement|rate\s+contract)/i;
const PO = /\b(purchase|work|revised|amended)\s+order\b|order\s+confirmation|letter\s+of\s+(award|intent)|\b(p\.?o\.?|loa|loi|wo)\b\s*(no|number|#|:|-)/i;
const AMEND = /\b(amendment|corrigendum|revision|revised\s+(boq|drawing|qty|quantity|specification)|addendum)\b/i;
const CLAR = /\b(clarification|query|queries|deviation|technical\s+query|tq\b)/i;
// Our own outgoing mails / internal noise that also say "offer" or "quotation".
const OWN = /^\s*((re|fw|fwd)\s*:\s*)*M\d{2}\s*[–-]|\b(our\s+offer|offer\s+(sent|submitted)|payment\s+request|cash\s+status|scrap\s+sale|po\s+creation|po\s+for\s+supply\s+to\s+ceebuild|salary|leave|attendance|invoice\s+no)\b/i;

export function classifyMail(subject: string | null, text: string | null): MailClass {
  const s = String(subject ?? '');
  const t = `${s}\n${String(text ?? '').slice(0, 4000)}`;
  if (OWN.test(s)) return 'OTHER';
  if (PO.test(s)) return AMEND.test(s) ? 'AMENDMENT' : 'PO';
  if (AMEND.test(s) && /\b(boq|tender|enquiry|rfq)\b/i.test(t)) return 'AMENDMENT';
  if (ENQ.test(s)) return 'ENQUIRY';
  if (CLAR.test(s)) return 'CLARIFICATION';
  if (ENQ.test(t)) return 'ENQUIRY';
  return 'OTHER';
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
  return words.length ? words.slice(0, 2).join(' ') : null;
}

/** Enquiry number key ("RFQ No. 4937002082" / "4937002082" -> "4937002082"). */
export const enquiryNoKey = (v: string | null | undefined) => {
  const k = String(v ?? '').toUpperCase().replace(/^(RFQ|ENQ(UIRY)?|TENDER|NIT|REF)\s*(NO\.?|NUMBER)?\s*[:.-]?\s*/i, '').replace(/[^0-9A-Z]/g, '');
  return k.length >= 4 ? k : null;
};
