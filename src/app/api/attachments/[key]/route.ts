import { NextResponse } from 'next/server';
import { getObject, s3Configured } from '@/lib/s3';

// Only these types may be shown inline (in-app preview). Everything else, notably HTML/SVG/XML,
// is always sent as a download so an uploaded file can never run script on the app's origin.
const INLINE_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  if (!s3Configured) {
    return NextResponse.json({ error: 'File storage is not configured on the server.' }, { status: 503 });
  }
  try {
    const { key } = await params;
    if (!key) {
      return NextResponse.json({ error: 'Missing attachment key' }, { status: 400 });
    }

    const decodedKey = decodeURIComponent(key);
    if (decodedKey.includes('..') || decodedKey.startsWith('/')) {
      return NextResponse.json({ error: 'Invalid attachment key' }, { status: 400 });
    }

    const object = await getObject(decodedKey);
    if (!object) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }

    // The type is decided by the file extension, never by what the uploader claimed.
    const ext = (decodedKey.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
    const inlineType = INLINE_TYPES[ext];

    // ?download=1 forces a save dialog; otherwise only safe types are previewed inline.
    const wantsDownload = new URL(req.url).searchParams.get('download') === '1';
    const inline = !wantsDownload && !!inlineType;

    const parts = decodedKey.split('_');
    const originalName = parts.length > 2 ? parts.slice(2).join('_') : decodedKey;
    const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');

    return new Response(Buffer.from(object.body), {
      status: 200,
      headers: {
        'Content-Type': inline ? inlineType : 'application/octet-stream',
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${safeName}"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=86400',
      },
    });
  } catch (error: unknown) {
    const name = (error as { name?: string })?.name;
    if (name === 'NoSuchKey' || name === 'NotFound') {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }
    console.error('Attachment proxy fetch error:', error);
    return NextResponse.json({ error: 'Failed to retrieve attachment' }, { status: 500 });
  }
}
