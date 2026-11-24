import { isN8nRequest } from '@/lib/n8n';
import { UserError } from '@/lib/actionResult';
import { attachN8nFile } from '@/modules/poIntake/server/intake';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * n8n attaches one file of a PO mail to the intake it created:
 * POST /api/n8n/po-file?intakeId=12&name=Cee%20Build%20PO.pdf&kind=PO   body = the file (raw bytes)
 */
export async function POST(req: Request) {
  if (!isN8nRequest(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const url = new URL(req.url);
  const intakeId = Number(url.searchParams.get('intakeId'));
  if (!Number.isInteger(intakeId) || intakeId <= 0) return Response.json({ error: 'intakeId is missing.' }, { status: 400 });
  try {
    const buffer = Buffer.from(await req.arrayBuffer());
    const mime = (req.headers.get('content-type') || '').split(';')[0].trim();
    return Response.json(
      await attachN8nFile(intakeId, { name: url.searchParams.get('name') ?? 'file', kind: url.searchParams.get('kind') ?? 'OTHER', mimeType: mime && mime !== 'application/octet-stream' ? mime : null }, buffer),
    );
  } catch (e) {
    if (e instanceof UserError) return Response.json({ error: e.message }, { status: 400 });
    console.error('[n8n po-file]', e);
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
