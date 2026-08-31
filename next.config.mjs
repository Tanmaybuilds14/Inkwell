/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emits .next/standalone for the Docker image; harmless on Vercel.
  output: 'standalone',
  // Native / connection-holding packages must not be bundled by Turbopack.
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
