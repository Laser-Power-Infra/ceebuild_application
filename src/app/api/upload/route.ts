import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { requireUser, EDITOR_ROLES } from '@/lib/auth/server';
import { putObject, cleanFileName, s3Configured } from '@/lib/s3';

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export async function POST(req: Request) {
  const auth = await requireUser(EDITOR_ROLES);
  if (auth.error) return auth.error;
  if (!s3Configured) {
    return NextResponse.json({ error: 'File storage is not configured on the server.' }, { status: 503 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get('file');

    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: 'File is larger than 50 MB' }, { status: 413 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Random prefix + timestamp keeps keys unguessable and unique; the original name follows the 2nd "_".
    const randomStr = randomBytes(6).toString('hex');
    const timeStamp = Date.now().toString(36);
    const attachmentKey = `${randomStr}_${timeStamp}_${cleanFileName(file.name)}`;

    await putObject(attachmentKey, buffer, file.type || 'application/octet-stream');

    return NextResponse.json({
      success: true,
      filename: attachmentKey,
      originalName: file.name,
      // Files are served through the app (safe headers), never straight from the storage server.
      url: `/api/attachments/${encodeURIComponent(attachmentKey)}`,
    });
  } catch (error) {
    console.error('S3 Upload Error:', error);
    return NextResponse.json({ error: 'Failed to upload attachment' }, { status: 500 });
  }
}
