import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth/server';

// Audit trail for the dashboard's Logs tab. proxy.ts lets every GET through without a login,
// and the log holds full snapshots of deleted records and user emails, so a login is required here.
export async function GET(req: Request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  try {
    const { searchParams } = new URL(req.url);
    const tableName = searchParams.get('tableName');
    const search = searchParams.get('search')?.trim();
    const contains = { contains: search, mode: 'insensitive' as const };

    const logs = await prisma.editLog.findMany({
      where: {
        ...(tableName ? { tableName } : {}),
        ...(search
          ? {
              OR: [
                { fieldName: contains },
                { oldValue: contains },
                { newValue: contains },
                { userName: contains },
                ...(/^\d{1,9}$/.test(search) ? [{ recordId: Number(search) }] : []),
              ],
            }
          : {}),
      },
      orderBy: { id: 'desc' },
      // shortcut: newest 500 only, add paging if the Logs tab needs older history
      take: 500,
    });

    return NextResponse.json({ logs });
  } catch (error) {
    console.error('Error fetching logs:', error);
    return NextResponse.json({ error: 'Failed to fetch logs' }, { status: 500 });
  }
}
