import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

let cachedOptions: any = null;
let cacheTime = 0;
const CACHE_TTL_MS = 60 * 1000; // 1 minute

export async function GET() {
  try {
    const now = Date.now();
    if (cachedOptions && now - cacheTime < CACHE_TTL_MS) {
      return NextResponse.json(cachedOptions);
    }

    const [
      uoms,
      ourItemNots,
      ourItemNames,
      sizes,
      sectionMms,
      sectionalWts,
      lengths,
      unitWts,
      memberWts,
      prices,
      qtys,
      statuses,
      itemNames,
      docketNos,
      typeOfItems,
    ] = await Promise.all([
      prisma.itemTable.findMany({ select: { uom: true }, distinct: ['uom'], where: { uom: { not: null } }, orderBy: { uom: 'asc' } }),
      prisma.itemTable.findMany({ select: { ourItemNot: true }, distinct: ['ourItemNot'], where: { ourItemNot: { not: null } }, orderBy: { ourItemNot: 'asc' } }),
      prisma.itemTable.findMany({ select: { ourItemName: true }, distinct: ['ourItemName'], where: { ourItemName: { not: null } }, orderBy: { ourItemName: 'asc' } }),
      prisma.itemTable.findMany({ select: { size: true }, distinct: ['size'], where: { size: { not: null } }, orderBy: { size: 'asc' } }),
      prisma.itemTable.findMany({ select: { sectionMm: true }, distinct: ['sectionMm'], where: { sectionMm: { not: null } }, orderBy: { sectionMm: 'asc' } }),
      prisma.itemTable.findMany({ select: { sectionalWtKgMtr: true }, distinct: ['sectionalWtKgMtr'], where: { sectionalWtKgMtr: { not: null } }, orderBy: { sectionalWtKgMtr: 'asc' } }),
      prisma.itemTable.findMany({ select: { lengthInMtr: true }, distinct: ['lengthInMtr'], where: { lengthInMtr: { not: null } }, orderBy: { lengthInMtr: 'asc' } }),
      prisma.itemTable.findMany({ select: { weightPerPiece: true }, distinct: ['weightPerPiece'], where: { weightPerPiece: { not: null } }, orderBy: { weightPerPiece: 'asc' } }),
      prisma.itemTable.findMany({ select: { unitWtOfMemberKg: true }, distinct: ['unitWtOfMemberKg'], where: { unitWtOfMemberKg: { not: null } }, orderBy: { unitWtOfMemberKg: 'asc' } }),
      prisma.itemTable.findMany({ select: { price: true }, distinct: ['price'], where: { price: { not: null } }, orderBy: { price: 'asc' } }),
      prisma.itemTable.findMany({ select: { qty: true }, distinct: ['qty'], where: { qty: { not: null } }, orderBy: { qty: 'asc' } }),
      prisma.itemTable.findMany({ select: { status: true }, distinct: ['status'], where: { status: { not: null } }, orderBy: { status: 'asc' } }),
      prisma.itemTable.findMany({ select: { itemNameParty: true }, distinct: ['itemNameParty'], where: { itemNameParty: { not: null } }, orderBy: { itemNameParty: 'asc' } }),
      prisma.itemTable.findMany({ select: { docketNoQtnNo: true }, distinct: ['docketNoQtnNo'], where: { docketNoQtnNo: { not: null } }, orderBy: { docketNoQtnNo: 'asc' } }),
      prisma.itemTable.findMany({ select: { typeOfItem: true }, distinct: ['typeOfItem'], where: { typeOfItem: { not: null } }, orderBy: { typeOfItem: 'asc' } }),
    ]);

    const staticOurItemNames = [
      'Fabricated Structures',
      'GI Wires',
      'Anti-Climbing Device',
      'Stay Set - 33KV',
      'Stay Set - 11KV',
      'Name Plate',
      'Phase Plate',
      'Circuit Plate',
      'Danger Plate',
      'Pipe Earthing',
      'Rod Earthing',
      'Coil Earthing',
      'Conterpoise Earthing',
      'Bird Guard',
      'OTHERS',
      'GI Pipe',
    ];

    const dbOurItemNames = ourItemNames.map((o) => o.ourItemName).filter(Boolean) as string[];
    const mergedOurItemNames = Array.from(new Set([...staticOurItemNames, ...dbOurItemNames]));

    const staticStatuses = ['Quoted', 'NOT Required'];
    const dbStatuses = statuses.map((s) => s.status).filter(Boolean) as string[];
    const mergedStatuses = Array.from(new Set([...staticStatuses, ...dbStatuses]));

    cachedOptions = {
      uom: uoms.map((u) => u.uom).filter(Boolean) as string[],
      ourItemNot: Array.from(new Set(['MANUFACTURING', 'NO', 'TRADING', ...ourItemNots.map((o) => o.ourItemNot).filter(Boolean) as string[]])),
      ourItemName: mergedOurItemNames,
      size: sizes.map((s) => s.size).filter(Boolean) as string[],
      sectionMm: sectionMms.map((s) => s.sectionMm).filter(Boolean) as string[],
      sectionalWtKgMtr: sectionalWts.map((s) => s.sectionalWtKgMtr).filter(Boolean) as string[],
      lengthInMtr: lengths.map((l) => l.lengthInMtr).filter(Boolean) as string[],
      weightPerPiece: unitWts.map((w) => w.weightPerPiece).filter(Boolean) as string[],
      unitWtOfMemberKg: memberWts.map((m) => m.unitWtOfMemberKg).filter(Boolean) as string[],
      price: prices.map((p) => p.price).filter(Boolean) as string[],
      qty: qtys.map((q) => q.qty).filter(Boolean) as string[],
      status: mergedStatuses,
      itemNameParty: itemNames.map((i) => i.itemNameParty).filter(Boolean) as string[],
      docketNoQtnNo: docketNos.map((d) => d.docketNoQtnNo).filter(Boolean) as string[],
      typeOfItem: typeOfItems.map((t) => t.typeOfItem).filter(Boolean) as string[],
    };
    cacheTime = Date.now();

    return NextResponse.json(cachedOptions);
  } catch (error) {
    console.error('Error fetching item filter options:', error);
    return NextResponse.json({ error: 'Failed to fetch filter options' }, { status: 500 });
  }
}
