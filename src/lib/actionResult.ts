import 'server-only';
import { Prisma } from '@prisma/client';
import { requireUser, auditUser, EDITOR_ROLES, type AuthUser } from '@/lib/auth/server';
import type { Role } from '@/lib/auth/session';
import type { TableQuery } from '@/components/data-table/types';

// Server Actions return {success, error} instead of throwing: Next hides thrown messages in
// production (same convention as GMD's app/actions).

export type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

/** Message for an error the user can act on. Thrown by actions as `new UserError(...)`. */
export class UserError extends Error {}

function toMessage(err: unknown, fallback: string) {
  if (err instanceof UserError) return err.message;
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    return 'That number already exists for this order.';
  }
  console.error(fallback, err);
  return fallback;
}

/** Public read: viewing needs no login (see src/proxy.ts). */
export async function read<T>(fn: () => Promise<T>, fallback = 'Failed to load'): Promise<ActionResult<T>> {
  try {
    return { success: true, data: await fn() };
  } catch (err) {
    return { success: false, error: toMessage(err, fallback) };
  }
}

/**
 * Write: signed-in editor (or the given roles) required. Server Actions POST to page routes,
 * which proxy.ts does not guard, so this check is the gate.
 */
export async function write<T>(
  fn: (user: AuthUser) => Promise<T>,
  opts: { roles?: Role[]; fallback?: string } = {},
): Promise<ActionResult<T>> {
  const auth = await requireUser(opts.roles ?? EDITOR_ROLES);
  if (auth.error) {
    const status = auth.error.status;
    return {
      success: false,
      error: status === 401 ? 'Please sign in to make changes.' : status === 403 ? 'Your account cannot make this change.' : 'Authentication unavailable.',
    };
  }
  try {
    return { success: true, data: await fn(auth.user) };
  } catch (err) {
    return { success: false, error: toMessage(err, opts.fallback ?? 'Save failed') };
  }
}

export { auditUser };

/** Normalise an untrusted TableQuery from the browser: strings only, known shapes. */
export function cleanQuery(q: unknown): TableQuery {
  const o = (q && typeof q === 'object' ? q : {}) as Record<string, unknown>;
  const strRecord = (v: unknown) =>
    Object.fromEntries(
      Object.entries(v && typeof v === 'object' ? (v as Record<string, unknown>) : {}).map(([k, x]) => [k, String(x ?? '')]),
    );
  const filters: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(o.filters && typeof o.filters === 'object' ? (o.filters as Record<string, unknown>) : {})) {
    if (Array.isArray(v)) filters[k] = v.map((x) => String(x));
  }
  const dateRanges: TableQuery['dateRanges'] = {};
  for (const [k, v] of Object.entries(o.dateRanges && typeof o.dateRanges === 'object' ? (o.dateRanges as Record<string, unknown>) : {})) {
    const r = (v ?? {}) as Record<string, unknown>;
    dateRanges[k] = { from: String(r.from ?? ''), to: String(r.to ?? '') };
  }
  const sort = o.sort && typeof o.sort === 'object' ? (o.sort as Record<string, unknown>) : null;
  return {
    page: Number(o.page) || 1,
    pageSize: Number(o.pageSize) || 50,
    sort: sort ? { key: String(sort.key ?? ''), dir: sort.dir === 'asc' ? 'asc' : 'desc' } : null,
    search: String(o.search ?? ''),
    filters,
    dateRanges,
    columnSearch: strRecord(o.columnSearch),
    extra: strRecord(o.extra),
  };
}

/** Positive integer id from untrusted input, else a UserError. */
export function toId(v: unknown, what = 'id'): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new UserError(`Invalid ${what}`);
  return n;
}
