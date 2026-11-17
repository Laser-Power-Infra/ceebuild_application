import 'server-only';
import { getSessionUser } from '@/lib/auth/server';

/** Role of the signed-in user for UI gating ('Guest' when not signed in). Server actions re-check. */
export async function currentRole(): Promise<'Admin' | 'User' | 'Viewer' | 'Guest'> {
  const user = await getSessionUser().catch(() => null);
  return user?.role ?? 'Guest';
}
