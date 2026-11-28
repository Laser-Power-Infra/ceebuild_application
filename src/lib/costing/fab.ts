// Fabrication / conversion categories (Costing Master FAB_RATE subjects), from the Ceebuild
// job-work rate chart (Satya ji, 23-Nov-2026). Each BOM line is costed at the rate of its own
// category, picked from the line's section and description; a line matching no category is
// flagged, not costed. Per-kg rates apply to the black weight, per-piece rates to the BOM qty.
// Pure functions (no I/O): shared by the server calculator and the BOM screen.

import { sectionDims } from '../bom/parse';

export interface FabCat {
  code: string;
  label: string;
  unit: 'Rs/kg' | 'Rs/pc';
  /** Sr no. on the job-work chart (information only). */
  chartSr: string;
}

export const FAB_CATS: FabCat[] = [
  { code: 'CH_ANG', label: 'Channel & angle – cutting, punching, numbering', unit: 'Rs/kg', chartSr: '1' },
  { code: 'CLAMP_65_50', label: 'Clamps – FB 65x6, 50x10, 50x8, 50x6', unit: 'Rs/kg', chartSr: '2' },
  { code: 'CLAMP_40', label: 'Clamps – FB 40x6, 40x5, 45x5', unit: 'Rs/kg', chartSr: '3' },
  { code: 'RADIUS_CLAMP', label: 'Radius clamps – FB 65x6, 50x10, 50x8, 50x6', unit: 'Rs/kg', chartSr: '4' },
  { code: 'WELDED', label: 'Welded materials (V-bracket, top cleat, J11V-KLIT) & all tower materials', unit: 'Rs/kg', chartSr: '5' },
  { code: 'TAPER_VCROSS', label: 'Taper cutting – V-cross (352DM)', unit: 'Rs/kg', chartSr: '6' },
  { code: 'CLAMP_30_25', label: 'Clamps – FB 30x3, 25x3', unit: 'Rs/kg', chartSr: '7' },
  { code: 'SQ_WASHER', label: 'Square washer 50x5 & 65x5', unit: 'Rs/kg', chartSr: '14' },
  { code: 'TUBE40_3000_DRILL', label: '40 NB tube 3000 mm – drilling', unit: 'Rs/pc', chartSr: '8 / 15' },
  { code: 'TUBE40_1800_DRILL', label: '40 NB tube 1800 mm – drilling', unit: 'Rs/pc', chartSr: '12' },
  { code: 'RB16_BOW', label: '16 mm angle bow', unit: 'Rs/pc', chartSr: '9' },
  { code: 'RB16_CUT_560', label: '16 mm rod cutting – 560 mm', unit: 'Rs/pc', chartSr: '10' },
  { code: 'RB16_CUT_1800', label: '16 mm rod cutting – 1800 mm', unit: 'Rs/pc', chartSr: '11' },
  { code: 'PLATE200_PUNCH', label: 'Plate 200x200x6 – punching', unit: 'Rs/pc', chartSr: '13' },
];

export const FAB_CAT_BY_CODE: Record<string, FabCat> = Object.fromEntries(FAB_CATS.map((c) => [c.code, c]));
export const isFabCat = (v: unknown): v is string => typeof v === 'string' && v in FAB_CAT_BY_CODE;
export const fabCatLabel = (code: string | null | undefined) => (code ? (FAB_CAT_BY_CODE[code]?.label ?? code) : '–');

const CLAMP_A = new Set(['65X6', '50X10', '50X8', '50X6']);
// 45x5 replaces 40x5 on the Lanarsy SBPDCL order (accepted 21-11-2026): same clamp work.
const CLAMP_B = new Set(['40X6', '40X5', '45X5']);
const CLAMP_C = new Set(['30X3', '25X3']);
const WASHER = new Set(['50X5', '65X5', '50X50X5', '65X65X5']);

const near = (len: number | null | undefined, target: number, tol = 25) => !!len && Math.abs(len - target) <= tol;

export interface FabClassInput {
  sectionKey: string | null;
  section: string | null;
  description: string | null;
  lengthMm: number | null;
  /** Item / structure type of the BOM: a tower takes the welded / tower rate. */
  structureType?: string | null;
}

/**
 * Fabrication category of a structure line, or null when no category of the chart fits (the line is
 * then flagged). Specific per-piece items come first, then welded / taper, then the section family.
 */
export function classifyFab(l: FabClassInput): string | null {
  const key = (l.sectionKey ?? '').toUpperCase();
  const desc = String(l.description ?? '').toUpperCase();
  const text = `${String(l.section ?? '').toUpperCase()} ${desc}`.replace(/[×*]/g, 'X');
  const flat = text.replace(/\s+/g, '');
  const dims = key ? sectionDims(key) : '';

  // Square washer 50x5 / 65x5.
  if (/WASHER/.test(desc)) return WASHER.has(dims) || /(50X50X5|65X65X5|50X5|65X5)(?!\d)/.test(flat) ? 'SQ_WASHER' : null;
  // 40 NB tube drilling, by length.
  if (/40\s*NB/.test(text) || /^(PIPE|TUBE|GIPIPE|MSPIPE)40/.test(key)) {
    if (near(l.lengthMm, 3000)) return 'TUBE40_3000_DRILL';
    if (near(l.lengthMm, 1800)) return 'TUBE40_1800_DRILL';
    return null;
  }
  // Plate 200x200x6 punching.
  if (/(PLATE|^PL\d|\sPL\d)/.test(text) && /200X200X6(?!\d)/.test(flat)) return 'PLATE200_PUNCH';
  // 16 mm round bar: angle bow, or cut to 560 / 1800 mm.
  if (key === 'RB16') {
    if (/BOW/.test(desc)) return 'RB16_BOW';
    if (near(l.lengthMm, 560, 10)) return 'RB16_CUT_560';
    if (near(l.lengthMm, 1800, 10)) return 'RB16_CUT_1800';
    return null;
  }
  // Taper-cut V-cross (352DM).
  if (/TAPER/.test(desc) || /352\s*DM/.test(text)) return 'TAPER_VCROSS';
  // Welded materials, and every structure line of a tower.
  if (/WELD|V[\s-]*BRACKET|TOP\s*(CLEAT|KLIT)|KLIT|J11V/.test(desc)) return 'WELDED';
  if (/TOWER/.test(String(l.structureType ?? '').toUpperCase())) return 'WELDED';
  // Channels and angles.
  if (key.startsWith('ISMC') || key.startsWith('ISA')) return 'CH_ANG';
  // Flats: clamps by size (radius clamps on the 65/50 sizes).
  if (key.startsWith('FLAT')) {
    if (CLAMP_A.has(dims)) return /RADIUS/.test(desc) ? 'RADIUS_CLAMP' : 'CLAMP_65_50';
    if (CLAMP_B.has(dims)) return 'CLAMP_40';
    if (CLAMP_C.has(dims)) return 'CLAMP_30_25';
  }
  return null;
}
