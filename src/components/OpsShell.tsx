import Link from 'next/link';
import type { ReactNode } from 'react';
import type { AuthUser } from '@/lib/auth/server';

const NAV = [
  { href: '/', label: 'Quotation dashboard' },
  { href: '/orders', label: 'Orders' },
  { href: '/execution', label: 'Execution registers' },
  { href: '/admin/sections', label: 'GTP sections' },
];

/** Header for the order-to-execution screens. Viewing is public; edits need sign-in. */
export function OpsShell({ user, children }: { user: AuthUser | null; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-4 py-3">
          <img src="/ceebuild-logo.png" alt="Ceebuild" className="h-8 w-auto" />
          <nav className="flex flex-wrap gap-1" aria-label="Sections">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="rounded-lg px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 hover:text-slate-900">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="flex-1" />
          {user ? (
            <span className="text-xs font-bold text-slate-600">
              {user.name} <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] text-blue-800">{user.role}</span>
            </span>
          ) : (
            <Link href="/login" className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700">
              Sign in to edit
            </Link>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] px-4 py-5">{children}</main>
    </div>
  );
}
