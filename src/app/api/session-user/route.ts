import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

/**
 * The signed-in user, checked against the database (active, role, session version) — the same
 * check every server page and action uses. NextAuth's /api/auth/session only decodes the cookie,
 * so a stale cookie (user disabled, password/role changed, cookie from another server on the same
 * host) would look signed in there but signed out everywhere else.
 */
export async function GET() {
  try {
    const user = await getSessionUser();
    return NextResponse.json({ user }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[auth] session-user lookup failed:', err);
    return NextResponse.json({ user: null, error: 'Authentication service unavailable' }, { status: 503 });
  }
}
