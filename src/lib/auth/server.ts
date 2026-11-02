/**
 * Server-side auth helpers for route handlers (Node runtime).
 *
 * middleware.ts already rejects requests without a valid signed cookie, but the
 * handlers re-check the user in the database so that disabling a user, changing
 * their role or resetting their password takes effect immediately.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { SESSION_COOKIE, verifySessionToken, isRole, type Role } from './session';

export interface AuthUser {
  id: number;
  username: string;
  name: string;
  role: Role;
}

export async function getSessionUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies();
  const payload = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!payload) return null;

  const user = await prisma.user.findUnique({ where: { id: payload.uid } });
  if (!user || !user.isActive || user.sessionVersion !== payload.sv || !isRole(user.role)) return null;

  return { id: user.id, username: user.username, name: user.name, role: user.role };
}

type AuthResult = { user: AuthUser; error?: undefined } | { user?: undefined; error: NextResponse };

/**
 * Usage in a route handler:
 *   const auth = await requireUser(['Admin']);
 *   if (auth.error) return auth.error;
 *   auth.user ...
 */
export async function requireUser(allowedRoles?: Role[]): Promise<AuthResult> {
  let user: AuthUser | null;
  try {
    user = await getSessionUser();
  } catch (err) {
    console.error('[auth] session lookup failed:', err);
    return { error: NextResponse.json({ error: 'Authentication service unavailable' }, { status: 503 }) };
  }
  if (!user) {
    return { error: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) };
  }
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return {
      error: NextResponse.json(
        { error: `Forbidden: requires role ${allowedRoles.join(' or ')}` },
        { status: 403 }
      ),
    };
  }
  return { user };
}

/** Roles allowed to create / edit records. Viewers are read-only. */
export const EDITOR_ROLES: Role[] = ['Admin', 'User'];
/** Roles allowed to delete records and manage master dropdowns. */
export const ADMIN_ROLES: Role[] = ['Admin'];

/** Attribution fields to spread into prisma.editLog.create({ data }). */
export function auditUser(user: AuthUser) {
  return { userId: user.id, userName: `${user.name} (${user.username})` };
}

/** Keep only whitelisted keys from a request body (prevents writing id/createdAt/etc.). */
export function pickFields<T extends string>(body: Record<string, unknown>, allowed: readonly T[]) {
  const out: Partial<Record<T, unknown>> = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(body, key)) out[key] = body[key];
  }
  return out;
}
