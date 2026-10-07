import { defineConfig, devices } from '@playwright/test';

const browserName = process.env.PLAYWRIGHT_BROWSER === 'webkit' ? 'webkit' : 'chromium';
const channel = browserName === 'chromium'
  ? process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' && !process.env.CI ? 'msedge' : undefined)
  : undefined;
const runName = channel || browserName;

export default defineConfig({
  testDir: './tests',
  testMatch: ['reader.spec.ts', 'editor.spec.ts', 'rich-editor.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 6_000 },
  metadata: { testEngine: runName },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: `test-results/${runName}/report` }],
    ['json', { outputFile: `test-results/${runName}/results.json` }],
  ],
  outputDir: `test-results/${runName}/artifacts`,
  use: {
    ...devices['Desktop Edge'],
    browserName,
    channel,
    baseURL: 'http://127.0.0.1:5173',
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    acceptDownloads: true,
  },
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
