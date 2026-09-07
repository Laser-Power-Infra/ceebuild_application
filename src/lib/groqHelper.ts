import { prisma } from '@/lib/prisma';

export async function getGroqApiKey(customApiKey?: string): Promise<string> {
  // 1. Primary: Check environment variable GROQ_API_KEY from .env
  const envKey = (process.env.GROQ_API_KEY || '').replace(/^["']|["']$/g, '').trim();
  if (envKey && envKey.startsWith('gsk_')) {
    return envKey;
  }

  // 2. Secondary: Explicit key passed in request or user state
  if (customApiKey && typeof customApiKey === 'string' && customApiKey.trim().startsWith('gsk_')) {
    return customApiKey.replace(/^["']|["']$/g, '').trim();
  }

  // 3. Fallback to PostgreSQL database master-values table
  try {
    const dbRecord = await prisma.masterValue.findFirst({
      where: {
        OR: [
          { type: 'GROQ_API_KEY', isActive: true },
          { type: 'SETTING', value: { contains: 'gsk_' } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (dbRecord && dbRecord.value) {
      const dbKey = dbRecord.value.replace(/^["']|["']$/g, '').trim();
      if (dbKey.startsWith('gsk_')) {
        return dbKey;
      }
    }
  } catch (err) {
    console.error('Error fetching Groq API key from DB:', err);
  }

  // 4. Return any non-empty envKey or customApiKey as last resort
  return envKey || customApiKey?.trim() || '';
}

export async function saveGroqApiKeyToDb(apiKey: string): Promise<boolean> {
  if (!apiKey || !apiKey.trim()) return false;
  const cleanKey = apiKey.replace(/^["']|["']$/g, '').trim();

  try {
    const existing = await prisma.masterValue.findFirst({
      where: { type: 'GROQ_API_KEY' },
    });

    if (existing) {
      await prisma.masterValue.update({
        where: { id: existing.id },
        data: { value: cleanKey, isActive: true },
      });
    } else {
      await prisma.masterValue.create({
        data: {
          type: 'GROQ_API_KEY',
          value: cleanKey,
          isActive: true,
        },
      });
    }
    return true;
  } catch (err) {
    console.error('Error saving Groq API Key to DB:', err);
    return false;
  }
}
