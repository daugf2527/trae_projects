import { defineConfig } from '@playwright/test'

const env = ((globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env ??
  {}) as Record<string, string | undefined>

export default defineConfig({
  testDir: './tests',
  timeout: 600_000, // 10 min - allows manual Turnstile solving
  outputDir: env.ARTIFACTS_DIR?.trim() || 'test-results',
  expect: {
    timeout: 30_000
  },
  retries: env.CI ? 1 : 0,
  workers: env.CI ? 1 : undefined,
  use: {
    baseURL: env.BASE_URL?.trim() || 'https://app.luckyx.world/',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    viewport: { width: 1920, height: 1080 }
  },
  reporter: [['list']]
})
