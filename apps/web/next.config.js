/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@pontual/db', '@pontual/types', '@pontual/utils'],
  // Wave AE-2D (2026-05-25): bypass do type-check de build do Next.js.
  // ~100 erros TS pre-existentes bloqueavam build após o module graph
  // expandir com payment-reminder-dispatcher.
  //
  // Eco audit W9 (2026-05-30): zero TS errors agora (corrigidos em waves
  // B+C+W6+W7). Removido o bypass — type-check ESTRITO restaurado em
  // todo build. Próximo build com erro TS quebra alto (não silent).
  // Se um dia voltar a quebrar, re-habilitar temporariamente é OK mas
  // documentar quais erros e plano de cleanup.
  experimental: {
    instrumentationHook: true,
    serverComponentsExternalPackages: ['@prisma/client', 'xml-crypto', 'node-forge', 'xml2js', '@xmldom/xmldom', '@xmldom/is-dom-node', 'xpath', 'bullmq', 'ioredis'],
    // Includes pra Next standalone copiar arquivos não-importados:
    // - nurture/templates/*.html lido em runtime pelo sender (lib/nurture/sender.ts)
    outputFileTracingIncludes: {
      '/api/internal/cron/nurture-tick': ['./src/lib/nurture/templates/**'],
    },
  },
  // 2026-05-29 fix: BullMQ + IORedis (email-blast worker) importam Node
  // built-ins. Next 14 compila instrumentation.ts em AMBOS edge + nodejs
  // runtimes — edge não tem esses módulos. Em edge runtime ignoramos os
  // imports inteiros via NormalModuleReplacementPlugin + fallback.
  webpack: (config, { nextRuntime, webpack }) => {
    if (nextRuntime !== 'nodejs') {
      config.resolve.fallback = {
        ...(config.resolve.fallback || {}),
        bullmq: false, ioredis: false,
        fs: false, path: false, crypto: false, stream: false,
        net: false, tls: false, child_process: false, os: false, dns: false,
        string_decoder: false, worker_threads: false, util: false,
        zlib: false, http: false, https: false, querystring: false, url: false,
      }
      // Ignora qualquer import de node:* scheme em edge runtime
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
          resource.request = resource.request.replace(/^node:/, '')
        })
      )
    }
    return config
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
        // Microphone liberado same-origin pro widget Sonax Webphone (WebRTC).
        { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=(self)' },
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
