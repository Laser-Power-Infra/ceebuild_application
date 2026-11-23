// M14 Costing Master load (Puja, 23-Nov-2026):
//  A. Fabrication / conversion rates per job-work chart category (Satya ji, 23-Nov).
//  C. Interim RM rates: Anchal Ispat L1 quote of 20-Nov (carriage paid, excl. GST), marked INTERIM
//     until purchase sends the PO/GRN rates.
//  D. End allowance / kerf kept at 0 and Planning Settings left "not confirmed".
// Everything else still pending (N&B, bought-out, freight, commercial, GI master) is left blank, so
// the costing lists it and blocks Apply until it is filled.
//
// Run (writes to DATABASE_URL):
//   node --conditions=react-server --import tsx scripts/m14_load_rates_23nov.ts [--user=<id>] [--dry]
// Idempotent: a rate already present for the same kind + subject + effective date is skipped.

import { FAB_CAT_BY_CODE } from '../src/lib/costing/fab';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const userId = Number(args.find((a) => a.startsWith('--user='))?.split('=')[1] ?? 6);

const FAB_SRC = 'Satya ji job-work rate chart, 23-Nov-2026';
const FAB: [string, number, string?][] = [
  ['CH_ANG', 1.6],
  ['CLAMP_65_50', 1.7],
  ['CLAMP_40', 1.8],
  ['RADIUS_CLAMP', 1.8],
  ['WELDED', 2.5],
  ['TAPER_VCROSS', 2.8],
  ['CLAMP_30_25', 2.85],
  ['SQ_WASHER', 3.5],
  ['TUBE40_3000_DRILL', 16, ' – TO CONFIRM: chart Sr 15 shows Rs 100/pc for the same item'],
  ['TUBE40_1800_DRILL', 14],
  ['RB16_BOW', 6],
  ['RB16_CUT_560', 0.5],
  ['RB16_CUT_1800', 1.5],
  ['PLATE200_PUNCH', 1],
];

const RM_SRC = 'INTERIM – Anchal Ispat L1 quote 20-Nov-2026 (carriage paid, excl. GST); replace with PO/GRN rate';
const RM_DATE = '2026-11-20';
/** Section key -> Rs/kg. Flats: every FLAT item on the purchase list. */
const RM: Record<string, number> = { ISMC100X50: 50.5, ISMC75X40: 50.5, ISA50X50X6: 50.0, RB16: 50.5 };
const FLAT_RATE = 50.5;

async function main() {
  const { prisma } = await import('../src/lib/prisma');
  const { addRate } = await import('../src/modules/costing/server/master');

  const u = await prisma.user.findUnique({ where: { id: userId } });
  if (!u || u.role !== 'Admin') throw new Error(`User ${userId} must be an active Admin`);
  const user = { id: u.id, username: u.username, name: u.name, role: 'Admin' as const };
  console.log(`DB: ${String(process.env.DATABASE_URL).replace(/\/\/[^@]+@/, '//***@')} as ${u.name}${dry ? ' (DRY RUN)' : ''}`);

  const add = async (kind: string, subject: string, value: number, unit: string, effectiveFrom: string, source: string) => {
    const exists = await prisma.costRate.findFirst({ where: { kind, subject, effectiveFrom: new Date(`${effectiveFrom}T00:00:00Z`) } });
    if (exists) return `skip ${kind} ${subject} (already ${exists.value.toString()} ${exists.unit})`;
    if (!dry) await addRate({ kind, subject, value, unit, effectiveFrom, source }, user);
    return `add  ${kind} ${subject} = ${value} ${unit} from ${effectiveFrom}`;
  };

  // A. Fabrication.
  for (const [code, value, note] of FAB) console.log(await add('FAB_RATE', code, value, FAB_CAT_BY_CODE[code].unit, '2026-11-23', FAB_SRC + (note ?? '')));

  // C. Interim RM rates for the items on the purchase list.
  const items = await prisma.rmPurchaseItem.findMany({ where: { active: true } });
  for (const it of items) {
    const v = RM[it.sectionKey] ?? (it.category === 'FLAT' ? FLAT_RATE : undefined);
    if (v === undefined) {
      console.log(`--   RM_RATE ${it.sectionKey} (${it.label}): not in the Anchal quote – left blank`);
      continue;
    }
    console.log(await add('RM_RATE', it.sectionKey, v, 'Rs/kg', RM_DATE, RM_SRC));
  }

  // D. End allowance / kerf: 0, not confirmed by the plant.
  const s = await prisma.planSettings.findUnique({ where: { id: 1 } });
  console.log(`Planning Settings: end allowance ${s?.endAllowanceMm ?? 0} mm, kerf ${s?.kerfMm ?? 0} mm, confirmed ${s?.confirmed ?? false}`);
  if (!dry && s && (s.endAllowanceMm !== 0 || s.kerfMm !== 0 || s.confirmed)) {
    console.log('  (left as entered: values were already changed on the server)');
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
