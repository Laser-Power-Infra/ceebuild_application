'use client';

import type { ReactNode } from 'react';
import { fmtNum } from '@/components/ServerTable';
import { describePattern, type BarPattern, type CutSettings, type PlanComparison } from '@/lib/planning/cutting';

export type Tone = 'slate' | 'green' | 'amber' | 'red' | 'blue';
const TONES: Record<Tone, string> = {
  slate: 'bg-slate-100 text-slate-700',
  green: 'bg-emerald-100 text-emerald-800',
  amber: 'bg-amber-100 text-amber-800',
  red: 'bg-rose-100 text-rose-800',
  blue: 'bg-blue-100 text-blue-800',
};

export function Badge({ tone = 'slate', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONES[tone]}`}>{children}</span>;
}

export function Card({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
          {title && <h3 className="text-sm font-semibold text-slate-900">{title}</h3>}
          <div className="flex-1" />
          {actions}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Plain read-only table for small result sets (patterns, comparison, lots). */
export function SimpleTable({ head, rows, empty = 'Nothing to show.', align }: { head: string[]; rows: ReactNode[][]; empty?: string; align?: ('left' | 'right')[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
            {head.map((h, i) => (
              <th key={h + i} className={`whitespace-nowrap px-3 py-2 font-semibold ${align?.[i] === 'right' ? 'text-right' : ''}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={head.length} className="px-3 py-6 text-center text-slate-500">
                {empty}
              </td>
            </tr>
          )}
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-slate-100 align-top last:border-0">
              {r.map((c, j) => (
                <td key={j} className={`px-3 py-2 ${align?.[j] === 'right' ? 'text-right tabular-nums' : ''}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Amber banner while the plant has not confirmed the planning settings. */
export function SettingsNote({ settings, confirmed, isAdmin }: { settings: CutSettings; confirmed: boolean; isAdmin?: boolean }) {
  return (
    <div className={`rounded-lg border px-3 py-2 text-xs ${confirmed ? 'border-slate-200 bg-slate-50 text-slate-600' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
      <span className="font-semibold">{confirmed ? 'Planning settings' : 'Plant to confirm:'}</span> standard bar {settings.stdBarMm} mm · max custom {settings.maxCustomMm} mm (per
      section where set) · end allowance {settings.endAllowanceMm} mm · kerf {settings.kerfMm} mm · tolerance +0/+{settings.tolPlusMm} mm · buffer {settings.bufferPct}% · custom length
      from {settings.customMinBars} bars · offcuts from {settings.minOffcutMm} mm.{' '}
      <a href="/admin/planning" className="font-semibold underline">
        {isAdmin ? 'Edit settings' : 'View settings'}
      </a>
    </div>
  );
}

const typeTone = (t: string): Tone => (t === 'CUSTOM' ? 'blue' : t === 'OVERLENGTH' ? 'red' : 'slate');
export const LINE_TYPE_LABEL: Record<string, string> = { CUSTOM: 'Custom length', STANDARD: '6 m standard', OVERLENGTH: 'Over-length', STOCK: 'Store stock' };

export function PatternTable({ patterns, source }: { patterns: (BarPattern & { source?: string })[]; source?: boolean }) {
  return (
    <SimpleTable
      head={['Section', 'Type', 'Bars', 'Cutting pattern', 'Offcut (mm)']}
      align={['left', 'left', 'right', 'left', 'right']}
      empty="No bars."
      rows={patterns.map((p) => [
        p.sectionLabel,
        <Badge key="t" tone={source ? (p.source === 'EXACT' ? 'green' : 'slate') : typeTone(p.lineType)}>
          {source ? (p.source === 'EXACT' ? 'Exact multiple' : 'Best fit') : LINE_TYPE_LABEL[p.lineType]}
        </Badge>,
        fmtNum(p.count, 0),
        <span key="d" className="font-mono text-xs text-slate-700">
          {describePattern(p)}
        </span>,
        fmtNum(p.offcutMm, 0),
      ])}
    />
  );
}

/** Mixed vs 6 m-only per section and in total. */
export function ComparisonTable({ comparison }: { comparison: PlanComparison }) {
  const std = new Map(comparison.standard.sections.map((s) => [s.sectionKey, s]));
  const rows = comparison.mixed.sections.map((m) => {
    const s = std.get(m.sectionKey);
    const save = (s?.wtKg ?? 0) - m.wtKg;
    return [
      m.sectionLabel,
      fmtNum(m.bars + m.bufferBars, 0),
      fmtNum(m.wtKg / 1000, 3),
      `${fmtNum(m.yieldPct, 1)}%`,
      fmtNum((s?.bars ?? 0) + (s?.bufferBars ?? 0), 0),
      fmtNum((s?.wtKg ?? 0) / 1000, 3),
      `${fmtNum(s?.yieldPct, 1)}%`,
      <span key="s" className={save > 0 ? 'font-semibold text-emerald-700' : 'text-slate-500'}>
        {fmtNum(save / 1000, 3)}
      </span>,
    ];
  });
  const m = comparison.mixed.totals;
  const s = comparison.standard.totals;
  rows.push([
    <strong key="t">Total</strong>,
    <strong key="a">{fmtNum(m.bars + m.bufferBars, 0)}</strong>,
    <strong key="b">{fmtNum(m.wtKg / 1000, 3)}</strong>,
    <strong key="c">{fmtNum(m.yieldPct, 1)}%</strong>,
    <strong key="d">{fmtNum(s.bars + s.bufferBars, 0)}</strong>,
    <strong key="e">{fmtNum(s.wtKg / 1000, 3)}</strong>,
    <strong key="f">{fmtNum(s.yieldPct, 1)}%</strong>,
    <strong key="g" className={comparison.savingKg > 0 ? 'text-emerald-700' : ''}>
      {fmtNum(comparison.savingKg / 1000, 3)}
    </strong>,
  ]);
  return (
    <SimpleTable
      head={['Section', 'Mixed bars', 'Mixed MT', 'Mixed yield', '6 m bars', '6 m MT', '6 m yield', 'Mixed saves (MT)']}
      align={['left', 'right', 'right', 'right', 'right', 'right', 'right', 'right']}
      rows={rows}
    />
  );
}

export function Notice({ tone, children }: { tone: 'red' | 'amber' | 'green'; children: ReactNode }) {
  const cls = tone === 'red' ? 'border-rose-200 bg-rose-50 text-rose-700' : tone === 'amber' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-800';
  return (
    <div role={tone === 'red' ? 'alert' : 'status'} className={`rounded-lg border px-3 py-2 text-xs font-medium ${cls}`}>
      {children}
    </div>
  );
}
