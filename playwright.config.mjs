import { defineConfig, devices } from "@playwright/test";

/**
 * Browser and image tests against the editor, served by tools/serve.js.
 *
 * The sky is rendered on the GPU, and a headless Chromium falls back to SwiftShader,
 * which rasterises differently from a real driver. So image comparisons run with a
 * tolerance rather than byte-for-byte, and the strict determinism claim
 * (architecture invariant 1) is pinned by unit tests on the arithmetic instead.
 */
export default defineConfig({
  testDir: "tests/browser",
  testMatch: /.*\.spec\.js/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],

  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      threshold: 0.2
    }
  },

  use: {
    baseURL: "http://127.0.0.1:5178",
    trace: "on-first-retry",
    screenshot: "only-on-failure"
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        launchOptions: {
          // A software rasteriser that at least supports WebGL2, so the engine
          // runs in CI. Numbers from it are not performance measurements.
          args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
        }
      }
    }
  ],

  webServer: {
    command: "node tools/serve.js 5178",
    url: "http://127.0.0.1:5178",
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
    stderr: "pipe"
  }
});
