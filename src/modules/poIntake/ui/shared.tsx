'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Ban, Info, Loader2, Trash2, Plus } from 'lucide-react';
import { fieldCls } from '@/components/Modal';
import { DRAWING_STATUSES, type PoFieldDef, type PoFieldValue, type PoLineDraft } from '@/lib/po/fields';
import { compareRate, type PoCheck } from '@/lib/po/checks';
import { sheetPreviewAction } from '@/app/actions/poIntake';
import type { IntakeDoc } from '../types';

export const GROUP_LABELS = { header: 'Header', commercial: 'Commercial', references: 'References (drive the BOM and drawing steps)' } as const;

const DRAWING_LABELS: Record<string, string> = { APPROVED: 'Approved / enclosed', TO_BE_APPROVED: 'To be approved by client', NOT_STATED: 'Not stated on PO' };

/** One PO field. Yellow = the AI could not read it confidently (or not at all) and it is still as read. */
export function PoField({
  def,
  value,
  read,
  onChange,
  disabled,
  highlight,
}: {
  def: PoFieldDef;
  value: string;
  read?: PoFieldValue;
  onChange: (v: string) => void;
  disabled?: boolean;
  highlight: boolean;
}) {
  const id = `po-${def.key}`;
  const cls = `${fieldCls} ${highlight ? '!border-amber-400 !bg-amber-100' : ''}`;
  const isDate = def.type === 'date' && (!value || /^\d{4}-\d{2}-\d{2}$/.test(value));
  return (
    <div className={def.type === 'longtext' ? 'sm:col-span-2' : ''}>
      <label htmlFor={id} className="mb-1 flex items-center gap-1 text-xs font-semibold text-slate-700">
        {def.label}
        {def.required && <span className="text-rose-600">*</span>}
        {read && read.confidence !== 'high' && (
          <span
            className={`rounded px-1 text-[10px] font-bold ${read.confidence === 'missing' ? 'bg-slate-200 text-slate-600' : read.confidence === 'low' ? 'bg-amber-200 text-amber-900' : 'bg-sky-100 text-sky-800'}`}
            title={read.note ?? undefined}
          >
            {read.confidence === 'missing' ? 'not on PO' : `${read.confidence} confidence`}
          </span>
        )}
      </label>
      {def.type === 'drawingStatus' ? (
        <select id={id} className={cls} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
          <option value="">–</option>
          {DRAWING_STATUSES.map((s) => (
            <option key={s} value={s}>{DRAWING_LABELS[s]}</option>
          ))}
        </select>
      ) : def.type === 'longtext' ? (
        <textarea id={id} rows={2} className={cls} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input
          id={id}
          type={isDate ? 'date' : 'text'}
          inputMode={def.type === 'money' || def.type === 'pct' || def.type === 'int' ? 'decimal' : undefined}
          className={cls}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {read?.note && highlight && <p className="mt-0.5 text-[11px] text-amber-800">{read.note}</p>}
    </div>
  );
}

export function ChecksPanel({ checks }: { checks: PoCheck[] }) {
  if (!checks.length) return <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">All checks passed.</p>;
  const order = { block: 0, flag: 1, info: 2 };
  return (
    <ul className="flex flex-col gap-1" aria-label="Checks">
      {[...checks].sort((a, b) => order[a.level] - order[b.level]).map((c, i) => (
        <li
          key={i}
          className={`flex items-start gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold ${
            c.level === 'block' ? 'border-rose-300 bg-rose-50 text-rose-800' : c.level === 'flag' ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-sky-200 bg-sky-50 text-sky-900'
          }`}
        >
          {c.level === 'block' ? <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : c.level === 'flag' ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
          <span>{c.message}</span>
        </li>
      ))}
    </ul>
  );
}

const n = (v: string) => {
  const t = v.replace(/,/g, '').trim();
  if (!t) return null;
  const x = Number(t);
  return Number.isFinite(x) ? x : null;
};
const s = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : String(v));

type LineKey = 'description' | 'hsn' | 'unit' | 'qty' | 'unitRate' | 'lineValue' | 'qtyVarPct';
const COLS: { key: LineKey; label: string; w: string; num?: boolean }[] = [
  { key: 'description', label: 'Description', w: 'min-w-[16rem]' },
  { key: 'hsn', label: 'HSN', w: 'w-20' },
  { key: 'unit', label: 'Unit', w: 'w-16' },
  { key: 'qty', label: 'Qty', w: 'w-24', num: true },
  { key: 'unitRate', label: 'Unit rate', w: 'w-24', num: true },
  { key: 'lineValue', label: 'Line value', w: 'w-28', num: true },
  { key: 'qtyVarPct', label: '± qty %', w: 'w-16', num: true },
];

/**
 * PO line items. Editable when `onChange` is given (review screen) or `onCell` (order tab, saves
 * one cell at a time). Shows our quoted rate and the difference.
 */
export function PoLinesTable({
  lines,
  onChange,
  onCell,
  readOnly,
  offerItems = 0,
}: {
  lines: (PoLineDraft & { id?: number })[];
  onChange?: (lines: PoLineDraft[]) => void;
  onCell?: (index: number, key: LineKey, value: string) => void;
  readOnly?: boolean;
  /** Items on the chosen offer: when > 0, a line with no matching item shows "not in offer". */
  offerItems?: number;
}) {
  const set = (i: number, key: LineKey, v: string) => {
    if (onCell) return onCell(i, key, v);
    if (!onChange) return;
    const next = lines.map((l, j) => (j === i ? { ...l, [key]: COLS.find((c) => c.key === key)?.num ? n(v) : v || null, confidence: 'high' as const } : l));
    onChange(next as PoLineDraft[]);
  };
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="min-w-full text-xs">
        <thead className="bg-slate-50 text-left text-[11px] text-slate-500">
          <tr>
            <th className="px-2 py-1.5">#</th>
            {COLS.map((c) => (
              <th key={c.key} className={`px-2 py-1.5 font-bold ${c.num ? 'text-right' : ''}`}>{c.label}</th>
            ))}
            <th className="px-2 py-1.5 text-right font-bold">Our quoted rate</th>
            <th className="px-2 py-1.5 text-right font-bold">PO vs quote</th>
            {onChange && !readOnly && <th />}
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 && (
            <tr>
              <td colSpan={11} className="px-3 py-4 text-center text-slate-500">No line items.</td>
            </tr>
          )}
          {lines.map((l, i) => {
            const cmp = compareRate(l);
            const yellow = l.confidence === 'low' || l.confidence === 'missing';
            return (
              <tr key={l.id ?? i} className={`border-t border-slate-100 align-top ${yellow ? 'bg-amber-50' : ''}`}>
                <td className="px-2 py-1 text-slate-400">{i + 1}</td>
                {COLS.map((c) => (
                  <td key={c.key} className={`px-1 py-1 ${c.w}`}>
                    {readOnly ? (
                      <span className={c.num ? 'block text-right tabular-nums' : ''}>{s(l[c.key] as number | string | null) || '–'}</span>
                    ) : c.key === 'description' ? (
                      <textarea
                        rows={2}
                        aria-label={`Line ${i + 1} ${c.label}`}
                        className={`w-full rounded border px-1.5 py-1 ${yellow ? 'border-amber-400 bg-amber-100' : 'border-slate-200'}`}
                        defaultValue={l.description}
                        onBlur={(e) => e.target.value !== l.description && set(i, c.key, e.target.value)}
                      />
                    ) : (
                      <>
                        <input
                          key={c.key === 'hsn' ? `hsn-${s(l.hsn)}` : undefined}
                          aria-label={`Line ${i + 1} ${c.label}`}
                          title={c.key === 'hsn' && l.hsnSource === 'MASTER' ? 'Not on the PO: filled from the HSN item master – check it' : undefined}
                          className={`w-full rounded border px-1.5 py-1 ${c.num ? 'text-right tabular-nums' : ''} ${
                            (yellow && (l[c.key] === null || l[c.key] === '')) || (c.key === 'hsn' && (!l.hsn || l.hsnSource === 'MASTER')) ? 'border-amber-400 bg-amber-100' : 'border-slate-200'
                          }`}
                          defaultValue={s(l[c.key] as number | string | null)}
                          onBlur={(e) => e.target.value !== s(l[c.key] as number | string | null) && set(i, c.key, e.target.value)}
                        />
                        {c.key === 'hsn' && l.hsnSource === 'MASTER' && <span className="block text-[10px] font-bold text-amber-800">item master</span>}
                      </>
                    )}
                  </td>
                ))}
                <td className="px-2 py-1 text-right tabular-nums" title={l.quotedItemName ?? undefined}>
                  {l.quotedRate !== null && l.quotedRate !== undefined ? (
                    <>
                      {l.quotedRate}
                      {l.quotedUom ? ` /${l.quotedUom}` : ''}
                      {l.quotedWtKg ? <span className="block text-[10px] font-normal text-slate-500">{l.quotedWtKg} kg/{l.quotedWtPer ?? 'unit'}</span> : null}
                    </>
                  ) : offerItems > 0 && l.description.trim() ? (
                    <span className="text-[11px] font-bold text-rose-700">item not in offer</span>
                  ) : (
                    '–'
                  )}
                </td>
                <td
                  className={`px-2 py-1 text-right font-bold tabular-nums ${cmp ? (cmp.diffPct < -0.5 ? 'text-rose-700' : 'text-emerald-700') : 'text-slate-400'}`}
                  title={cmp ? `${cmp.basis}${cmp.poPerKg !== undefined ? `: PO ${cmp.poPerKg} vs quote ${cmp.quotedPerKg} Rs/kg` : ''}` : undefined}
                >
                  {cmp ? `${cmp.diffPct > 0 ? '+' : ''}${cmp.diffPct}%` : '–'}
                  {cmp && cmp.basis !== `per ${l.unit ?? 'unit'}` && <span className="block text-[10px] font-normal text-slate-500">{cmp.basis.startsWith('per kg') ? 'per kg' : cmp.basis}</span>}
                </td>
                {onChange && !readOnly && (
                  <td className="px-1 py-1">
                    <button type="button" aria-label={`Remove line ${i + 1}`} className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" onClick={() => onChange(lines.filter((_, j) => j !== i))}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {onChange && !readOnly && (
        <button
          type="button"
          className="m-2 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-blue-700 hover:bg-blue-50"
          onClick={() => onChange([...lines, { description: '', hsn: null, unit: null, qty: null, unitRate: null, lineValue: null, qtyVarPct: null, confidence: 'missing' }])}
        >
          <Plus className="h-3.5 w-3.5" /> Add line
        </button>
      )}
    </div>
  );
}

/** PDF / image preview of the attached documents, one tab per file. */
export function DocViewer({ docs, active, onActive, tall }: { docs: IntakeDoc[]; active: number; onActive: (i: number) => void; tall?: boolean }) {
  const d = docs[active];
  const viewable = d?.url && /\.(pdf|png|jpe?g|webp|gif|bmp)$/i.test(d.fileName);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1">
        {docs.map((x, i) => (
          <button
            key={x.id}
            type="button"
            onClick={() => onActive(i)}
            className={`max-w-[16rem] truncate rounded-full px-3 py-1 text-[11px] font-bold ${i === active ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            title={x.fileName}
          >
            {x.kind}: {x.fileName}
          </button>
        ))}
      </div>
      {d && d.url && SHEET_FILE.test(d.fileName) ? (
        <SheetPreviewView docId={d.id} url={d.url} tall={tall} />
      ) : d && viewable ? (
        /\.pdf$/i.test(d.fileName) ? (
          <iframe title={d.fileName} src={d.url as string} className={`w-full rounded-lg border border-slate-200 bg-slate-100 ${tall ? 'h-[80vh]' : 'h-[60vh]'}`} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt={d.fileName} src={d.url as string} className="max-h-[80vh] w-full rounded-lg border border-slate-200 object-contain" />
        )
      ) : d ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-6 text-center text-xs text-slate-600">
          No preview for {d.fileName}.{' '}
          {d.url && (
            <a className="font-bold text-blue-700 hover:underline" href={`${d.url}?download=1`}>
              Download
            </a>
          )}
        </p>
      ) : null}
    </div>
  );
}

const SHEET_FILE = /\.(xlsx|xlsm|xls|csv)$/i;
type Sheets = { fileName: string; sheets: { name: string; rows: string[][]; totalRows: number; totalCols: number }[] };

/** Excel / CSV attachment (BOM) shown as a table, one tab per sheet, so it can be checked before Confirm. */
function SheetPreviewView({ docId, url, tall }: { docId: number; url: string; tall?: boolean }) {
  const [data, setData] = useState<{ id: number; sheets: Sheets } | null>(null);
  const [err, setErr] = useState<{ id: number; msg: string } | null>(null);
  const [tab, setTab] = useState(0);
  useEffect(() => {
    let live = true;
    void sheetPreviewAction(docId).then((r) => {
      if (!live) return;
      if (r.success) {
        setData({ id: docId, sheets: r.data });
        setTab(0);
      } else setErr({ id: docId, msg: r.error });
    });
    return () => {
      live = false;
    };
  }, [docId]);
  const download = (
    <a className="font-bold text-blue-700 hover:underline" href={`${url}?download=1`}>
      Download
    </a>
  );
  if (err?.id === docId) return <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-4 text-center text-xs text-rose-800">Preview failed: {err.msg} {download}</p>;
  if (!data || data.id !== docId)
    return (
      <p className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-6 text-xs text-slate-600">
        <Loader2 className="h-4 w-4 animate-spin" /> Opening the sheet…
      </p>
    );
  const sh = data.sheets.sheets[tab] ?? data.sheets.sheets[0];
  if (!sh) return <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-6 text-center text-xs text-slate-600">The workbook has no sheets. {download}</p>;
  const cols = Math.min(sh.totalCols, 40);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1 text-[11px]">
        {data.sheets.sheets.map((x, i) => (
          <button key={x.name} type="button" onClick={() => setTab(i)} className={`rounded px-2 py-0.5 font-bold ${i === tab ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            {x.name}
          </button>
        ))}
        <span className="ml-auto text-slate-500">
          {sh.totalRows} rows{sh.totalRows > sh.rows.length ? ` (first ${sh.rows.length} shown)` : ''} · {download}
        </span>
      </div>
      <div className={`overflow-auto rounded-lg border border-slate-200 bg-white ${tall ? 'h-[76vh]' : 'h-[56vh]'}`}>
        <table className="min-w-full border-collapse text-[11px]">
          <thead className="sticky top-0 bg-slate-100 text-slate-500">
            <tr>
              <th className="border border-slate-200 px-1.5 py-0.5" />
              {Array.from({ length: cols }, (_, c) => (
                <th key={c} className="border border-slate-200 px-1.5 py-0.5 font-bold">{XLSX_COL(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sh.rows.map((r, i) => (
              <tr key={i}>
                <td className="border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-right text-slate-400">{i + 1}</td>
                {Array.from({ length: cols }, (_, c) => (
                  <td key={c} className="max-w-[14rem] truncate border border-slate-200 px-1.5 py-0.5" title={r[c] || undefined}>
                    {r[c] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** 0 -> A, 25 -> Z, 26 -> AA. */
const XLSX_COL = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : XLSX_COL(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));
