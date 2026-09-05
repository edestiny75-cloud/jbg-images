import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  images: {
    remotePatterns: [
      // Product thumbnails and print PDFs live in Google Cloud Storage.
      { protocol: 'https', hostname: 'storage.googleapis.com' },
      // Supabase Storage buckets.
      { protocol: 'https', hostname: '*.supabase.co' },
    ],
  },
  experimental: {
    // Server Actions receive multi-MB spreadsheet uploads from List Intake.
    serverActions: { bodySizeLimit: '10mb' },
  },
};

export default nextConfig;
