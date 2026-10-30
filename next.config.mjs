/** @type {import('next').NextConfig} */
const nextConfig = {
  // DEV usa su propia carpeta de build (npm run dev:dev) para poder correr junto a PROD sin pisarse.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
};

export default nextConfig;
