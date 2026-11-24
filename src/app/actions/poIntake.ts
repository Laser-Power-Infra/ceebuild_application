'use server';

import { read, write, toId, UserError } from '@/lib/actionResult';
import { geminiConfigured, geminiVia, getGeminiModel } from '@/lib/gemini';
import { mailDbConfigured } from '@/lib/mailDb';
import { n8nConfigured } from '@/lib/n8n';
import { mailboxConfigured, mailboxName, searchMailbox, threadMails } from '@/lib/mailbox';
import { s3Configured } from '@/lib/s3';
import type { PoFieldKey, PoLineDraft } from '@/lib/po/fields';
import {
  checkDuplicate,
  confirmIntake,
  discardIntake,
  getIntakeReview,
  intakeForThread,
  pendingIntakes,
  requestMailRead,
  rereadIntake,
  searchMailArchive,
  startIntake,
  startIntakeFromMail,
  toKind,
  type IntakeFile,
} from '@/modules/poIntake/server/intake';
import { getOrderPo, updateOrderPoField, updatePoLine } from '@/modules/poIntake/server/orderPo';
import { runIndentJob, setHold } from '@/modules/poIntake/server/job';
import { sheetPreview } from '@/modules/poIntake/server/sheetPreview';

const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

/** What is set up on the server (the dialog explains what is missing). */
export async function intakeSetupAction() {
  return read(async () => ({
    gemini: geminiConfigured(),
    geminiVia: geminiVia(),
    model: getGeminiModel(),
    mailbox: mailboxConfigured(),
    mailboxName: mailboxName(),
    storage: s3Configured,
    // Mail archive (MySQL) + n8n: PO mails are picked from the archive and read by n8n.
    archive: mailDbConfigured() && n8nConfigured(),
  }));
}

/** Files from the browser: FormData with `file` (repeated) and `kind` (same order: PO | OFFER | BOM | DRAWING | OTHER). */
export async function startIntakeAction(form: FormData) {
  return write(
    async (user) => {
      if (!(form instanceof FormData)) throw new UserError('No files.');
      const files = form.getAll('file');
      const kinds = form.getAll('kind').map(String);
      const list: IntakeFile[] = [];
      for (let i = 0; i < files.length && i < 10; i++) {
        const f = files[i];
        if (typeof f === 'string') continue;
        list.push({ name: f.name || `file-${i + 1}`, type: f.type, buffer: Buffer.from(await f.arrayBuffer()), kind: toKind(kinds[i] ?? 'OTHER') });
      }
      return startIntake(list, { source: 'UPLOAD' }, user);
    },
    { fallback: 'Could not read the PO' },
  );
}

export async function searchMailboxAction(q: unknown) {
  return write(() => searchMailbox(String(q ?? '').slice(0, 200)), { fallback: 'Mailbox search failed' });
}

export async function threadMailsAction(threadId: unknown) {
  return write(() => threadMails(String(threadId ?? '').slice(0, 100)), { fallback: 'Could not open the mail thread' });
}

export async function startIntakeFromMailAction(messageId: unknown, picks: unknown) {
  return write(
    (user) =>
      startIntakeFromMail(
        String(messageId ?? '').slice(0, 100),
        (Array.isArray(picks) ? picks : []).map((p) => {
          const o = obj(p);
          return { fileName: String(o.fileName ?? ''), kind: toKind(o.kind), messageId: o.messageId ? String(o.messageId).slice(0, 100) : undefined };
        }),
        user,
      ),
    { fallback: 'Could not read the PO from the mail' },
  );
}

export async function getIntakeReviewAction(id: unknown) {
  return read(() => getIntakeReview(toId(id, 'intake')));
}

export async function checkDuplicateAction(customer: unknown, poNumber: unknown) {
  return read(() => checkDuplicate(customer ? String(customer).slice(0, 200) : null, poNumber ? String(poNumber).slice(0, 100) : null));
}

export async function confirmIntakeAction(id: unknown, input: unknown) {
  const i = obj(input);
  const hold = obj(i.hold);
  return write(
    (user) =>
      confirmIntake(
        toId(id, 'intake'),
        {
          docketId: toId(i.docketId, 'docket'),
          fields: Object.fromEntries(Object.entries(obj(i.fields)).map(([k, v]) => [k, v === null || v === undefined ? null : String(v).slice(0, 4000)])) as Partial<Record<PoFieldKey, string | null>>,
          lines: (Array.isArray(i.lines) ? i.lines : []) as PoLineDraft[],
          hold: { on: hold.on === true, reason: String(hold.reason ?? '') },
          remarks: i.remarks ? String(i.remarks).slice(0, 1000) : undefined,
        },
        user,
      ),
    { fallback: 'Could not save the order' },
  );
}

/** Read the PO again with the current reading rules (old reading discarded). */
export async function rereadIntakeAction(id: unknown) {
  return write((user) => rereadIntake(toId(id, 'intake'), user), { fallback: 'Could not read the PO again' });
}

/** Excel / CSV preview of an attached file (BOM) for the review screen. */
export async function sheetPreviewAction(documentId: unknown) {
  return read(() => sheetPreview(toId(documentId, 'file')));
}

export async function discardIntakeAction(id: unknown) {
  return write((user) => discardIntake(toId(id, 'intake'), user));
}

export async function getOrderPoAction(orderId: unknown) {
  return read(() => getOrderPo(toId(orderId, 'order')));
}

export async function updateOrderPoFieldAction(orderId: unknown, key: unknown, value: unknown) {
  return write((user) => updateOrderPoField(toId(orderId, 'order'), String(key), value, user));
}

export async function updatePoLineAction(lineId: unknown, field: unknown, value: unknown) {
  return write((user) => updatePoLine(toId(lineId, 'line'), String(field), value, user));
}

export async function setHoldAction(orderId: unknown, on: unknown, reason: unknown) {
  return write((user) => setHold(toId(orderId, 'order'), on === true, String(reason ?? ''), user));
}

export async function runIndentJobAction(orderId: unknown) {
  return write((user) => runIndentJob(toId(orderId, 'order'), user), { fallback: 'Indent job failed' });
}

// ---------------------------------------------------------------- mail archive + n8n

export async function pendingIntakesAction() {
  return read(() => pendingIntakes());
}

export async function searchMailArchiveAction(q: unknown) {
  return write(() => searchMailArchive(String(q ?? '').slice(0, 200)), { fallback: 'Mail search failed' });
}

export async function requestMailReadAction(threadId: unknown, picks: unknown) {
  return write(
    (user) =>
      requestMailRead(
        String(threadId ?? '').slice(0, 100),
        (Array.isArray(picks) ? picks : []).slice(0, 15).map((p) => {
          const o = obj(p);
          return { name: String(o.name ?? '').slice(0, 255), kind: toKind(o.kind) };
        }),
        user,
      ),
    { fallback: 'Could not send the mail to n8n' },
  );
}

export async function intakeForThreadAction(threadId: unknown, since: unknown) {
  return read(() => intakeForThread(String(threadId ?? '').slice(0, 100), since ? String(since).slice(0, 40) : null));
}
