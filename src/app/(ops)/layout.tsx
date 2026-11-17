import type { ReactNode } from 'react';
import StoreProvider from '@/components/StoreProvider';
import { OpsShell } from '@/components/OpsShell';
import { getSessionUser } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

export default async function OpsLayout({ children }: { children: ReactNode }) {
  // A failed lookup (e.g. DB down) just shows the read-only view.
  const user = await getSessionUser().catch(() => null);
  return (
    <StoreProvider>
      <OpsShell user={user}>{children}</OpsShell>
    </StoreProvider>
  );
}
