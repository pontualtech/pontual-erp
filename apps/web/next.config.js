/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@pontual/db', '@pontual/types', '@pontual/utils'],
  experimental: {
    instrumentationHook: true,
    serverComponentsExternalPackages: ['@prisma/client', 'xml-crypto', 'node-forge', 'xml2js', '@xmldom/xmldom', '@xmldom/is-dom-node', 'xpath'],
  },
  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        { key: 'X-XSS-Protection', value: '1; mode=block' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        // Camera + geolocation liberados para o app do motorista (same-origin).
        // Microphone continua bloqueado — não é usado em nenhum lugar hoje.
        { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(self)' },
        // CSP:
        //  - script-src: Leaflet via unpkg.com (mapa do dashboard de logistica)
        //  - style-src: idem
        //  - img-src: tile servers OpenStreetMap (já coberto pelo 'https:' global, explicitado por clareza)
        { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://www.google-analytics.com https://unpkg.com https://*.sonax.cloud https://*.sonax.net.br https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://www.doubango.org; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com https://*.sonax.cloud https://*.sonax.net.br https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; img-src 'self' data: https: blob:; font-src 'self' data: https://fonts.gstatic.com https://*.sonax.cloud https://cdnjs.cloudflare.com; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.pontualtech.work wss://*.pontualtech.work https://us.i.posthog.com https://us.posthog.com https://www.google-analytics.com https://analytics.google.com https://*.google-analytics.com https://*.sonax.cloud wss://*.sonax.cloud https://*.sonax.net.br wss://*.sonax.net.br https://*.sonax.net.br:* wss://*.sonax.net.br:* https://viacep.com.br https://www.doubango.org; media-src 'self' blob: https: data:; frame-src 'self' https://*.sonax.cloud https://*.sonax.net.br; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self';" },
      ],
    }]
  },
}
module.exports = nextConfig
