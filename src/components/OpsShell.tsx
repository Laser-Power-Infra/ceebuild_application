import type { ReactNode } from 'react';
import type { AuthUser } from '@/lib/auth/server';
import { AppSidebar } from '@/components/AppSidebar';

/** Shell for the order-to-execution screens. Viewing is public; edits need sign-in. */
export function OpsShell({ user, children }: { user: AuthUser | null; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 lg:flex">
      <AppSidebar user={user ? { name: user.name, role: user.role } : null} />
      <main className="min-w-0 flex-1 px-4 py-6 lg:px-8">
        <div className="mx-auto max-w-[1600px]">{children}</div>
      </main>
    </div>
  );
}
