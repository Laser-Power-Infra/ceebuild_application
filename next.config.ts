import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // For Docker: set OUTPUT=standalone in Docker build env.
  // For local dev/prod: leave unset so next start works normally.
  // ...(process.env.NEXT_OUTPUT === 'standalone' ? { output: 'standalone' } : {})
  output: 'standalone',
  allowedDevOrigins: ['192.168.1.*', 'localhost', '127.0.0.1','192.168.1.200'],
};

export default nextConfig;
