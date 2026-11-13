import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests run against a real server started by the webServer hook, using the offline fixture
 * decision source (no API key, no cost) and a throwaway data directory.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4519',
    trace: 'off',
    video: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node scripts/e2e-server.mjs',
    url: 'http://127.0.0.1:4519/api/health',
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      TIDEHAVEN_FIXTURE: '1',
      TIDEHAVEN_DATA_DIR: 'D:/Projects/Tidehaven/data/e2e',
      TIDEHAVEN_PORT: '4519',
      TIDEHAVEN_LOG_LEVEL: 'warn',
      TIDEHAVEN_MIN_FREE_MB: '10',
    },
  },
});
