'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { signOut } from 'next-auth/react';
import { ChevronDown, LogIn, LogOut, Menu, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { NAV_GROUPS, type NavItem, type QuotationTab } from '@/lib/navigation';

export type { QuotationTab };

type SidebarUser = { name: string; role: string } | null;

const STORE_COLLAPSED = 'ceebuild.sidebar.collapsed';
const STORE_GROUPS = 'ceebuild.sidebar.closedGroups';

function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
function writeStore(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

/**
 * The app's navigation, driven by NAV_GROUPS in src/lib/navigation.ts.
 * - Desktop: full sidebar, or a narrow icon rail (toggle remembered per browser).
 * - Groups fold open/closed (remembered); the group of the current page always shows.
 * - Mobile: top bar with a slide-in drawer.
 * On the dashboard (`onTabSelect` given) quotation entries switch tabs in place.
 */
export function AppSidebar({
  user,
  activeTab,
  onTabSelect,
  counts,
}: {
  user: SidebarUser;
  activeTab?: QuotationTab;
  onTabSelect?: (tab: QuotationTab) => void;
  counts?: Partial<Record<string, number>>;
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [closedGroups, setClosedGroups] = useState<string[]>([]);

  useEffect(() => {
    setCollapsed(readStore(STORE_COLLAPSED, false));
    setClosedGroups(readStore<string[]>(STORE_GROUPS, []));
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      writeStore(STORE_COLLAPSED, !c);
      return !c;
    });
  };
  const toggleGroup = (key: string) => {
    setClosedGroups((g) => {
      const next = g.includes(key) ? g.filter((k) => k !== key) : [...g, key];
      writeStore(STORE_GROUPS, next);
      return next;
    });
  };

  const visible = (n: NavItem) => !n.roles || (user && n.roles.includes(user.role));
  const isActive = (n: NavItem) => {
    if (n.soon) return false;
    if (n.tab) return pathname === '/' && activeTab === n.tab;
    const paths = [n.href, ...(n.match ?? [])];
    return paths.some((p) => pathname === p || pathname.startsWith(p + '/'));
  };

  const groups = NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter(visible) })).filter((g) => g.items.length);

  const handleLogout = async () => {
    try {
      await signOut({ redirect: false });
    } catch (err) {
      console.error(err);
    }
    window.location.reload();
  };

  const initials = (user?.name || 'Guest')
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const renderItem = (n: NavItem, rail: boolean) => {
    const active = isActive(n);
    const Icon = n.icon;
    const count = counts?.[n.key];
    const base = `group relative flex w-full items-center rounded-md text-[13px] transition-colors ${
      rail ? 'h-9 justify-center' : 'h-8 gap-2.5 px-2.5'
    }`;
    const tone = n.soon
      ? 'cursor-not-allowed text-slate-400'
      : active
        ? 'bg-slate-100 font-medium text-slate-900'
        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900';

    const body = (
      <>
        {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-blue-600" aria-hidden />}
        <Icon
          className={`h-4 w-4 shrink-0 ${n.soon ? 'text-slate-300' : active ? 'text-blue-600' : 'text-slate-600 group-hover:text-slate-800'}`}
          strokeWidth={1.9}
        />
        {!rail && (
          <>
            <span className="flex-1 truncate text-left">{n.label}</span>
            {n.soon ? (
              <span className="rounded border border-slate-200 px-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                Soon
              </span>
            ) : (
              typeof count === 'number' && (
                <span className="text-[11px] tabular-nums text-slate-600">{count.toLocaleString('en-IN')}</span>
              )
            )}
          </>
        )}
      </>
    );

    const title = rail ? `${n.label}${n.soon ? ' (coming soon)' : ''}` : n.soon ? 'Coming soon' : undefined;

    if (n.soon) {
      return (
        <div key={n.key} className={`${base} ${tone}`} title={title} aria-disabled="true">
          {body}
        </div>
      );
    }
    if (n.tab && onTabSelect) {
      const tab = n.tab;
      return (
        <button
          key={n.key}
          type="button"
          title={title}
          className={`${base} ${tone}`}
          aria-current={active ? 'page' : undefined}
          onClick={() => {
            onTabSelect(tab);
            setDrawerOpen(false);
          }}
        >
          {body}
        </button>
      );
    }
    return (
      <Link
        key={n.key}
        href={n.href}
        title={title}
        className={`${base} ${tone}`}
        aria-current={active ? 'page' : undefined}
        onClick={() => setDrawerOpen(false)}
      >
        {body}
      </Link>
    );
  };

  const renderNav = (rail: boolean) => (
    <nav className={`flex-1 overflow-y-auto py-3 ${rail ? 'px-2' : 'px-3'}`} aria-label="Main">
      {groups.map((g, gi) => {
        const hasActive = g.items.some(isActive);
        const open = rail || hasActive || !closedGroups.includes(g.key);
        return (
          <div key={g.key} className={gi > 0 ? (rail ? 'mt-2 border-t border-slate-100 pt-2' : 'mt-4') : ''}>
            {!rail && (
              <button
                type="button"
                onClick={() => toggleGroup(g.key)}
                disabled={hasActive}
                aria-expanded={open}
                className="flex w-full items-center justify-between rounded px-2.5 pb-1.5 pt-1 text-xs font-bold uppercase tracking-wider text-slate-600 hover:text-slate-800 disabled:cursor-default disabled:hover:text-slate-600"
              >
                {g.label}
                {!hasActive && (
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? '' : '-rotate-90'}`} />
                )}
              </button>
            )}
            {open && <div className="space-y-0.5">{g.items.map((n) => renderItem(n, rail))}</div>}
          </div>
        );
      })}
    </nav>
  );

  const renderFooter = (rail: boolean) => (
    <div className={`border-t border-slate-200 ${rail ? 'p-2' : 'p-3'}`}>
      {user ? (
        <div className={`flex items-center ${rail ? 'flex-col gap-2' : 'gap-2.5 px-1'}`}>
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[11px] font-semibold text-white"
            title={rail ? `${user.name} · ${user.role}` : undefined}
          >
            {initials}
          </div>
          {!rail && (
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-[13px] font-medium text-slate-900">{user.name}</div>
              <div className="text-xs text-slate-600">
                {user.role}
                {user.role === 'Viewer' ? ' · read-only' : ''}
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={handleLogout}
            title="Sign out"
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <Link
          href="/login"
          title={rail ? 'Sign in to edit' : undefined}
          className={`flex items-center justify-center gap-2 rounded-md bg-blue-600 text-[13px] font-medium text-white transition-colors hover:bg-blue-700 ${
            rail ? 'h-9 w-full' : 'w-full px-3 py-2'
          }`}
        >
          <LogIn className="h-4 w-4" />
          {!rail && 'Sign in to edit'}
        </Link>
      )}
    </div>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4 lg:hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100"
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </button>
        <img src="/ceebuild-logo.png" alt="Ceebuild" className="h-7 w-auto object-contain" />
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-white shadow-xl">
            <div className="flex h-14 items-center justify-between border-b border-slate-200 px-4">
              <img src="/ceebuild-logo.png" alt="Ceebuild" className="h-7 w-auto object-contain" />
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
                aria-label="Close navigation"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {renderNav(false)}
            {renderFooter(false)}
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-200 lg:flex ${
          collapsed ? 'w-[60px]' : 'w-60'
        }`}
      >
        <div className={`flex h-14 items-center border-b border-slate-200 ${collapsed ? 'justify-center' : 'justify-between pl-4 pr-2'}`}>
          {!collapsed && <img src="/ceebuild-logo.png" alt="Ceebuild" className="h-7 w-auto object-contain" />}
          <button
            type="button"
            onClick={toggleCollapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>
        {renderNav(collapsed)}
        {renderFooter(collapsed)}
      </aside>
    </>
  );
}

/** Title row at the top of each screen's content area. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-0.5 text-[13px] text-slate-700">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
