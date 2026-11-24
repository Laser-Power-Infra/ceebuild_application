// M15 - fill what the PO leaves to "us" before review: HSN from the item master, GST % from the HSN
// ("extra at actual" -> 18 % as per law) with GST amount and total worked out, and a proposed delivery
// date (PO date + standard lead time) when the PO gives none. Everything filled here stays yellow
// (low confidence) with a note, so the reviewer accepts or changes it. Pure (tests/po.test.ts).

import { addDays } from './checks';
import type { PoExtraction, PoFieldValue } from './fields';
import { gstPctFor, hsnFor } from './hsn';
import { parseDate, parseMoney } from './normalise';

const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const fmt = (ymd: string) => `${ymd.slice(8, 10)}-${ymd.slice(5, 7)}-${ymd.slice(0, 4)}`;

export interface Enriched {
  extraction: PoExtraction;
  /** Suggested delivery date (yyyy-mm-dd) when the PO has none; the field itself stays empty and yellow. */
  proposedCompletion: { date: string; reason: string } | null;
}

export function enrichExtraction(ex: PoExtraction, opts: { leadTimeDays: number }): Enriched {
  const fields = { ...ex.fields };
  // 1. HSN per line: printed on the PO wins; else the item master.
  const lines = ex.lines.map((l) => {
    if (l.hsn) return { ...l, hsnSource: l.hsnSource ?? ('PO' as const) };
    const m = hsnFor(l.description);
    return m ? { ...l, hsn: m.hsn, hsnSource: 'MASTER' as const } : { ...l, hsnSource: null };
  });

  // 2. GST % from the HSN when the PO prints no rate ("extra at actual / as applicable").
  const basic = parseMoney(fields.basicValue?.value) ?? (lines.length && lines.every((l) => l.lineValue !== null) ? lines.reduce((s, l) => s + (l.lineValue ?? 0), 0) : null);
  if (!fields.gstPct?.value) {
    const rates = [...new Set(lines.map((l) => gstPctFor(l.hsn)).filter((r): r is number => r !== null))];
    const pct = rates.length === 1 ? rates[0] : rates.length === 0 ? 18 : null;
    if (pct !== null) {
      const printed = fields.gstPct?.note ? ` (PO: ${fields.gstPct.note})` : '';
      fields.gstPct = { value: String(pct), confidence: 'low', note: `GST ${pct}% as per law – default from the HSN${printed}` };
      if (!fields.gstAmount?.value && basic !== null) {
        fields.gstAmount = { value: money((basic * pct) / 100), confidence: 'low', note: `calculated: basic x ${pct}% (as per law)` };
      }
    } else {
      fields.gstPct = { ...(fields.gstPct as PoFieldValue), confidence: 'missing', note: `lines have different GST rates (${rates.join(' / ')}%) – enter the GST` };
    }
  }
  const gst = parseMoney(fields.gstAmount?.value);
  if (!fields.totalValue?.value && basic !== null && gst !== null) {
    fields.totalValue = { value: money(basic + gst), confidence: 'low', note: 'calculated: basic + GST (no freight / other charges added)' };
  }

  // 3. Delivery date: propose PO date + standard lead time; the field stays empty (yellow) until accepted.
  let proposedCompletion: Enriched['proposedCompletion'] = null;
  const poDate = parseDate(fields.poDate?.value);
  if (!fields.completionDate?.value && poDate) {
    const date = addDays(poDate, opts.leadTimeDays);
    proposedCompletion = { date, reason: `PO date ${fmt(poDate)} + standard lead time ${opts.leadTimeDays} days` };
  }

  return { extraction: { ...ex, fields, lines }, proposedCompletion };
}
