/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // For Docker: set OUTPUT=standalone in Docker build env.
  // For local dev/prod: leave unset so next start works normally.
  // ...(process.env.NEXT_OUTPUT === 'standalone' ? { output: 'standalone' } : {})
  output:"standalone",
};

module.exports = nextConfig;
