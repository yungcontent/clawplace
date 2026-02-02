import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Serverful deployment for API routes to work
  images: {
    unoptimized: true
  },

  // Security: Limit request body size to prevent memory exhaustion
  experimental: {
    serverActions: {
      bodySizeLimit: '1mb'
    }
  },

  // Disable x-powered-by header
  poweredByHeader: false,

  // Strict mode for better security
  reactStrictMode: true,

  // Headers for additional security
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY'
          }
        ]
      }
    ];
  }
};

export default nextConfig;
