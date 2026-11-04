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
      // Tight, because both CI and a developer's machine render through the
      // same SwiftShader rasteriser (forced in launchOptions below), so the
      // output is deterministic rather than driver-dependent. The loose
      // tolerance this started with was wide enough to miss a one-degree
      // change in the sun's position, which made the test decorative.
      maxDiffPixelRatio: 0.002,
      threshold: 0.1
    }
  },

  use: {
    baseURL: "http://127.0.0.1:5178",

    // The editor's date control means local midnight, which is right - a
    // person setting 21 June means their 21 June. So a test that scrubs to
    // "midnight" and expects night has fixed a zone whether it says so or
    // not, and until now the zone it fixed was whichever one the developer's
    // machine happened to be in. CI runs in UTC, where minute 0 of 21 June is
    // 18:00 on the 20th in Denver and the sun is 26 degrees up; two tests
    // failed there and passed on every machine they were written on.
    //
    // Denver, because that is the place these tests use and the sky in
    // `sunrise-denver-june.png` is Denver's.
    timezoneId: "America/Denver",
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
