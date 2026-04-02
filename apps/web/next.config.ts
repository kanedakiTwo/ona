import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@ona/shared'],
  output: 'standalone',
}

export default nextConfig
