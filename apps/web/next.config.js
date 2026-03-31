/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@pontual/db', '@pontual/types', '@pontual/utils'],
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client', 'xml-crypto', 'node-forge', 'xml2js', '@xmldom/xmldom', '@xmldom/is-dom-node', 'xpath'],
  },
}
module.exports = nextConfig
