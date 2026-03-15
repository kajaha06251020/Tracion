import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  // Proxy /api/* requests to the Hono API server
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/:path*`,
      },
      {
        source: '/trpc/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/trpc/:path*`,
      },
    ]
  },
}

export default nextConfig
