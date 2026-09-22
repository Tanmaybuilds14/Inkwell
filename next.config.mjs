/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emits .next/standalone for the Docker image; Vercel deployment will ignore this.
  // Native / connection-holding packages must not be bundled by Turbopack.
  output: process.env.BUILD_STANDALONE === '1' ? 'standalone' : undefined,
  serverExternalPackages: ['@prisma/adapter-pg', 'pg', 'ioredis', 'happy-dom'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.clerk.dev',
      },
    ],
  },
};

export default nextConfig;
