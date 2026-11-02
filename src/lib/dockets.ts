/** Shared docket constants/helpers (safe for client and server). */

export const DOCKET_TYPES = ['Tender', 'Purchase'] as const;
export type DocketType = (typeof DOCKET_TYPES)[number];

export function isDocketType(value: unknown): value is DocketType {
  return typeof value === 'string' && (DOCKET_TYPES as readonly string[]).includes(value);
}

/** Canonical form used to match items to dockets (items are linked by docket number text, not FK). */
export function normalizeDocketNo(value: string | null | undefined): string {
  return (value || '').trim().toUpperCase();
}
