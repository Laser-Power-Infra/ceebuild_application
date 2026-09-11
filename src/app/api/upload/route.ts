import { NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const S3_ENDPOINT_URL = process.env.S3_ENDPOINT_URL || 'http://192.168.1.190:8500';
const S3_BUCKET = process.env.S3_BUCKET || 'ceebuild-docket';
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY || 'ai_server';
const S3_SECRET_KEY = process.env.S3_SECRET_KEY || 'asmitabidyututsabminmoyarecool';
const S3_REGION = process.env.S3_REGION || 'us-east-1';
const S3_PUBLIC_URL = process.env.S3_PUBLIC_URL || 'http://192.168.1.190:8500';

const s3Client = new S3Client({
  endpoint: S3_ENDPOINT_URL,
  region: S3_REGION,
  credentials: {
    accessKeyId: S3_ACCESS_KEY,
    secretAccessKey: S3_SECRET_KEY,
  },
  forcePathStyle: true,
});

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Random strict prefix for attachment filename
    const randomStr = Math.random().toString(36).substring(2, 8);
    const timeStamp = Date.now().toString(36);
    const cleanFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const attachmentKey = `${randomStr}_${timeStamp}_${cleanFileName}`;

    const command = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: attachmentKey,
      Body: buffer,
      ContentType: file.type || 'application/octet-stream',
    });

    await s3Client.send(command);

    const publicUrl = `${S3_PUBLIC_URL.replace(/\/$/, '')}/${S3_BUCKET}/${attachmentKey}`;

    return NextResponse.json({
      success: true,
      filename: attachmentKey,
      originalName: file.name,
      url: publicUrl,
    });
  } catch (error: any) {
    console.error('S3 Upload Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to upload attachment to S3' },
      { status: 500 }
    );
  }
}
