// BOM check gate (A15 step 1). Pure: works on piece values plus the section master.

export interface CheckPiece {
  markNo: string | null;
  sectionKey: string | null;
  lengthMm: number | null;
  qtyPerSet: number | null;
  sets: number | null;
  totalQty: number | null;
  kgPerM: number | null;
  unitWtKg: number | null;
}

export interface SectionStd {
  kgPerM: number;
  approved: boolean;
}

export interface PieceFlags {
  flagMarkLength: boolean;
  flagBlankQty: boolean;
  flagKgm: boolean;
  flagFractionalSets: boolean;
  flagSection: boolean;
  issues: string | null;
}

/** GTP weight tolerance (SBPDCL letter 2333: ±5%). */
export const KGM_TOLERANCE = 0.05;
const EPS = 1e-6;

const isWhole = (n: number) => Math.abs(n - Math.round(n)) < EPS;
const fmt = (n: number) => String(Math.round(n * 1000) / 1000);
const markKey = (m: string | null) => (m ?? '').trim().toUpperCase();

/**
 * Flags for every piece, in input order.
 * - mark/length clash: the same mark appears with different lengths;
 * - blank qty: neither total qty nor qty per set;
 * - fractional sets: sets not whole, or total qty / qty per set not whole;
 * - kg/m: given kg/m (or unit wt / length) more than ±5% off the section standard;
 * - section: not an approved section. Section checks only run when the master has entries.
 */
export function checkPieces(pieces: CheckPiece[], master: Map<string, SectionStd>): PieceFlags[] {
  const lengthsByMark = new Map<string, Set<number>>();
  for (const p of pieces) {
    const k = markKey(p.markNo);
    if (!k || p.lengthMm === null) continue;
    if (!lengthsByMark.has(k)) lengthsByMark.set(k, new Set());
    lengthsByMark.get(k)!.add(p.lengthMm);
  }
  const masterFilled = master.size > 0;

  return pieces.map((p) => {
    const issues: string[] = [];

    const lengths = lengthsByMark.get(markKey(p.markNo));
    const flagMarkLength = !!lengths && lengths.size > 1;
    if (flagMarkLength) issues.push(`Mark ${p.markNo} has different lengths: ${[...lengths!].sort((a, b) => a - b).join(', ')} mm`);

    const flagBlankQty = p.totalQty === null && p.qtyPerSet === null;
    if (flagBlankQty) issues.push('Qty is blank');

    let flagFractionalSets = false;
    if (p.sets !== null && !isWhole(p.sets)) {
      flagFractionalSets = true;
      issues.push(`Sets ${fmt(p.sets)} is not a whole number`);
    } else if (p.totalQty !== null && p.qtyPerSet !== null && p.qtyPerSet > 0 && !isWhole(p.totalQty / p.qtyPerSet)) {
      flagFractionalSets = true;
      issues.push(`Total qty ${fmt(p.totalQty)} / qty per set ${fmt(p.qtyPerSet)} = ${fmt(p.totalQty / p.qtyPerSet)} sets`);
    }

    let flagKgm = false;
    let flagSection = false;
    if (masterFilled) {
      const std = p.sectionKey ? master.get(p.sectionKey) : undefined;
      if (!p.sectionKey) {
        flagSection = true;
        issues.push('Section is blank');
      } else if (!std || !std.approved) {
        flagSection = true;
        issues.push(`Section ${p.sectionKey} is not in the approved GTP list`);
      }
      const given =
        p.kgPerM ?? (p.unitWtKg !== null && p.lengthMm ? (p.unitWtKg * 1000) / p.lengthMm : null);
      if (std && given !== null && std.kgPerM > 0 && Math.abs(given - std.kgPerM) / std.kgPerM > KGM_TOLERANCE + EPS) {
        flagKgm = true;
        const pct = ((given - std.kgPerM) / std.kgPerM) * 100;
        issues.push(`kg/m ${fmt(given)} vs standard ${fmt(std.kgPerM)} (${pct > 0 ? '+' : ''}${pct.toFixed(1)}%)`);
      }
    }

    return {
      flagMarkLength,
      flagBlankQty,
      flagKgm,
      flagFractionalSets,
      flagSection,
      issues: issues.length ? issues.join('; ') : null,
    };
  });
}

export const hasFlag = (f: PieceFlags) =>
  f.flagMarkLength || f.flagBlankQty || f.flagKgm || f.flagFractionalSets || f.flagSection;
