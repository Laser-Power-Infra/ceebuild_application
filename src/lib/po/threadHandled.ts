// Which mail-archive threads the PO reader must not read again. Pure (tested).
//
// A thread is done once it has an EXTRACTED / CONFIRMED intake, or FAILED MAX_FAILS times. A
// DISCARDED intake (not a PO, a bounce, our own PO...) closes the thread only until a new message
// comes in: e.g. 25-11 the UPCL second-lot thread ended with a bounce and was discarded; on 26-11
// Souvik forwarded the real POs in the same thread and they were never read. After MAX_DISCARDS the
// thread stays closed, so a chatty non-PO thread is not read on every reply.

export const MAX_FAILS = 3;
export const MAX_DISCARDS = 3;

export interface IntakeOfThread {
  status: string;
  createdAt: Date;
}

/** Archive dates look like "2026-11-26 05:43:03" (no zone): read as UTC. */
export function archiveDate(v: string | null | undefined): Date | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s.replace(' ', 'T') : `${s.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function threadHandled(intakes: IntakeOfThread[], lastMessage: Date | null): boolean {
  if (intakes.some((i) => i.status === 'EXTRACTED' || i.status === 'CONFIRMED')) return true;
  if (intakes.filter((i) => i.status === 'FAILED').length >= MAX_FAILS) return true;
  const discards = intakes.filter((i) => i.status === 'DISCARDED');
  if (!discards.length) return false;
  if (discards.length >= MAX_DISCARDS || !lastMessage) return true;
  const lastRead = Math.max(...intakes.map((i) => i.createdAt.getTime()));
  // Open again only when a message came in after the last reading.
  return lastMessage.getTime() <= lastRead;
}
