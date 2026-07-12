import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

// Minimal Vitest setup. Tests live in tests/ and cover pure money/date/phone
// logic plus source/migration regression guards. DB-backed integration tests
// are listed as it.todo (see tests/integration.todo.test.ts).
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
