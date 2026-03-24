import { fileURLToPath } from 'node:url'

import { defineConfig } from '@playwright/test'

const playwrightDir = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
    permissions: ['clipboard-read', 'clipboard-write'],
    viewport: {
      width: 1440,
      height: 1100,
    },
  },
  webServer: {
    command: 'WEB_DIST_DIR=dist-runtime pnpm preview --host 127.0.0.1 --port 4173',
    port: 4173,
    reuseExistingServer: true,
    cwd: playwrightDir,
    timeout: 120_000,
  },
})
