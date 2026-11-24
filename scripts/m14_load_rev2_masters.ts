// M14 Rev 2 (Puja, CEEBUILD_DEV_BLOCK_REV2_24-11-2026 §4): seed the Costing Master.
//  4.1 RM: Anchal Ispat L1 20-Nov ESTIMATE rows were loaded on 23-Nov (m14_load_rates_23nov.ts); the
//      rev2 migration tags them rate_type ESTIMATE. Not re-added here.
//  4.3 GI: labour Solitare 3.80 (default), zinc issue 3.8% (IS), zinc Rs 379/kg excl. (Hind Commercial
//      18-07-2026, weekly update), GI transport 0.70 (ESTIMATE, Puja to confirm).
//  4.4 Nuts & bolts DEFAULT 93.50 Rs/kg (R G International PO 22-07-2026, monthly update).
//  4.5 Finance: 45 days credit (LC / MSME VBD), interest 1% per 30 days of the selling value.
//  4.6 VA default 12% (zinc included in the base).
//  4.7 Still pending (left blank, flagged by the costing): LC/BG, inspection, packing, minimum VA %,
//      kerf / end allowance, 40 NB tube rate, eye-bolt threading.
//
// Run (writes to DATABASE_URL – back up first):
//   node --conditions=react-server --import tsx scripts/m14_load_rev2_masters.ts [--user=<id>] [--dry]
// Idempotent: a rate already present for the same kind + subject + effective date is skipped.

export {};

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const userId = Number(args.find((a) => a.startsWith('--user='))?.split('=')[1] ?? 6);

const REV2 = 'Rev 2 dev block 24-11-2026';

interface Seed {
  kind: string;
  subject?: string;
  value: number;
  unit: string;
  effectiveFrom: string;
  source: string;
  rateType?: 'ESTIMATE' | 'QUOTE' | 'PO' | 'GRN' | 'ACTUAL';
  supplier?: string;
  owner?: string;
  updateFreqDays?: number;
}

const ANCHAL = `${REV2} §4.1 – comparative 20-11-2026, Anchal Ispat L1, carriage paid Dhulagarh, excl. GST, 10 days credit; family rate for every size (MR Steel L2 = QUOTE, not used)`;
const fam = (subject: string, value: number): Seed => ({ kind: 'RM_RATE', subject, value, unit: 'Rs/kg', effectiveFrom: '2026-11-20', rateType: 'ESTIMATE', supplier: 'Anchal Ispat', owner: 'Purchase – Baptu', updateFreqDays: 7, source: ANCHAL });

const SEEDS: Seed[] = [
  // 4.1 RM family rows (size row -> family row): ISMC all 50.50, angles all 50.00, flats all 50.50, round 50.50
  fam('CHANNEL', 50.5),
  fam('ANGLE', 50.0),
  fam('FLAT', 50.5),
  fam('ROD', 50.5),
  // 4.3 GI / galvanising
  { kind: 'GALV_RATE', value: 3.8, unit: 'Rs/kg black', effectiveFrom: '2026-11-24', rateType: 'ESTIMATE', supplier: 'Solitare', owner: 'Puja', source: `${REV2} §4.3 – AD report history, excl. GST; galvaniser choice to be confirmed by Puja` },
  { kind: 'ZINC_PCT', value: 3.8, unit: '%', effectiveFrom: '2026-11-24', rateType: 'ESTIMATE', owner: 'Puja', source: `${REV2} §4.3 – zinc issue IS 3.8% (commercial 3.0%, pipe 10%, DC Power 4%)` },
  { kind: 'ZINC_RATE', value: 379, unit: 'Rs/kg', effectiveFrom: '2026-07-18', rateType: 'PO', supplier: 'Hind Commercial', owner: 'Purchase – Baptu', updateFreqDays: 7, source: `${REV2} §4.3 – Rs 447.22 incl. GST = Rs 379 excl., 18-07-2026; update weekly` },
  { kind: 'GALV_TRANSPORT', value: 0.7, unit: 'Rs/kg', effectiveFrom: '2026-11-24', rateType: 'ESTIMATE', owner: 'Puja', source: `${REV2} §4.3 – both ways, old Jan-2025 data, Puja to confirm (kanta Rs 50–200/trip not included)` },
  // 4.4 Nuts & bolts
  { kind: 'NB_RATE', value: 93.5, unit: 'Rs/kg', effectiveFrom: '2026-07-22', rateType: 'PO', supplier: 'R G International', owner: 'Purchase – Baptu', updateFreqDays: 30, source: `${REV2} §4.4 – GI nut+bolt+washer M12–M20 Gr 4.6/5.6, 3,305 kg, for lots >= 100 kg (small lots 146–148, Fasteners India); M10 no rate` },
  // 4.5 Finance
  { kind: 'CREDIT_DAYS', value: 45, unit: 'days', effectiveFrom: '2026-11-24', rateType: 'ACTUAL', owner: 'Accounts', source: `${REV2} §4.5 – 45 days under LC / MSME vendor bill discounting; party terms override, advance = 0` },
  { kind: 'INTEREST_PCT', value: 1, unit: '%', effectiveFrom: '2026-11-24', rateType: 'ACTUAL', owner: 'Accounts', source: `${REV2} §4.5 – 1% per 30 days of selling value before GST (45 days = 1.5%)` },
  // 4.6 VA
  { kind: 'VA_PCT', value: 12, unit: '%', effectiveFrom: '2026-11-24', rateType: 'ACTUAL', owner: 'Puja', source: `${REV2} §4.6 – default VA on the full cost base incl. zinc; per-docket override by Admin` },
];

async function main() {
  const { prisma } = await import('../src/lib/prisma');
  const { addRate } = await import('../src/modules/costing/server/master');

  const u = await prisma.user.findUnique({ where: { id: userId } });
  if (!u || u.role !== 'Admin') throw new Error(`User ${userId} must be an active Admin`);
  const user = { id: u.id, username: u.username, name: u.name, role: 'Admin' as const };
  console.log(`DB: ${String(process.env.DATABASE_URL).replace(/\/\/[^@]+@/, '//***@')} as ${u.name}${dry ? ' (DRY RUN)' : ''}`);

  for (const s of SEEDS) {
    const subject = s.subject ?? 'DEFAULT';
    const exists = await prisma.costRate.findFirst({ where: { kind: s.kind, subject, effectiveFrom: new Date(`${s.effectiveFrom}T00:00:00Z`) } });
    if (exists) {
      console.log(`skip ${s.kind} ${subject} (already ${exists.value.toString()} ${exists.unit} from ${s.effectiveFrom})`);
      continue;
    }
    if (!dry) await addRate({ ...s, subject }, user);
    console.log(`add  ${s.kind} ${subject} = ${s.value} ${s.unit} from ${s.effectiveFrom} [${s.rateType ?? '-'}]`);
  }

  // What the costing will still flag as pending / missing.
  const kinds = ['MIN_VA_PCT', 'LC_BG_PCT', 'INSPECTION', 'PACKING', 'FREIGHT_MT', 'NB_MARGIN_PCT', 'BO_MARGIN_PCT'];
  for (const k of kinds) {
    const n = await prisma.costRate.count({ where: { kind: k } });
    console.log(`--   ${k}: ${n ? `${n} row(s)` : 'blank (pending)'}`);
  }
  const rm = await prisma.costRate.count({ where: { kind: 'RM_RATE' } });
  console.log(`--   RM_RATE rows: ${rm}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
