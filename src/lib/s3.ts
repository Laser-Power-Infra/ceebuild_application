import 'server-only';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

// S3 for new modules reads credentials from the environment only (no fallback secrets).
// Without S3_ACCESS_KEY/S3_SECRET_KEY the file is simply not archived; the data import still works.

const env = process.env;
const configured = !!(env.S3_ACCESS_KEY && env.S3_SECRET_KEY);

const client = configured
  ? new S3Client({
      endpoint: env.S3_ENDPOINT_URL || 'http://192.168.1.190:8500',
      region: env.S3_REGION || 'us-east-1',
      credentials: { accessKeyId: env.S3_ACCESS_KEY as string, secretAccessKey: env.S3_SECRET_KEY as string },
      forcePathStyle: true,
    })
  : null;

/** Stores the file and returns its key, or null when S3 is not configured. Upload errors propagate. */
export async function archiveFile(prefix: string, fileName: string, body: Buffer, contentType: string): Promise<string | null> {
  if (!client) return null;
  const clean = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `${prefix}/${Date.now().toString(36)}_${clean}`;
  await client.send(
    new PutObjectCommand({ Bucket: env.S3_BUCKET || 'ceebuild-docket', Key: key, Body: body, ContentType: contentType || 'application/octet-stream' }),
  );
  return key;
}
