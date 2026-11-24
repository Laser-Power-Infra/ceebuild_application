import 'server-only';
import { pairFiles, type MailFile } from '@/lib/mailFiles';

export type { MailFile, MailFileKind } from '@/lib/mailFiles';

/**
 * The company mail archive (MySQL `threads`, filled by the mail sync), read through the email
 * portal's API - this dashboard has no database login for it. Route (Match Emails Portal backend):
 *   GET {MAIL_API_URL}/api/db-emails/ceebuild-po?days=&limit=   PO-looking Ceebuild mails
 *   GET {MAIL_API_URL}/api/db-emails/ceebuild-po?q=&limit=      search
 *   GET {MAIL_API_URL}/api/db-emails/ceebuild-po?threadId=      one thread
 * MAIL_API_URL = http://192.168.1.190:6002 (the portal on the office LAN). Every attachment is
 * already on Google Drive (`attach_links`); n8n downloads the PO copies from there.
 */

const clean = (v: string | undefined) => (v || '').replace(/^["']|["']$/g, '').trim();
const apiUrl = () => clean(process.env.MAIL_API_URL).replace(/\/+$/, '');
export const mailDbConfigured = () => !!apiUrl();

export interface MailThread {
  threadId: string;
  date: string | null;
  sender: string | null;
  subject: string | null;
  company: string | null;
  msgCount: number;
  files: MailFile[];
  /** Start of the thread text, for the AI as context. */
  text: string;
}

interface Row {
  thread_id: string;
  date: string | null;
  sender: string | null;
  subject: string | null;
  company: string | null;
  msg_count: number | null;
  attach_names: string | null;
  attach_links: string | null;
  body_head: string | null;
}

const toThread = (r: Row): MailThread => ({
  threadId: r.thread_id,
  date: r.date,
  sender: r.sender,
  subject: r.subject,
  company: r.company,
  msgCount: r.msg_count ?? 1,
  files: pairFiles(r.attach_names, r.attach_links),
  // The sync stores line breaks as the two characters backslash + n.
  text: (r.body_head ?? '').replace(/\\r/g, '').replace(/\r/g, '').replace(/\\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(),
});

async function fetchThreads(params: Record<string, string | number>): Promise<MailThread[]> {
  if (!apiUrl()) throw new Error('MAIL_API_URL is not set (email portal API for the mail archive).');
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const res = await fetch(`${apiUrl()}/api/db-emails/ceebuild-po?${qs}`, { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  let body: { success?: boolean; threads?: Row[]; error?: string };
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Mail archive API answered ${res.status} without JSON (is the email portal updated?): ${text.slice(0, 120)}`);
  }
  if (!res.ok || !body.success) throw new Error(`Mail archive API error ${res.status}: ${body.error ?? 'unknown'}`);
  return (body.threads ?? []).map(toThread);
}

/** Candidate customer-PO mails of the last `days` days, newest first. */
export const poMailCandidates = (days: number, limit: number) => fetchThreads({ days, limit: Math.min(limit, 100) });

/** Free-text search for the "Pick from mail" box (subject / sender / attachment names); blank = recent PO mails. */
export function searchMailThreads(q: string, limit = 30) {
  const words = q.trim();
  return words.length >= 2 ? fetchThreads({ q: words.slice(0, 200), limit }) : fetchThreads({ days: 60, limit });
}

export async function getMailThread(threadId: string): Promise<MailThread | null> {
  return (await fetchThreads({ threadId, limit: 1 }))[0] ?? null;
}
