import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { BLANK, type ColumnKind, type TableQuery, type TableSort } from '@/components/data-table/types';

// Generic server-side table: one filtered/sorted page in SQL plus facets, ported from GMD's
// packages/physical-stock/src/server/query.ts. Each screen describes its SQL source and how
// each field reads; paging, filtering, search, sorting and facets are shared here.

const sql = Prisma.sql;
export const MAX_PAGE_SIZE = 200;
const FACET_LIMIT = 500;

export interface FieldSql {
  /** Display/filter/facet text. */
  text: Prisma.Sql;
  /** Value used for date and number sorting/filters (defaults to text). */
  raw?: Prisma.Sql;
  kind: ColumnKind;
  sortable?: boolean;
  /** Included in the global search box. Default true. */
  searchable?: boolean;
}

export interface TableSpec {
  /** FROM clause including joins, e.g. sql`orders o LEFT JOIN ...`. */
  from: Prisma.Sql;
  fields: Record<string, FieldSql>;
  /** Stable order appended after the user's sort. */
  fallbackOrder: Prisma.Sql;
  /** Always-on predicate (e.g. one order's rows). */
  scope?: Prisma.Sql;
}

/** Numeric value of a text cell ("1,000" -> 1000); NULL when not a number. */
export const num = (e: Prisma.Sql) =>
  sql`(CASE WHEN replace(btrim(coalesce((${e})::text, '')), ',', '') ~ '^-?[0-9]+([.][0-9]+)?$' THEN replace(btrim((${e})::text), ',', '')::numeric END)`;
export const text = (e: Prisma.Sql) => sql`btrim(coalesce((${e})::text, ''))`;

const escapeLike = (v: string) => v.replace(/([\\%_])/g, '\\$1');
const squish = (v: string) => v.replace(/\s+/g, '');

/** WHERE for `query`; `skip` drops one field's own filter so facet lists cascade. `extra` adds screen predicates. */
export function buildWhere(spec: TableSpec, query: TableQuery, skip?: string, extra: Prisma.Sql[] = []): Prisma.Sql {
  const parts: Prisma.Sql[] = spec.scope ? [spec.scope] : [];
  for (const [key, values] of Object.entries(query.filters ?? {})) {
    const f = spec.fields[key];
    if (key === skip || !f || !values?.length) continue;
    const t = text(f.text);
    parts.push(sql`(${Prisma.join(values.map((v) => (v === BLANK ? sql`${t} = ''` : sql`${t} = ${v}`)), ' OR ')})`);
  }
  for (const [key, value] of Object.entries(query.columnSearch ?? {})) {
    const f = spec.fields[key];
    if (key === skip || !f || !value.trim()) continue;
    parts.push(sql`regexp_replace(${text(f.text)}, '\s', '', 'g') ILIKE ${`%${escapeLike(squish(value))}%`}`);
  }
  for (const [key, range] of Object.entries(query.dateRanges ?? {})) {
    const f = spec.fields[key];
    if (key === skip || !f || f.kind !== 'date') continue;
    const raw = f.raw ?? f.text;
    if (/^\d{4}-\d{2}-\d{2}$/.test(range.from)) parts.push(sql`${raw} >= ${range.from}::date`);
    if (/^\d{4}-\d{2}-\d{2}$/.test(range.to)) parts.push(sql`${raw} < (${range.to}::date + interval '1 day')`);
  }
  const search = (query.search ?? '').trim();
  const searchable = Object.values(spec.fields).filter((f) => f.searchable !== false);
  if (search && searchable.length) {
    const all = Prisma.join(searchable.map((f) => text(f.text)), " || ' ' || ");
    parts.push(sql`regexp_replace(${all}, '\s', '', 'g') ILIKE ${`%${escapeLike(squish(search))}%`}`);
  }
  parts.push(...extra);
  return parts.length ? Prisma.join(parts, ' AND ') : sql`TRUE`;
}

export function buildOrderBy(spec: TableSpec, sort: TableSort | null): Prisma.Sql {
  const f = sort ? spec.fields[sort.key] : undefined;
  if (!sort || !f || f.sortable === false) return spec.fallbackOrder;
  const dir = Prisma.raw(sort.dir === 'asc' ? 'ASC' : 'DESC');
  if (f.kind === 'date' || f.kind === 'boolean') return sql`${f.raw ?? f.text} ${dir} NULLS LAST, ${spec.fallbackOrder}`;
  if (f.kind === 'number') return sql`${f.raw ?? num(f.text)} ${dir} NULLS LAST, ${spec.fallbackOrder}`;
  const nulls = Prisma.raw(sort.dir === 'asc' ? 'NULLS LAST' : 'NULLS FIRST');
  return sql`NULLIF(lower(${text(f.text)}), '') ${dir} ${nulls}, ${spec.fallbackOrder}`;
}

export function pageBounds(query: TableQuery) {
  const pageSize = Math.min(Math.max(1, Math.floor(Number(query.pageSize) || 25)), MAX_PAGE_SIZE);
  const offset = Math.max(0, Math.floor(Number(query.page) || 1) - 1) * pageSize;
  return { pageSize, offset };
}

/** SELECT list of every field as "key". */
export function selectFields(spec: TableSpec): Prisma.Sql {
  return Prisma.join(
    Object.entries(spec.fields).map(([k, f]) => sql`${f.kind === 'text' ? f.text : (f.raw ?? f.text)} AS ${Prisma.raw(`"${k}"`)}`),
    ', ',
  );
}

/**
 * Rows of one page plus aggregates over the whole filtered set.
 * `aggregates` is a SELECT list (e.g. sql`count(*)::int AS total, sum(x)::float AS wt`); it must include `total`.
 */
export async function fetchPage<Row, Agg extends { total: number }>(
  spec: TableSpec,
  query: TableQuery,
  aggregates: Prisma.Sql,
  extra: Prisma.Sql[] = [],
): Promise<{ rows: Row[]; agg: Agg }> {
  const { pageSize, offset } = pageBounds(query);
  const where = buildWhere(spec, query, undefined, extra);
  const [rows, aggRows] = await Promise.all([
    prisma.$queryRaw<Row[]>(sql`SELECT ${selectFields(spec)} FROM ${spec.from} WHERE ${where}
      ORDER BY ${buildOrderBy(spec, query.sort)} LIMIT ${pageSize} OFFSET ${offset}`),
    prisma.$queryRaw<Agg[]>(sql`SELECT ${aggregates} FROM ${spec.from} WHERE ${where}`),
  ]);
  return { rows, agg: aggRows[0] };
}

/** Distinct values of `key` under every other active filter; empty cells come first as BLANK. */
export async function fetchFacet(spec: TableSpec, key: string, query: TableQuery, extra: Prisma.Sql[] = []): Promise<string[]> {
  const f = spec.fields[key];
  if (!f) return [];
  const rows = await prisma.$queryRaw<{ v: string }[]>(sql`SELECT DISTINCT ${text(f.text)} AS v
    FROM ${spec.from} WHERE ${buildWhere(spec, query, key, extra)} ORDER BY 1 LIMIT ${FACET_LIMIT}`);
  const values = rows.map((r) => r.v);
  return values.includes('') ? [BLANK, ...values.filter(Boolean)] : values;
}

/** Coerce Prisma raw results (Decimal, bigint, Date) to plain JSON-safe values for the client. */
export function plain<T>(rows: T[]): T[] {
  return rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r as Record<string, unknown>)) {
      if (v instanceof Date) out[k] = v.toISOString();
      else if (typeof v === 'bigint') out[k] = Number(v);
      else if (v && typeof v === 'object' && 'toNumber' in v && typeof (v as { toNumber: unknown }).toNumber === 'function') {
        out[k] = (v as { toNumber: () => number }).toNumber();
      } else out[k] = v;
    }
    return out as T;
  });
}
