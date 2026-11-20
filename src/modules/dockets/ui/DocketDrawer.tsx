'use client';

import { useEffect, useMemo, useState } from 'react';
import { Eye, Loader2, Paperclip, X } from 'lucide-react';
import { DOCKET_TYPES, isDocketType } from '@/lib/dockets';
import { cn } from '@/lib/utils';
import type { Docket, DocketActions } from '../types';

type Field = 'docketNoQtnNo' | 'type' | 'partyName' | 'state' | 'utility' | 'deliveryLocation' | 'address' | Condition;
type Condition = 'price' | 'payment' | 'delivery' | 'warranty' | 'approval' | 'inspection';

const CONDITIONS: Array<[Condition, string]> = [
  ['price', 'Price condition'],
  ['payment', 'Payment condition'],
  ['delivery', 'Delivery condition'],
  ['warranty', 'Warranty condition'],
  ['approval', 'Approval condition'],
  ['inspection', 'Inspection condition'],
];
const FIELDS: Field[] = ['docketNoQtnNo', 'type', 'partyName', 'state', 'utility', 'deliveryLocation', 'address', ...CONDITIONS.map(([k]) => k)];

const input =
  'h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus-visible:border-blue-500 focus-visible:ring-1 focus-visible:ring-blue-500 disabled:bg-muted disabled:text-foreground/60';
const labelCls = 'mb-1 block text-xs font-medium text-foreground/70';

interface DocketDrawerProps {
  /** Live row (attachment count follows uploads). */
  doc: Docket;
  canEdit: boolean;
  isAdmin: boolean;
  termOptions: Record<Condition, string[]>;
  attachmentCount: number;
  uploading: boolean;
  actions: DocketActions;
  /** `changed` = something was saved (the row flashes). */
  onClose: (changed: boolean) => void;
}

/** Docket fields, edited beside the table. Read-only users get the same panel as "View", with no Save. */
export function DocketDrawer({ doc, canEdit, isAdmin, termOptions, attachmentCount, uploading, actions, onClose }: DocketDrawerProps) {
  const initial = useMemo(
    () => Object.fromEntries(FIELDS.map((f) => [f, doc[f] ?? ''])) as Record<Field, string>,
    // The form is seeded once per docket; later row refreshes must not overwrite what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc.id]
  );
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    setForm(initial);
  }, [initial]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const dirty = FIELDS.filter((f) => form[f] !== initial[f]);
  const typeMissing = !isDocketType(form.type);

  const close = () => {
    if (!dirty.length) return onClose(false);
    actions.confirm({
      title: 'Discard unsaved changes?',
      message: `Your changes to ${doc.docketNoQtnNo || `#${doc.id}`} have not been saved.`,
      confirmLabel: 'Discard',
      onConfirm: () => onClose(false),
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const save = async () => {
    if (typeMissing) return;
    setSaving(true);
    // One field per request, as before: each change keeps its own audit-log entry and server rule.
    let ok = true;
    for (const f of dirty) ok = (await actions.updateDocket(doc.id, f, form[f])) && ok;
    setSaving(false);
    if (ok) onClose(dirty.length > 0);
  };

  const text = (field: Field, label: string, opts: { list?: string; disabled?: boolean; span?: string } = {}) => (
    <label className={opts.span}>
      <span className={labelCls}>{label}</span>
      <input
        value={form[field]}
        list={opts.list}
        disabled={!canEdit || opts.disabled}
        onChange={(e) => setForm((prev) => ({ ...prev, [field]: e.target.value }))}
        className={input}
      />
    </label>
  );

  return (
    <aside
      role="dialog"
      aria-label={`${canEdit ? 'Edit' : 'View'} ${doc.docketNoQtnNo || `docket #${doc.id}`}`}
      className={cn(
        'fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-border bg-background shadow-xl transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-opacity motion-reduce:duration-150',
        shown ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0 motion-reduce:translate-x-0'
      )}
    >
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <h2 className="truncate text-sm font-semibold">
          {canEdit ? 'Edit' : 'View'} {doc.docketNoQtnNo || 'docket'} <span className="font-normal text-muted-foreground">#{doc.id}</span>
        </h2>
        <button type="button" onClick={close} aria-label="Close" className="flex size-7 items-center justify-center rounded-md text-foreground/70 hover:bg-muted">
          <X size={16} />
        </button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-3">
          {text('docketNoQtnNo', isAdmin ? 'Docket / Qtn no' : 'Docket / Qtn no (Admin only)', { disabled: !isAdmin })}
          <label>
            <span className={labelCls}>Type</span>
            <select
              value={isDocketType(form.type) ? form.type : ''}
              disabled={!canEdit}
              aria-invalid={typeMissing}
              onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value }))}
              className={cn(input, typeMissing && 'border-amber-400')}
            >
              {typeMissing && <option value="">Choose a type</option>}
              {DOCKET_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            {typeMissing && canEdit && <span className="mt-1 block text-[11px] text-amber-700">Type is required: Tender or Purchase.</span>}
          </label>
          {text('partyName', 'Party name', { list: 'master-party-names', span: 'col-span-2' })}
        </div>

        <div className="grid grid-cols-3 gap-3">
          {text('state', 'State', { list: 'master-states' })}
          {text('utility', 'Utility', { list: 'master-utilities' })}
          {text('deliveryLocation', 'Delivery location')}
          {text('address', 'Address', { list: 'master-addresses', span: 'col-span-3' })}
        </div>

        <div className="space-y-3 border-t border-border pt-4">
          {CONDITIONS.map(([field, label]) => {
            const current = form[field];
            const options = current && !termOptions[field].includes(current) ? [current, ...termOptions[field]] : termOptions[field];
            return (
              <label key={field} className="block">
                <span className={labelCls}>{label}</span>
                <select value={current} disabled={!canEdit} onChange={(e) => setForm((prev) => ({ ...prev, [field]: e.target.value }))} className={input}>
                  <option value="">Not set</option>
                  {options.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
                {/* A native select cuts long condition texts off; the full text is readable here. */}
                {current && <span className="mt-1 block text-xs text-muted-foreground">{current}</span>}
              </label>
            );
          })}
        </div>

        <div className="flex items-center gap-2 border-t border-border pt-4">
          <span className="text-xs font-medium text-foreground/70">Attachments</span>
          <button
            type="button"
            disabled={attachmentCount === 0}
            onClick={() => actions.openAttachments(doc.id)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            <Eye size={13} className="text-muted-foreground" />
            View {attachmentCount}
          </button>
          {canEdit && (
            <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-muted">
              {uploading ? <Loader2 size={13} className="animate-spin" /> : <Paperclip size={13} className="text-muted-foreground" />}
              {uploading ? 'Uploading…' : 'Attach files'}
              <input
                type="file"
                multiple
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  const files = e.target.files ? Array.from(e.target.files) : [];
                  e.target.value = ''; // allow re-selecting the same file(s) later
                  if (files.length) void actions.uploadAttachments(doc.id, files);
                }}
              />
            </label>
          )}
        </div>
      </div>

      <footer className="flex h-14 shrink-0 items-center justify-end gap-2 border-t border-border bg-muted/50 px-4">
        <button type="button" onClick={close} className="h-8 rounded-md border border-border bg-background px-3 text-[13px] font-medium hover:bg-muted">
          {canEdit ? 'Cancel' : 'Close'}
        </button>
        {canEdit && (
          <button
            type="button"
            onClick={save}
            disabled={saving || dirty.length === 0 || typeMissing}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#0f62fe] px-3 text-[13px] font-semibold text-white hover:bg-[#0353e9] active:translate-y-px disabled:opacity-50"
          >
            {saving && <Loader2 size={13} className="animate-spin" />}
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
      </footer>
    </aside>
  );
}
