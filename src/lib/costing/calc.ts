// M14 quotation costing from a BOM. Pure functions (no I/O) so every number can be unit-tested.
//
// Per structure line, for ONE set (totals are then x sets):
//   black wt  = qty/set x length x kg/m (kg/m from the GTP section master)
//   galv wt   = black wt x (1 + zinc pick-up %)           (black wt when not galvanised)
//   RM        = black wt x RM rate x (1 + wastage %)       (wastage: master override, else cutting plan)
//   fab       = black wt x Rs/kg, or qty x Rs/pc: the rate of the line's own fabrication category
//               (job-work chart, src/lib/costing/fab.ts); a line with no category is flagged
//   galv      = galvanising rate x (galv or black wt, per the rate unit) + transport x black wt
//   freight   = despatch wt / 1000 x Rs/MT (destination state)
//   inspection, packing = Rs/kg x billed wt
//   interest  = base x interest % x credit days / 365;  LC/BG = base x LC/BG %
//   cost      = base + interest + LC/BG;  selling = cost x (1 + VA %)
// Mixed BOM: each line carries the set count of its structure; totals are line x sets.
// Nuts & bolts (category NUTS_BOLTS) and bought-out lines are costed from their own rate plus their
// own margin % (not the structure VA %), interest/LC included; they are kept out of the structure
// weight and per-kg price and quoted as separate offer lines.
// Only lines in the purchase scope are costed (IN_SCOPE, BOUGHT_OUT); NOT_IN_SCOPE / CLIENT_SUPPLY
// are listed but excluded. Non-billable lines are supplied, so they are costed, but their weight is
// not billed: their cost is carried on the billable kg.

export const RATE_KINDS = [
  'RM_RATE',
  'WASTAGE_PCT',
  'FAB_RATE',
  'GALV_RATE',
  'ZINC_PCT',
  'GALV_TRANSPORT',
  'FREIGHT_MT',
  'INTEREST_PCT',
  'CREDIT_DAYS',
  'LC_BG_PCT',
  'INSPECTION',
  'PACKING',
  'MIN_VA_PCT',
  'NB_RATE',
  'NB_MARGIN_PCT',
  'BOUGHT_OUT',
  'BO_MARGIN_PCT',
] as const;
export type RateKind = (typeof RATE_KINDS)[number];

/** Label, allowed units and what the subject means, per kind (drives the Costing Master UI). */
export const RATE_META: Record<RateKind, { label: string; units: string[]; subject: string; perSubject: boolean }> = {
  RM_RATE: { label: 'RM rate', units: ['Rs/kg'], subject: 'RM purchase item', perSubject: true },
  WASTAGE_PCT: { label: 'Wastage % (override of cutting plan)', units: ['%'], subject: 'RM purchase item or DEFAULT', perSubject: true },
  FAB_RATE: { label: 'Fabrication / conversion', units: ['Rs/kg', 'Rs/pc'], subject: 'Fabrication category (job-work chart)', perSubject: true },
  GALV_RATE: { label: 'Galvanising rate', units: ['Rs/kg black', 'Rs/kg galv'], subject: 'DEFAULT', perSubject: false },
  ZINC_PCT: { label: 'Zinc pick-up %', units: ['%'], subject: 'DEFAULT', perSubject: false },
  GALV_TRANSPORT: { label: 'Transport to/from galvaniser', units: ['Rs/kg'], subject: 'DEFAULT', perSubject: false },
  FREIGHT_MT: { label: 'Freight (FOR)', units: ['Rs/MT'], subject: 'Destination state or DEFAULT', perSubject: true },
  INTEREST_PCT: { label: 'Interest % per year', units: ['%'], subject: 'DEFAULT', perSubject: false },
  CREDIT_DAYS: { label: 'Credit days', units: ['days'], subject: 'DEFAULT', perSubject: false },
  LC_BG_PCT: { label: 'LC / BG charges', units: ['%'], subject: 'DEFAULT', perSubject: false },
  INSPECTION: { label: 'Inspection', units: ['Rs/kg'], subject: 'DEFAULT', perSubject: false },
  PACKING: { label: 'Packing', units: ['Rs/kg'], subject: 'DEFAULT', perSubject: false },
  MIN_VA_PCT: { label: 'Minimum VA %', units: ['%'], subject: 'DEFAULT', perSubject: false },
  NB_RATE: { label: 'Nuts & bolts', units: ['Rs/kg', 'Rs/set'], subject: 'Size (e.g. M16X40) or DEFAULT', perSubject: true },
  NB_MARGIN_PCT: { label: 'Nuts & bolts margin %', units: ['%'], subject: 'DEFAULT', perSubject: false },
  BOUGHT_OUT: { label: 'Bought-out item', units: ['Rs/no'], subject: 'Item name (danger board, stay set ...)', perSubject: true },
  BO_MARGIN_PCT: { label: 'Bought-out margin %', units: ['%'], subject: 'DEFAULT', perSubject: false },
};

export const FAB_TYPES = ['PLAIN_CUT', 'CLAMP_BENT', 'WELDED'] as const;
export type FabType = (typeof FAB_TYPES)[number];
export const FAB_LABELS: Record<FabType, string> = { PLAIN_CUT: 'Plain cut', CLAMP_BENT: 'Clamp / bent', WELDED: 'Welded assembly' };

export const CATEGORIES = ['STRUCTURE', 'NUTS_BOLTS', 'BOUGHT_OUT'] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABELS: Record<Category, string> = { STRUCTURE: 'Structure', NUTS_BOLTS: 'Nuts & Bolts – separate item', BOUGHT_OUT: 'Bought-out' };

export const SCOPES = ['IN_SCOPE', 'NOT_IN_SCOPE', 'BOUGHT_OUT', 'CLIENT_SUPPLY'] as const;
export type Scope = (typeof SCOPES)[number];
export const SCOPE_LABELS: Record<Scope, string> = { IN_SCOPE: 'In scope', NOT_IN_SCOPE: 'Not in scope', BOUGHT_OUT: 'Bought-out', CLIENT_SUPPLY: 'Client supply' };

export type BillingBasis = 'BLACK' | 'GALV';

export interface RateRow {
  id: number;
  kind: string;
  subject: string;
  value: number;
  unit: string;
  /** yyyy-mm-dd */
  effectiveFrom: string;
  /** Where the figure came from; "INTERIM ..." marks a provisional rate. */
  source?: string | null;
}

/** Rate marked provisional (e.g. RM rates from a supplier quote until purchase gives PO/GRN rates). */
export const isInterim = (r: { source?: string | null } | null | undefined) => !!r && /^\s*INTERIM\b/i.test(r.source ?? '');

export const normSubject = (s: string | null | undefined) =>
  String(s ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ') || 'DEFAULT';

/**
 * The rate in force on `date`: latest effective date <= date, for the exact subject first, then
 * DEFAULT (when `fallbackDefault`). Ties on the same date: the newest row (highest id) wins.
 */
export function pickRate(rates: RateRow[], kind: RateKind, subject: string | null, date: string, fallbackDefault = true): RateRow | null {
  const want = normSubject(subject);
  const best = (subj: string) =>
    rates
      .filter((r) => r.kind === kind && normSubject(r.subject) === subj && r.effectiveFrom <= date)
      .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : b.id - a.id))[0] ?? null;
  return best(want) ?? (fallbackDefault && want !== 'DEFAULT' ? best('DEFAULT') : null);
}

export interface CostLineInput {
  rowNo: number;
  markNo: string | null;
  description: string | null;
  section: string | null;
  sectionKey: string | null;
  lengthMm: number | null;
  qtyPerSet: number | null;
  /** kg/m as read from the drawing (used only when the GTP master has no entry). */
  kgPerM: number | null;
  unitWtKg: number | null;
  category: string;
  scope: string;
  /** Supplied but not billed (e.g. stay clamps): cost is carried on the billable kg. */
  nonBillable: boolean;
  rateKey: string | null;
  /** Sets of the structure this line belongs to (mixed BOMs: each structure has its own count); null = unknown. */
  sets: number | null;
  /** Structure (group) name; null for a single-structure BOM. */
  group: string | null;
  /** Fabrication category (FAB_RATE subject) of a structure line; null = none matched (flagged). */
  fabCat?: string | null;
}

export interface CostInput {
  lines: CostLineInput[];
  galvanised: boolean;
  billingBasis: BillingBasis;
  destState: string | null;
  /** VA % to quote on the structure; null = the Costing Master minimum. */
  vaPct: number | null;
  /** yyyy-mm-dd: rates in force on this date are used. */
  quoteDate: string;
  /** GTP section master: section key -> kg/m. */
  sectionKgm: Record<string, number>;
  /** RM purchase list: section key -> label. Structure lines outside it are flagged, not costed. */
  purchaseItems: Record<string, string>;
  /** Wastage % per section from the cutting plan. */
  planWastagePct: Record<string, number>;
  rates: RateRow[];
  /** Last quoted structure price per kg for the same item type (variance check). */
  lastPricePerKg?: { value: number; ref: string } | null;
  /**
   * Planning Settings (end allowance / kerf) confirmed by the plant. False blocks Apply: the
   * cutting-plan wastage is not final. Undefined = not checked (unit tests).
   */
  planConfirmed?: boolean;
}

export type LineStatus = 'COSTED' | 'EXCLUDED' | 'FLAGGED';

export interface LineResult {
  rowNo: number;
  markNo: string | null;
  section: string | null;
  category: string;
  scope: string;
  group: string | null;
  sets: number;
  billable: boolean;
  status: LineStatus;
  /** Why the line is excluded / flagged, or a remark (non-billable). */
  note: string | null;
  qtyPerSet: number;
  kgPerM: number | null;
  kgPerMSource: 'GTP' | 'DRAWING' | null;
  /** Per ONE set of its structure. */
  blackWtKg: number;
  galvWtKg: number;
  wastagePct: number | null;
  wastageSource: 'MASTER' | 'CUTTING_PLAN' | 'DEFAULT' | null;
  rmRate: number | null;
  /** RM rate is provisional (marked INTERIM in the Costing Master). */
  rmInterim: boolean;
  fabCat: string | null;
  fabRate: number | null;
  fabUnit: string | null;
  /** Per one set, Rs. */
  rm: number;
  fab: number;
  galv: number;
  freight: number;
  inspPack: number;
  commercial: number;
  cost: number;
  sell: number;
  /** Margin used on this line (VA % for structure, own margin for N&B / bought-out). */
  marginPct: number;
}

export interface RateUsed {
  id: number;
  kind: string;
  subject: string;
  value: number;
  unit: string;
  effectiveFrom: string;
}

export interface Bucket {
  blackWtKg: number;
  galvWtKg: number;
  cost: number;
  sell: number;
}

export interface GroupResult {
  name: string;
  sets: number;
  /** Structure only, per one set. */
  blackWtPerSet: number;
  galvWtPerSet: number;
  billedWtPerSet: number;
  sellPerSet: number;
  /** Structure only, all sets. */
  blackWtKg: number;
  billedWtKg: number;
  sell: number;
  /** N&B + bought-out of this structure, all sets. */
  otherSell: number;
}

export interface CostResult {
  lines: LineResult[];
  groups: GroupResult[];
  vaPct: number;
  minVaPct: number | null;
  nbMarginPct: number;
  boMarginPct: number;
  /** Sets of a single-structure BOM; null for a mixed BOM. */
  sets: number | null;
  /** All structures' sets added up (information only). */
  totalSets: number;
  /** Structure only, per one set (single-structure BOM only). */
  perSet: Bucket | null;
  /** Structure only, all sets. */
  structure: Bucket & { sellPerKg: number; costPerKg: number; billedWtKg: number; nonBillableWtKg: number };
  nutsBolts: { cost: number; sell: number; perSetSell: number | null };
  boughtOut: { cost: number; sell: number; perSetSell: number | null };
  grandSell: number;
  ratesUsed: RateUsed[];
  checks: {
    belowMinVa: boolean;
    variancePct: number | null;
    varianceRef: string | null;
    /** Lines with blank weight, rate or set count (they stop the price being applied). */
    blankLines: string[];
    outsidePurchaseList: string[];
    nonBillable: string[];
    /** Costing Master / Planning Settings values not entered yet (they stop the price being applied). */
    missingMasters: string[];
    /** Lines priced with a provisional (INTERIM) RM rate. */
    interimLines: string[];
    /** True when the price may be applied to the quotation. */
    ok: boolean;
    messages: string[];
  };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

const COSTED_SCOPES = new Set(['IN_SCOPE', 'BOUGHT_OUT']);

export function computeCosting(input: CostInput): CostResult {
  const used = new Map<number, RateUsed>();
  const take = (kind: RateKind, subject: string | null, fallbackDefault = true) => {
    const r = pickRate(input.rates, kind, subject, input.quoteDate, fallbackDefault);
    if (r) used.set(r.id, { id: r.id, kind: r.kind, subject: r.subject, value: r.value, unit: r.unit, effectiveFrom: r.effectiveFrom });
    return r;
  };
  const val = (r: RateRow | null) => (r ? r.value : 0);

  const minVa = take('MIN_VA_PCT', null);
  const vaPct = input.vaPct ?? (minVa ? minVa.value : 0);
  const va = vaPct / 100;
  const nbMargin = take('NB_MARGIN_PCT', null);
  const boMargin = take('BO_MARGIN_PCT', null);

  // Commercial and plant-wide factors (same for every line).
  const zinc = val(take('ZINC_PCT', null)) / 100;
  const galvRate = input.galvanised ? take('GALV_RATE', null) : null;
  const galvTransport = input.galvanised ? val(take('GALV_TRANSPORT', null)) : 0;
  const freightMt = val(take('FREIGHT_MT', input.destState));
  const inspection = val(take('INSPECTION', null));
  const packing = val(take('PACKING', null));
  const interestPct = val(take('INTEREST_PCT', null)) / 100;
  const creditDays = val(take('CREDIT_DAYS', null));
  const lcbg = val(take('LC_BG_PCT', null)) / 100;
  const commercialFactor = interestPct * (creditDays / 365) + lcbg;

  // Masters still blank: listed, and Apply is blocked until they are filled (a 0 entered is filled).
  const missingMasters: string[] = [];
  const need = (kind: RateKind, label: string, subject: string | null = null) => {
    if (!pickRate(input.rates, kind, subject, input.quoteDate)) missingMasters.push(label);
  };
  need('MIN_VA_PCT', 'Minimum VA %');
  need('FREIGHT_MT', `Freight Rs/MT${input.destState ? ` (${input.destState})` : ''}`, input.destState);
  need('INTEREST_PCT', 'Interest %');
  need('CREDIT_DAYS', 'Credit days');
  need('LC_BG_PCT', 'LC / BG charges %');
  need('INSPECTION', 'Inspection cost');
  need('PACKING', 'Packing cost');
  if (input.galvanised) {
    need('GALV_RATE', 'Galvanising rate (GI cost master)');
    need('ZINC_PCT', 'Zinc pick-up % (GI cost master)');
    need('GALV_TRANSPORT', 'Galvaniser transport (GI cost master)');
  }
  if (input.planConfirmed === false) missingMasters.push('End allowance / kerf – not confirmed by the plant (Planning Settings)');
  const interimLines: string[] = [];

  const blank: string[] = [];
  const outside: string[] = [];
  const nonBillable: string[] = [];
  const label = (l: CostLineInput) => `${l.group ? `${l.group}: ` : ''}row ${l.rowNo}${l.markNo ? ` (mark ${l.markNo})` : ''}`;

  const lines: LineResult[] = input.lines.map((l) => {
    const qty = l.qtyPerSet ?? 0;
    const base: LineResult = {
      rowNo: l.rowNo,
      markNo: l.markNo,
      section: l.section,
      category: l.category,
      scope: l.scope,
      group: l.group,
      sets: l.sets !== null && l.sets > 0 ? l.sets : 0,
      billable: !l.nonBillable,
      status: 'EXCLUDED',
      note: null,
      qtyPerSet: qty,
      kgPerM: null,
      kgPerMSource: null,
      blackWtKg: 0,
      galvWtKg: 0,
      wastagePct: null,
      wastageSource: null,
      rmRate: null,
      rmInterim: false,
      fabCat: l.category === 'STRUCTURE' ? (l.fabCat ?? null) : null,
      fabRate: null,
      fabUnit: null,
      rm: 0,
      fab: 0,
      galv: 0,
      freight: 0,
      inspPack: 0,
      commercial: 0,
      cost: 0,
      sell: 0,
      marginPct: 0,
    };
    if (!COSTED_SCOPES.has(l.scope)) return { ...base, note: l.scope === 'CLIENT_SUPPLY' ? 'Client supply' : 'Not in purchase scope' };
    if (!(qty > 0)) {
      blank.push(`${label(l)}: qty per set is blank`);
      return { ...base, status: 'FLAGGED', note: 'Qty per set is blank' };
    }
    if (l.sets === null || Number.isNaN(l.sets)) {
      blank.push(`${label(l)}: no set count for ${l.group ?? 'the structure'}`);
      return { ...base, status: 'FLAGGED', note: 'No set count for this structure' };
    }
    if (!(l.sets > 0)) return { ...base, note: '0 sets of this structure' };
    if (l.nonBillable) nonBillable.push(label(l));

    // Bought-out (scope or category): purchase rate per number, own margin.
    if (l.scope === 'BOUGHT_OUT' || l.category === 'BOUGHT_OUT') {
      const key = l.rateKey || l.description;
      const rate = take('BOUGHT_OUT', key, false);
      if (!rate) {
        blank.push(`${label(l)}: no bought-out rate for "${normSubject(key)}"`);
        return { ...base, category: 'BOUGHT_OUT', status: 'FLAGGED', note: `No bought-out rate for ${normSubject(key)}` };
      }
      const purchase = qty * rate.value;
      const commercial = purchase * commercialFactor;
      const cost = purchase + commercial;
      const m = val(boMargin);
      return { ...base, category: 'BOUGHT_OUT', status: 'COSTED', rmRate: rate.value, rm: r2(purchase), commercial: r2(commercial), cost: r2(cost), sell: r2(cost * (1 + m / 100)), marginPct: m };
    }

    // Nuts & bolts: own rate (Rs/kg needs unit wt, or Rs/set), own margin.
    if (l.category === 'NUTS_BOLTS') {
      const rate = take('NB_RATE', l.rateKey);
      if (!rate) {
        blank.push(`${label(l)}: no nuts & bolts rate for "${normSubject(l.rateKey)}"`);
        return { ...base, status: 'FLAGGED', note: 'No nuts & bolts rate' };
      }
      let purchase: number;
      let wt = 0;
      if (rate.unit === 'Rs/kg') {
        if (!(l.unitWtKg && l.unitWtKg > 0)) {
          blank.push(`${label(l)}: nuts & bolts rate is per kg but the unit weight is blank`);
          return { ...base, status: 'FLAGGED', note: 'Unit weight blank (rate is Rs/kg)' };
        }
        wt = qty * l.unitWtKg;
        purchase = wt * rate.value;
      } else purchase = qty * rate.value;
      const commercial = purchase * commercialFactor;
      const cost = purchase + commercial;
      const m = val(nbMargin);
      return { ...base, status: 'COSTED', blackWtKg: r3(wt), galvWtKg: r3(wt), rmRate: rate.value, rm: r2(purchase), commercial: r2(commercial), cost: r2(cost), sell: r2(cost * (1 + m / 100)), marginPct: m };
    }

    // Structure.
    const key = l.sectionKey;
    if (!key) {
      blank.push(`${label(l)}: section is blank`);
      return { ...base, status: 'FLAGGED', note: 'Section is blank' };
    }
    if (!input.purchaseItems[key]) {
      outside.push(`${label(l)}: ${l.section ?? key}`);
      const k = input.sectionKgm[key] ?? (l.kgPerM && l.kgPerM > 0 ? l.kgPerM : null);
      return { ...base, status: 'FLAGGED', note: `${l.section ?? key} is not in the RM purchase list – not costed`, kgPerM: k, kgPerMSource: input.sectionKgm[key] ? 'GTP' : k ? 'DRAWING' : null };
    }
    const gtp = input.sectionKgm[key];
    const kgm = gtp ?? (l.kgPerM && l.kgPerM > 0 ? l.kgPerM : null);
    const kgmSource = gtp ? 'GTP' : kgm ? 'DRAWING' : null;
    if (!kgm || !(l.lengthMm && l.lengthMm > 0)) {
      blank.push(`${label(l)}: ${!kgm ? 'kg/m (not in GTP sections)' : 'length'} is blank`);
      return { ...base, status: 'FLAGGED', note: !kgm ? 'kg/m blank – add the section to GTP Sections' : 'Length blank', kgPerM: kgm };
    }
    const rmRate = take('RM_RATE', key, false);
    if (!rmRate) {
      blank.push(`${label(l)}: no RM rate for ${input.purchaseItems[key]}`);
      return { ...base, status: 'FLAGGED', note: `No RM rate for ${input.purchaseItems[key]}`, kgPerM: kgm, kgPerMSource: kgmSource };
    }
    if (!l.fabCat) {
      blank.push(`${label(l)}: no fabrication category matches (set it on the line)`);
      return { ...base, status: 'FLAGGED', note: 'No fabrication category matches – not costed', kgPerM: kgm, kgPerMSource: kgmSource };
    }
    const fabRateRow = take('FAB_RATE', l.fabCat, false);
    if (!fabRateRow) {
      blank.push(`${label(l)}: no fabrication rate for ${l.fabCat}`);
      return { ...base, status: 'FLAGGED', note: `No fabrication rate for ${l.fabCat}`, kgPerM: kgm, kgPerMSource: kgmSource };
    }
    if (input.galvanised && !galvRate) {
      blank.push(`${label(l)}: no galvanising rate`);
      return { ...base, status: 'FLAGGED', note: 'No galvanising rate', kgPerM: kgm, kgPerMSource: kgmSource };
    }

    const black = (qty * l.lengthMm * kgm) / 1000;
    const galvWt = input.galvanised ? black * (1 + zinc) : black;
    const override = take('WASTAGE_PCT', key, false);
    let wastagePct: number;
    let wastageSource: LineResult['wastageSource'];
    if (override) {
      wastagePct = override.value;
      wastageSource = 'MASTER';
    } else if (input.planWastagePct[key] !== undefined) {
      wastagePct = input.planWastagePct[key];
      wastageSource = 'CUTTING_PLAN';
    } else {
      wastagePct = val(take('WASTAGE_PCT', null));
      wastageSource = 'DEFAULT';
    }
    const rm = black * rmRate.value * (1 + wastagePct / 100);
    // Per-kg rates on the black weight, per-piece rates on the BOM qty.
    const fab = fabRateRow.unit === 'Rs/pc' ? qty * fabRateRow.value : black * fabRateRow.value;
    const rmInterim = isInterim(rmRate);
    if (rmInterim) interimLines.push(label(l));
    const galv = input.galvanised && galvRate ? galvRate.value * (galvRate.unit === 'Rs/kg galv' ? galvWt : black) + galvTransport * black : 0;
    const freight = (galvWt / 1000) * freightMt;
    // Inspection / packing per kg of the weight handled (billed or not: the clamp is still packed).
    const inspPack = (inspection + packing) * (input.billingBasis === 'GALV' ? galvWt : black);
    const baseCost = rm + fab + galv + freight + inspPack;
    const commercial = baseCost * commercialFactor;
    const cost = baseCost + commercial;
    return {
      ...base,
      status: 'COSTED',
      note: l.nonBillable ? 'Non-billable: supplied, cost carried on billable kg' : null,
      kgPerM: kgm,
      kgPerMSource: kgmSource,
      blackWtKg: r3(black),
      galvWtKg: r3(galvWt),
      wastagePct: r2(wastagePct),
      wastageSource,
      rmRate: rmRate.value,
      rmInterim,
      fabRate: fabRateRow.value,
      fabUnit: fabRateRow.unit,
      rm: r2(rm),
      fab: r2(fab),
      galv: r2(galv),
      freight: r2(freight),
      inspPack: r2(inspPack),
      commercial: r2(commercial),
      cost: r2(cost),
      sell: r2(cost * (1 + va)),
      marginPct: vaPct,
    };
  });

  const costed = lines.filter((l) => l.status === 'COSTED');
  const tot = (ls: LineResult[], f: (l: LineResult) => number) => ls.reduce((a, l) => a + f(l) * l.sets, 0);
  const struct = costed.filter((l) => l.category === 'STRUCTURE');
  const nb = costed.filter((l) => l.category === 'NUTS_BOLTS');
  const bo = costed.filter((l) => l.category === 'BOUGHT_OUT');
  const billedOf = (l: LineResult) => (l.billable ? (input.billingBasis === 'GALV' ? l.galvWtKg : l.blackWtKg) : 0);

  // Per structure.
  const groupNames = [...new Set(input.lines.map((l) => l.group ?? ''))];
  const groups: GroupResult[] = groupNames.map((g) => {
    const gl = lines.filter((l) => (l.group ?? '') === g);
    const sets = gl.find((l) => l.sets > 0)?.sets ?? 0;
    const gs = gl.filter((l) => l.status === 'COSTED' && l.category === 'STRUCTURE');
    const one = (f: (l: LineResult) => number) => gs.reduce((a, l) => a + f(l), 0);
    return {
      name: g || 'Structure',
      sets,
      blackWtPerSet: r3(one((l) => l.blackWtKg)),
      galvWtPerSet: r3(one((l) => l.galvWtKg)),
      billedWtPerSet: r3(one(billedOf)),
      sellPerSet: r2(one((l) => l.sell)),
      blackWtKg: r3(one((l) => l.blackWtKg) * sets),
      billedWtKg: r3(one(billedOf) * sets),
      sell: r2(one((l) => l.sell) * sets),
      otherSell: r2(gl.filter((l) => l.status === 'COSTED' && l.category !== 'STRUCTURE').reduce((a, l) => a + l.sell * l.sets, 0)),
    };
  });
  const single = groups.length === 1 ? groups[0] : null;

  const billedWt = tot(struct, billedOf);
  const sell = tot(struct, (l) => l.sell);
  const cost = tot(struct, (l) => l.cost);
  const structure = {
    blackWtKg: r3(tot(struct, (l) => l.blackWtKg)),
    galvWtKg: r3(tot(struct, (l) => l.galvWtKg)),
    cost: r2(cost),
    sell: r2(sell),
    billedWtKg: r3(billedWt),
    nonBillableWtKg: r3(tot(struct.filter((l) => !l.billable), (l) => (input.billingBasis === 'GALV' ? l.galvWtKg : l.blackWtKg))),
    sellPerKg: billedWt > 0 ? r2(sell / billedWt) : 0,
    costPerKg: billedWt > 0 ? r2(cost / billedWt) : 0,
  };
  const perSet: Bucket | null =
    single && single.sets > 0
      ? { blackWtKg: single.blackWtPerSet, galvWtKg: single.galvWtPerSet, cost: r2(cost / single.sets), sell: single.sellPerSet }
      : null;
  const nbSell = tot(nb, (l) => l.sell);
  const boSell = tot(bo, (l) => l.sell);
  const nutsBolts = { cost: r2(tot(nb, (l) => l.cost)), sell: r2(nbSell), perSetSell: single && single.sets > 0 ? r2(nbSell / single.sets) : null };
  const boughtOut = { cost: r2(tot(bo, (l) => l.cost)), sell: r2(boSell), perSetSell: single && single.sets > 0 ? r2(boSell / single.sets) : null };

  const messages: string[] = [];
  const belowMinVa = !!minVa && vaPct < minVa.value - 1e-9;
  if (!minVa) messages.push('Minimum VA % is not set in the Costing Master.');
  if (belowMinVa) messages.push(`VA ${vaPct}% is below the minimum ${minVa!.value}%.`);
  if (nb.length && !nbMargin) messages.push('Nuts & bolts margin % is not set in the Costing Master (0% used).');
  if (bo.length && !boMargin) messages.push('Bought-out margin % is not set in the Costing Master (0% used).');
  let variancePct: number | null = null;
  if (input.lastPricePerKg && input.lastPricePerKg.value > 0 && structure.sellPerKg > 0) {
    variancePct = r2(((structure.sellPerKg - input.lastPricePerKg.value) / input.lastPricePerKg.value) * 100);
    messages.push(`${variancePct > 0 ? '+' : ''}${variancePct}% vs last quoted Rs ${input.lastPricePerKg.value}/kg (${input.lastPricePerKg.ref}).`);
  }
  if (missingMasters.length) messages.push(`Not yet in the masters (price cannot be applied): ${missingMasters.join('; ')}.`);
  if (interimLines.length) messages.push(`${interimLines.length} line(s) use an INTERIM RM rate (supplier quote) – replace with the PO/GRN rate when purchase sends it.`);
  if (blank.length) messages.push(`${blank.length} line(s) have a blank weight, rate or set count.`);
  if (outside.length) messages.push(`${outside.length} line(s) use a section outside the RM purchase list (not costed).`);
  if (nonBillable.length) messages.push(`${nonBillable.length} non-billable line(s): supplied and costed, but their ${r3(structure.nonBillableWtKg / 1000)} MT is not billed – the cost is carried on the billable kg.`);
  const fractional = groups.filter((g) => g.sets > 0 && Math.abs(g.sets - Math.round(g.sets)) > 1e-6);
  if (fractional.length) messages.push(`Fractional set count: ${fractional.map((g) => `${g.name} ${g.sets}`).join('; ')}.`);
  const totalSets = r3(groups.reduce((a, g) => a + g.sets, 0));
  if (!(totalSets > 0)) messages.push('No set count: check the item quantity / structure set counts.');
  if (costed.length === 0) messages.push('No line could be costed.');

  return {
    lines,
    groups,
    vaPct,
    minVaPct: minVa ? minVa.value : null,
    nbMarginPct: val(nbMargin),
    boMarginPct: val(boMargin),
    sets: single ? single.sets : null,
    totalSets,
    perSet,
    structure,
    nutsBolts,
    boughtOut,
    grandSell: r2(structure.sell + nutsBolts.sell + boughtOut.sell),
    ratesUsed: [...used.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.subject.localeCompare(b.subject)),
    checks: {
      belowMinVa,
      variancePct,
      varianceRef: input.lastPricePerKg?.ref ?? null,
      blankLines: blank,
      outsidePurchaseList: outside,
      nonBillable,
      missingMasters,
      interimLines,
      ok: blank.length === 0 && outside.length === 0 && missingMasters.length === 0 && totalSets > 0 && costed.length > 0,
      messages,
    },
  };
}

export function setsFromItem(qty: number | null, uom: string | null, setWtKg: number): { sets: number; basis: 'SETS' | 'WEIGHT' | 'UNKNOWN' } {
  if (qty === null || !(qty > 0)) return { sets: 0, basis: 'UNKNOWN' };
  const u = String(uom ?? '').trim().toUpperCase().replace(/[.\s]/g, '');
  if (/^(KG|KGS)$/.test(u)) return { sets: setWtKg > 0 ? r3(qty / setWtKg) : 0, basis: 'WEIGHT' };
  if (/^(MT|TON|TONNE|TONNES|MTS)$/.test(u)) return { sets: setWtKg > 0 ? r3((qty * 1000) / setWtKg) : 0, basis: 'WEIGHT' };
  return { sets: qty, basis: 'SETS' };
}

/** Wastage % per section from a cutting plan's section summaries: scrap / net x 100. */
/**
 * Wastage % per section from a cutting plan's section summaries: scrap / net x 100. A section that
 * needs fewer than `minBars` bars is left out (the Costing Master default applies): a few short
 * pieces would otherwise carry a whole bar (offcut goes to stock), e.g. 787% on 2 pieces of 338 mm.
 */
export function wastageFromPlan(sections: { sectionKey: string; netKg: number; scrapKg: number; bars?: number }[], minBars = 0): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of sections) if (s.netKg > 0 && (s.bars ?? Infinity) >= minBars) out[s.sectionKey] = r2((s.scrapKg / s.netKg) * 100);
  return out;
}
