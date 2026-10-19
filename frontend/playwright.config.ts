import { defineConfig, devices } from '@playwright/test';

// Runs against a backend serving the production build (npm run build) on :8000.
// E2E_BASE_URL points it elsewhere, e.g. the Vite dev server on :5173.
export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.ts',
  forbidOnly: !!process.env.CI,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
