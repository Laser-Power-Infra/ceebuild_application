// M14 quotation costing from a BOM. Pure functions (no I/O) so every number can be unit-tested.
//
// Per structure line, for ONE set (totals are then x sets):
//   black wt  = qty/set x length x kg/m (kg/m from the GTP section master)
//   galv wt   = black wt x (1 + zinc pick-up %)           (black wt when not galvanised)
//   RM        = black wt x RM rate x (1 + wastage %)       (wastage: master override, else cutting plan)
//   fab       = black wt x fabrication rate (by fabrication type)
//   galv      = galvanising rate x (galv or black wt, per the rate unit) + transport x black wt
//   freight   = despatch wt / 1000 x Rs/MT (destination state)
//   inspection, packing = Rs/kg x billed wt
//   interest  = base x interest % x credit days / 365;  LC/BG = base x LC/BG %
//   cost      = base + interest + LC/BG;  selling = cost x (1 + VA %)
// Nuts & bolts (category NUTS_BOLTS) and bought-out lines are costed from their own rate and kept
// out of the structure weight and per-kg price; they are quoted as separate offer lines.
// Only lines in the purchase scope are costed (IN_SCOPE, BOUGHT_OUT); NOT_IN_SCOPE / CLIENT_SUPPLY
// and non-billable lines are listed but excluded.

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
  'BOUGHT_OUT',
] as const;
export type RateKind = (typeof RATE_KINDS)[number];

/** Label, allowed units and what the subject means, per kind (drives the Costing Master UI). */
export const RATE_META: Record<RateKind, { label: string; units: string[]; subject: string; perSubject: boolean }> = {
  RM_RATE: { label: 'RM rate', units: ['Rs/kg'], subject: 'RM purchase item', perSubject: true },
  WASTAGE_PCT: { label: 'Wastage % (override of cutting plan)', units: ['%'], subject: 'RM purchase item or DEFAULT', perSubject: true },
  FAB_RATE: { label: 'Fabrication / conversion', units: ['Rs/kg'], subject: 'Fabrication type', perSubject: true },
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
  BOUGHT_OUT: { label: 'Bought-out item', units: ['Rs/no'], subject: 'Item name (danger board, stay set ...)', perSubject: true },
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
}

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
  nonBillable: boolean;
  rateKey: string | null;
}

export interface CostInput {
  lines: CostLineInput[];
  sets: number;
  fabType: string;
  galvanised: boolean;
  billingBasis: BillingBasis;
  destState: string | null;
  /** VA % to quote; null = the Costing Master minimum. */
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
}

export type LineStatus = 'COSTED' | 'EXCLUDED' | 'FLAGGED';

export interface LineResult {
  rowNo: number;
  markNo: string | null;
  section: string | null;
  category: string;
  scope: string;
  status: LineStatus;
  /** Why the line is excluded / flagged. */
  note: string | null;
  qtyPerSet: number;
  kgPerM: number | null;
  kgPerMSource: 'GTP' | 'DRAWING' | null;
  /** Per set. */
  blackWtKg: number;
  galvWtKg: number;
  wastagePct: number | null;
  wastageSource: 'MASTER' | 'CUTTING_PLAN' | 'DEFAULT' | null;
  rmRate: number | null;
  /** Per set, Rs. */
  rm: number;
  fab: number;
  galv: number;
  freight: number;
  inspPack: number;
  commercial: number;
  cost: number;
  sell: number;
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

export interface CostResult {
  lines: LineResult[];
  vaPct: number;
  minVaPct: number | null;
  sets: number;
  /** Structure only, per one set. */
  perSet: Bucket;
  /** Structure only, all sets. */
  structure: Bucket & { sellPerKg: number; costPerKg: number; billedWtKg: number };
  nutsBolts: { cost: number; sell: number; perSetSell: number };
  boughtOut: { cost: number; sell: number; perSetSell: number };
  grandSell: number;
  ratesUsed: RateUsed[];
  checks: {
    belowMinVa: boolean;
    variancePct: number | null;
    varianceRef: string | null;
    /** Lines with blank weight or rate (they stop the price being applied). */
    blankLines: string[];
    outsidePurchaseList: string[];
    nonBillable: string[];
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
  const fabRateRow = take('FAB_RATE', input.fabType);

  const blank: string[] = [];
  const outside: string[] = [];
  const nonBillable: string[] = [];
  const label = (l: CostLineInput) => `row ${l.rowNo}${l.markNo ? ` (mark ${l.markNo})` : ''}`;

  const lines: LineResult[] = input.lines.map((l) => {
    const qty = l.qtyPerSet ?? 0;
    const base: LineResult = {
      rowNo: l.rowNo,
      markNo: l.markNo,
      section: l.section,
      category: l.category,
      scope: l.scope,
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
      rm: 0,
      fab: 0,
      galv: 0,
      freight: 0,
      inspPack: 0,
      commercial: 0,
      cost: 0,
      sell: 0,
    };
    if (!COSTED_SCOPES.has(l.scope)) return { ...base, note: l.scope === 'CLIENT_SUPPLY' ? 'Client supply' : 'Not in purchase scope' };
    if (l.nonBillable) {
      nonBillable.push(label(l));
      return { ...base, note: 'Non-billable' };
    }
    if (!(qty > 0)) {
      blank.push(`${label(l)}: qty per set is blank`);
      return { ...base, status: 'FLAGGED', note: 'Qty per set is blank' };
    }

    // Bought-out (scope or category): purchase rate per number.
    if (l.scope === 'BOUGHT_OUT' || l.category === 'BOUGHT_OUT') {
      const key = l.rateKey || l.description;
      const rate = take('BOUGHT_OUT', key, false);
      if (!rate) {
        blank.push(`${label(l)}: no bought-out rate for "${normSubject(key)}"`);
        return { ...base, status: 'FLAGGED', note: `No bought-out rate for ${normSubject(key)}` };
      }
      const purchase = qty * rate.value;
      const commercial = purchase * commercialFactor;
      const cost = purchase + commercial;
      return { ...base, category: 'BOUGHT_OUT', status: 'COSTED', rmRate: rate.value, rm: r2(purchase), commercial: r2(commercial), cost: r2(cost), sell: r2(cost * (1 + va)) };
    }

    // Nuts & bolts: own rate, Rs/kg (needs unit wt) or Rs/set.
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
      return { ...base, status: 'COSTED', blackWtKg: r3(wt), galvWtKg: r3(wt), rmRate: rate.value, rm: r2(purchase), commercial: r2(commercial), cost: r2(cost), sell: r2(cost * (1 + va)) };
    }

    // Structure.
    const key = l.sectionKey;
    if (!key) {
      blank.push(`${label(l)}: section is blank`);
      return { ...base, status: 'FLAGGED', note: 'Section is blank' };
    }
    if (!input.purchaseItems[key]) {
      outside.push(`${label(l)}: ${l.section ?? key}`);
      return { ...base, status: 'FLAGGED', note: `${l.section ?? key} is not in the RM purchase list – not costed` };
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
    if (!fabRateRow) {
      blank.push(`${label(l)}: no fabrication rate for ${input.fabType}`);
      return { ...base, status: 'FLAGGED', note: `No fabrication rate for ${input.fabType}`, kgPerM: kgm, kgPerMSource: kgmSource };
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
    const fab = black * fabRateRow.value;
    const galv = input.galvanised && galvRate ? galvRate.value * (galvRate.unit === 'Rs/kg galv' ? galvWt : black) + galvTransport * black : 0;
    const freight = (galvWt / 1000) * freightMt;
    const billed = input.billingBasis === 'GALV' ? galvWt : black;
    const inspPack = (inspection + packing) * billed;
    const baseCost = rm + fab + galv + freight + inspPack;
    const commercial = baseCost * commercialFactor;
    const cost = baseCost + commercial;
    return {
      ...base,
      status: 'COSTED',
      kgPerM: kgm,
      kgPerMSource: kgmSource,
      blackWtKg: r3(black),
      galvWtKg: r3(galvWt),
      wastagePct: r2(wastagePct),
      wastageSource,
      rmRate: rmRate.value,
      rm: r2(rm),
      fab: r2(fab),
      galv: r2(galv),
      freight: r2(freight),
      inspPack: r2(inspPack),
      commercial: r2(commercial),
      cost: r2(cost),
      sell: r2(cost * (1 + va)),
    };
  });

  const costed = lines.filter((l) => l.status === 'COSTED');
  const sum = (ls: LineResult[], f: (l: LineResult) => number) => ls.reduce((a, l) => a + f(l), 0);
  const struct = costed.filter((l) => l.category === 'STRUCTURE');
  const nb = costed.filter((l) => l.category === 'NUTS_BOLTS');
  const bo = costed.filter((l) => l.category === 'BOUGHT_OUT');
  const sets = input.sets > 0 ? input.sets : 0;

  const perSet: Bucket = {
    blackWtKg: r3(sum(struct, (l) => l.blackWtKg)),
    galvWtKg: r3(sum(struct, (l) => l.galvWtKg)),
    cost: r2(sum(struct, (l) => l.cost)),
    sell: r2(sum(struct, (l) => l.sell)),
  };
  const billedPerSet = input.billingBasis === 'GALV' ? perSet.galvWtKg : perSet.blackWtKg;
  const sellPerKg = billedPerSet > 0 ? r2(perSet.sell / billedPerSet) : 0;
  const costPerKg = billedPerSet > 0 ? r2(perSet.cost / billedPerSet) : 0;
  const nbSellSet = sum(nb, (l) => l.sell);
  const boSellSet = sum(bo, (l) => l.sell);

  const structure = {
    blackWtKg: r3(perSet.blackWtKg * sets),
    galvWtKg: r3(perSet.galvWtKg * sets),
    cost: r2(perSet.cost * sets),
    sell: r2(perSet.sell * sets),
    sellPerKg,
    costPerKg,
    billedWtKg: r3(billedPerSet * sets),
  };
  const nutsBolts = { cost: r2(sum(nb, (l) => l.cost) * sets), sell: r2(nbSellSet * sets), perSetSell: r2(nbSellSet) };
  const boughtOut = { cost: r2(sum(bo, (l) => l.cost) * sets), sell: r2(boSellSet * sets), perSetSell: r2(boSellSet) };

  const messages: string[] = [];
  const belowMinVa = !!minVa && vaPct < minVa.value - 1e-9;
  if (!minVa) messages.push('Minimum VA % is not set in the Costing Master.');
  if (belowMinVa) messages.push(`VA ${vaPct}% is below the minimum ${minVa!.value}%.`);
  let variancePct: number | null = null;
  if (input.lastPricePerKg && input.lastPricePerKg.value > 0 && sellPerKg > 0) {
    variancePct = r2(((sellPerKg - input.lastPricePerKg.value) / input.lastPricePerKg.value) * 100);
    messages.push(`${variancePct > 0 ? '+' : ''}${variancePct}% vs last quoted Rs ${input.lastPricePerKg.value}/kg (${input.lastPricePerKg.ref}).`);
  }
  if (blank.length) messages.push(`${blank.length} line(s) have a blank weight or rate.`);
  if (outside.length) messages.push(`${outside.length} line(s) use a section outside the RM purchase list (not costed).`);
  if (nonBillable.length) messages.push(`${nonBillable.length} non-billable line(s) excluded.`);
  if (!(sets > 0)) messages.push('Number of sets is zero: check the item quantity.');
  if (struct.length === 0 && nb.length === 0 && bo.length === 0) messages.push('No line could be costed.');

  return {
    lines,
    vaPct,
    minVaPct: minVa ? minVa.value : null,
    sets,
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
      ok: blank.length === 0 && outside.length === 0 && sets > 0 && costed.length > 0,
      messages,
    },
  };
}

/** Unit of the item quantity -> how many BOM sets it means. KG/MT quantities divide by the set weight. */
export function setsFromItem(qty: number | null, uom: string | null, setWtKg: number): { sets: number; basis: 'SETS' | 'WEIGHT' | 'UNKNOWN' } {
  if (qty === null || !(qty > 0)) return { sets: 0, basis: 'UNKNOWN' };
  const u = String(uom ?? '').trim().toUpperCase().replace(/[.\s]/g, '');
  if (/^(KG|KGS)$/.test(u)) return { sets: setWtKg > 0 ? r3(qty / setWtKg) : 0, basis: 'WEIGHT' };
  if (/^(MT|TON|TONNE|TONNES|MTS)$/.test(u)) return { sets: setWtKg > 0 ? r3((qty * 1000) / setWtKg) : 0, basis: 'WEIGHT' };
  return { sets: qty, basis: 'SETS' };
}

/** Wastage % per section from a cutting plan's section summaries: scrap / net x 100. */
export function wastageFromPlan(sections: { sectionKey: string; netKg: number; scrapKg: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of sections) if (s.netKg > 0) out[s.sectionKey] = r2((s.scrapKg / s.netKg) * 100);
  return out;
}
