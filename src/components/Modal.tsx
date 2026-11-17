'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

/** Minimal accessible modal: Esc and the X close it; focus moves into it on open. */
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-[8vh]">
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`w-full ${wide ? 'max-w-4xl' : 'max-w-lg'} rounded-2xl bg-white p-5 shadow-2xl`}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-extrabold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-slate-500 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const fieldCls =
  'w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20';
export const labelCls = 'mb-1 block text-xs font-extrabold text-slate-700';

export function FormError({ error }: { error: string }) {
  if (!error) return null;
  return (
    <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">
      {error}
    </div>
  );
}
