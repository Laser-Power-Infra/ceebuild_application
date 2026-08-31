import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    status: 'okay',
    timestamp: new Date().toISOString(),
  });
}
