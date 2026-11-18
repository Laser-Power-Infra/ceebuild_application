import { NextResponse } from 'next/server';
import { nextDocketNumber } from '@/lib/docketNumber';

// Only a suggestion for the form; POST /api/dockets re-checks and renumbers if it was taken meanwhile.
export async function GET() {
  try {
    return NextResponse.json(await nextDocketNumber());
  } catch (error) {
    console.error('Error generating next docket number:', error);
    return NextResponse.json({ error: 'Failed to generate next docket number' }, { status: 500 });
  }
}
