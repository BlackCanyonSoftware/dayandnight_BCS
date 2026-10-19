import { defineConfig } from "@playwright/test";

/**
 * The Electron tests: the real shell, the real windows, the real desktop.
 *
 * Separate from playwright.config.mjs because these launch the application
 * rather than a page, need no web server, and must not run in parallel - there
 * is one desktop and one WorkerW, and two copies of the application would
 * fight over them (main.js takes a single-instance lock, so the second would
 * simply quit).
 */
export default defineConfig({
  testDir: "tests/desktop",
  testMatch: /.*\.spec\.mjs/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"]]
});
