/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Required for Docker standalone deployment
  output: 'standalone',
};

module.exports = nextConfig;
