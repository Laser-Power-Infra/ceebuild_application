// Lanarsy SBPDCL sample BOM (docs/m14-rev2-reference/Sample_Lanarsy_BOM_SBPDCL.xlsx) read the way
// docs/m14-rev2-reference/bom_parse_reference.py.txt reads it, so the indent can be checked against
// the reference Rev 3 indent workbook. Rev 2 substitutions (Lanarsy mail 21-11-2026) are applied
// on top: Flat 40x5 -> Flat 45x5, Angle 65x65x6 -> Angle 75x75x6, same pieces and cut lengths.
import path from 'node:path';
import * as XLSX from 'xlsx';
import type { PlanPiece, SectionInfo } from '../../src/lib/planning/cutting';

export interface LanarsyPiece {
  row: number;
  struct: string;
  code: string;
  desc: string;
  sec: string;
  L: number;
  qty: number;
}

const FILE = path.join(process.cwd(), 'docs', 'm14-rev2-reference', 'Sample_Lanarsy_BOM_SBPDCL.xlsx');

function norm(raw: string): string {
  const s = raw.toUpperCase().replace(/ /g, '');
  if (s.startsWith('ISMC100')) return 'ISMC 100X50';
  if (s === 'FT75X40' || s === 'ISMC75X40') return 'ISMC 75X40';
  if (s.startsWith('L65')) return 'L65X65X6';
  if (s.startsWith('L50')) return 'L50X50X6';
  if (s.startsWith('16')) return 'RD 16';
  const m = /^F[LT]\.?(\d+)X(\d+)/.exec(s);
  if (m) return `FL ${m[1]}X${m[2]}`;
  return s;
}

/** Pieces as the reference parser produces them (BOM corrections applied, qty rounded up). */
export function readLanarsyBom(): LanarsyPiece[] {
  const ws = XLSX.readFile(FILE).Sheets['Cee Build'];
  const v = (r: number, c: number): unknown => {
    const cell = ws[XLSX.utils.encode_cell({ r: r - 1, c })];
    return cell === undefined || cell.v === '' ? null : cell.v;
  };
  const out: LanarsyPiece[] = [];
  let struct = '';
  for (let r = 6; r <= 212; r++) {
    const c = Array.from({ length: 19 }, (_, k) => v(r, k));
    if (c[3] && c[6] === null && c[11] !== null && c[4] === null) {
      struct = String(c[3]).trim();
      continue;
    }
    if (!c[3] || c[7] === null) continue;
    let sec = norm(String(c[7]));
    const q = Number(c[17] ?? 0);
    const wtm = Number(c[9]);
    if (c[6] === null || c[6] === 0 || !q) continue;
    if (sec === 'FL 50X8' && Math.abs(wtm - 1.6) < 0.05) sec = 'FL 40X5';
    if (sec === 'FL 50X8' && Math.abs(wtm - 2.36) < 0.05) sec = 'FL 50X6';
    out.push({
      row: r,
      struct,
      code: c[2] === null ? '' : String(c[2]).trim(),
      desc: String(c[3]).trim(),
      sec,
      L: Math.trunc(Number(c[8])),
      qty: Math.ceil(q - 1e-9),
    });
  }
  return out;
}

/** Rev 2: sections accepted by Lanarsy in lieu of the BOM ones. */
export const REV2_SUBSTITUTE: Record<string, string> = { 'FL 40X5': 'FL 45X5', L65X65X6: 'L75X75X6' };

export const LANARSY_SECTIONS: Record<string, SectionInfo> = {
  'ISMC 100X50': { label: 'ISMC 100x50', kgPerM: 9.56, maxBarMm: 6600 },
  'ISMC 75X40': { label: 'ISMC 75x40', kgPerM: 7.14, maxBarMm: null },
  L75X75X6: { label: 'Angle 75x75x6', kgPerM: 6.8, maxBarMm: null },
  L50X50X6: { label: 'Angle 50x50x6', kgPerM: 4.5, maxBarMm: null },
  'FL 50X8': { label: 'Flat 50x8', kgPerM: 3.14, maxBarMm: null },
  'FL 65X6': { label: 'Flat 65x6', kgPerM: 3.06, maxBarMm: null },
  'FL 50X6': { label: 'Flat 50x6', kgPerM: 2.36, maxBarMm: null },
  'RD 16': { label: 'Round bar 16', kgPerM: 1.58, maxBarMm: null },
  'FL 45X5': { label: 'Flat 45x5', kgPerM: 1.77, maxBarMm: null },
  'FL 30X3': { label: 'Flat 30x3', kgPerM: 0.7, maxBarMm: null },
};

/** Rev 2 pieces for the planner, one mark per BOM row (ERE code + row, as the BOM upload keeps them). */
export function lanarsyRev2Pieces(): PlanPiece[] {
  return readLanarsyBom().map((p) => ({
    markNo: `${p.code || 'ROW'}-${p.row}`,
    sectionKey: REV2_SUBSTITUTE[p.sec] ?? p.sec,
    lengthMm: p.L,
    qty: p.qty,
  }));
}
