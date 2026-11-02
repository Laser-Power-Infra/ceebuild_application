/**
 * READ-ONLY diagnostic: why does a docket show "No items listed"?
 *
 *   node scripts/diagnose_docket_items.js CEE-000500
 *
 * Items are linked to dockets only by the docket number text (iteam-table.docket_no_qtn_no
 * = docket-party-name.docket_no_qtn_no), there is no foreign key. This script lists:
 *   1. the docket row(s) with that number,
 *   2. items with an exact match,
 *   3. items with a near match (case / whitespace / missing zero-padding),
 *   4. audit-log entries mentioning the number (renames, deletes, creates).
 * It never writes to the database.
 */
const { PrismaClient } = require('@prisma/client');

async function main() {
  const docketNo = (process.argv[2] || '').trim();
  if (!docketNo) {
    console.error('Usage: node scripts/diagnose_docket_items.js <docket no, e.g. CEE-000500>');
    process.exit(1);
  }
  const digits = (docketNo.match(/\d+/) || [''])[0].replace(/^0+/, '');
  const prisma = new PrismaClient();
  try {
    const dockets = await prisma.dockerPartyName.findMany({
      where: { docketNoQtnNo: { contains: digits || docketNo, mode: 'insensitive' } },
      select: { id: true, docketNoQtnNo: true, partyName: true, type: true, createdAt: true },
    });
    console.log('Docket rows:', dockets.map((d) => ({ ...d, docketNoQtnNo: JSON.stringify(d.docketNoQtnNo) })));

    const exact = await prisma.itemTable.count({ where: { docketNoQtnNo: docketNo } });
    console.log(`Items with exact docket number "${docketNo}": ${exact}`);

    const near = await prisma.itemTable.findMany({
      where: { docketNoQtnNo: { contains: digits || docketNo, mode: 'insensitive' } },
      select: { id: true, docketNoQtnNo: true, itemNameParty: true, createdAt: true },
      take: 50,
    });
    const nearOnly = near.filter((i) => i.docketNoQtnNo !== docketNo);
    console.log(`Items with a similar (non-identical) docket number: ${nearOnly.length}`);
    nearOnly.forEach((i) => console.log(`  item #${i.id} docket=${JSON.stringify(i.docketNoQtnNo)} "${i.itemNameParty}"`));

    const logs = await prisma.editLog.findMany({
      where: {
        OR: [
          { oldValue: { contains: docketNo, mode: 'insensitive' } },
          { newValue: { contains: docketNo, mode: 'insensitive' } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    console.log(`Audit-log entries mentioning ${docketNo}: ${logs.length}`);
    logs.forEach((l) =>
      console.log(`  ${l.createdAt.toISOString()} ${l.tableName}#${l.recordId} ${l.fieldName}: ${String(l.oldValue).slice(0, 80)} -> ${String(l.newValue).slice(0, 80)}`)
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
