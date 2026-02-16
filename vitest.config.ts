import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['tests/e2e/**'],
    testTimeout: 15000,
    environmentMatchGlobs: [
      ['tests/integration/**', 'node'],
    ],
    fileParallelism: false,
  },
})
