// M14 fabrication drawings: drawing standards (Admin master `drawing_standards`) and the pure rules
// that read them. No I/O: shared by the renderer, the server and the tests. The defaults below are
// the seed of migration 20261125160000_m14_drawing_standards (a test keeps the two in step).

export const STANDARD_KINDS = ['HOLE', 'GAUGE', 'EDGE', 'WELD', 'FINISH', 'MATERIAL', 'TOLERANCE', 'MARKING'] as const;
export type StandardKind = (typeof STANDARD_KINDS)[number];

export const STANDARD_KIND_LABELS: Record<StandardKind, string> = {
  HOLE: 'Bolt holes',
  GAUGE: 'Gauge (back mark) by angle leg – IS SP:6',
  EDGE: 'Edge distance',
  WELD: 'Welds',
  FINISH: 'Finish notes',
  MATERIAL: 'Material / welding notes',
  TOLERANCE: 'Tolerances',
  MARKING: 'Marking',
};

export interface DrawingStandard {
  kind: StandardKind;
  key: string;
  /** Numeric value (mm, factor) or null for a text rule. */
  numValue: number | null;
  /** Text value (note printed on the drawing) or null. */
  textValue: string | null;
  unit: string | null;
  note: string | null;
}

const n = (kind: StandardKind, key: string, numValue: number, unit: string, note: string | null = null): DrawingStandard => ({ kind, key, numValue, textValue: null, unit, note });
const t = (kind: StandardKind, key: string, textValue: string, note: string | null = null): DrawingStandard => ({ kind, key, numValue: null, textValue, unit: null, note });

/** IS SP:6 back marks (gauge g from heel, single row) by angle leg, mm. */
export const SP6_GAUGES: [number, number][] = [
  [40, 22], [45, 25], [50, 28], [55, 30], [60, 35], [65, 35], [70, 40], [75, 40], [80, 45], [90, 50], [100, 55],
];

export const DEFAULT_STANDARDS: DrawingStandard[] = [
  n('HOLE', 'CLEARANCE', 1.5, 'mm', 'Hole dia = bolt dia + this (IS 800 normal clearance)'),
  t('HOLE', 'METHOD', 'PUNCHED', 'Holes punched, not gas-cut'),
  ...SP6_GAUGES.map(([leg, g]) => n('GAUGE', `LEG_${leg}`, g, 'mm', `Gauge from heel for a ${leg} mm leg (IS SP:6)`)),
  n('EDGE', 'FACTOR', 1.5, 'x hole dia', 'Minimum edge / end distance = factor x hole dia'),
  n('EDGE', 'FLAT_50', 25, 'mm', 'End distance used on 50 mm wide flats (centre line of the flat)'),
  n('WELD', 'MESH_TACK_LENGTH', 25, 'mm', 'Wire mesh tack weld length'),
  n('WELD', 'MESH_TACK_PITCH', 150, 'mm', 'Wire mesh tack weld pitch (c/c)'),
  n('WELD', 'STRIP_FILLET', 4, 'mm', 'Strip-to-rail fillet weld size, both sides'),
  t('FINISH', 'PAINT', 'Remove weld spatter, wire-brush / clean, 1 coat red-oxide primer + 2 coats enamel (shade as per approved drawing).'),
  t('FINISH', 'HDG', 'Hot-dip galvanised to IS 2629 after fabrication (no paint).'),
  t('FINISH', 'BLACK', 'Supplied black (no finish) unless the order says otherwise.'),
  t('MATERIAL', 'STEEL', 'Material IS 2062 E250A.'),
  t('MATERIAL', 'WELDING', 'Welding to IS 816 (E6013 electrodes).'),
  t('TOLERANCE', 'LENGTH', 'Tolerances as approved drawing; else up to 50 mm ±5%, 51-100 ±4%, 101-300 ±3%, above 300 ±2%.'),
  t('MARKING', 'ERECTION', 'Punch the erection mark on each member / assembly.'),
];

const key = (s: Pick<DrawingStandard, 'kind' | 'key'>) => `${s.kind}:${s.key}`;

/** Defaults overlaid with the master rows (master wins; unknown master rows are kept). */
export function mergeStandards(rows: DrawingStandard[]): DrawingStandard[] {
  const map = new Map(DEFAULT_STANDARDS.map((s) => [key(s), s]));
  for (const r of rows) map.set(key(r), r);
  return [...map.values()];
}

const find = (stds: DrawingStandard[], kind: StandardKind, k: string) => stds.find((s) => s.kind === kind && s.key === k) ?? null;
const num = (stds: DrawingStandard[], kind: StandardKind, k: string) => find(stds, kind, k)?.numValue ?? find(DEFAULT_STANDARDS, kind, k)?.numValue ?? null;
const text = (stds: DrawingStandard[], kind: StandardKind, k: string) => find(stds, kind, k)?.textValue ?? find(DEFAULT_STANDARDS, kind, k)?.textValue ?? null;

/** Bolt dia (mm) from "M10", "M16X40", "M10 bolt + nut" or a number; null if none. */
export function boltDia(v: string | number | null | undefined): number | null {
  if (typeof v === 'number') return v > 0 ? v : null;
  const m = String(v ?? '').toUpperCase().match(/\bM\s?(\d{1,2})\b|\bM(\d{1,2})X/);
  const d = m ? Number(m[1] ?? m[2]) : NaN;
  return Number.isFinite(d) && d > 0 ? d : null;
}

/** Hole dia for a bolt: bolt dia + clearance (1.5 by default), e.g. M10 -> 11.5. */
export function holeDia(bolt: string | number, stds: DrawingStandard[] = DEFAULT_STANDARDS): number | null {
  const d = boltDia(bolt);
  if (d === null) return null;
  const c = num(stds, 'HOLE', 'CLEARANCE') ?? 1.5;
  return Math.round((d + c) * 10) / 10;
}

/** IS SP:6 gauge from the heel for an angle leg (mm); null when the leg is not in the table. */
export function gaugeFor(legMm: number, stds: DrawingStandard[] = DEFAULT_STANDARDS): number | null {
  return num(stds, 'GAUGE', `LEG_${legMm}`);
}

/**
 * Minimum edge / end distance for a hole: factor (1.5) x hole dia, rounded up to 0.5 mm; on a
 * 50 mm wide flat the FLAT_50 rule (25 mm) is used when it is larger.
 */
export function minEdge(hole: number, flatWidthMm: number | null = null, stds: DrawingStandard[] = DEFAULT_STANDARDS): number {
  const f = num(stds, 'EDGE', 'FACTOR') ?? 1.5;
  const base = Math.ceil(f * hole * 2) / 2;
  const flat50 = flatWidthMm === 50 ? num(stds, 'EDGE', 'FLAT_50') : null;
  return flat50 !== null ? Math.max(base, flat50) : base;
}

/** Wire-mesh tack weld: length @ pitch c/c (25 @ 150 by default). */
export function meshTack(stds: DrawingStandard[] = DEFAULT_STANDARDS): { lengthMm: number; pitchMm: number; text: string } {
  const lengthMm = num(stds, 'WELD', 'MESH_TACK_LENGTH') ?? 25;
  const pitchMm = num(stds, 'WELD', 'MESH_TACK_PITCH') ?? 150;
  return { lengthMm, pitchMm, text: `tack weld ${lengthMm} mm long @ ${pitchMm} mm c/c` };
}

/** Finish note chosen from the BOM flags (galvanised wins over painted, as in costing). */
export function finishNote(bom: { galvanised: boolean; painted: boolean }, stds: DrawingStandard[] = DEFAULT_STANDARDS): string {
  if (bom.galvanised) return text(stds, 'FINISH', 'HDG') ?? '';
  if (bom.painted) return text(stds, 'FINISH', 'PAINT') ?? '';
  return text(stds, 'FINISH', 'BLACK') ?? '';
}

/** General notes (material, welding, tolerance, marking) in print order. */
export function generalNotes(stds: DrawingStandard[] = DEFAULT_STANDARDS): string[] {
  return [text(stds, 'MATERIAL', 'STEEL'), text(stds, 'MATERIAL', 'WELDING'), text(stds, 'TOLERANCE', 'LENGTH'), text(stds, 'MARKING', 'ERECTION')].filter((s): s is string => !!s);
}

export const holeMethod = (stds: DrawingStandard[] = DEFAULT_STANDARDS) => text(stds, 'HOLE', 'METHOD') ?? 'PUNCHED';

export type SectionShape = 'ANGLE' | 'FLAT' | 'CHANNEL' | 'ROUND' | 'PIPE' | 'OTHER';
export interface SectionGeom {
  shape: SectionShape;
  /** Angle leg A / flat width / channel depth / bar dia, mm. */
  a: number | null;
  /** Angle leg B / flat — / channel flange, mm. */
  b: number | null;
  /** Thickness, mm. */
  t: number | null;
}

/** Shape and size from a section text ("ISA 40x40x5", "FL 50x6", "ISMC 75X40", "RB 16"). */
export function sectionGeom(section: string | null | undefined): SectionGeom {
  const s = String(section ?? '').toUpperCase().replace(/[×*]/g, 'X').replace(/\s+/g, ' ').trim();
  const nums = (s.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (/^(MS\s*)?(ISA|ANGLE|ANG|L)\s*\d/.test(s)) return { shape: 'ANGLE', a: nums[0] ?? null, b: nums.length >= 3 ? nums[1] : (nums[0] ?? null), t: nums[nums.length - 1] ?? null };
  if (/^(MS\s*)?(FLAT|FLT|FL|FB|PF|F)\s*\d/.test(s)) return { shape: 'FLAT', a: nums[0] ?? null, b: null, t: nums[1] ?? null };
  if (/^(MS\s*)?(ISMC|CHANNEL|MC|C)\s*\d/.test(s)) return { shape: 'CHANNEL', a: nums[0] ?? null, b: nums[1] ?? null, t: nums[2] ?? null };
  if (/PIPE|TUBE|NB/.test(s)) return { shape: 'PIPE', a: nums[0] ?? null, b: null, t: null };
  if (/^(MS\s*)?(RB|ROD|ROUND|RD|DIA)/.test(s) || /DIA$/.test(s)) return { shape: 'ROUND', a: nums[0] ?? null, b: null, t: null };
  return { shape: 'OTHER', a: nums[0] ?? null, b: nums[1] ?? null, t: nums[2] ?? null };
}
