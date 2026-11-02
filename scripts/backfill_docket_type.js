/**
 * Backfill blank docket "type" values (shown as "- Select Type -" in the dashboard).
 *
 * NOT run automatically. Review the dry run first, then apply deliberately.
 *
 *   Dry run (default, read-only):
 *     node scripts/backfill_docket_type.js
 *
 *   Apply one type to ALL blank dockets (only if that is really correct):
 *     node scripts/backfill_docket_type.js --apply --default Tender
 *
 *   Apply per-docket values from a CSV with header "docketNoQtnNo,type"
 *   (export the dry-run list, have sales fill in the type, then apply):
 *     node scripts/backfill_docket_type.js --csv-out blank_types.csv      # write the list to fill in
 *     node scripts/backfill_docket_type.js --apply --csv blank_types.csv  # apply the filled-in file
 *
 * Every change is written to the edit-logs audit table (field "type", user "backfill script").
 * Valid types: Tender, Purchase.
 */
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

const VALID = ['Tender', 'Purchase'];
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : true;
};

const apply = flag('apply') === true;
const defaultType = flag('default');
const csvIn = flag('csv');
const csvOut = flag('csv-out');

function normType(t) {
  if (typeof t !== 'string') return null;
  return VALID.find((v) => v.toLowerCase() === t.trim().toLowerCase()) || null;
}

function parseCsv(path) {
  const lines = fs.readFileSync(path, 'utf-8').split(/\r?\n/).filter((l) => l.trim());
  const header = lines.shift().split(',').map((h) => h.trim());
  const di = header.indexOf('docketNoQtnNo');
  const ti = header.indexOf('type');
  if (di === -1 || ti === -1) throw new Error('CSV header must contain docketNoQtnNo,type');
  const map = new Map();
  for (const line of lines) {
    const cols = line.split(',');
    const dn = (cols[di] || '').trim();
    const t = normType(cols[ti]);
    if (dn && t) map.set(dn.toUpperCase(), t);
  }
  return map;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const blanks = await prisma.dockerPartyName.findMany({
      where: { OR: [{ type: null }, { type: '' }, { NOT: { type: { in: VALID } } }] },
      select: { id: true, docketNoQtnNo: true, partyName: true, type: true, createdAt: true },
      orderBy: { id: 'desc' },
    });

    console.log(`Dockets with blank/invalid type: ${blanks.length}`);
    for (const d of blanks.slice(0, 50)) {
      console.log(`  #${d.id}  ${d.docketNoQtnNo || '-'}  ${JSON.stringify(d.type)}  ${d.partyName || ''}`);
    }
    if (blanks.length > 50) console.log(`  ... and ${blanks.length - 50} more`);

    if (typeof csvOut === 'string') {
      const rows = ['docketNoQtnNo,type,partyName'].concat(
        blanks.map((d) => `${d.docketNoQtnNo || ''},,"${(d.partyName || '').replace(/"/g, '""')}"`)
      );
      fs.writeFileSync(csvOut, rows.join('\n'), 'utf-8');
      console.log(`Wrote ${blanks.length} rows to ${csvOut}. Fill the "type" column with Tender or Purchase.`);
    }

    let plan = [];
    if (typeof csvIn === 'string') {
      const map = parseCsv(csvIn);
      plan = blanks
        .filter((d) => d.docketNoQtnNo && map.has(d.docketNoQtnNo.trim().toUpperCase()))
        .map((d) => ({ d, type: map.get(d.docketNoQtnNo.trim().toUpperCase()) }));
    } else if (defaultType !== undefined) {
      const t = normType(defaultType);
      if (!t) throw new Error(`--default must be one of ${VALID.join(', ')}`);
      plan = blanks.map((d) => ({ d, type: t }));
    }

    if (plan.length === 0) {
      console.log('\nNothing to apply (pass --default <Type> or --csv <file>). Dry run only.');
      return;
    }

    console.log(`\nPlanned updates: ${plan.length}`);
    if (!apply) {
      console.log('Dry run - re-run with --apply to write these changes.');
      return;
    }

    for (const { d, type } of plan) {
      await prisma.$transaction([
        prisma.dockerPartyName.update({ where: { id: d.id }, data: { type } }),
        prisma.editLog.create({
          data: {
            tableName: 'docket-party-name',
            recordId: d.id,
            fieldName: 'type',
            oldValue: d.type || '',
            newValue: type,
            userName: 'backfill script (scripts/backfill_docket_type.js)',
          },
        }),
      ]);
    }
    console.log(`Updated ${plan.length} dockets.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});
