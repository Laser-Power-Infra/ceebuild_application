import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, auditUser, ADMIN_ROLES } from '@/lib/auth/server';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type');
    const activeOnly = searchParams.get('activeOnly') === 'true';

    const where: any = {};
    if (type) {
      where.type = type;
    }
    if (activeOnly) {
      where.isActive = true;
    }

    const values = await prisma.masterValue.findMany({
      where,
      orderBy: { value: 'asc' },
    });

    // Group by type for easy consumption by form selects
    const grouped: { [key: string]: string[] } = {
      PARTY_NAME: [],
      STATE: [],
      UTILITY: [],
      ADDRESS: [],
      STATUS: [],
    };

    for (const item of values) {
      if (item.isActive) {
        if (!grouped[item.type]) grouped[item.type] = [];
        grouped[item.type].push(item.value);
      }
    }

    return NextResponse.json({ masterValues: values, grouped });
  } catch (error) {
    console.error('Error fetching master values:', error);
    return NextResponse.json({ error: 'Failed to fetch master values' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await requireUser(ADMIN_ROLES);
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const { type, value, isActive = true } = body;

    if (!type || !value || !value.trim()) {
      return NextResponse.json({ error: 'Type and Value are required' }, { status: 400 });
    }

    const created = await prisma.masterValue.create({
      data: {
        type: type.trim(),
        value: value.trim(),
        isActive: Boolean(isActive),
      },
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error('Error creating master value:', error);
    return NextResponse.json({ error: 'Failed to create master value' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const auth = await requireUser(ADMIN_ROLES);
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const { id, type, value, isActive } = body;

    if (!id) {
      return NextResponse.json({ error: 'Missing ID' }, { status: 400 });
    }

    const updated = await prisma.masterValue.update({
      where: { id: Number(id) },
      data: {
        ...(type ? { type: type.trim() } : {}),
        ...(value ? { value: value.trim() } : {}),
        ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {}),
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error updating master value:', error);
    return NextResponse.json({ error: 'Failed to update master value' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const auth = await requireUser(ADMIN_ROLES);
  if (auth.error) return auth.error;
  const user = auth.user;

  try {
    const { searchParams } = new URL(req.url);
    const id = Number(searchParams.get('id'));
    if (!id) return NextResponse.json({ error: 'Missing ID' }, { status: 400 });

    const existing = await prisma.masterValue.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: 'Record not found' }, { status: 404 });

    await prisma.$transaction([
      prisma.masterValue.delete({ where: { id } }),
      prisma.editLog.create({
        data: {
          tableName: 'master-values',
          recordId: id,
          fieldName: 'DELETE_MASTER_VALUE',
          oldValue: JSON.stringify(existing),
          newValue: `Deleted ${existing.type} option "${existing.value}" by ${user.name} (${user.username})`,
          ...auditUser(user),
        },
      }),
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting master value:', error);
    return NextResponse.json({ error: 'Failed to delete master value' }, { status: 500 });
  }
}
