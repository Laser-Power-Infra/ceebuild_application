import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/** Auto-generated docket numbers look like CEE-000518. */
export const AUTO_DOCKET_NO = /^CEE-\d{6}$/;
const FIRST_NUMBER = 518;

type Db = Pick<typeof prisma, '$queryRaw'>;

/** Next free CEE- number: highest existing CEE-NNNNNN + 1 (ignores revisions like CEE-000518-R1). */
export async function nextDocketNumber(db: Db = prisma): Promise<{ nextDocketNo: string; nextNumber: number }> {
  const rows = await db.$queryRaw<{ max: number | null }[]>(Prisma.sql`
    SELECT max(substring(docket_no_qtn_no from '^CEE-([0-9]+)$')::int) AS max FROM "docket-party-name"`);
  const max = rows[0]?.max;
  const nextNumber = max != null ? Number(max) + 1 : FIRST_NUMBER;
  return { nextDocketNo: `CEE-${String(nextNumber).padStart(6, '0')}`, nextNumber };
}

/** True when a Prisma error is a unique-constraint violation (P2002). */
export function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === 'P2002';
}
