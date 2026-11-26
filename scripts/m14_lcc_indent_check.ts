// Rev 2 §10 acceptance: the dashboard's indent planner on the LCC Chelligada BOM (order 5, PO 42008150)
// against the approved RM indent INDT/2627/0001 (Samrat, 03-11-2026). Read-only: nothing is saved.
// Files are the order documents: "MSDSS_Detailed_BOM_Rev1_with_Junction_Boxes.xlsx" (party BOM) and
// "…INDT-2627-0001.xlsx" (attached to the order on 26-11-2026).
// Run: node --env-file=.env --conditions=react-server --import tsx scripts/m14_lcc_indent_check.ts
import * as XLSX from 'xlsx';
import { prisma } from '@/lib/prisma';
import { getObject } from '@/lib/s3';
import { planIndent, type PlanPiece, type SectionInfo } from '@/lib/planning/cutting';
import { getPlanSettings } from '@/modules/settings/server';
import { cutSettingsOf } from '@/modules/rm/server/common';

const ORDER_ID = 5;
// Party section -> section of the indent (with the 08-10 clarification: ISMC 125 = 125x65x5.3), IS kg/m.
const SEC: Record<string, { key: string; kgm: number }> = {
  ISMC200: { key: '200X75X6.2', kgm: 22.3 }, ISMC150: { key: '150X75X5.7', kgm: 16.8 }, ISMC125: { key: '125X65X5.3', kgm: 13.1 },
  ISMC100: { key: '100X50X5', kgm: 9.56 }, ISMC75: { key: '75X40X4.8', kgm: 7.14 },
  L75X75X6: { key: '75X75X6', kgm: 6.8 }, L90X90X6: { key: '90X90X6', kgm: 8.195 }, L50X50X6: { key: '50X50X6', kgm: 4.5 },
  '25NB(M)PIPE': { key: '25NB(M)', kgm: 2.41 }, '25NBPIPE': { key: '25NB(M)', kgm: 2.41 }, '50NB(M)PIPE': { key: '50NB(M)', kgm: 5.03 },
};
const norm = (s: string) => s.toUpperCase().replace(/\s+/g, '');
const r1 = (n: number) => Math.round(n * 10) / 10;

async function sheetOf(nameLike: string) {
  const d = await prisma.orderDocument.findFirst({ where: { orderId: ORDER_ID, fileName: { contains: nameLike } }, orderBy: { id: 'desc' } });
  if (!d?.s3Key) throw new Error(`${nameLike} not on order ${ORDER_ID}`);
  const o = await getObject(d.s3Key);
  return XLSX.read(Buffer.from(o!.body));
}

(async () => {
  const bom = await sheetOf('MSDSS_Detailed_BOM');
  const indt = await sheetOf('INDT-2627-0001.xlsx');
  const pieces: PlanPiece[] = [];
  let plateNos = 0;
  for (const sh of ['4-Pole Structure', '8-Pole Structure', 'Transformer LA', 'Lightning Spike']) {
    for (const r of (XLSX.utils.sheet_to_json(bom.Sheets[sh], { header: 1, blankrows: false }) as unknown[][]).slice(1)) {
      const [mark, sec, , len, qty] = r as [string, string, string, number, number];
      if (!sec || mark === 'TOTAL') continue;
      if (norm(sec).startsWith('PL')) { plateNos += Number(qty) || 0; continue; }
      const m = SEC[norm(sec)];
      if (!m || !len || !qty) throw new Error(`Unmapped BOM row: ${sh} ${mark} ${sec}`);
      pieces.push({ markNo: `${sh.split(' ')[0]}-${mark}`, sectionKey: m.key, lengthMm: Number(len), qty: Number(qty) });
    }
  }
  const sections: Record<string, SectionInfo> = {};
  for (const v of Object.values(SEC)) sections[v.key] = { label: v.key, kgPerM: v.kgm, maxBarMm: null };
  const plan = planIndent(pieces, sections, cutSettingsOf(await getPlanSettings()), 'MIXED');

  const rows = (XLSX.utils.sheet_to_json(indt.Sheets['INDENT'], { header: 1 }) as unknown[][]).filter((r) => typeof r[0] === 'number') as (string | number)[][];
  const k = (s: string, l: number) => `${s}|${l}`;
  const theirs = new Map<string, { bars: number; kg: number }>();
  let theirPlates = 0;
  let theirPlateKg = 0;
  for (const r of rows) {
    if (r[2] === 'PLATE') { theirPlates += Number(r[5]); theirPlateKg += Number(r[5]) * Number(r[7]); continue; }
    const x = theirs.get(k(String(r[3]), Number(r[4]))) ?? { bars: 0, kg: 0 };
    x.bars += Number(r[5]);
    x.kg += (Number(r[4]) / 1000) * Number(r[7]) * Number(r[5]);
    theirs.set(k(String(r[3]), Number(r[4])), x);
  }
  const ours = new Map<string, { bars: number; kg: number }>();
  for (const l of plan.lines) {
    const x = ours.get(k(l.sectionKey, l.barLengthMm)) ?? { bars: 0, kg: 0 };
    x.bars += l.bars;
    x.kg += l.wtKg;
    ours.set(k(l.sectionKey, l.barLengthMm), x);
  }
  const keys = [...new Set([...theirs.keys(), ...ours.keys()])].sort();
  const table = keys.map((x) => ({ section: x.split('|')[0], barMm: Number(x.split('|')[1]), indtBars: theirs.get(x)?.bars ?? 0, dashboardBars: ours.get(x)?.bars ?? 0, indtKgIS: r1(theirs.get(x)?.kg ?? 0), dashboardKgIS: r1(ours.get(x)?.kg ?? 0) }));
  console.table(table);
  const sum = (f: (r: (typeof table)[number]) => number) => r1(table.reduce((a, r) => a + f(r), 0));
  const diff = table.filter((r) => r.indtBars !== r.dashboardBars);
  console.log(`Bars: INDT ${sum((r) => r.indtBars)} · dashboard ${sum((r) => r.dashboardBars)} · lines different: ${diff.length}`);
  console.log(`Kg (IS): INDT ${sum((r) => r.indtKgIS)} · dashboard ${sum((r) => r.dashboardKgIS)}`);
  console.log(`Plates: INDT ${theirPlates} nos (${r1(theirPlateKg)} kg IS) · BOM ${plateNos} nos`);
  console.log(`Total IS -3 %: ${r1((sum((r) => r.dashboardKgIS) + theirPlateKg) * 0.97)} kg (INDT 12,332.36)`);
  process.exit(diff.length ? 1 : 0);
})();
