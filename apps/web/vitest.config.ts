import { defineConfig } from 'vitest/config'
import path from 'path'

/**
 * Sprint 6 (post nota-10 audit recomendação): vitest setup pra critical path.
 *
 * Foco: testes de helpers ISOLADOS (sem DB, sem Next.js runtime).
 * Tests de integração com DB devem rodar via scripts/e2e-*.ts
 * (já existe pattern com Prisma client direto).
 *
 * Uso:
 *   npm run test         — uma rodada
 *   npm run test:watch   — watch mode
 *   npm run test:ui      — UI vitest
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    exclude: ['node_modules/**', '.next/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/lib/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.spec.ts'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
