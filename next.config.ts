import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // For Docker: set OUTPUT=standalone in Docker build env.
  // For local dev/prod: leave unset so next start works normally.
  // ...(process.env.NEXT_OUTPUT === 'standalone' ? { output: 'standalone' } : {})
  output: 'standalone',
  experimental: {
    // Client BOM workbooks are sent to Server Actions (limit checked again in modules/bom/server/workbook.ts).
    serverActions: { bodySizeLimit: '21mb' },
    // proxy.ts buffers matched request bodies; keep its limit in line with the Server Action limit.
    proxyClientMaxBodySize: '21mb',
  },
};

export default nextConfig;
