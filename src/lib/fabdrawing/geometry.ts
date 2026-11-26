// M14 fabrication drawings, part 2: geometry the BOM lacks, per mark (holes, slots, bends, welds,
// notches). Pure: validation of what is typed in, and conversion to what the drawing model prints.

import type { FabHoleFeature } from './model';

export const FEATURE_KINDS = ['HOLE', 'SLOT', 'BEND', 'WELD', 'NOTCH'] as const;
export type FeatureKind = (typeof FEATURE_KINDS)[number];
export const FEATURE_SOURCES = ['DRAWING', 'STANDARD', 'MANUAL'] as const;
export type FeatureSource = (typeof FEATURE_SOURCES)[number];
export const WELD_TYPES = ['FILLET', 'BUTT', 'TACK', 'PLUG'] as const;

export const FEATURE_LABELS: Record<FeatureKind, string> = { HOLE: 'Holes', SLOT: 'Slots', BEND: 'Bend', WELD: 'Weld', NOTCH: 'Notch' };

export interface FabFeature {
  id?: number;
  markNo: string;
  kind: FeatureKind;
  /** Positions from end A, mm. */
  positionsMm: number[];
  diaMm: number | null;
  offsetMm: number | null;
  face: string | null;
  count: number | null;
  bendAngle: number | null;
  bendRadius: number | null;
  weldType: string | null;
  weldSize: number | null;
  weldLength: number | null;
  weldPitch: number | null;
  source: FeatureSource;
  toConfirm: boolean;
  note: string | null;
}

const num = (v: unknown): number | null => {
  const s = String(v ?? '').trim().replace(/,/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};

/** "50, 475; 1600 2775" -> [50, 475, 1600, 2775]; NaN marks a bad entry. */
export function parsePositions(v: unknown): number[] {
  const s = String(v ?? '').trim();
  if (!s) return [];
  return s.split(/[\s,;/]+/).filter(Boolean).map((x) => Number(x));
}

/** Validate one feature as typed on the form (lengthMm = the mark's cut length, for range checks). */
export function parseFeature(i: Record<string, unknown>, lengthMm: number | null): { feature: FabFeature } | { error: string } {
  const markNo = String(i.markNo ?? '').trim().toUpperCase();
  if (!markNo) return { error: 'Choose the mark.' };
  const kind = String(i.kind ?? '').toUpperCase() as FeatureKind;
  if (!(FEATURE_KINDS as readonly string[]).includes(kind)) return { error: 'Choose holes, slot, bend, weld or notch.' };
  const source = (String(i.source ?? 'MANUAL').toUpperCase() || 'MANUAL') as FeatureSource;
  if (!(FEATURE_SOURCES as readonly string[]).includes(source)) return { error: 'Source must be drawing, standard or manual.' };
  const positionsMm = parsePositions(i.positions);
  if (positionsMm.some((p) => !Number.isFinite(p) || p < 0)) return { error: `${markNo}: positions must be numbers in mm from end A, e.g. "50, 475, 1600".` };
  if (lengthMm && positionsMm.some((p) => p > lengthMm)) return { error: `${markNo}: a position is beyond the cut length ${lengthMm} mm.` };
  const f: FabFeature = {
    markNo,
    kind,
    positionsMm: [...positionsMm].sort((a, b) => a - b),
    diaMm: num(i.diaMm),
    offsetMm: num(i.offsetMm),
    face: String(i.face ?? '').trim().slice(0, 40) || null,
    count: num(i.count),
    bendAngle: num(i.bendAngle),
    bendRadius: num(i.bendRadius),
    weldType: String(i.weldType ?? '').trim().toUpperCase() || null,
    weldSize: num(i.weldSize),
    weldLength: num(i.weldLength),
    weldPitch: num(i.weldPitch),
    source,
    toConfirm: i.toConfirm === true || i.toConfirm === 'true',
    note: String(i.note ?? '').trim().slice(0, 300) || null,
  };
  for (const k of ['diaMm', 'offsetMm', 'count', 'bendAngle', 'bendRadius', 'weldSize', 'weldLength', 'weldPitch'] as const) {
    const v = f[k];
    if (v !== null && (!Number.isFinite(v) || v < 0)) return { error: `${markNo}: ${k} must be a positive number.` };
  }
  if (f.count !== null && !Number.isInteger(f.count)) return { error: `${markNo}: count must be a whole number.` };
  if (kind === 'HOLE' || kind === 'SLOT') {
    if (positionsMm.length === 0 && !f.count) return { error: `${markNo}: give the hole positions (mm from end A) or at least the count.` };
    if (f.diaMm !== null && (f.diaMm < 3 || f.diaMm > 80)) return { error: `${markNo}: hole dia ${f.diaMm} mm looks wrong (3–80).` };
  }
  if (kind === 'BEND' && (f.bendAngle === null || f.bendAngle <= 0 || f.bendAngle > 180)) return { error: `${markNo}: bend angle must be from 1 to 180 degrees.` };
  if (kind === 'WELD') {
    if (f.weldType && !(WELD_TYPES as readonly string[]).includes(f.weldType)) return { error: `${markNo}: weld type must be ${WELD_TYPES.join(', ')}.` };
    if (f.weldSize === null) return { error: `${markNo}: give the weld size (mm).` };
  }
  return { feature: f };
}

const q = (v: number) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10));

/** One line of text for the drawing / cutting list. */
export function describeFeature(f: FabFeature): string {
  const at = f.positionsMm.length ? ` at ${f.positionsMm.map(q).join(' / ')} from end A` : '';
  const tbc = f.toConfirm ? ' – TO CONFIRM' : '';
  switch (f.kind) {
    case 'HOLE':
    case 'SLOT': {
      const n = f.positionsMm.length || f.count || 0;
      const what = f.kind === 'SLOT' ? 'slots' : 'holes';
      return `${n} ${what} ${f.diaMm ? `${q(f.diaMm)} dia` : 'dia by standard'}${at}${f.offsetMm ? `, ${q(f.offsetMm)} from heel/edge` : ''}${f.face ? ` (${f.face})` : ''}${tbc}`;
    }
    case 'BEND':
      return `Bend ${q(f.bendAngle ?? 0)}°${f.bendRadius ? ` inside R ${q(f.bendRadius)}` : ''}${at}${f.count && f.count > 1 ? ` x ${f.count}` : ''}${tbc}`;
    case 'WELD':
      return `${(f.weldType ?? 'FILLET').toLowerCase()} weld ${q(f.weldSize ?? 0)} mm${f.weldLength ? ` x ${q(f.weldLength)} long` : ''}${f.weldPitch ? ` @ ${q(f.weldPitch)} c/c` : ''}${f.face ? ` (${f.face})` : ''}${tbc}`;
    case 'NOTCH':
      return `Notch${at}${f.note ? ` – ${f.note}` : ''}${tbc}`;
  }
}

export interface MarkGeometry {
  holes: FabHoleFeature | null;
  /** Bend / weld / notch / slot lines for the member sheet. */
  lines: string[];
  /** Short text for the cutting-list column, e.g. "2 bends; weld". */
  bendWeld: string | null;
  holeCount: number;
  bends: number;
  welds: number;
  toConfirm: boolean;
}

/** Features of one BOM -> per mark what the drawing model prints. */
export function geometryByMark(features: FabFeature[]): Map<string, MarkGeometry> {
  const out = new Map<string, MarkGeometry>();
  for (const f of features) {
    const g = out.get(f.markNo) ?? { holes: null, lines: [], bendWeld: null, holeCount: 0, bends: 0, welds: 0, toConfirm: false };
    g.toConfirm ||= f.toConfirm;
    if (f.kind === 'HOLE') {
      const n = f.positionsMm.length || f.count || 0;
      g.holeCount += n;
      if (!g.holes) {
        g.holes = { markNo: f.markNo, positionsMm: [...f.positionsMm], diaMm: f.diaMm, offsetMm: f.offsetMm, source: f.source, toConfirm: f.toConfirm, note: f.note };
      } else {
        g.holes.positionsMm = [...g.holes.positionsMm, ...f.positionsMm].sort((a, b) => a - b);
        g.holes.toConfirm ||= f.toConfirm;
        g.lines.push(describeFeature(f));
      }
    } else {
      if (f.kind === 'BEND') g.bends += f.count && f.count > 0 ? f.count : Math.max(1, f.positionsMm.length);
      if (f.kind === 'WELD') g.welds += 1;
      if (f.kind === 'SLOT') g.holeCount += f.positionsMm.length || f.count || 0;
      g.lines.push(describeFeature(f));
    }
    const parts = [g.bends ? `${g.bends} bend${g.bends > 1 ? 's' : ''}` : '', g.welds ? 'weld' : ''].filter(Boolean);
    g.bendWeld = parts.length ? parts.join('; ') : null;
    out.set(f.markNo, g);
  }
  return out;
}
