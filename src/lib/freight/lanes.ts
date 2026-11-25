// Freight Master lanes from the FREIGHT HISTORY RECORD (Rev 2 §5, Puja 25-11). Pure functions.
// Rules: trucks only for Ceebuild (no trailer / container / courier); per destination state and
// truck class, the lowest trip rate of the last 6 months, else the latest older rate + 5 %;
// outliers (Rs/MT outside 0.5x-2x the lane median) dropped; full-load Rs/MT = trip rate / capacity.

export interface FoRow {
  fromLoc: string | null;
  toLoc: string | null;
  toPin: string | null;
  vehicleType: string | null;
  /** yyyy-mm-dd (our document date, else the FO date). */
  date: string | null;
  /** Rs per trip. */
  tripRate: number | null;
}

export interface Lane {
  state: string;
  capacityMt: number;
  tripRate: number;
  ratePerMt: number;
  basis: 'LOWEST_6M' | 'OLDER_PLUS_5';
  trips: number;
  lastDate: string;
  outliers: number;
}

const BY3: Record<string, string> = {
  '737': 'Sikkim',
  ...Object.fromEntries(['814', '815', '816', '822', '825', '826', '827', '828', '829', '831', '832', '833', '834', '835'].map((p) => [p, 'Jharkhand'])),
  '403': 'Goa',
  '605': 'Puducherry',
  '682': 'Kerala',
  '744': 'Andaman & Nicobar',
  '790': 'Arunachal Pradesh',
  '791': 'Arunachal Pradesh',
  '792': 'Arunachal Pradesh',
  '793': 'Meghalaya',
  '794': 'Meghalaya',
  '795': 'Manipur',
  '796': 'Mizoram',
  '797': 'Nagaland',
  '798': 'Nagaland',
  '799': 'Tripura',
  '160': 'Chandigarh',
};
const BY2: Record<string, string> = {
  '11': 'Delhi',
  '12': 'Haryana',
  '13': 'Haryana',
  '14': 'Punjab',
  '15': 'Punjab',
  '16': 'Punjab',
  '17': 'Himachal Pradesh',
  '18': 'Jammu & Kashmir',
  '19': 'Jammu & Kashmir',
  '20': 'Uttar Pradesh',
  '21': 'Uttar Pradesh',
  '22': 'Uttar Pradesh',
  '23': 'Uttar Pradesh',
  '24': 'Uttar Pradesh',
  '25': 'Uttar Pradesh',
  '26': 'Uttarakhand',
  '27': 'Uttar Pradesh',
  '28': 'Uttar Pradesh',
  '30': 'Rajasthan',
  '31': 'Rajasthan',
  '32': 'Rajasthan',
  '33': 'Rajasthan',
  '34': 'Rajasthan',
  '36': 'Gujarat',
  '37': 'Gujarat',
  '38': 'Gujarat',
  '39': 'Gujarat',
  '40': 'Maharashtra',
  '41': 'Maharashtra',
  '42': 'Maharashtra',
  '43': 'Maharashtra',
  '44': 'Maharashtra',
  '45': 'Madhya Pradesh',
  '46': 'Madhya Pradesh',
  '47': 'Madhya Pradesh',
  '48': 'Madhya Pradesh',
  '49': 'Chhattisgarh',
  '50': 'Telangana',
  '51': 'Andhra Pradesh',
  '52': 'Andhra Pradesh',
  '53': 'Andhra Pradesh',
  '56': 'Karnataka',
  '57': 'Karnataka',
  '58': 'Karnataka',
  '59': 'Karnataka',
  '60': 'Tamil Nadu',
  '61': 'Tamil Nadu',
  '62': 'Tamil Nadu',
  '63': 'Tamil Nadu',
  '64': 'Tamil Nadu',
  '67': 'Kerala',
  '68': 'Kerala',
  '69': 'Kerala',
  '70': 'West Bengal',
  '71': 'West Bengal',
  '72': 'West Bengal',
  '73': 'West Bengal',
  '74': 'West Bengal',
  '75': 'Odisha',
  '76': 'Odisha',
  '77': 'Odisha',
  '78': 'Assam',
  '80': 'Bihar',
  '81': 'Bihar',
  '82': 'Bihar',
  '83': 'Bihar',
  '84': 'Bihar',
  '85': 'Bihar',
};

/** State of a 6-digit Indian PIN, or null. */
export function stateOfPin(pin: string | number | null | undefined): string | null {
  const p = String(pin ?? '').replace(/\D/g, '');
  if (p.length !== 6) return null;
  return BY3[p.slice(0, 3)] ?? BY2[p.slice(0, 2)] ?? null;
}

/** Truck capacity in MT from the vehicle type ("TRUCK-16MT" -> 16); null for anything but a sized truck. */
export function truckCapacityMt(vehicleType: string | null | undefined): number | null {
  const m = String(vehicleType ?? '').toUpperCase().match(/^TRUCK\s*-?\s*(\d+(?:\.\d+)?)\s*MT$/);
  return m ? Number(m[1]) : null;
}

const addMonths = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Lanes from `origin` (matched in FROM_LOC) as on `asOf` (yyyy-mm-dd). */
export function deriveLanes(rows: FoRow[], asOf: string, origin = /DHULAGARH/i): Lane[] {
  const cutoff = addMonths(asOf, -6);
  const groups = new Map<string, { state: string; cap: number; rows: { date: string; rate: number }[] }>();
  for (const r of rows) {
    if (!r.fromLoc || !origin.test(r.fromLoc)) continue;
    const cap = truckCapacityMt(r.vehicleType);
    const state = stateOfPin(r.toPin);
    if (!cap || !state || !r.date || r.date > asOf || !(r.tripRate && r.tripRate > 0)) continue;
    const k = `${state}|${cap}`;
    const g = groups.get(k) ?? { state, cap, rows: [] };
    g.rows.push({ date: r.date, rate: r.tripRate });
    groups.set(k, g);
  }
  const out: Lane[] = [];
  for (const g of groups.values()) {
    const med = median(g.rows.map((x) => x.rate));
    const ok = g.rows.filter((x) => x.rate >= med * 0.5 && x.rate <= med * 2);
    if (!ok.length) continue;
    const recent = ok.filter((x) => x.date >= cutoff);
    let trip: number;
    let basis: Lane['basis'];
    let last: string;
    if (recent.length) {
      trip = Math.min(...recent.map((x) => x.rate));
      basis = 'LOWEST_6M';
      last = recent.map((x) => x.date).sort().at(-1)!;
    } else {
      const latest = [...ok].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
      trip = latest.rate * 1.05;
      basis = 'OLDER_PLUS_5';
      last = latest.date;
    }
    out.push({ state: g.state, capacityMt: g.cap, tripRate: r2(trip), ratePerMt: r2(trip / g.cap), basis, trips: ok.length, lastDate: last, outliers: g.rows.length - ok.length });
  }
  return out.sort((a, b) => a.state.localeCompare(b.state) || a.capacityMt - b.capacityMt);
}

/**
 * Per state, from one lane: the 16 MT class (24-28 ft open truck, the commonest Ceebuild load), else
 * the nearest class from 9 to 25 MT. FREIGHT_TRIP = its trip rate; FREIGHT_MT = trip rate / capacity
 * (full load). The lowest Rs/MT across classes is not used: short local trips on big trucks distort it.
 */
export function stateFreight(lanes: Lane[]): { state: string; perMt: Lane; trip: Lane }[] {
  const states = [...new Set(lanes.map((l) => l.state))];
  const out: { state: string; perMt: Lane; trip: Lane }[] = [];
  for (const s of states) {
    // At least 3 trips on the lane: one-off trips (often a wrong PIN) are not a rate.
    const ls = lanes.filter((l) => l.state === s && l.capacityMt >= 9 && l.capacityMt <= 25 && l.trips >= 3);
    if (!ls.length) continue;
    const trip = ls.reduce((a, b) => (Math.abs(b.capacityMt - 16) < Math.abs(a.capacityMt - 16) ? b : a));
    out.push({ state: s, perMt: trip, trip });
  }
  return out;
}
