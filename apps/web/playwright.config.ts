import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  globalSetup: './e2e/setup/create-test-session.ts',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    storageState: 'e2e/setup/auth-state.json',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // The auth redirect test must run without a session cookie
      name: 'unauthenticated',
      use: { ...devices['Desktop Chrome'], storageState: undefined },
      testMatch: '**/auth.spec.ts',
    },
  ],
  webServer: [
    {
      command: 'TRACION_TEST_MODE=true bun run dev',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      env: { TRACION_TEST_MODE: 'true' },
    },
    {
      command: 'TRACION_TEST_MODE=true bun run start',
      url: 'http://localhost:3001/health',
      reuseExistingServer: !process.env.CI,
      cwd: '../api',
    },
  ],
})
