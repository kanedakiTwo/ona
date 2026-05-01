import type { NextConfig } from 'next'
import withPWA from 'next-pwa'

const nextConfig: NextConfig = {
  transpilePackages: ['@ona/shared'],
  output: 'standalone',
}

export default withPWA({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development',
})(
  // @ts-expect-error - @types/next-pwa ships a Next 13 NextConfig type that conflicts with Next 15
  nextConfig,
)
