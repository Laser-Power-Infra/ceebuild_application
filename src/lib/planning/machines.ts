// Machine production plan (A15 step 4). Pure functions: no DB, no I/O, so they are unit-tested
// (tests/machines.test.ts) and shared by the order page, the cross-order plan and the overview.
//
// Model
//  - Each BOM mark has a routing: one cutting operation (cropping or shearing) plus counts of
//    holes, notches, bends, weld joints and threads per piece, and whether it is numbered.
//  - Work units per operation = pieces x units per piece (cuts: 1 per piece; numbering: 1 per piece).
//  - Capacity of a machine per working day = rate/h x identical units x shifts x hours/shift x utilisation.
//    An operation's machines share its load in proportion to capacity, so they finish together.
//  - Operations run in parallel (different machines), so the order takes as long as its slowest
//    operation: the bottleneck.

export const OPERATIONS = ['CROPPING', 'SHEARING', 'PUNCHING', 'NOTCHING', 'BENDING', 'WELDING', 'NUMBERING', 'THREADING'] as const;
export type Operation = (typeof OPERATIONS)[number];

export const CUT_OPS = ['CROPPING', 'SHEARING', 'NONE'] as const;
export type CutOp = (typeof CUT_OPS)[number];

export const OPERATION_LABELS: Record<Operation, string> = {
  CROPPING: 'Cropping',
  SHEARING: 'Shearing',
  PUNCHING: 'Punching',
  NOTCHING: 'Notching',
  BENDING: 'Bending',
  WELDING: 'Welding',
  NUMBERING: 'Numbering',
  THREADING: 'Threading',
};

/** Unit of work each operation's rate is expressed in. */
export const OP_UNIT: Record<Operation, string> = {
  CROPPING: 'cuts',
  SHEARING: 'cuts',
  PUNCHING: 'holes',
  NOTCHING: 'notches',
  BENDING: 'bends',
  WELDING: 'joints',
  NUMBERING: 'pieces',
  THREADING: 'threads',
};

export const isOperation = (v: unknown): v is Operation => typeof v === 'string' && (OPERATIONS as readonly string[]).includes(v);
export const isCutOp = (v: unknown): v is CutOp => typeof v === 'string' && (CUT_OPS as readonly string[]).includes(v);

export interface Routing {
  cutOp: CutOp;
  holes: number;
  notches: number;
  bends: number;
  welds: number;
  threads: number;
  numbering: boolean;
}

/**
 * Default routing from the section text/key: channels (ISMC / MC / channel) are cropped on UP-1;
 * angles, flats and everything else are sheared. All other counts start at 0 and are entered per mark.
 */
export function defaultRouting(section: string | null | undefined): Routing {
  const s = String(section ?? '').toUpperCase().replace(/\s+/g, '');
  const channel = /^(ISMC|MC|ISJC|JC)\d/.test(s) || s.includes('CHANNEL');
  return { cutOp: channel ? 'CROPPING' : 'SHEARING', holes: 0, notches: 0, bends: 0, welds: 0, threads: 0, numbering: true };
}

/** Units of `op` needed for one piece with this routing. */
export function unitsPerPiece(r: Routing, op: Operation): number {
  switch (op) {
    case 'CROPPING':
    case 'SHEARING':
      return r.cutOp === op ? 1 : 0;
    case 'PUNCHING':
      return r.holes;
    case 'NOTCHING':
      return r.notches;
    case 'BENDING':
      return r.bends;
    case 'WELDING':
      return r.welds;
    case 'THREADING':
      return r.threads;
    case 'NUMBERING':
      return r.numbering ? 1 : 0;
  }
}

/** Operations a piece with this routing passes through, in shop order. */
export function operationsOf(r: Routing): Operation[] {
  return OPERATIONS.filter((op) => unitsPerPiece(r, op) > 0);
}

export interface PlanMachine {
  id: number;
  code: string;
  name: string;
  operation: string;
  units: number;
  ratePerHour: number;
  shiftsPerDay: number;
  hoursPerShift: number;
  utilisationPct: number;
  active: boolean;
  rateConfirmed: boolean;
}

/** Units one machine (all its identical units) completes per working day. */
export function machineCapacityPerDay(m: PlanMachine): number {
  if (!m.active) return 0;
  const v = m.ratePerHour * m.units * m.shiftsPerDay * m.hoursPerShift * (m.utilisationPct / 100);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

export interface PlanMark {
  markNo: string;
  /** Pieces to plan for (full BOM qty, or what received RM can cut). */
  qty: number;
  routing: Routing;
  /** Pieces already done per operation; subtracted when given (REMAINING basis). */
  produced?: Partial<Record<Operation, number>>;
}

export interface MachineLoad {
  id: number;
  code: string;
  name: string;
  capacityPerDay: number;
  load: number;
  days: number;
  sharePct: number;
  rateConfirmed: boolean;
}

export interface OperationLoad {
  operation: Operation;
  unit: string;
  /** Total work units for the operation. */
  load: number;
  pieces: number;
  capacityPerDay: number;
  /** Working days; null when there is load but no active machine (blocked). */
  days: number | null;
  noMachine: boolean;
  machines: MachineLoad[];
  marks: { markNo: string; pieces: number; units: number }[];
}

export interface MachinePlanResult {
  operations: OperationLoad[];
  bottleneck: { operation: Operation; days: number | null } | null;
  /** Working days for the order (= bottleneck); null when an operation has no machine. */
  totalDays: number | null;
  /** totalDays / working days per week. */
  weeks: number | null;
  /** Some machine used by the plan still has a placeholder rate. */
  unconfirmedRates: boolean;
  totalPieces: number;
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** Load, days and bottleneck per operation for the given marks. */
export function computeMachinePlan(marks: PlanMark[], machines: PlanMachine[], workDaysPerWeek = 6): MachinePlanResult {
  const operations: OperationLoad[] = [];
  let unconfirmed = false;
  for (const op of OPERATIONS) {
    const markLoads: OperationLoad['marks'] = [];
    for (const m of marks) {
      const per = unitsPerPiece(m.routing, op);
      if (per <= 0) continue;
      const pieces = Math.max(0, Math.floor(m.qty) - Math.max(0, m.produced?.[op] ?? 0));
      if (pieces <= 0) continue;
      markLoads.push({ markNo: m.markNo, pieces, units: pieces * per });
    }
    const load = markLoads.reduce((s, x) => s + x.units, 0);
    if (load <= 0) continue;
    const opMachines = machines.filter((m) => m.operation === op && m.active);
    const caps = opMachines.map((m) => ({ m, cap: machineCapacityPerDay(m) })).filter((x) => x.cap > 0);
    const capacity = caps.reduce((s, x) => s + x.cap, 0);
    const days = capacity > 0 ? load / capacity : null;
    if (caps.some((x) => !x.m.rateConfirmed)) unconfirmed = true;
    operations.push({
      operation: op,
      unit: OP_UNIT[op],
      load,
      pieces: markLoads.reduce((s, x) => s + x.pieces, 0),
      capacityPerDay: round(capacity),
      days: days === null ? null : round(days),
      noMachine: capacity <= 0,
      machines: caps.map(({ m, cap }) => {
        const share = cap / capacity;
        return {
          id: m.id,
          code: m.code,
          name: m.name,
          capacityPerDay: round(cap),
          load: round(load * share),
          days: round((load * share) / cap),
          sharePct: round(share * 100, 1),
          rateConfirmed: m.rateConfirmed,
        };
      }),
      marks: markLoads.sort((a, b) => b.units - a.units),
    });
  }
  const blocked = operations.find((o) => o.noMachine);
  const slowest = operations.reduce<OperationLoad | null>((best, o) => (o.days !== null && (!best || (best.days ?? 0) < o.days) ? o : best), null);
  const bottleneck = blocked ? { operation: blocked.operation, days: null } : slowest ? { operation: slowest.operation, days: slowest.days } : null;
  const totalDays = blocked ? null : slowest ? slowest.days : 0;
  return {
    operations,
    bottleneck,
    totalDays,
    weeks: totalDays === null ? null : round(totalDays / Math.max(1, workDaysPerWeek), 1),
    unconfirmedRates: unconfirmed,
    totalPieces: marks.reduce((s, m) => s + Math.max(0, Math.floor(m.qty)), 0),
  };
}
