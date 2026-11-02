'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

export interface ConfirmDialogOptions {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  /** If set, the user must type this exact text before the confirm button is enabled. */
  requireText?: string;
  onConfirm: () => void | Promise<void>;
}

interface Props extends ConfirmDialogOptions {
  open: boolean;
  onClose: () => void;
}

/**
 * Modal confirmation used for destructive actions (delete docket / item / master option).
 * Replaces window.confirm so the action is explicit and cannot be accidentally triggered by Enter.
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Delete',
  requireText,
  onConfirm,
  onClose,
}: Props) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    setTyped('');
    setBusy(false);
    // Focus the safe option (or the text box) by default.
    setTimeout(() => (requireText ? inputRef.current?.focus() : cancelRef.current?.focus()), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, requireText]);

  if (!open) return null;

  const canConfirm = !busy && (!requireText || typed.trim() === requireText.trim());

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-xl bg-rose-50 border border-rose-200 shrink-0">
            <AlertTriangle className="w-5 h-5 text-rose-600" />
          </div>
          <div className="space-y-1">
            <h2 id="confirm-dialog-title" className="text-base font-extrabold text-slate-900">
              {title}
            </h2>
            <div className="text-xs text-slate-600 font-medium leading-relaxed">{message}</div>
          </div>
        </div>

        {requireText && (
          <div className="space-y-1">
            <label htmlFor="confirm-dialog-input" className="text-xs font-bold text-slate-700">
              Type <span className="font-mono text-rose-700">{requireText}</span> to confirm
            </label>
            <input
              id="confirm-dialog-input"
              ref={inputRef}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleConfirm();
                }
              }}
              autoComplete="off"
              className="w-full p-2.5 border border-slate-300 rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
            />
          </div>
        )}

        <p className="text-[11px] text-slate-500">This action cannot be undone. It will be recorded in the Audit Log.</p>

        <div className="flex justify-end gap-2 pt-1">
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="px-4 py-2 text-xs font-extrabold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl"
          >
            {busy ? 'Deleting...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
