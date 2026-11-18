// Date-only filters from the UI (<input type="date"> => YYYY-MM-DD) are calendar days in India time.
const DAY_OFFSET = process.env.APP_TZ_OFFSET || '+05:30';
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function startOfDay(value: string): Date | null {
  const d = new Date(DATE_ONLY.test(value) ? `${value}T00:00:00${DAY_OFFSET}` : value);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Prisma `createdAt` filter for a start/end date taken from the UI.
 * A YYYY-MM-DD end date means "through the end of that day", so it becomes `lt` the start of the next day.
 * (new Date('2026-11-18') is midnight UTC at the START of the 18th, which used to drop the whole end day.)
 */
export function createdAtRange(startDate: string | null, endDate: string | null): { gte?: Date; lt?: Date; lte?: Date } | undefined {
  const range: { gte?: Date; lt?: Date; lte?: Date } = {};
  if (startDate) {
    const d = startOfDay(startDate);
    if (d) range.gte = d;
  }
  if (endDate) {
    const d = startOfDay(endDate);
    if (d && DATE_ONLY.test(endDate)) range.lt = new Date(d.getTime() + 24 * 60 * 60 * 1000);
    else if (d) range.lte = d;
  }
  return Object.keys(range).length ? range : undefined;
}
