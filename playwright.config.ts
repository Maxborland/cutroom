import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  retries: 1,
  workers: 1,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'npm run server',
      port: 3001,
      reuseExistingServer: true,
      timeout: 30000,
    },
    {
      command: 'npm run dev',
      port: 5173,
      reuseExistingServer: true,
      timeout: 30000,
    },
  ],
})
