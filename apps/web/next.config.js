/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@pontual/db', '@pontual/types', '@pontual/utils'],
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client'],
  },
}
module.exports = nextConfig
