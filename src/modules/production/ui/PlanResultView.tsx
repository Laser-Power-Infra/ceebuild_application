'use client';

import { Fragment, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { Kpi, fmtNum } from '@/components/ServerTable';
import { OPERATION_LABELS, type MachinePlanResult } from '@/lib/planning/machines';

/** Load per operation as bars (bottleneck highlighted) with a per-machine breakdown on click. */
export function PlanResultView({ plan, workDaysPerWeek }: { plan: MachinePlanResult; workDaysPerWeek: number }) {
  const [open, setOpen] = useState<string | null>(null);
  const maxDays = Math.max(1, ...plan.operations.map((o) => o.days ?? 0));
  const blocked = plan.operations.some((o) => o.noMachine);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <Kpi label="Working days (bottleneck)" value={plan.totalDays === null ? 'Blocked' : fmtNum(plan.totalDays, 1)} tone={plan.totalDays === null ? 'red' : undefined} />
        <Kpi label={`Weeks (${workDaysPerWeek}-day week)`} value={plan.weeks === null ? '–' : fmtNum(plan.weeks, 1)} />
        <Kpi
          label="Bottleneck"
          value={plan.bottleneck ? OPERATION_LABELS[plan.bottleneck.operation] : '–'}
          tone={plan.bottleneck ? (plan.bottleneck.days === null ? 'red' : 'amber') : undefined}
        />
        <Kpi label="Pieces planned" value={fmtNum(plan.totalPieces, 0)} />
      </div>

      {plan.unconfirmedRates && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Some machine rates are placeholders, not plant-confirmed, so days are indicative. Confirm them on{' '}
            <a href="/admin/machines" className="font-semibold underline">Machines</a>.
          </span>
        </div>
      )}
      {blocked && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>An operation has work but no active machine (or zero shifts). Activate or add a machine for it on <a href="/admin/machines" className="font-semibold underline">Machines</a>.</span>
        </div>
      )}

      {plan.operations.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">No machine load on this basis.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
              <tr>
                <th className="px-4 py-2">Operation</th>
                <th className="px-4 py-2 text-right">Pieces</th>
                <th className="px-4 py-2 text-right">Load</th>
                <th className="px-4 py-2 text-right">Capacity / day</th>
                <th className="px-4 py-2 text-right">Days</th>
                <th className="w-[35%] px-4 py-2">Load vs bottleneck</th>
              </tr>
            </thead>
            <tbody>
              {plan.operations.map((o) => {
                const isBottleneck = plan.bottleneck?.operation === o.operation;
                const pct = o.days === null ? 100 : Math.max(2, (o.days / maxDays) * 100);
                const expanded = open === o.operation;
                return (
                  <Fragment key={o.operation}>
                    <tr className={`border-t border-slate-100 ${isBottleneck ? 'bg-amber-50/60' : ''}`}>
                      <td className="px-4 py-2">
                        <button type="button" className="inline-flex items-center gap-1 font-semibold text-slate-800" onClick={() => setOpen(expanded ? null : o.operation)} aria-expanded={expanded}>
                          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          {OPERATION_LABELS[o.operation]}
                          {isBottleneck && <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800">Bottleneck</span>}
                        </button>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtNum(o.pieces, 0)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtNum(o.load, 0)} {o.unit}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{o.noMachine ? '–' : fmtNum(o.capacityPerDay, 0)}</td>
                      <td className={`px-4 py-2 text-right font-semibold tabular-nums ${o.noMachine ? 'text-rose-700' : ''}`}>{o.days === null ? 'No machine' : fmtNum(o.days, 1)}</td>
                      <td className="px-4 py-2">
                        <div className="h-2.5 w-full rounded-full bg-slate-100">
                          <div className={`h-2.5 rounded-full ${o.noMachine ? 'bg-rose-500' : isBottleneck ? 'bg-amber-500' : 'bg-blue-500'}`} style={{ width: `${pct}%` }} />
                        </div>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-t border-slate-100 bg-slate-50/60">
                        <td colSpan={6} className="px-4 py-3">
                          <div className="grid gap-4 lg:grid-cols-2">
                            <table className="text-xs">
                              <thead className="text-left text-slate-500">
                                <tr>
                                  <th className="py-1 pr-3 font-semibold">Machine</th>
                                  <th className="py-1 pr-3 text-right font-semibold">Capacity / day</th>
                                  <th className="py-1 pr-3 text-right font-semibold">Share</th>
                                  <th className="py-1 pr-3 text-right font-semibold">Load</th>
                                  <th className="py-1 text-right font-semibold">Days</th>
                                </tr>
                              </thead>
                              <tbody>
                                {o.machines.length === 0 && (
                                  <tr>
                                    <td colSpan={5} className="py-1 text-rose-700">No active machine for this operation.</td>
                                  </tr>
                                )}
                                {o.machines.map((m) => (
                                  <tr key={m.id}>
                                    <td className="py-1 pr-3">
                                      {m.code} {!m.rateConfirmed && <span className="text-amber-700" title="Rate not confirmed">*</span>}
                                    </td>
                                    <td className="py-1 pr-3 text-right tabular-nums">{fmtNum(m.capacityPerDay, 0)}</td>
                                    <td className="py-1 pr-3 text-right tabular-nums">{fmtNum(m.sharePct, 1)}%</td>
                                    <td className="py-1 pr-3 text-right tabular-nums">{fmtNum(m.load, 0)}</td>
                                    <td className="py-1 text-right tabular-nums">{fmtNum(m.days, 1)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            <table className="text-xs">
                              <thead className="text-left text-slate-500">
                                <tr>
                                  <th className="py-1 pr-3 font-semibold">Mark</th>
                                  <th className="py-1 pr-3 text-right font-semibold">Pieces</th>
                                  <th className="py-1 text-right font-semibold">{o.unit}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {o.marks.slice(0, 50).map((m) => (
                                  <tr key={m.markNo}>
                                    <td className="py-1 pr-3">{m.markNo}</td>
                                    <td className="py-1 pr-3 text-right tabular-nums">{fmtNum(m.pieces, 0)}</td>
                                    <td className="py-1 text-right tabular-nums">{fmtNum(m.units, 0)}</td>
                                  </tr>
                                ))}
                                {o.marks.length > 50 && (
                                  <tr>
                                    <td colSpan={3} className="py-1 text-slate-500">…and {o.marks.length - 50} more marks</td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
