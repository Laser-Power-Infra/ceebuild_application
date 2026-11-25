import { isN8nRequest } from '@/lib/n8n';
import { UserError } from '@/lib/actionResult';
import { erpFeedStatus, importErpRows, type ErpSource } from '@/modules/erp/server/import';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * n8n "Ceebuild – Power BI daily feed" (Rev 2 §5 / §8): one batch of Power BI rows.
 * POST { source: 'PO' | 'INDENT' | 'FREIGHT', rows: [{ <Power BI column>: value }], label? }
 *   -> { inserted, skipped, exceptions, exceptionSample, derived: { rates } }
 * GET -> row counts and last load per source.   Header x-api-key: N8N_API_KEY.
 */
export async function POST(req: Request) {
  if (!isN8nRequest(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { source?: string; rows?: unknown; label?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Body must be JSON.' }, { status: 400 });
  }
  try {
    const source = String(body.source ?? '').toUpperCase() as ErpSource;
    return Response.json(await importErpRows(source, body.rows as Record<string, unknown>[], String(body.label ?? `n8n ${new Date().toISOString().slice(0, 10)}`)));
  } catch (e) {
    if (e instanceof UserError) return Response.json({ error: e.message }, { status: 400 });
    console.error('[n8n erp-import]', e);
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  if (!isN8nRequest(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return Response.json(await erpFeedStatus());
}
