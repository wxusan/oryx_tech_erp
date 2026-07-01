import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

// Minimal Vitest setup. Tests live in tests/ and cover pure money/date/phone
// logic plus source/migration regression guards. DB-backed integration tests
// are listed as it.todo (see tests/integration.todo.test.ts).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': resolve(process.cwd(), 'src'),
    },
  },
})
