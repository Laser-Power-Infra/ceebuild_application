import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const terms = await prisma.treamAndConditions.findMany({
      orderBy: { id: 'asc' },
    });

    const priceOptions = Array.from(new Set(terms.map((t) => t.price).filter(Boolean))) as string[];
    const paymentOptions = Array.from(new Set(terms.map((t) => t.payment).filter(Boolean))) as string[];
    const deliveryOptions = Array.from(new Set(terms.map((t) => t.delivery).filter(Boolean))) as string[];
    const warrantyOptions = Array.from(new Set(terms.map((t) => t.warranty).filter(Boolean))) as string[];
    const approvalOptions = Array.from(new Set(terms.map((t) => t.approval).filter(Boolean))) as string[];
    const inspectionOptions = Array.from(new Set(terms.map((t) => t.inspection).filter(Boolean))) as string[];

    return NextResponse.json({
      terms,
      dropdowns: {
        price: priceOptions,
        payment: paymentOptions,
        delivery: deliveryOptions,
        warranty: warrantyOptions,
        approval: approvalOptions,
        inspection: inspectionOptions,
      },
    });
  } catch (error) {
    console.error('Error fetching terms:', error);
    return NextResponse.json({ error: 'Failed to fetch terms' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const newTerm = await prisma.treamAndConditions.create({
      data: {
        price: body.price || null,
        payment: body.payment || null,
        delivery: body.delivery || null,
        warranty: body.warranty || null,
        approval: body.approval || null,
        inspection: body.inspection || null,
      },
    });

    await prisma.editLog.create({
      data: {
        tableName: 'tream-and-conditions',
        recordId: newTerm.id,
        fieldName: 'ALL_FIELDS',
        oldValue: 'NONE (New Record)',
        newValue: JSON.stringify(body),
      },
    });

    return NextResponse.json(newTerm);
  } catch (error) {
    console.error('Error creating term:', error);
    return NextResponse.json({ error: 'Failed to create term' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const { id, ...data } = body;
    if (!id) return NextResponse.json({ error: 'Missing ID' }, { status: 400 });

    const existing = await prisma.treamAndConditions.findUnique({ where: { id: Number(id) } });
    if (!existing) return NextResponse.json({ error: 'Record not found' }, { status: 404 });

    const updated = await prisma.treamAndConditions.update({
      where: { id: Number(id) },
      data,
    });

    for (const key of Object.keys(data)) {
      const oldVal = (existing as any)[key] != null ? String((existing as any)[key]) : '';
      const newVal = data[key] != null ? String(data[key]) : '';
      if (oldVal !== newVal) {
        await prisma.editLog.create({
          data: {
            tableName: 'tream-and-conditions',
            recordId: Number(id),
            fieldName: key,
            oldValue: oldVal,
            newValue: newVal,
          },
        });
      }
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error updating term:', error);
    return NextResponse.json({ error: 'Failed to update term' }, { status: 500 });
  }
}
