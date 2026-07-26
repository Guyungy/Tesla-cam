import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 120000,
  expect: {
    timeout: 5000,
  },
  reporter: [['list']],
  use: {
    trace: 'on-first-retry',
  },
});
