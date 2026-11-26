// Several customer POs in one mail (26-11: "PO and MC Second Lot – UPCL" carries NC26Y-00016,
// NC26Y-00008 and O226Y-00051). The first reading of the mail fills one PO and lists the others as
// "OTHER_PO: po no | file" (extraction.otherPos). Each other PO is then read on its own as a "part"
// of the thread: thread id "<thread>~<PO key>", only its own PO file sent, with a focus line telling
// the AI which PO to read. Pure (tested).

import type { MailFile } from '@/lib/mailFiles';

export const PART_SEP = '~';

/** "NC26Y-00008" -> "NC26Y-00008"; "LIL/SBPDCL/.../112" -> "LIL-SBPDCL-...-112" (max 40). */
export function partKey(poNumber: string): string {
  return poNumber
    .toUpperCase()
    .replace(/[^0-9A-Z]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

const bare = (s: string) => s.toUpperCase().replace(/[^0-9A-Z]/g, '');

export const partThreadId = (threadId: string, poNumber: string) => `${threadId}${PART_SEP}${partKey(poNumber)}`;

export function splitThreadId(id: string): { threadId: string; part: string | null } {
  const i = id.indexOf(PART_SEP);
  return i < 0 ? { threadId: id, part: null } : { threadId: id.slice(0, i), part: id.slice(i + 1) || null };
}

/** The file of one PO: the name the AI gave, else a PO-type file whose name carries the PO number. */
export function fileForPo(files: MailFile[], poNumber: string, fileName: string | null): MailFile | null {
  const usable = files.filter((f) => f.kind !== 'SKIP' && f.driveId);
  if (fileName) {
    const n = fileName.trim().toLowerCase();
    const hit = usable.find((f) => f.name.trim().toLowerCase() === n);
    if (hit) return hit;
  }
  const key = bare(poNumber);
  if (key.length < 4) return null;
  return usable.find((f) => f.kind === 'PO' && bare(f.name).includes(key)) ?? null;
}

/** Files sent for one part: its PO file, plus BOMs / drawings of the mail (shared). */
export function filesForPart(files: MailFile[], poFile: MailFile): MailFile[] {
  return [poFile, ...files.filter((f) => f !== poFile && f.driveId && (f.kind === 'BOM' || f.kind === 'DRAWING'))];
}

export function focusLine(poNumber: string, fileName: string): string {
  return (
    `THIS READING IS FOR ONE PO ONLY: PO no. ${poNumber} (document "${fileName}"). The same mail carries other, separate POs that are ` +
    `read on their own - read every field and line ONLY from PO no. ${poNumber}; do not list OTHER_PO lines.`
  );
}

export interface PartTarget {
  partId: string;
  poNumber: string;
  file: MailFile;
}

/**
 * Other POs of a mail still to read: listed by the first reading, not the PO already read, not
 * already an order (orderPoNumbers), with a file found in the mail. Duplicates dropped.
 */
export function partTargets(
  threadId: string,
  readPoNumber: string | null,
  otherPos: { poNumber: string; fileName: string | null }[],
  files: MailFile[],
  orderPoNumbers: Iterable<string>,
): PartTarget[] {
  const skip = new Set([...orderPoNumbers].map(bare));
  if (readPoNumber) skip.add(bare(readPoNumber));
  const out: PartTarget[] = [];
  for (const o of otherPos) {
    const k = bare(o.poNumber);
    if (k.length < 3 || skip.has(k)) continue;
    const file = fileForPo(files, o.poNumber, o.fileName);
    if (!file) continue;
    skip.add(k);
    out.push({ partId: partThreadId(threadId, o.poNumber), poNumber: o.poNumber, file });
  }
  return out;
}
