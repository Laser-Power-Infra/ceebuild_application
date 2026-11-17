import { defineConfig } from 'prisma/config';

// Prisma 7 no longer loads .env itself. No .env exists in the Docker build, where
// `prisma generate` needs no database URL, so a missing file is fine.
try {
  process.loadEnvFile();
} catch {}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
