// M14 25-11 (Puja's mails 08:47-08:59): masters from her C1 decisions, CEE-000534 delivery state,
// BOMs for CEE-000533 / 534 / 535 and the KESCo DTR fencing docket, draft costings (not applied),
// and the KESCo quoted snapshot (Rev 0, offer sent 25-11). Idempotent: each step is skipped when done.
//   node --env-file=.env --conditions=react-server --import tsx scripts/m14_25nov_masters_dockets.ts [--user=6]
// Nothing is sent to a customer; no price is applied to a quotation item (except KESCo, which
// Puja quoted herself: its typed prices are the sent offer).
export {};
import * as XLSX from 'xlsx';

const USER_ID = Number(process.argv.find((a) => a.startsWith('--user='))?.slice(7) ?? 6);
const EFF = new Date('2026-11-25T00:00:00Z');
const STR_REQ = process.argv.find((a) => a.endsWith('.xlsx')) ?? 'scratch/att/86766697a6f4_mwul8tlc_Structure_Requirements_12.11.2026.xlsx';

type Line = Record<string, unknown>;
const S = (markNo: string, description: string, section: string, lengthMm: number, qty: number, extra: Line = {}): Line => ({ markNo, description, section, lengthMm, qtyPerSet: qty, category: 'STRUCTURE', ...extra });
const NB = (description: string, qty: number, unitWtKg: number | null): Line => ({ description, section: description, qtyPerSet: qty, unitWtKg, category: 'NUTS_BOLTS' });
const BO = (description: string, qty: number): Line => ({ description, qtyPerSet: qty, category: 'BOUGHT_OUT' });

async function main() {
  const { prisma } = await import('../src/lib/prisma');
  const { createBomFromLines, confirmItemBom } = await import('../src/modules/costing/server/itemBom');
  const { saveCosting } = await import('../src/modules/costing/server/compute');
  const { freezeQuotation } = await import('../src/modules/costing/server/snapshot');
  const { nextDocketNumber } = await import('../src/lib/docketNumber');

  const u = await prisma.user.findUnique({ where: { id: USER_ID } });
  if (!u) throw new Error(`user ${USER_ID} not found`);
  const user = { id: u.id, username: u.username, name: u.name ?? u.username, role: 'Admin' } as import('../src/lib/auth/server').AuthUser;
  const log: string[] = [];

  // ---------- 1. Masters (Puja C1 decisions + KESCo cost-sheet inputs) ----------
  const rates = [
    { kind: 'GALV_RATE', subject: 'DEFAULT', value: 4.03, unit: 'Rs/kg black', rateType: 'QUOTE', supplier: 'Sinha Enterprise', owner: 'Purchase', updateFreqDays: 30, source: 'Puja 25-11: default galvaniser Sinha Enterprise, labour excl. GST (others kept as history)' },
    { kind: 'GALV_TRANSPORT', subject: 'DEFAULT', value: 0.5, unit: 'Rs/kg', rateType: 'QUOTE', owner: 'Logistics', updateFreqDays: 30, source: 'Puja 25-11: Dhulagarh - galvaniser, both ways' },
    { kind: 'ZINC_PCT', subject: 'DEFAULT', value: 3.8, unit: '%', rateType: 'ACTUAL', owner: 'Puja', updateFreqDays: 90, source: 'Puja 25-11: zinc issue for offers 3.8% (IS galvanising)' },
    { kind: 'MIN_VA_PCT', subject: 'DEFAULT', value: 8, unit: '%', rateType: 'ACTUAL', owner: 'Puja', updateFreqDays: 90, source: 'Puja 25-11: below 8% blocked; 8-12% needs approval with a reason' },
    { kind: 'RM_RATE', subject: 'WIRE_MESH', value: 66, unit: 'Rs/kg', rateType: 'PO', supplier: 'S.K. Weldedmesh', owner: 'Purchase', updateFreqDays: 30, source: 'Puja 25-11: GI chain-link / welded mesh, PO history 62-68 Rs/kg (2024-25)' },
    { kind: 'PAINT_RATE', subject: 'DEFAULT', value: 7, unit: 'Rs/kg', rateType: 'ESTIMATE', owner: 'Production', updateFreqDays: 30, source: 'KESCo DTR fencing cost sheet 25-11 (two coats bus-green)' },
    { kind: 'NB_RATE', subject: 'M10', value: 6, unit: 'Rs/set', rateType: 'ESTIMATE', owner: 'Purchase', updateFreqDays: 30, source: 'KESCo cost sheet 25-11: M10 bolt + nut + lock nut + washer set' },
    { kind: 'BOUGHT_OUT', subject: 'DOOR LOCK HANDLE / LATCH', value: 150, unit: 'Rs/no', rateType: 'ESTIMATE', owner: 'Purchase', updateFreqDays: 30, source: 'KESCo cost sheet 25-11' },
    // 10 SWG = 3.25 mm wire, 0.0652 kg/m: 50x50 mesh = 40 m/sqm = 2.61 kg/sqm; 100x100 = 1.30 kg/sqm; at Rs 66/kg.
    { kind: 'BOUGHT_OUT', subject: 'WIRE FABRIC 10 SWG 50X50 (SQM)', value: 172.2, unit: 'Rs/no', rateType: 'ESTIMATE', supplier: 'S.K. Weldedmesh', owner: 'Purchase', updateFreqDays: 30, source: 'Rs 66/kg x 2.61 kg/sqm (10 SWG, 50x50 mesh); per sqm' },
    { kind: 'BOUGHT_OUT', subject: 'WIRE FABRIC 10 SWG 100X100 (SQM)', value: 86.1, unit: 'Rs/no', rateType: 'ESTIMATE', supplier: 'S.K. Weldedmesh', owner: 'Purchase', updateFreqDays: 30, source: 'Rs 66/kg x 1.30 kg/sqm (10 SWG, 100x100 mesh); per sqm' },
  ];
  for (const r of rates) {
    const have = await prisma.costRate.findFirst({ where: { kind: r.kind, subject: r.subject, effectiveFrom: EFF } });
    if (have) continue;
    const c = await prisma.costRate.create({ data: { ...r, effectiveFrom: EFF, createdById: user.id, createdByName: user.name } });
    await prisma.editLog.create({ data: { tableName: 'cost_rates', recordId: c.id, fieldName: 'ALL_FIELDS', oldValue: 'NONE (New Record)', newValue: JSON.stringify({ ...r, effectiveFrom: '2026-11-25' }), userId: user.id, userName: user.name } });
    log.push(`rate ${r.kind} ${r.subject} = ${r.value} ${r.unit}`);
  }
  // Update frequency / owner (metadata only, values untouched): steel daily (Purchase), zinc daily
  // (LME-based, auto fetch pending), N&B and freight monthly.
  const meta = [
    { where: { kind: 'RM_RATE', subject: { in: ['CHANNEL', 'ANGLE', 'FLAT', 'ROD', 'PIPE'] } }, data: { updateFreqDays: 1, owner: 'Purchase' } },
    { where: { kind: 'ZINC_RATE' }, data: { updateFreqDays: 1, owner: 'Purchase (LME-based)' } },
    { where: { kind: 'NB_RATE' }, data: { updateFreqDays: 30 } },
    { where: { kind: { in: ['FREIGHT_MT', 'FREIGHT_TRIP'] } }, data: { updateFreqDays: 30 } },
  ];
  for (const m of meta) {
    const n = await prisma.costRate.updateMany(m as never);
    if (n.count) log.push(`metadata ${JSON.stringify(m.where)} -> ${JSON.stringify(m.data)} on ${n.count} row(s)`);
  }

  // ---------- 2. CEE-000534: billing state stays Haryana, delivery state Bihar ----------
  const nkc = await prisma.dockerPartyName.findUnique({ where: { docketNoQtnNo: 'CEE-000534' } });
  if (nkc && nkc.deliveryState !== 'Bihar') {
    await prisma.dockerPartyName.update({ where: { id: nkc.id }, data: { deliveryState: 'Bihar' } });
    await prisma.editLog.create({ data: { tableName: 'docket-party-name', recordId: nkc.id, fieldName: 'deliveryState', oldValue: nkc.deliveryState ?? '', newValue: 'Bihar', userId: user.id, userName: user.name } });
    log.push('CEE-000534 delivery state = Bihar (billing state Haryana kept)');
  }
  const jsw = await prisma.dockerPartyName.findUnique({ where: { docketNoQtnNo: 'CEE-000533' } });
  if (jsw && !jsw.deliveryState) await prisma.dockerPartyName.update({ where: { id: jsw.id }, data: { deliveryState: 'Chhattisgarh' } });
  const lsr = await prisma.dockerPartyName.findUnique({ where: { docketNoQtnNo: 'CEE-000535' } });
  if (lsr && !lsr.deliveryState) await prisma.dockerPartyName.update({ where: { id: lsr.id }, data: { deliveryState: 'Maharashtra' } });

  const hasBom = async (itemId: number) => !!(await prisma.itemBom.findFirst({ where: { itemId } }));
  const bomOf = async (itemId: number) => (await prisma.itemBom.findFirst({ where: { itemId }, orderBy: { id: 'desc' } }))!;
  const build = async (itemId: number, input: Parameters<typeof createBomFromLines>[1], after?: (bomId: number) => Promise<void>) => {
    if (await hasBom(itemId)) return (await bomOf(itemId)).id;
    const { id } = await createBomFromLines(itemId, input, user);
    if (after) await after(id);
    await confirmItemBom(id, user);
    log.push(`item ${itemId}: BOM ${id} created + confirmed (${input.structureType})`);
    return id;
  };
  const setLine = (bomId: number, markNo: string, data: Record<string, unknown>) => prisma.itemBomLine.updateMany({ where: { bomId, markNo }, data });

  // ---------- 3. CEE-000533 JSW Mahanadi, GI pipe type earthing, 36 sets ----------
  const jswBom = await build(
    5758,
    {
      source: 'MANUAL',
      structureType: 'Pipe type earthing (400 kV TL)',
      drawingRef: 'L&T/CPRI 010258-T-TL-8D-AS-0001 (DA) / -0002 (DC & DD)',
      note: 'From Puja 25-11 (BOM on Drive, L&T/CPRI drawings). RFQ says 2.85 m pipe, drawing shows 3000 mm tube: BOM takes 3000 mm (open query). Hot-dip galvanised to IS 2629. Bolt weights are standard (bolt + nut + spring washer).',
      lines: [],
      groups: [
        {
          name: 'Type DA', drawingNo: '010258-T-TL-8D-AS-0001', sets: 22,
          lines: [
            S('P1', '25 NB medium GI tube, perforated', 'PIPE 25NB', 3000, 1, { kgPerM: 2.41 }),
            S('FC', 'Earthing flat type C', 'FLAT 50X6', 851, 1),
            S('FD', 'Earthing flat type D', 'FLAT 50X6', 3540, 1),
            NB('M12X35 bolt + nut + spring washer', 2, 0.065),
            NB('M16X35 bolt + nut + spring washer', 2, 0.13),
            NB('M16X45 bolt + nut + spring washer', 2, 0.145),
          ],
        },
        {
          name: 'Type DC & DD', drawingNo: '010258-T-TL-8D-AS-0002', sets: 14,
          lines: [
            S('P1', '25 NB medium GI tube, perforated', 'PIPE 25NB', 3000, 1, { kgPerM: 2.41 }),
            S('FC', 'Earthing flat type C', 'FLAT 50X6', 951, 1),
            S('FD', 'Earthing flat type D', 'FLAT 50X6', 5441, 1),
            NB('M12X35 bolt + nut + spring washer', 2, 0.065),
            NB('M16X35 bolt + nut + spring washer', 2, 0.13),
            NB('M16X45 bolt + nut + spring washer', 2, 0.145),
          ],
        },
      ],
    },
    // Tube perforation is not on the job-work chart: the 40 NB 3000 mm drilling rate is used as a proxy (to confirm with Satya).
    (id) => setLine(id, 'P1', { fabCat: 'TUBE40_3000_DRILL' }).then(() => undefined),
  );

  // ---------- 4. CEE-000534 NKC, SBPDCL Sasaram ----------
  // Item 5759 "11 kV GI fabricated structures" (per kg): representative mix, one of each member that
  // has an SBPDCL-approved drawing in the Lanarsy SBPDCL BOM (letter 2333). Quantities awaited from NKC.
  const nkcStructBom = await build(5759, {
    source: 'MANUAL',
    structureType: '11 kV structures (SBPDCL) – member mix',
    drawingRef: 'SBPDCL approved drawings (letter 2333) as in the Lanarsy SBPDCL BOM',
    note: 'One of each member with an SBPDCL-approved drawing (Lanarsy SBPDCL BOM). Rs/kg depends on the mix: re-cost when NKC sends the kg per structure. Top channel 2200 mm per the Lanarsy BOM (Puja wrote 2240 – to confirm). F-bracket: no drawing (missing).',
    lines: [],
    groups: [
      {
        name: '11 kV structure members (1 each)', sets: 1,
        lines: [
          S('R01', 'Top channel', 'ISMC 100X50', 2200, 1),
          S('R04', 'V-cross arm', 'ISMC 75X40', 1476, 1),
          S('R18', 'Back clamp for V-cross arm / guarding cross arm', 'FLAT 50X8', 573, 1),
          S('R09', 'Belting angle', 'ISA 65X65X6', 1832, 1),
          S('R19', 'Clamp for belting angle', 'FLAT 50X8', 579, 1),
          S('R12', 'Fish plate', 'FLAT 50X8', 264, 1),
          S('R06', 'Back clamp for danger board', 'FLAT 30X3', 564, 1),
        ],
      },
    ],
  });
  // Item 5761 "GI nut & bolt" (per kg): 1 kg of N&B at the N&B master rate.
  const nkcNbBom = await build(5761, {
    source: 'MANUAL',
    structureType: 'GI nut & bolt (per kg)',
    note: '1 kg of GI nuts & bolts at the N&B master rate (Rs/kg); sizes awaited from NKC.',
    lines: [NB('GI nut & bolt (mixed sizes), per kg', 1, 1)],
  });

  // ---------- 5. CEE-000535 Laser, KUSUM Solar Maharashtra, from the "STR req" sheet ----------
  let laserBom: number | null = null;
  try {
    const wb = XLSX.readFile(STR_REQ);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['STR req'], { header: 1, raw: true, defval: null });
    const lines: Line[] = [];
    for (const r of rows.slice(5)) {
      const [, desc, mark, section, len, , total] = r as [unknown, string, string, string, number, number, number];
      if (!section || String(section) === '0' || !(Number(len) > 0) || !(Number(total) > 0)) continue;
      // "EYE HOOK BOLT, M16, 236" is made from 16 mm rod (fabricated, threaded): rod line.
      const rod = String(section).trim().match(/^M(\d+)$/i);
      lines.push(S(String(mark ?? '').replace(/^-$/, ''), String(desc), rod ? `RB ${rod[1]}` : String(section).replace(/-/g, ' '), Number(len), Number(total)));
    }
    laserBom = await build(5763, {
      source: 'ENQUIRY_DRAWING',
      structureType: 'KUSUM Solar Maharashtra – 11/33 kV structures',
      fileName: 'Structure_Requirements_12.11.2026.xlsx',
      drawingRef: 'Laser structure requirements 12-11-2026 (sheet STR req)',
      note: 'Enquiry: Saurav Banerjee (Asst. Manager – Procurement, Laser) 31-10-2026, summary 16-11-2026, forwarded by Samrat Dey to info@ on 16-11-2026. Quantities = total nos of the STR req sheet (1 set). Laser states 2,549.7 kg in the mail – compare with the BOM weight.',
      lines: [],
      groups: [{ name: 'All structures (total nos)', sets: 1, lines }],
    });
  } catch (e) {
    log.push(`CEE-000535 BOM not built: ${String(e).slice(0, 200)}`);
  }

  // ---------- 6. KESCo DTR fencing docket (offer sent 25-11) ----------
  let kesco = await prisma.dockerPartyName.findFirst({ where: { utility: 'KESCo', partyName: { contains: 'LASER', mode: 'insensitive' } } });
  if (!kesco) {
    const { nextDocketNo } = await nextDocketNumber();
    kesco = await prisma.dockerPartyName.create({
      data: {
        docketNoQtnNo: nextDocketNo,
        partyName: 'LASER POWER & INFRA LTD.',
        address: 'Adventz Infinity@5, BN Block, 19th Floor, Salt Lake Sector V, Kolkata 700091',
        state: 'West Bengal',
        deliveryState: 'Uttar Pradesh',
        utility: 'KESCo',
        deliveryLocation: 'Laser store, Kanpur (KESCo RDSS)',
        type: 'Purchase',
      },
    });
    await prisma.editLog.create({ data: { tableName: 'docket-party-name', recordId: kesco.id, fieldName: 'ALL_FIELDS', oldValue: 'NONE (New Record)', newValue: JSON.stringify({ docketNo: kesco.docketNoQtnNo, utility: 'KESCo', source: 'Puja 25-11: offer sent 25-11-2026' }), userId: user.id, userName: user.name } });
    log.push(`KESCo docket ${kesco.docketNoQtnNo} created`);
  }
  const kNo = kesco.docketNoQtnNo!;
  const kItems = [
    { key: '7.08', party: 'Sl 7.08 – DTR fencing Type A, chain-link (wire fabric 50x50) with 40x5 MS strips', qty: '7520', price: '991' },
    { key: '7.09-1', party: 'Sl 7.09 – DTR fencing Type B, 40x5 MS strips @ 75 mm clear, Option 1 with 100x100 mesh', qty: '2835.2', price: '1619' },
    { key: '7.09-2', party: 'Sl 7.09 – DTR fencing Type B, 40x5 MS strips @ 75 mm clear, Option 2 without mesh', qty: '2835.2', price: '1516' },
  ];
  const itemIds: Record<string, number> = {};
  for (const k of kItems) {
    let it = await prisma.itemTable.findFirst({ where: { docketNoQtnNo: kNo, itemNameParty: k.party } });
    if (!it) {
      it = await prisma.itemTable.create({ data: { docketNoQtnNo: kNo, itemNameParty: k.party, ourItemName: 'DTR Fencing', uom: 'SQM', qty: k.qty, price: k.price, uomOfQtn: 'SQM', hsn: '7308' } });
      log.push(`KESCo item ${k.key} @ Rs ${k.price}/sqm`);
    }
    itemIds[k.key] = it.id;
  }
  const fencing = (type: 'A' | 'B', mesh: '50X50' | '100X100' | null): Line[] => [
    S('FCA-1', 'MS angle (upright)', 'ISA 40X40X5', 2800, 5),
    S('FCH-1', 'MS horizontal flat', 'FLAT 50X6', 3000, 9),
    S('FCH-2', 'MS horizontal flat', 'FLAT 50X6', 2000, 3),
    S('FCH-3', 'MS horizontal flat (gate)', 'FLAT 50X6', 900, 3),
    S('FCV-1', 'MS vertical flat (panel), welded', 'FLAT 40X5', 2350, type === 'A' ? 26 : 96),
    S('FCV-2', 'MS vertical flat (gate), welded', 'FLAT 40X5', 2200, type === 'A' ? 3 : 8),
    S('FTB-1', 'Tie MS horizontal flat (header + bottom)', 'FLAT 50X6', 1000, 2),
    S('FH-1', 'Gate hinge, welded', 'FLAT 50X6', 130, 3),
    S('FLP-1', 'Flat support pad lock', 'FLAT 50X6', 20, 1),
    S('FLP-2', 'Flat support pad lock', 'FLAT 50X6', 100, 1),
    ...(mesh ? [BO(`WIRE FABRIC 10 SWG ${mesh} (SQM)`, 27.14)] : []),
    NB('M10 bolt + nut + lock nut + washer set, Gr 4.6', 32, null),
    BO('DOOR LOCK HANDLE / LATCH', 1),
  ];
  const kBoms: Record<string, number> = {};
  for (const [key, type, mesh, sets] of [['7.08', 'A', '50X50', 262], ['7.09-1', 'B', '100X100', 99], ['7.09-2', 'B', null, 99]] as const) {
    kBoms[key] = await build(
      itemIds[key],
      {
        source: 'MANUAL',
        structureType: `DTR fencing Type ${type}`,
        drawingRef: 'Satwik approved drg (KESCo sign 19-09-2026); Ceebuild BOM 24-11-2026',
        note: `Per enclosure 12 m x 2.4 m = 28.8 sqm; ${sets} enclosures. Painted (two coats bus-green). Freight by space: 14 sets per 24-28 ft open truck.`,
        lines: [],
        groups: [{ name: `Type ${type} enclosure`, drawingNo: 'Satwik / KESCo 19-09-2026', sets, lines: fencing(type, mesh) }],
      },
      async (id) => {
        await prisma.itemBom.update({ where: { id }, data: { galvanised: false, painted: true, billingBasis: 'BLACK', fabType: 'WELDED', loadBasis: 'SPACE', setsPerTruck: 14 } });
        // Every fencing member is welded (panels, strips, gate): welded fabrication rate.
        await prisma.itemBomLine.updateMany({ where: { bomId: id, category: 'STRUCTURE' }, data: { fabCat: 'WELDED' } });
      },
    );
  }

  // ---------- 7. Draft costings (saved, NOT applied) ----------
  const cost = async (label: string, bomId: number | null, vaPct: number | null = null) => {
    if (!bomId) return;
    const c = await saveCosting(bomId, { vaPct, quoteDate: '2026-11-25', apply: false }, user);
    const row = await prisma.itemCosting.findUnique({ where: { id: c.id } });
    const f = row!.flags as { messages?: string[]; ok?: boolean; effectiveVaPct?: number };
    log.push(`COSTING ${label}: sell/kg ${row!.sellPerKg} · sell/set ${row!.sellPerSet} · total Rs ${row!.sellTotal} (N&B ${row!.nbSellTotal}, BO ${row!.boSellTotal}) · black ${row!.blackWtKg} kg · VA ${row!.vaPct}% · ok=${f.ok}`);
    for (const m of f.messages ?? []) log.push(`   - ${m}`);
  };
  await cost('CEE-000533 JSW pipe earthing (36 sets)', jswBom);
  await cost('CEE-000534 NKC structures (mix)', nkcStructBom);
  await cost('CEE-000534 NKC GI nut & bolt (1 kg)', nkcNbBom);
  await cost('CEE-000535 Laser KUSUM structures', laserBom);
  for (const k of Object.keys(kBoms)) await cost(`${kNo} KESCo ${k} (VA 25%)`, kBoms[k], 25);

  // ---------- 8. KESCo quoted snapshot (Rev 0) ----------
  const snap = await prisma.quotationSnapshot.findFirst({ where: { docketId: kesco.id } });
  if (!snap) {
    const s = await freezeQuotation(
      kesco.id,
      {
        quotedOn: '2026-11-25',
        status: 'SENT',
        sentTo: 'Laser Power & Infra (KESCo RDSS) – sent by Puja 25-11-2026',
        note: 'VA 25% (docket override). Galvanised alternative: 7.08 Rs 1,116; 7.09 Rs 1,889 (with mesh) / 1,786 (without) per sqm. Cost sheet: RM 50.00/50.50, fab 2.50/kg welded, paint 7.00/kg, M10 set 6.00, latch 150/set, interest 1.5%.',
      },
      user,
    );
    log.push(`KESCo snapshot Rev ${s.rev} frozen`);
  }

  console.log(log.join('\n'));
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
