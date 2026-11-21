// M14 data load (Puja, 21-Nov-2026): GTP sections from SBPDCL letter 2333, RM purchase list,
// SBPDCL drawings into the Approved Drawing Library, and the CEE-000532 mixed BOM (draft).
//
// Run (writes to DATABASE_URL):
//   node --conditions=react-server --import tsx scripts/m14_load_sbpdcl.ts <bom.xlsx> [--user=<id>] [--dry]
// Idempotent: sections are upserted, existing drawings (same no + rev) skipped, the item BOM is only
// created when the item has none. No rates are loaded (the Ceebuild team fills them).

import * as XLSX from 'xlsx';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const dry = args.includes('--dry');
const userId = Number(args.find((a) => a.startsWith('--user='))?.split('=')[1] ?? 6);
if (!file) throw new Error('Usage: m14_load_sbpdcl.ts <bom.xlsx> [--user=<id>] [--dry]');

const LETTER = 'SBPDCL letter 2333 dt 28-07-2025';
const GTP: [string, number, string, boolean][] = [
  ['ISMC 100x50', 9.56, 'CHANNEL', true],
  ['ISMC 75x40', 7.14, 'CHANNEL', true],
  ['Angle 50x50x6', 4.5, 'ANGLE', true],
  ['Angle 75x75x6', 6.8, 'ANGLE', true],
  ['Angle 75x75x10', 11.0, 'ANGLE', true],
  ['Flat 30x3', 0.71, 'FLAT', true],
  ['Flat 45x5', 1.77, 'FLAT', true],
  ['Flat 50x6', 2.36, 'FLAT', true],
  ['Flat 50x8', 3.14, 'FLAT', true],
  ['Flat 50x10', 3.93, 'FLAT', true],
  ['Flat 65x6', 3.06, 'FLAT', true],
  ['Flat 65x8', 4.08, 'FLAT', true],
  ['Flat 75x8', 4.71, 'FLAT', true],
  ['Round bar 16 dia', 1.58, 'ROD', true],
  // Not in the approved GTP: flagged, pending Lanarsy confirmation.
  ['Angle 65x65x6', 5.8, 'ANGLE', false],
  ['Flat 40x5', 1.57, 'FLAT', false],
];

async function main() {
  const { prisma } = await import('../src/lib/prisma');
  const { sectionKey } = await import('../src/lib/bom/parse');
  const { upsertSection } = await import('../src/modules/sections/server');
  const { upsertPurchaseItem } = await import('../src/modules/costing/server/master');
  const { createDrawing } = await import('../src/modules/costing/server/drawings');
  const { createBomFromLines } = await import('../src/modules/costing/server/itemBom');
  const { parseMixedBom } = await import('../src/lib/costing/mixedBom');

  const u = await prisma.user.findUnique({ where: { id: userId } });
  if (!u || u.role !== 'Admin') throw new Error(`User ${userId} must be an active Admin`);
  const user = { id: u.id, username: u.username, name: u.name, role: 'Admin' as const };
  console.log(`DB: ${String(process.env.DATABASE_URL).replace(/\/\/[^@]+@/, '//***@')} as ${u.name}${dry ? ' (DRY RUN)' : ''}`);

  // 1. GTP sections.
  for (const [label, kgm, , approved] of GTP) {
    const note = approved ? `${LETTER}; IS 2062 E250A; galv IS 2629 610 g/m²; ±5%` : 'NOT in approved GTP – pending Lanarsy confirmation';
    if (!dry) await upsertSection({ label, kgPerM: kgm, grade: 'IS 2062 E250A', approved, source: note }, user);
  }
  console.log(`GTP sections: ${GTP.length} upserted (${GTP.filter((g) => !g[3]).length} not approved)`);

  // 2. RM purchase list (no rates): the approved GTP sections. Edit in Costing Master if not all are bought.
  let n = 0;
  for (const [label, , cat, approved] of GTP) {
    if (!approved) continue;
    const exists = await prisma.rmPurchaseItem.findUnique({ where: { sectionKey: sectionKey(label)! } });
    if (exists) continue;
    if (!dry) await upsertPurchaseItem({ label, category: cat, sortOrder: ++n }, user);
  }
  console.log(`RM purchase list: ${n} added`);

  // 3. Drawings from the SBPDCL BOM.
  const wb = XLSX.readFile(file!);
  const cells = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
  const mixed = parseMixedBom(cells);
  if (!mixed) throw new Error('Not a mixed BOM');
  let added = 0;
  const skipped: string[] = [];
  for (const g of mixed.groups) {
    if (!g.drawingNo) {
      skipped.push(`${g.name} (no drawing no.)`);
      continue;
    }
    const exists = await prisma.approvedDrawing.findUnique({ where: { drawingNo_revision: { drawingNo: g.drawingNo, revision: '0' } } });
    if (exists) {
      skipped.push(`${g.drawingNo} (already in library)`);
      continue;
    }
    const epc = /^EPC-PD-/i.test(g.drawingNo);
    if (!dry)
      await createDrawing(
        {
          utility: 'SBPDCL',
          state: 'Bihar',
          itemType: g.name,
          drawingNo: g.drawingNo,
          revision: '0',
          approvalLetterNo: epc ? LETTER.replace(/ dt .*/, '') : null,
          approvalDate: epc ? '2025-07-28' : null,
          remarks: `${epc ? '' : 'Not an EPC-PD drawing: confirm its approval. '}Loaded from the CEE-000532 SBPDCL RDSS BOM (Lanarsy).`,
          supersedePrevious: false,
        },
        g.lines,
        user,
      );
    added++;
  }
  console.log(`Drawings: ${added} added; skipped ${skipped.length}${skipped.length ? `: ${skipped.join('; ')}` : ''}`);

  // 4. CEE-000532 item: mixed BOM as a draft (only if it has none).
  const item = await prisma.itemTable.findFirst({ where: { docketNoQtnNo: 'CEE-000532' }, orderBy: { id: 'asc' } });
  if (!item) console.log('CEE-000532 item not found: BOM not created');
  else if (await prisma.itemBom.count({ where: { itemId: item.id } })) console.log(`Item ${item.id} already has a BOM: not replaced`);
  else if (!dry) {
    const r = await createBomFromLines(
      item.id,
      { source: 'ENQUIRY_DRAWING', lines: [], groups: mixed.groups, fileName: 'Cee_Build_BOM_11Kv_Fab_SBPDCL.xlsx', drawingRef: 'SBPDCL RDSS – 11 kV line structures', note: mixed.note, structureType: 'SBPDCL RDSS 11 kV line structures (mixed)' },
      user,
    );
    console.log(`Item ${item.id}: mixed BOM ${r.id} created (draft) with ${mixed.groups.length} structures`);
  }
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
