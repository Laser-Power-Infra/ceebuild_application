/** Client-safe types of the Control Tower (src/modules/overview). */

export type FlagSeverity = 'high' | 'medium' | 'low';

export interface OrderFlag {
  orderId: number;
  poNumber: string;
  client: string | null;
  /** Stable code, e.g. GALV_PENDING (see server/flags.ts). */
  code: string;
  severity: FlagSeverity;
  title: string;
  detail: string;
  /** Date the item became overdue (yyyy-mm-dd). */
  since: string | null;
  /** Days overdue (0 when not yet overdue, e.g. a security expiring soon). */
  days: number | null;
  /** Order page tab that fixes it. */
  tab: string;
}

/** Weight (kg) and money (Rs) pipeline of one order or a set of orders. */
export interface Pipeline {
  orderedKg: number;
  cutKg: number;
  galvanisedKg: number;
  inspectedKg: number;
  dispatchedKg: number;
  contractValue: number | null;
  billedRs: number;
  collectedRs: number;
  retentionRs: number;
  outstandingRs: number;
}

export interface OverviewRow {
  id: number;
  poNumber: string;
  poDate: string | null;
  client: string | null;
  docketNo: string | null;
  status: string;
  daysSincePo: number | null;
  deliveryDue: string | null;
  daysLate: number | null;
  orderedMt: number | null;
  cutMt: number | null;
  galvanisedMt: number | null;
  inspectedMt: number | null;
  dispatchedMt: number | null;
  billedRs: number | null;
  collectedRs: number | null;
  outstandingRs: number | null;
  flags: number | null;
  highFlags: number | null;
  /** Filled in after the SQL page from orderBottlenecks (not sortable). */
  bottleneck: string | null;
  bottleneckDays: number | null;
}

export interface OverviewMeta {
  orderedMt: number;
  dispatchedMt: number;
  outstandingRs: number;
}

export interface OverviewStats {
  openOrders: number;
  pipelineMt: number;
  dispatchedThisMonthMt: number;
  billedRs: number;
  collectedRs: number;
  outstandingRs: number;
  overdueRs: number;
  flags: number;
  highFlags: number;
  /** Orders per status, every status in ORDER_STATUSES order (0 included). */
  funnel: { status: string; orders: number; mt: number }[];
}

export interface OrderSummary {
  pipeline: Pipeline;
  flags: OrderFlag[];
  bottleneck: { operation: string; days: number; totalDays: number } | null;
}

export interface AgeingBucket {
  bucket: string;
  invoices: number;
  amount: number;
}
