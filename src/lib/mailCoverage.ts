import 'server-only';
import { prisma } from '@/lib/prisma';
import { recentCeebuildThreads, type MailThread } from '@/lib/mailDb';
import { classifyMail, isOwnMail } from '@/lib/enquiry/classify';
import { mailSkipReason } from '@/lib/po/direction';

/**
 * Safety net for the automatic mail reading: Ceebuild threads of the last days that look like a
 * customer PO or an enquiry but that neither n8n reader has recorded (no po_intakes / enquiry_intakes
 * row). Goes out with the daily reminder so a missed PO / enquiry is seen the next morning
 * (e.g. PO N926Y-00023 that came as "N926Y-00023_PO_...pdf" inside a "Purchase Enquiry" thread).
 * The signals match the mail portal's ceebuild-po route (subject / file names / mail text).
 */

const PO_SUBJECT = /\b(purchase|work|revised|amended)\s+order\b|order\s+confirmation|letter\s+of\s+(award|intent)|\b(PO|P\.O\.|LOA|LOI|WO)\b/i;
const PO_FILE = /(purchase|work)[\s_.-]*order|(^|[^a-z0-9])(po|p\.o|loa|loi|wo)([^a-z0-9]|$)/i;
const PO_TEXT = /\b(purchase|work)\s+order\b|letter\s+of\s+(award|intent)|\bP\.?\s?O\.?\s*(No|Number)\b/i;

export interface MissedMail {
  kind: 'PO' | 'ENQUIRY';
  threadId: string;
  date: string | null;
  sender: string | null;
  subject: string | null;
  files: string[];
  why: string;
}

const ref = (id: string) => `thread:${id}`;

export function mailSignals(t: Pick<MailThread, 'subject' | 'text' | 'files'>) {
  const names = t.files.map((f) => f.name).join(', ');
  const s = String(t.subject ?? '');
  const po = PO_SUBJECT.test(s) ? 'PO words in the subject' : PO_FILE.test(names) ? 'a PO file is attached' : PO_TEXT.test(t.text) ? 'PO words in the mail text' : null;
  const cls = classifyMail(t.subject, t.text);
  const enquiry = cls === 'ENQUIRY' || cls === 'AMENDMENT' || cls === 'CLARIFICATION';
  return { po, enquiry };
}

/** Threads of the last `days` days (older than `graceMinutes`, so the 15-min readers had their turn) nobody read. */
export async function missedMails(days = 2, graceMinutes = 90): Promise<MissedMail[]> {
  const threads = await recentCeebuildThreads(days);
  const cutoff = Date.now() - graceMinutes * 60000;
  const refs = threads.map((t) => ref(t.threadId));
  if (!refs.length) return [];
  const [pos, enqs] = await Promise.all([
    prisma.poIntake.findMany({
      where: { OR: [{ gmailMessageId: { in: refs } }, ...threads.map((t) => ({ gmailMessageId: { startsWith: `${ref(t.threadId)}~` } }))] },
      select: { gmailMessageId: true },
    }),
    prisma.enquiryIntake.findMany({ where: { threadRef: { in: refs } }, select: { threadRef: true } }),
  ]);
  const poDone = new Set(pos.map((p) => String(p.gmailMessageId).split('~')[0]));
  const enqDone = new Set(enqs.map((e) => e.threadRef));
  const out: MissedMail[] = [];
  for (const t of threads) {
    const at = t.date ? new Date(t.date.replace(' ', 'T') + '+05:30').getTime() : 0;
    if (!at || at > cutoff) continue;
    if (isOwnMail(t.subject) || mailSkipReason(t.subject, t.sender).skip) continue;
    const sig = mailSignals(t);
    const base = { threadId: t.threadId, date: t.date, sender: t.sender, subject: t.subject, files: t.files.filter((f) => f.kind !== 'SKIP').map((f) => f.name) };
    // A PO can come later in an enquiry thread: an enquiry record does not cover the PO.
    if (sig.po && !poDone.has(ref(t.threadId))) out.push({ ...base, kind: 'PO', why: `Looks like a PO (${sig.po}) but was not read as a PO` });
    else if (!sig.po && sig.enquiry && !enqDone.has(ref(t.threadId))) out.push({ ...base, kind: 'ENQUIRY', why: 'Looks like an enquiry but was not read' });
  }
  return out;
}

export function missedMailsText(rows: MissedMail[]): string {
  if (!rows.length) return '';
  const line = (m: MissedMail) =>
    `- [${m.kind}] ${String(m.date ?? '').slice(0, 16)} | ${String(m.sender ?? '').replace(/<.*>/, '').trim().slice(0, 40)} | ${String(m.subject ?? '').slice(0, 90)}` +
    `${m.files.length ? `\n  Files: ${m.files.slice(0, 5).join(', ').slice(0, 200)}` : ''}\n  ${m.why} (thread ${m.threadId})`;
  return `MAILS NOT READ (check: PO / enquiry missed?)\n${rows.map(line).join('\n')}`;
}
