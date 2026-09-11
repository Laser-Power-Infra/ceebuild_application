import { NextResponse } from 'next/server';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const S3_ENDPOINT_URL = process.env.S3_ENDPOINT_URL || 'http://192.168.1.190:8500';
const S3_BUCKET = process.env.S3_BUCKET || 'ceebuild-docket';
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY || 'ai_server';
const S3_SECRET_KEY = process.env.S3_SECRET_KEY || 'asmitabidyututsabminmoyarecool';
const S3_REGION = process.env.S3_REGION || 'us-east-1';

const s3Client = new S3Client({
  endpoint: S3_ENDPOINT_URL,
  region: S3_REGION,
  credentials: {
    accessKeyId: S3_ACCESS_KEY,
    secretAccessKey: S3_SECRET_KEY,
  },
  forcePathStyle: true,
});

export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  try {
    const { key } = await params;
    if (!key) {
      return NextResponse.json({ error: 'Missing attachment key' }, { status: 400 });
    }

    const decodedKey = decodeURIComponent(key);

    const command = new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: decodedKey,
    });

    const s3Response = await s3Client.send(command);

    if (!s3Response.Body) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }

    const byteArray = await s3Response.Body.transformToByteArray();
    const buffer = Buffer.from(byteArray);
    const contentType = s3Response.ContentType || 'application/octet-stream';

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${decodedKey}"`,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error: any) {
    console.error('Attachment proxy fetch error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to retrieve attachment from S3' },
      { status: 500 }
    );
  }
}
