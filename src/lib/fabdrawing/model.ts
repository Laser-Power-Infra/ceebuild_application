// M14 fabrication drawings: item BOM (+ drawing standards, + any geometry entered) -> drawing model.
// Pure (no I/O). The cutting list is the BOM itself: every STRUCTURE line in scope gives one row
// with its own mark, section, length and qty per set; total = qty per set x sets of its structure.
// Nothing is recalculated or rounded, so the list matches the BOM (and the indent built from it).
// Geometry the BOM lacks is never invented: hole dia / gauge / edge come from the standards and are
// listed as design decisions; hole count and positions not given are listed "to be confirmed".

import { boltDia, finishNote, gaugeFor, generalNotes, holeDia, holeMethod, meshTack, minEdge, sectionGeom, DEFAULT_STANDARDS, type DrawingStandard, type SectionGeom } from './standards';

export interface FabBomLine {
  groupId: number | null;
  rowNo: number;
  markNo: string | null;
  description: string | null;
  section: string | null;
  lengthMm: number | null;
  qtyPerSet: number | null;
  /** STRUCTURE | NUTS_BOLTS | BOUGHT_OUT */
  category: string;
  /** IN_SCOPE | NOT_IN_SCOPE | BOUGHT_OUT | CLIENT_SUPPLY */
  scope: string;
  /** Fabrication category (hand-set or auto), e.g. WELDED, CLAMP_40. */
  fabCat: string | null;
}

export interface FabBomGroup {
  id: number | null;
  name: string;
  drawingNo: string | null;
  /** Sets of this structure; null = not set on the BOM (totals then "to confirm"). */
  sets: number | null;
}

export interface FabBom {
  structureType: string | null;
  drawingRef: string | null;
  galvanised: boolean;
  painted: boolean;
  /** PLAIN_CUT | CLAMP_BENT | WELDED */
  fabType: string;
  groups: FabBomGroup[];
  lines: FabBomLine[];
}

/** Holes of one mark known from a drawing / entered by hand (drawing_features, later phase). */
export interface FabHoleFeature {
  markNo: string;
  /** Positions from end A, mm. */
  positionsMm: number[];
  /** Hole dia; null = from the bolt size by standard. */
  diaMm?: number | null;
  /** Gauge / offset from the heel or edge, mm; null = standard gauge. */
  offsetMm?: number | null;
  source: 'DRAWING' | 'STANDARD' | 'MANUAL';
  toConfirm: boolean;
  note?: string | null;
}

export interface FabHeader {
  company: string;
  project: string;
  clientCode: string;
  itemCode: string;
  rev: number;
  /** DD-MM-YYYY */
  date: string;
  basis: string;
  preparedBy: string;
  checkedBy: string | null;
  approvedBy: string | null;
  /** DRAFT | ISSUED | CONFIRMED | SUPERSEDED */
  status: string;
}

export interface MemberView {
  key: string;
  markNo: string;
  description: string;
  section: string;
  geom: SectionGeom;
  lengthMm: number | null;
  /** "qty/set in structure" per group, e.g. [{ group: 'Type A enclosure', qtyPerSet: 5 }] */
  uses: { group: string; qtyPerSet: number | null }[];
  holeDiaMm: number | null;
  gaugeMm: number | null;
  edgeMm: number | null;
  holes: FabHoleFeature | null;
  bendWeld: string;
  notes: string[];
}

export interface CutRow {
  markNo: string;
  description: string;
  section: string;
  lengthMm: number | null;
  qtyPerSet: number | null;
  sets: number | null;
  totalQty: number | null;
  holes: string;
  bendWeld: string;
}

export interface CutGroup {
  name: string;
  sets: number | null;
  rows: CutRow[];
}

export interface OtherRow {
  group: string;
  markNo: string;
  description: string;
  category: string;
  qtyPerSet: number | null;
  sets: number | null;
  totalQty: number | null;
}

export interface FabModel {
  header: FabHeader;
  drawingNoBase: string;
  notes: string[];
  decisions: string[];
  toConfirm: string[];
  members: MemberView[];
  cutting: CutGroup[];
  /** Grand total by mark + section + length over all structures (same as cutting[0] for one). */
  totals: CutRow[];
  other: OtherRow[];
  boltDiaMm: number | null;
}

const EXCLUDED_SCOPES = new Set(['NOT_IN_SCOPE', 'CLIENT_SUPPLY', 'BOUGHT_OUT']);
const BENT = /^(CLAMP|RADIUS_CLAMP|RB16_BOW)/;
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const fmt = (v: number) => (Number.isInteger(v) ? String(v) : String(round3(v)));

/** Upper-case alphanumeric code (keeps case of mixed-case names like KESCo when short). */
export function codeOf(v: string | null | undefined, fallback: string): string {
  const s = String(v ?? '').replace(/[^A-Za-z0-9]/g, '');
  return s ? s.slice(0, 12) : fallback;
}

/** Item code from the structure type: first 3 letters of its longest word ("DTR fencing Type A" -> FEN). */
export function itemCodeOf(structureType: string | null | undefined): string {
  const words = String(structureType ?? '').toUpperCase().match(/[A-Z]{3,}/g) ?? [];
  const w = words.filter((x) => !['DTR', 'TYPE', 'THE', 'AND', 'WITH', 'FOR'].includes(x)).sort((a, b) => b.length - a.length)[0];
  return w ? w.slice(0, 3) : 'STR';
}

/** Drawing number of one sheet: CB/<client>/<item>/<sheet 2 digits>. */
export const drawingNo = (base: string, sheet: number) => `${base}/${String(sheet).padStart(2, '0')}`;

/** Most common bolt size on the N&B lines ("M10 bolt + nut ..." -> 10), else null. */
export function bomBoltDia(lines: FabBomLine[]): number | null {
  const count = new Map<number, number>();
  for (const l of lines) {
    if (l.category !== 'NUTS_BOLTS') continue;
    const d = boltDia(l.description) ?? boltDia(l.section);
    if (d) count.set(d, (count.get(d) ?? 0) + (l.qtyPerSet ?? 1));
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function bendWeldOf(l: FabBomLine, bom: FabBom): string {
  if (l.fabCat && BENT.test(l.fabCat)) return 'bend – TBC';
  if (l.fabCat === 'WELDED' || (!l.fabCat && bom.fabType === 'WELDED')) return 'weld';
  if (!l.fabCat && bom.fabType === 'CLAMP_BENT') return 'bend – TBC';
  return '–';
}

export function buildFabModel(input: { bom: FabBom; header: FabHeader; standards?: DrawingStandard[]; features?: FabHoleFeature[] }): FabModel {
  const { bom, header } = input;
  const stds = input.standards ?? DEFAULT_STANDARDS;
  const features = new Map((input.features ?? []).map((f) => [f.markNo, f]));
  const drawingNoBase = `CB/${header.clientCode}/${header.itemCode}`;

  const groups: FabBomGroup[] = bom.groups.length ? bom.groups : [{ id: null, name: bom.structureType ?? 'Structure', drawingNo: bom.drawingRef, sets: null }];
  const groupOf = (l: FabBomLine) => groups.find((g) => g.id === l.groupId) ?? groups[0];
  const markOf = (l: FabBomLine) => (l.markNo ?? '').trim() || `R${l.rowNo}`;

  const bolt = bomBoltDia(bom.lines);
  const hole = bolt ? holeDia(bolt, stds) : null;
  const toConfirm: string[] = [];
  const decisions: string[] = [];

  const cutLines = bom.lines.filter((l) => l.category === 'STRUCTURE' && !EXCLUDED_SCOPES.has(l.scope));
  const otherLines = bom.lines.filter((l) => !cutLines.includes(l) && l.scope !== 'NOT_IN_SCOPE' && l.scope !== 'CLIENT_SUPPLY');

  // ---- members (one view per mark + section + length)
  const members = new Map<string, MemberView>();
  for (const l of cutLines) {
    const markNo = markOf(l);
    const section = (l.section ?? '').trim() || '–';
    const k = `${markNo}|${section}|${l.lengthMm ?? ''}`;
    const g = groupOf(l);
    const m = members.get(k);
    if (m) {
      m.uses.push({ group: g.name, qtyPerSet: l.qtyPerSet });
      continue;
    }
    const geom = sectionGeom(section);
    const gauge = geom.shape === 'ANGLE' && geom.a ? gaugeFor(geom.a, stds) : null;
    const f = features.get(markNo) ?? null;
    const dia = f?.diaMm ?? hole;
    members.set(k, {
      key: k,
      markNo,
      description: (l.description ?? '').trim(),
      section,
      geom,
      lengthMm: l.lengthMm,
      uses: [{ group: g.name, qtyPerSet: l.qtyPerSet }],
      holeDiaMm: dia,
      gaugeMm: f?.offsetMm ?? gauge,
      edgeMm: dia ? minEdge(dia, geom.shape === 'FLAT' ? geom.a : null, stds) : null,
      holes: f,
      bendWeld: bendWeldOf(l, bom),
      notes: [],
    });
  }
  for (const m of members.values()) {
    if (m.holes) {
      const src = m.holes.source === 'DRAWING' ? 'from the approved drawing' : m.holes.source === 'MANUAL' ? 'entered by hand' : 'from the drawing standards';
      m.notes.push(`${m.holes.positionsMm.length} holes ${m.holeDiaMm ?? '?'} dia at ${m.holes.positionsMm.join(' / ')} from end A (${src})${m.holes.toConfirm ? ' – TO CONFIRM' : ''}.`);
      if (m.holes.note) m.notes.push(m.holes.note);
    } else {
      const parts = [m.holeDiaMm ? `hole dia ${m.holeDiaMm} by standard` : 'hole dia not known (no bolt size on the BOM)'];
      if (m.gaugeMm) parts.push(`gauge ${m.gaugeMm} from heel`);
      if (m.edgeMm) parts.push(`min end / edge distance ${m.edgeMm}`);
      m.notes.push(`Holes: ${parts.join(', ')}. Count and positions NOT DEFINED – to confirm.`);
    }
    if (m.geom.shape === 'ANGLE' && !m.gaugeMm) m.notes.push(`Gauge for a ${m.geom.a ?? '?'} mm leg is not in the standards – to confirm.`);
    if (m.lengthMm === null) m.notes.push('Cut length missing on the BOM – to confirm.');
    if (m.bendWeld.startsWith('bend')) m.notes.push('Bent member: developed length = BOM length; bend details to confirm.');
  }

  // ---- cutting list per structure
  const cutRow = (l: FabBomLine, sets: number | null): CutRow => {
    const m = members.get(`${markOf(l)}|${(l.section ?? '').trim() || '–'}|${l.lengthMm ?? ''}`)!;
    const holes = m.holes ? `${m.holes.positionsMm.length} x ${m.holeDiaMm ?? '?'}${m.holes.toConfirm ? ' (TBC)' : ''}` : m.holeDiaMm ? `${m.holeDiaMm} dia – TBC` : 'TBC';
    return {
      markNo: m.markNo,
      description: m.description,
      section: m.section,
      lengthMm: l.lengthMm,
      qtyPerSet: l.qtyPerSet,
      sets,
      totalQty: l.qtyPerSet !== null && sets !== null ? round3(l.qtyPerSet * sets) : null,
      holes,
      bendWeld: m.bendWeld,
    };
  };
  const cutting: CutGroup[] = groups
    .map((g) => ({ name: g.name, sets: g.sets, rows: cutLines.filter((l) => groupOf(l) === g).map((l) => cutRow(l, g.sets)) }))
    .filter((g) => g.rows.length > 0);

  const totalsMap = new Map<string, CutRow>();
  const multi = cutting.length > 1;
  for (const g of cutting) {
    for (const r of g.rows) {
      const k = `${r.markNo}|${r.section}|${r.lengthMm ?? ''}`;
      const t = totalsMap.get(k);
      // Over several structures qty/set and sets have no single value: only the total is kept.
      if (!t) totalsMap.set(k, multi ? { ...r, qtyPerSet: null, sets: null } : { ...r });
      else t.totalQty = t.totalQty !== null && r.totalQty !== null ? round3(t.totalQty + r.totalQty) : null;
    }
  }
  const totals = [...totalsMap.values()];

  const other: OtherRow[] = otherLines.map((l) => {
    const g = groupOf(l);
    return {
      group: g.name,
      markNo: (l.markNo ?? '').trim(),
      description: (l.description ?? l.section ?? '').trim(),
      category: l.category,
      qtyPerSet: l.qtyPerSet,
      sets: g.sets,
      totalQty: l.qtyPerSet !== null && g.sets !== null ? round3(l.qtyPerSet * g.sets) : null,
    };
  });

  // ---- design decisions (engineering rules taken from the standards master)
  if (bolt && hole) decisions.push(`Bolt holes: ${hole} dia (M${bolt} + ${fmt(hole - bolt)} clearance, IS 800) – ${holeMethod(stds).toLowerCase()}, not gas-cut.`);
  else decisions.push('Bolt holes: no bolt size on the BOM – hole dia not fixed.');
  const angleLegs = [...new Set([...members.values()].filter((m) => m.geom.shape === 'ANGLE' && m.geom.a).map((m) => m.geom.a!))];
  for (const leg of angleLegs) {
    const g = gaugeFor(leg, stds);
    decisions.push(g ? `Holes in ${leg} mm angle legs on the gauge line ${g} mm from heel (IS SP:6 back mark).` : `No IS SP:6 gauge in the standards for a ${leg} mm leg.`);
  }
  if (hole) {
    const flat50 = [...members.values()].some((m) => m.geom.shape === 'FLAT' && m.geom.a === 50);
    decisions.push(`Minimum edge / end distance ${minEdge(hole, null, stds)} mm (1.5 x hole dia)${flat50 ? `; ${minEdge(hole, 50, stds)} mm on 50 mm flats, holes on the flat centre line` : ''}.`);
  }
  const mesh = otherLines.some((l) => /MESH|WIRE\s*FABRIC|CHAIN/i.test(`${l.description ?? ''} ${l.markNo ?? ''}`));
  if (mesh) decisions.push(`Wire mesh fixing: ${meshTack(stds).text} on all rails and strips.`);
  const welded = [...members.values()].some((m) => m.bendWeld === 'weld');
  if (welded) {
    const fil = stds.find((s) => s.kind === 'WELD' && s.key === 'STRIP_FILLET')?.numValue ?? 4;
    decisions.push(`Welded members: ${fil} mm fillet both sides at each crossing unless the approved drawing says otherwise.`);
  }

  // ---- to be confirmed by production before cutting
  const noHoles = [...members.values()].filter((m) => !m.holes).map((m) => m.markNo);
  if (noHoles.length) toConfirm.push(`Hole count and positions not defined for: ${[...new Set(noHoles)].join(', ')} (member sheets show hole dia / gauge / edge from the standards only).`);
  const tbcHoles = [...members.values()].filter((m) => m.holes?.toConfirm).map((m) => m.markNo);
  if (tbcHoles.length) toConfirm.push(`Hole positions marked TO CONFIRM for: ${tbcHoles.join(', ')}.`);
  if (angleLegs.length) toConfirm.push('Gauge line(s) above against the plant jigs / practice.');
  if (mesh) toConfirm.push(`Mesh tack weld ${meshTack(stds).lengthMm} @ ${meshTack(stds).pitchMm} c/c.`);
  const bent = [...members.values()].filter((m) => m.bendWeld.startsWith('bend')).map((m) => m.markNo);
  if (bent.length) toConfirm.push(`Bend details (angle, inside radius) for: ${bent.join(', ')}.`);
  const noSets = groups.filter((g) => g.sets === null && cutLines.some((l) => groupOf(l) === g)).map((g) => g.name);
  if (noSets.length) toConfirm.push(`Set count not on the BOM for: ${noSets.join(', ')} – total qty left blank.`);
  const noLen = cutLines.filter((l) => l.lengthMm === null || l.qtyPerSet === null).map(markOf);
  if (noLen.length) toConfirm.push(`Length or qty missing on the BOM for: ${noLen.join(', ')}.`);

  const notes = [...generalNotes(stds), `Finish: ${finishNote(bom, stds)}`, 'Cut lengths and quantities are the confirmed BOM; this drawing never changes a length.'];

  return { header, drawingNoBase, notes, decisions, toConfirm, members: [...members.values()], cutting, totals, other, boltDiaMm: bolt };
}
