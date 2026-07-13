import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

// Unit/component/source-guard suite. Real PostgreSQL route and invariant tests
// live under tests/integration and run separately through test:integration.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['tests/integration/**/*.integration.test.ts'],
    // Dummy DB URLs so modules that import the Prisma client singleton (e.g.
    // telegram-id.ts) can be loaded by pure unit tests. The pg adapter builds a
    // lazy Pool, so no real connection is made unless a query actually runs.
    env: {
      DATABASE_URL: 'postgresql://dummy:dummy@localhost:5432/dummy',
      DIRECT_URL: 'postgresql://dummy:dummy@localhost:5432/dummy',
    },
  },
  resolve: {
    alias: {
      '@': resolve(process.cwd(), 'src'),
    },
  },
})
