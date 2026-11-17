// Shared Prisma client for the maintenance scripts.
// Prisma 7 needs a driver adapter and no longer loads .env on its own.
import { PrismaClient as BaseClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

try {
  process.loadEnvFile();
} catch {}

export class PrismaClient extends BaseClient {
  constructor() {
    super({
      adapter: new PrismaPg({
        connectionString: process.env.DATABASE_URL,
        connectionTimeoutMillis: 5_000,
      }),
    });
  }
}
