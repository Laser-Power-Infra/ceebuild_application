import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getPlanSettings, type PlanSettingsValues } from '@/modules/settings/server';
import type { FlagSeverity, OrderFlag } from '../types';

const sql = Prisma.sql;

/** An issued RM indent with nothing received after this many days is flagged (not in plan_settings yet). */
export const INDENT_RECEIPT_ALERT_DAYS = 15;
/** PBG / LC / security expiring within this many days is flagged. */
export const SECURITY_EXPIRY_ALERT_DAYS = 30;

const LATEST_UPLOAD = sql`(SELECT max(u.id) FROM bom_uploads u WHERE u.order_id = o.id)`;

/**
 * Every red flag as rows (order_id, code, severity, title, detail, since, tab). One definition used
 * by the Control Tower, the order summary tab and the alerts API, so they always agree.
 * Thresholds come from plan_settings.
 */
export function flagsSql(cfg: PlanSettingsValues): Prisma.Sql {
  const bomDays = cfg.bomDueDays;
  const galvDays = cfg.galvAlertDays;
  const diDays = cfg.diAlertDays;
  return sql`
  -- 1. No BOM uploaded N days after the PO.
  SELECT o.id AS order_id, 'BOM_MISSING' AS code, 'high' AS severity,
         'BOM not uploaded' AS title,
         'PO dated ' || to_char(o.po_date, 'DD-Mon-YYYY') || '; no client BOM uploaded yet.' AS detail,
         (o.po_date + ${bomDays}::int) AS since, 'bom' AS tab
  FROM orders o
  WHERE NOT EXISTS (SELECT 1 FROM bom_uploads u WHERE u.order_id = o.id)
    AND CURRENT_DATE - o.po_date > ${bomDays}::int

  UNION ALL
  -- 2. BOM uploaded but not confirmed correct after N days.
  SELECT o.id, 'BOM_NOT_CORRECT', 'medium', 'BOM not confirmed',
         'Latest BOM (' || u.file_name || ') uploaded ' || to_char(u.created_at, 'DD-Mon-YYYY') || ' is still a draft.',
         (u.created_at::date + ${bomDays}::int), 'bom'
  FROM orders o JOIN bom_uploads u ON u.id = ${LATEST_UPLOAD}
  WHERE u.status <> 'CORRECT' AND CURRENT_DATE - u.created_at::date > ${bomDays}::int

  UNION ALL
  -- 3. Pieces at the galvaniser too long. Per mark, FIFO: the oldest OUT not yet covered by INs.
  SELECT x.order_id, 'GALV_PENDING', CASE WHEN CURRENT_DATE - min(x.oldest) > 2 * ${galvDays}::int THEN 'high' ELSE 'medium' END,
         'Galvanising overdue',
         sum(x.pending)::int || ' pieces of ' || count(*) || ' mark(s) out since ' || to_char(min(x.oldest), 'DD-Mon-YYYY') || ' not back',
         (min(x.oldest) + ${galvDays}::int), 'galv'
  FROM (
    SELECT m.order_id, m.mark, m.out_total - m.in_total AS pending,
           (SELECT min(r.challan_date) FROM (
              SELECT c.challan_date, sum(l.pieces) OVER (ORDER BY c.challan_date, c.id ROWS UNBOUNDED PRECEDING) AS run
              FROM galv_challans c JOIN galv_challan_lines l ON l.challan_id = c.id
              WHERE c.order_id = m.order_id AND c.direction = 'OUT' AND upper(l.mark_no) = m.mark) r
            WHERE r.run > m.in_total) AS oldest
    FROM (
      SELECT c.order_id, upper(l.mark_no) AS mark,
             coalesce(sum(l.pieces) FILTER (WHERE c.direction = 'OUT'), 0) AS out_total,
             coalesce(sum(l.pieces) FILTER (WHERE c.direction = 'IN'), 0) AS in_total
      FROM galv_challans c JOIN galv_challan_lines l ON l.challan_id = c.id
      GROUP BY 1, 2
    ) m WHERE m.out_total > m.in_total
  ) x
  WHERE CURRENT_DATE - x.oldest > ${galvDays}::int
  GROUP BY x.order_id

  UNION ALL
  -- 4. Inspection / MC done but no DI from the client.
  SELECT o.id, 'NO_DI_AFTER_MC', 'medium', 'MC received, no DI',
         'First inspection/MC ' || to_char(min(i.inspection_date), 'DD-Mon-YYYY') || '; no dispatch instruction yet.',
         (min(i.inspection_date) + ${diDays}::int), 'di'
  FROM orders o JOIN inspections i ON i.order_id = o.id
  WHERE NOT EXISTS (SELECT 1 FROM dispatch_instructions x WHERE x.order_id = o.id)
  GROUP BY o.id
  HAVING CURRENT_DATE - min(i.inspection_date) > ${diDays}::int

  UNION ALL
  -- 5. DI issued but nothing dispatched against it.
  SELECT x.order_id, 'DI_NOT_DISPATCHED', 'high', 'DI not dispatched',
         'DI ' || x.di_no || ' dated ' || to_char(x.di_date, 'DD-Mon-YYYY') || ' has no dispatch against it.',
         (x.di_date + ${diDays}::int), 'dispatch'
  FROM dispatch_instructions x
  WHERE NOT EXISTS (SELECT 1 FROM dispatches d WHERE d.di_id = x.id)
    AND CURRENT_DATE - x.di_date > ${diDays}::int

  UNION ALL
  -- 6. Contractual delivery date passed, BOM weight not fully dispatched.
  SELECT o.id, 'DELIVERY_LATE', 'high', 'Delivery overdue',
         'Delivery was due ' || to_char(o.delivery_due, 'DD-Mon-YYYY') || '; ' ||
           CASE WHEN coalesce(bw.wt, 0) = 0 THEN 'no BOM weight yet, ' || round(coalesce(dw.wt, 0) / 1000, 2) || ' MT dispatched.'
                ELSE round(coalesce(dw.wt, 0) / 1000, 2) || ' of ' || round(bw.wt / 1000, 2) || ' MT dispatched.' END,
         o.delivery_due, 'dispatch'
  FROM orders o
  LEFT JOIN LATERAL (SELECT sum(p.total_wt_kg) AS wt FROM bom_pieces p WHERE p.upload_id = ${LATEST_UPLOAD}) bw ON TRUE
  LEFT JOIN LATERAL (SELECT sum(d.wt_kg) AS wt FROM dispatches d WHERE d.order_id = o.id) dw ON TRUE
  WHERE o.delivery_due < CURRENT_DATE AND (coalesce(bw.wt, 0) = 0 OR coalesce(dw.wt, 0) < bw.wt)

  UNION ALL
  -- 7. Invoice past its due date with money outstanding (retention excluded).
  SELECT iv.order_id, 'INVOICE_OVERDUE', CASE WHEN CURRENT_DATE - iv.due_date > 30 THEN 'high' ELSE 'medium' END,
         'Payment overdue',
         'Invoice ' || iv.invoice_no || ': Rs ' || to_char(iv.total_amount - ic.amt - ic.ret, 'FM99,99,99,99,990') ||
           ' outstanding, due ' || to_char(iv.due_date, 'DD-Mon-YYYY') || '.',
         iv.due_date, 'billing'
  FROM invoices iv
  LEFT JOIN LATERAL (SELECT coalesce(sum(c.amount), 0) AS amt, coalesce(sum(c.retention), 0) AS ret
                     FROM collections c WHERE c.invoice_id = iv.id) ic ON TRUE
  WHERE iv.due_date < CURRENT_DATE AND iv.total_amount - ic.amt - ic.ret > 0.5

  UNION ALL
  -- 8. PBG / LC / security expiring soon, or expired while still active.
  SELECT sc.order_id, 'SECURITY_EXPIRY', CASE WHEN sc.expiry_date < CURRENT_DATE THEN 'high' ELSE 'medium' END,
         CASE WHEN sc.expiry_date < CURRENT_DATE THEN sc.kind || ' expired' ELSE sc.kind || ' expiring' END,
         sc.kind || coalesce(' ' || sc.ref_no, '') || ' (Rs ' || to_char(sc.amount, 'FM99,99,99,99,990') || ') ' ||
           CASE WHEN sc.expiry_date < CURRENT_DATE THEN 'expired ' ELSE 'expires ' END || to_char(sc.expiry_date, 'DD-Mon-YYYY') || '.',
         sc.expiry_date, 'billing'
  FROM order_securities sc
  WHERE sc.status = 'ACTIVE' AND sc.expiry_date IS NOT NULL
    AND sc.expiry_date <= CURRENT_DATE + ${SECURITY_EXPIRY_ALERT_DAYS}::int

  UNION ALL
  -- 9. RM lot below ordered length, still accepted or debit note without a number.
  SELECT rr.order_id, 'RM_SHORT_OPEN', 'medium', 'Short RM lot not settled',
         count(*) || ' short lot(s) on GRN ' || string_agg(DISTINCT rr.receipt_no, ', ') || ' need reject / debit note.',
         min(rr.receipt_date), 'receipt'
  FROM rm_receipts rr JOIN rm_receipt_lots rl ON rl.receipt_id = rr.id
  WHERE rl.length_status = 'SHORT'
    AND (rl.decision = 'ACCEPTED' OR (rl.decision = 'DEBIT_NOTE' AND coalesce(rl.debit_note_no, '') = ''))
  GROUP BY rr.order_id

  UNION ALL
  -- 10. Issued RM indent, nothing received since.
  SELECT ri.order_id, 'INDENT_NO_RECEIPT', 'medium', 'RM not received',
         'Indent ' || ri.indent_no || ' issued ' || to_char(ri.issued_at, 'DD-Mon-YYYY') || '; no RM received against it.',
         (ri.issued_at::date + ${INDENT_RECEIPT_ALERT_DAYS}::int), 'receipt'
  FROM rm_indents ri
  WHERE ri.status = 'ISSUED' AND ri.issued_at IS NOT NULL
    AND CURRENT_DATE - ri.issued_at::date > ${INDENT_RECEIPT_ALERT_DAYS}::int
    AND NOT EXISTS (SELECT 1 FROM rm_receipts rr WHERE rr.indent_id = ri.id
                    OR (rr.order_id = ri.order_id AND rr.receipt_date >= ri.issued_at::date))
  `;
}

/** Flag count per order, joinable as `fc` (order_id, n, high). */
export function flagCountsSql(cfg: PlanSettingsValues): Prisma.Sql {
  return sql`(SELECT f.order_id, count(*)::int AS n, count(*) FILTER (WHERE f.severity = 'high')::int AS high
    FROM (${flagsSql(cfg)}) f JOIN orders co ON co.id = f.order_id AND co.cancel_status IS NULL GROUP BY f.order_id)`;
}

const SEVERITY_RANK: Record<FlagSeverity, number> = { high: 0, medium: 1, low: 2 };

/** All flags (optionally for some orders), most severe and oldest first. */
export async function listFlags(orderIds?: number[]): Promise<OrderFlag[]> {
  const cfg = await getPlanSettings();
  // A cancelled / superseded order raises no flag (nor the daily alert).
  const where = orderIds?.length ? sql`WHERE o.cancel_status IS NULL AND f.order_id IN (${Prisma.join(orderIds)})` : sql`WHERE o.cancel_status IS NULL`;
  const rows = await prisma.$queryRaw<
    { orderId: number; poNumber: string; client: string | null; code: string; severity: FlagSeverity; title: string; detail: string; since: Date | null; tab: string; days: number | null }[]
  >(sql`SELECT f.order_id AS "orderId", o.po_number AS "poNumber", coalesce(nullif(o.client, ''), d.party_name) AS client,
      f.code, f.severity, f.title, f.detail, f.since, f.tab, (CURRENT_DATE - f.since)::int AS days
    FROM (${flagsSql(cfg)}) f JOIN orders o ON o.id = f.order_id JOIN "docket-party-name" d ON d.id = o.docket_id
    ${where}`);
  return rows
    .map((r) => ({ ...r, since: r.since ? r.since.toISOString().slice(0, 10) : null, days: r.days === null ? null : Math.max(0, r.days) }))
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || (a.since ?? '').localeCompare(b.since ?? '') || a.poNumber.localeCompare(b.poNumber));
}
