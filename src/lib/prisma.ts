import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.DATABASE_URL,
      // pg waits forever by default; keep Prisma 6's 5s connect timeout
      connectionTimeoutMillis: 5_000,
    }),
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
