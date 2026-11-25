// M14: load Power BI export files (PO details, Indent details, Freight history FO) into the dashboard,
// the same way the daily n8n feed does (src/modules/erp/server/import.ts): content hash, existing rows
// skipped, nothing deleted, then freight lanes / RM PO rates refreshed. First seed: 25-11-2026.
//   node --env-file=.env --conditions=react-server --import tsx scripts/m14_import_pbi.ts [dir]
// Default dir: docs/m14-rev2-reference/pbi-25-11 (gitignored).
export {};
import path from 'node:path';
import * as XLSX from 'xlsx';

const DIR = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'docs/m14-rev2-reference/pbi-25-11';
const FILES = [
  ['PO', 'PBI_Ceebuild_PO_Details_25-11-2026.xlsx'],
  ['INDENT', 'PBI_Ceebuild_Indent_Details_25-11-2026.xlsx'],
  ['FREIGHT', 'PBI_Freight_History_FO_All_25-11-2026.xlsx'],
] as const;

async function main() {
  const { importErpRows } = await import('../src/modules/erp/server/import');
  const { prisma } = await import('../src/lib/prisma');
  for (const [source, file] of FILES) {
    const wb = XLSX.readFile(path.join(DIR, file), { cellDates: true });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { raw: true, defval: null });
    const r = await importErpRows(source, rows, file, 'M14 import (Power BI export file)');
    console.log(`${source}: ${r.rows} rows, ${r.inserted} new, ${r.exceptions} exceptions, ${r.derived.rates} rate rows`);
    for (const e of r.exceptionSample.slice(0, 5)) console.log(`   row ${e.row}: ${e.problem} ${e.value}`);
  }
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
