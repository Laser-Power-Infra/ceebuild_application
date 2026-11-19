import { NextResponse, type NextRequest } from 'next/server';
import { createHash, timingSafeEqual } from 'node:crypto';
import { listFlags } from '@/modules/overview/server/flags';
import type { OrderFlag } from '@/modules/overview/types';

export const dynamic = 'force-dynamic';

/** Constant-time compare of two secrets (hashed first so lengths always match). */
function sameSecret(a: string, b: string) {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

function digest(flags: OrderFlag[], generatedAt: string, baseUrl: string): string {
  if (flags.length === 0) return `Ceebuild daily alert (${generatedAt.slice(0, 10)}): nothing is overdue.`;
  const high = flags.filter((f) => f.severity === 'high');
  const lines = [
    `Ceebuild daily alert ${generatedAt.slice(0, 10)}: ${flags.length} red flag(s), ${high.length} high.`,
    '',
  ];
  const byOrder = new Map<number, OrderFlag[]>();
  for (const f of flags) byOrder.set(f.orderId, [...(byOrder.get(f.orderId) ?? []), f]);
  for (const [orderId, list] of byOrder) {
    lines.push(`PO ${list[0].poNumber}${list[0].client ? ` (${list[0].client})` : ''}`);
    for (const f of list) lines.push(`${f.severity === 'high' ? '[HIGH]' : '[MED]'} ${f.title}: ${f.detail}${f.days ? ` (${f.days} d overdue)` : ''}`);
    if (baseUrl) lines.push(`${baseUrl}/orders/${orderId}`);
    lines.push('');
  }
  return lines.join('\n').trim();
}

/**
 * Red-flag feed for the daily WhatsApp / email alert (polled by n8n).
 *   GET /api/alerts                 -> JSON {generatedAt, counts, flags}
 *   GET /api/alerts?format=text     -> plain-text digest
 *   GET /api/alerts?severity=high   -> high flags only
 * Requires header `x-api-key: <ALERTS_API_KEY>`.
 */
export async function GET(req: NextRequest) {
  const key = process.env.ALERTS_API_KEY;
  if (!key || key.length < 16) return NextResponse.json({ error: 'Alerts are not configured (ALERTS_API_KEY).' }, { status: 503 });
  const given = req.headers.get('x-api-key') ?? '';
  if (!given || !sameSecret(given, key)) return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });

  const params = req.nextUrl.searchParams;
  let flags: OrderFlag[];
  try {
    flags = await listFlags();
  } catch (err) {
    console.error('alerts: failed to load flags', err);
    return NextResponse.json({ error: 'Failed to load flags' }, { status: 500 });
  }
  if (params.get('severity') === 'high') flags = flags.filter((f) => f.severity === 'high');

  const generatedAt = new Date().toISOString();
  const counts = {
    total: flags.length,
    high: flags.filter((f) => f.severity === 'high').length,
    medium: flags.filter((f) => f.severity === 'medium').length,
    orders: new Set(flags.map((f) => f.orderId)).size,
    byCode: flags.reduce<Record<string, number>>((acc, f) => ({ ...acc, [f.code]: (acc[f.code] ?? 0) + 1 }), {}),
  };
  const headers = { 'Cache-Control': 'no-store' };
  if (params.get('format') === 'text') {
    const baseUrl = (process.env.NEXTAUTH_URL ?? '').replace(/\/+$/, '');
    return new NextResponse(digest(flags, generatedAt, baseUrl), { headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  return NextResponse.json({ generatedAt, counts, flags }, { headers });
}
