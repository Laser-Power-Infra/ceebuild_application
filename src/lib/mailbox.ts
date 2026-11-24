import 'server-only';
import { UserError } from '@/lib/actionResult';

/**
 * Read-only access to the orders mailbox (info@ceebuildcompany.com) through the Gmail API, so a
 * PO can be picked straight from the mail instead of being downloaded and uploaded (M15).
 *
 * Server environment only:
 *   GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET  - Google OAuth client (Desktop app)
 *   GMAIL_REFRESH_TOKEN                    - from `npm run gmail-auth` signed in as the mailbox
 *   GMAIL_MAILBOX                          - shown in the UI, e.g. info@ceebuildcompany.com
 * Scope gmail.readonly: the dashboard can never send, delete or change mail.
 */

const env = (k: string) => (process.env[k] || '').replace(/^["']|["']$/g, '').trim();
export const mailboxConfigured = () => !!(env('GMAIL_CLIENT_ID') && env('GMAIL_CLIENT_SECRET') && env('GMAIL_REFRESH_TOKEN'));
export const mailboxName = () => env('GMAIL_MAILBOX') || 'info@ceebuildcompany.com';

let cached: { token: string; until: number } | null = null;

async function accessToken(): Promise<string> {
  if (!mailboxConfigured()) throw new UserError(`The ${mailboxName()} mailbox is not connected yet (GMAIL_* settings missing on the server). Upload the PO file instead.`);
  if (cached && cached.until > Date.now() + 60_000) return cached.token;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env('GMAIL_CLIENT_ID'),
      client_secret: env('GMAIL_CLIENT_SECRET'),
      refresh_token: env('GMAIL_REFRESH_TOKEN'),
      grant_type: 'refresh_token',
    }),
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!res.ok || !j.access_token) throw new UserError(`Mailbox sign-in failed (${j.error_description || j.error || res.status}). Re-run "npm run gmail-auth".`);
  cached = { token: j.access_token, until: Date.now() + (j.expires_in ?? 3000) * 1000 };
  return cached.token;
}

async function gmail<T>(path: string): Promise<T> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { headers: { Authorization: `Bearer ${await accessToken()}` } });
  if (!res.ok) throw new UserError(`Mailbox error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

interface GPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GPart[];
}
interface GMessage {
  id: string;
  threadId: string;
  internalDate?: string;
  snippet?: string;
  payload?: GPart;
}

export interface MailAttachment {
  messageId: string;
  attachmentId: string;
  fileName: string;
  mimeType: string;
  size: number;
}
export interface MailItem {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  attachments: MailAttachment[];
}

const header = (p: GPart | undefined, name: string) => p?.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? '';

function attachmentsOf(m: GMessage): MailAttachment[] {
  const out: MailAttachment[] = [];
  const walk = (p: GPart | undefined) => {
    if (!p) return;
    if (p.filename && p.body?.attachmentId) {
      out.push({ messageId: m.id, attachmentId: p.body.attachmentId, fileName: p.filename, mimeType: p.mimeType || 'application/octet-stream', size: p.body.size ?? 0 });
    }
    p.parts?.forEach(walk);
  };
  walk(m.payload);
  // Signature logos and inline images are noise.
  return out.filter((a) => !(/^image\//.test(a.mimeType) && a.size < 40_000));
}

function toItem(m: GMessage): MailItem {
  return {
    id: m.id,
    threadId: m.threadId,
    subject: header(m.payload, 'subject') || '(no subject)',
    from: header(m.payload, 'from'),
    date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : '',
    snippet: m.snippet ?? '',
    attachments: attachmentsOf(m),
  };
}

/** Default search: mails with attachments that look like orders. */
export const DEFAULT_PO_QUERY = 'has:attachment (PO OR "purchase order" OR "work order" OR "order confirmation" OR LOA OR "revised purchase order") newer_than:180d';

/** Up to 25 matching mails, newest first, with their attachments. */
export async function searchMailbox(q: string): Promise<MailItem[]> {
  const query = q.trim() ? `has:attachment ${q.trim()}` : DEFAULT_PO_QUERY;
  const list = await gmail<{ messages?: { id: string }[] }>(`messages?maxResults=25&q=${encodeURIComponent(query)}`);
  const msgs = await Promise.all((list.messages ?? []).map((m) => gmail<GMessage>(`messages/${m.id}?format=full`)));
  return msgs.map(toItem).filter((m) => m.attachments.length > 0);
}

/** Every message of a thread (the BOM often comes a day after the PO in the same thread). */
export async function threadMails(threadId: string): Promise<MailItem[]> {
  const t = await gmail<{ messages?: GMessage[] }>(`threads/${encodeURIComponent(threadId)}?format=full`);
  return (t.messages ?? []).map(toItem);
}

export async function getMailMeta(messageId: string): Promise<MailItem> {
  return toItem(await gmail<GMessage>(`messages/${encodeURIComponent(messageId)}?format=full`));
}

/**
 * Attachment by file name. Gmail attachment ids are not stable between reads of the same message,
 * so the message is read again and the current id of the named file is used.
 */
export async function downloadAttachmentByName(messageId: string, fileName: string): Promise<{ data: Buffer; mimeType: string; fileName: string; subject: string }> {
  const m = await getMailMeta(messageId);
  const a = m.attachments.find((x) => x.fileName === fileName);
  if (!a) throw new UserError(`"${fileName}" is no longer in that mail.`);
  return { data: await downloadAttachment(messageId, a.attachmentId), mimeType: a.mimeType, fileName: a.fileName, subject: m.subject };
}

export async function downloadAttachment(messageId: string, attachmentId: string): Promise<Buffer> {
  const a = await gmail<{ data?: string; size?: number }>(`messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
  if (!a.data) throw new UserError('The attachment is empty.');
  return Buffer.from(a.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}
