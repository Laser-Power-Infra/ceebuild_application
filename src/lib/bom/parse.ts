// Client BOM sheet -> piece rows. Pure (no DB, no xlsx) so it can be unit-tested; the server
// reads the workbook with SheetJS and passes the 2-D cell array here.

export const PIECE_FIELDS = [
  'markNo',
  'description',
  'section',
  'lengthMm',
  'qtyPerSet',
  'sets',
  'totalQty',
  'kgPerM',
  'unitWtKg',
  'totalWtKg',
] as const;
export type PieceField = (typeof PIECE_FIELDS)[number];

export const FIELD_LABELS: Record<PieceField, string> = {
  markNo: 'Mark no',
  description: 'Description',
  section: 'Section',
  lengthMm: 'Length (mm)',
  qtyPerSet: 'Qty per set',
  sets: 'No. of sets',
  totalQty: 'Total qty',
  kgPerM: 'kg/m',
  unitWtKg: 'Unit wt (kg)',
  totalWtKg: 'Total wt (kg)',
};

/** Header text -> field, tried in this order (specific patterns before generic ones). */
const HEADER_RULES: [PieceField, RegExp][] = [
  ['totalWtKg', /^(total|tot)(wt|weight)/],
  ['totalQty', /^(total|tot)(qty|quantity|nos|no|pcs)/],
  ['kgPerM', /(kg\/m|kgperm|kgpermtr|kgm$|wtperm|weightperm|sectionalwt|unitwtkg\/m)/],
  ['unitWtKg', /^(unit|pc|piece|per)?(wt|weight)(perpc|perpiece|\/pc|pc|kg)?(kg)?$|^unit(wt|weight)/],
  ['sets', /^(no|nos|noof)?sets?$|^noofsets/],
  ['qtyPerSet', /^(qty|quantity|nos|no|pcs)(perset|\/set)?$|perset/],
  ['markNo', /^(mark|mk|piece|part)(no|number|mark)?$|^markno/],
  ['section', /^(section|size|profile|sectionsize|member|angle)/],
  ['lengthMm', /^(length|len|lg|cutlength)/],
  ['description', /^(description|desc|particulars|item|itemdescription|name|component)/],
];

const normHeader = (h: unknown) =>
  String(h ?? '')
    .toLowerCase()
    .replace(/[\s._\-()[\]]/g, '');

export type ColumnMap = Partial<Record<PieceField, string>>;

/** Map each field to one header (first matching rule wins; a header is used once). */
export function autoMapHeaders(headers: string[]): ColumnMap {
  const map: ColumnMap = {};
  const used = new Set<string>();
  for (const [field, re] of HEADER_RULES) {
    if (map[field]) continue;
    const hit = headers.find((h) => h && !used.has(h) && re.test(normHeader(h)));
    if (hit) {
      map[field] = hit;
      used.add(hit);
    }
  }
  return map;
}

/** Index of the header row: the first of the top 15 rows that maps a mark or section plus 2 more fields. */
export function findHeaderRow(cells: unknown[][]): number {
  for (let i = 0; i < Math.min(cells.length, 15); i++) {
    const headers = (cells[i] ?? []).map((c) => String(c ?? '').trim());
    const map = autoMapHeaders(headers);
    if ((map.markNo || map.section) && Object.keys(map).length >= 3) return i;
  }
  return 0;
}

/** Number from a cell: "1,250.5" -> 1250.5; blank or text -> null. */
export function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/,/g, '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

const toText = (v: unknown) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

/**
 * "ISMC 100 x 50", "ISA-50X50X6 mm" -> "ISMC100X50", "ISA50X50X6". The section family is written
 * one way however the BOM spells it (M14, SBPDCL BOM): L / ANGLE -> ISA, FL / FT / FLAT / MS FLAT
 * -> FLAT, MC / CHANNEL -> ISMC, "16 Dia" / "Round bar 16" / "RB 16" / "Rod 16" -> RB16.
 */
export function sectionKey(section: string | null | undefined): string | null {
  if (!section) return null;
  let k = section
    .toUpperCase()
    .replace(/[×*]/g, 'X')
    .replace(/Ø|Φ/g, 'DIA')
    // "6MM" / "6 MM" (unit touching a digit) as well as a free-standing "MM".
    .replace(/(\d)\s*MM(?![A-Z])/g, '$1')
    .replace(/\bMM\b/g, '')
    .replace(/[\s\-_.]/g, '');
  if (!k) return null;
  // Round bar: any of RB / ROD / ROUNDBAR / ROUND with a diameter, or a bare "16DIA".
  const rb = k.match(/^(?:MS)?(?:ROUNDBAR|ROUND|RODS?|RB|RD|BAR)?(\d+(?:\.\d+)?)DIA$/) ?? k.match(/^(?:MS)?(?:ROUNDBAR|ROUND|RODS?|RB|RD)?DIA(\d+(?:\.\d+)?)$/) ?? k.match(/^(?:MS)?(?:ROUNDBAR|ROUND|RODS?|RB|RD)(\d+(?:\.\d+)?)$/);
  if (rb) return `RB${rb[1]}`;
  const fam: [RegExp, string][] = [
    [/^(?:MS)?(?:ANGLE|ANG|ISA|L)(?=\d)/, 'ISA'],
    [/^(?:MS)?(?:FLAT|FLT|FL|FT|PF|F)(?=\d)/, 'FLAT'],
    [/^(?:MS)?(?:CHANNEL|ISMC|MC|C)(?=\d)/, 'ISMC'],
  ];
  for (const [re, name] of fam) {
    if (re.test(k)) {
      k = k.replace(re, name);
      break;
    }
  }
  // A channel is named depth x flange; a third figure is the web thickness ("ISMC 75X40X6").
  k = k.replace(/^(ISMC\d+(?:\.\d+)?X\d+(?:\.\d+)?)X\d+(?:\.\d+)?$/, '$1');
  return k;
}

/** Size part of a section key: "ISMC75X40" -> "75X40", "RB16" -> "16". */
export const sectionDims = (key: string) => key.replace(/^[A-Z]+/, '');

export interface ParsedPiece {
  rowNo: number; // 1-based row number in the sheet
  markNo: string | null;
  description: string | null;
  section: string | null;
  sectionKey: string | null;
  lengthMm: number | null;
  qtyPerSet: number | null;
  sets: number | null;
  totalQty: number | null;
  kgPerM: number | null;
  unitWtKg: number | null;
  totalWtKg: number | null;
  raw: Record<string, unknown>;
  /** Fields holding a negative number in the sheet (the import rejects such rows). */
  negative: PieceField[];
}

/** "TOTAL", "Grand Total", "Sub-total:" ... in a label cell marks a summary row, not a piece. */
const TOTAL_LABEL = /^(grand|sub)?[\s-]*totals?\b/i;
const NUMERIC_FIELDS = ['lengthMm', 'qtyPerSet', 'sets', 'totalQty', 'kgPerM', 'unitWtKg', 'totalWtKg'] as const;

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Rows below `headerRow` -> pieces. Blank rows and TOTAL / sub-total rows are skipped; negative
 * numbers are listed in `negative` (the import rejects them). A length header that says metres
 * ("Length (m)", "Length in Mtr") is converted to mm. Missing totals are derived:
 * total qty = qty/set x sets; total wt = unit wt x total qty, else kg/m x length x total qty.
 */
export function parsePieces(cells: unknown[][], headerRow: number, map: ColumnMap): ParsedPiece[] {
  const headers = (cells[headerRow] ?? []).map((c) => String(c ?? '').trim());
  const idx = (f: PieceField) => (map[f] ? headers.indexOf(map[f] as string) : -1);
  const lengthHeader = normHeader(map.lengthMm);
  // "Length (mm)" / "Length in millimetre" are mm even though "millimetre" contains "metre".
  const lengthInMm = /(mm|millimet)/.test(lengthHeader);
  const lengthInMetres = !lengthInMm && (/(mtr|metre|meter|inm$)/.test(lengthHeader) || /\(m\)/i.test(map.lengthMm ?? ''));

  const out: ParsedPiece[] = [];
  for (let r = headerRow + 1; r < cells.length; r++) {
    const row = cells[r] ?? [];
    if (row.every((c) => String(c ?? '').trim() === '')) continue;
    const get = (f: PieceField) => (idx(f) >= 0 ? row[idx(f)] : undefined);

    const section = toText(get('section'));
    // Summary rows (TOTAL / Grand total / Sub-total) would double-count the weight: skip them.
    const firstText = toText(row.find((c) => String(c ?? '').trim() !== ''));
    const labels = [firstText, toText(get('markNo')), toText(get('description')), section];
    if (labels.some((l) => l !== null && TOTAL_LABEL.test(l)) && (section === null || TOTAL_LABEL.test(section))) continue;

    const negative = NUMERIC_FIELDS.filter((f) => {
      const n = toNum(get(f));
      return n !== null && n < 0;
    });

    let lengthMm = toNum(get('lengthMm'));
    if (lengthMm !== null && lengthInMetres) lengthMm = lengthMm * 1000;
    const qtyPerSet = toNum(get('qtyPerSet'));
    const sets = toNum(get('sets'));
    let totalQty = toNum(get('totalQty'));
    if (totalQty === null && qtyPerSet !== null && sets !== null) totalQty = round3(qtyPerSet * sets);
    if (totalQty === null && qtyPerSet !== null && sets === null && !map.sets) totalQty = qtyPerSet;
    const kgPerM = toNum(get('kgPerM'));
    const unitWtKg = toNum(get('unitWtKg'));
    let totalWtKg = toNum(get('totalWtKg'));
    if (totalWtKg === null && totalQty !== null) {
      if (unitWtKg !== null) totalWtKg = round3(unitWtKg * totalQty);
      else if (kgPerM !== null && lengthMm !== null) totalWtKg = round3((kgPerM * lengthMm * totalQty) / 1000);
    }

    const raw: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      if (h && row[i] !== undefined && row[i] !== '') raw[h] = row[i];
    });

    out.push({
      rowNo: r + 1,
      markNo: toText(get('markNo')),
      description: toText(get('description')),
      section,
      sectionKey: sectionKey(section),
      lengthMm: lengthMm === null ? null : Math.round(lengthMm),
      qtyPerSet,
      sets,
      totalQty,
      kgPerM,
      unitWtKg,
      totalWtKg,
      raw,
      negative: [...negative],
    });
  }
  return out;
}
