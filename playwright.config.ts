import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  outputDir: 'artifacts/playwright',
  use: {
    reducedMotion: 'reduce',
    viewport: { width: 1280, height: 960 },
    launchOptions: {
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
    },
  },
  webServer: [
    { command: 'npm run dev -- --port 5174 --strictPort', url: 'http://127.0.0.1:5174', reuseExistingServer: false },
    { command: 'npm run server', port: 8788, reuseExistingServer: false, env: { MATCH_LOG_DIR: process.env.MATCH_LOG_DIR ?? 'artifacts/matches' } },
  ],
});
