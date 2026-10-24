import { _electron as electron } from "@playwright/test";
import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Milestone 0's exit criteria, checked against the real application.
 *
 * These are the tests that justify the milestone: whether Electron can hold a
 * window behind the desktop icons at all (ADR 0001, ADR 0002), and whether the
 * editor and the wallpaper draw the same sky from the same engine.
 *
 * They run on Windows only. Everywhere else the host falls back by design, and
 * asserting the fallback on a platform that has no desktop to attach to would
 * test nothing.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** @type {import("@playwright/test").ElectronApplication} */
let app;
/** @type {import("@playwright/test").Page} */
let editor;

test.beforeEach(async () => {
  app = await electron.launch({
    args: [root],
    cwd: root
  });
  editor = await app.firstWindow();
  await editor.waitForLoadState("domcontentloaded");
});

test.afterEach(async () => {
  await app.close();
});

test("the editor opens and renders a sky through the engine", async () => {
  await expect(editor.locator("#preview")).toBeVisible();

  // The page API is the contract the editor promises a test or a script.
  const frame = await editor.evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return window.DayAndNight.lastFrame();
  });

  expect(frame, "the engine should have rendered at least one frame").not.toBeNull();
  expect(Number.isFinite(frame.sunAltitude)).toBe(true);
  expect(frame.sunAltitude).toBeGreaterThanOrEqual(-90);
  expect(frame.sunAltitude).toBeLessThanOrEqual(90);
  expect(["day", "civil", "nautical", "astronomical", "night"]).toContain(frame.band);
});

test("it is served from the application's own secure scheme, not file://", async () => {
  // ADR 0001: a custom standard scheme rather than file://, which is not a
  // secure context and would cost ES modules and a well-behaved WebGL context.
  expect(editor.url()).toMatch(/^dayandnight:\/\/app\/index\.html$/);
  expect(await editor.evaluate(() => window.isSecureContext)).toBe(true);
});

test("the renderer is locked down", async () => {
  // contextIsolation on, nodeIntegration off, sandbox on. If any of these
  // regress, a bug in the page becomes a bug on the user's machine.
  const exposure = await editor.evaluate(() => ({
    node: typeof globalThis.require,
    process: typeof globalThis.process,
    bridge: typeof globalThis.dayAndNight
  }));

  expect(exposure.node, "require must not be reachable from the page").toBe("undefined");
  expect(exposure.process, "process must not be reachable from the page").toBe("undefined");
  expect(exposure.bridge, "the named bridge should be there").toBe("object");
});

test("the editor reports the screens the shell sees", async () => {
  const monitors = await editor.evaluate(() => window.dayAndNight.getMonitors());

  expect(Array.isArray(monitors)).toBe(true);
  expect(monitors.length).toBeGreaterThan(0);

  for (const monitor of monitors) {
    expect(monitor.bounds.w).toBeGreaterThan(0);
    expect(monitor.bounds.h).toBeGreaterThan(0);
    expect(monitor.scale).toBeGreaterThan(0);
  }
  expect(monitors.filter((m) => m.primary).length).toBe(1);
});

test("turning the wallpaper on puts a window behind the desktop icons", async () => {
  test.skip(process.platform !== "win32", "the desktop host is Windows-only");

  const before = await editor.evaluate(() => window.dayAndNight.getWallpaperState());
  expect(before.on).toBe(false);

  await editor.locator("#wallBtn").click();

  // The surfaces are created at once but can only attach to the desktop once
  // each is ready to show, so wait for the host to settle rather than for the
  // windows to exist. "starting" is exactly the state that distinguishes them.
  await expect
    .poll(async () => (await editor.evaluate(() => window.dayAndNight.getWallpaperState())).host, {
      timeout: 20_000
    })
    .not.toBe("starting");

  const state = await editor.evaluate(() => window.dayAndNight.getWallpaperState());
  expect(state.on).toBe(true);

  expect(state.screens, "one surface per screen").toBeGreaterThan(0);

  // The real assertion of the milestone. "fallback" is a supported degraded
  // mode, but on a healthy Windows desktop it means the technique broke, so
  // this must be the real thing.
  expect(
    state.host,
    `expected the WorkerW host; got "${state.host}"${state.reason ? ` (${state.reason})` : ""}`
  ).toBe("workerw");

  // One BrowserWindow per screen, plus the editor.
  const windowCount = await app.evaluate(
    ({ BrowserWindow }) => BrowserWindow.getAllWindows().length
  );
  expect(windowCount).toBe(state.screens + 1);
});

test("the wallpaper surface draws the same engine as the preview", async () => {
  test.skip(process.platform !== "win32", "the desktop host is Windows-only");

  await editor.locator("#wallBtn").click();
  await expect
    .poll(async () => (await editor.evaluate(() => window.dayAndNight.getWallpaperState())).host, {
      timeout: 20_000
    })
    .not.toBe("starting");

  const windows = app.windows();
  const surface = windows.find((w) => w.url().includes("wallpaper.html"));
  expect(surface, "a wallpaper window should exist").toBeTruthy();

  await surface.waitForLoadState("domcontentloaded");

  // The surface has no page API - it is deliberately the smallest possible
  // document - so it is checked by reading the pixels it actually drew.
  const pixel = await surface.evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const canvas = document.getElementById("surface");
    const gl = canvas.getContext("webgl2");
    const data = new Uint8Array(4);
    gl.readPixels(
      Math.floor(gl.drawingBufferWidth / 2),
      Math.floor(gl.drawingBufferHeight / 2),
      1,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      data
    );
    return { rgba: Array.from(data), w: gl.drawingBufferWidth, h: gl.drawingBufferHeight };
  });

  expect(pixel.w, "the surface should be sized to its monitor").toBeGreaterThan(0);
  expect(pixel.rgba[3], "the sky is opaque").toBe(255);

  // It drew *something*: a sky is never pure black, even at astronomical
  // night, because the zenith keyframe is #05070f rather than #000000.
  const brightness = pixel.rgba[0] + pixel.rgba[1] + pixel.rgba[2];
  expect(brightness, "the surface should have drawn a sky, not stayed blank").toBeGreaterThan(0);
});

test("turning it off takes every surface away", async () => {
  test.skip(process.platform !== "win32", "the desktop host is Windows-only");

  await editor.locator("#wallBtn").click();
  await expect
    .poll(async () => (await editor.evaluate(() => window.dayAndNight.getWallpaperState())).host, {
      timeout: 20_000
    })
    .not.toBe("starting");

  await editor.locator("#wallBtn").click();
  await expect
    .poll(async () => (await editor.evaluate(() => window.dayAndNight.getWallpaperState())).on, {
      timeout: 10_000
    })
    .toBe(false);

  const windowCount = await app.evaluate(
    ({ BrowserWindow }) => BrowserWindow.getAllWindows().length
  );
  expect(windowCount, "only the editor should be left").toBe(1);
});

/**
 * Turn the wallpaper on and wait for the host to settle.
 * @returns {Promise<import("@playwright/test").Page>} the surface's page
 */
async function startWallpaper() {
  await editor.locator("#wallBtn").click();
  await expect
    .poll(async () => (await editor.evaluate(() => window.dayAndNight.getWallpaperState())).host, {
      timeout: 20_000
    })
    .not.toBe("starting");

  const surface = app.windows().find((w) => w.url().includes("wallpaper.html"));
  expect(surface, "a wallpaper window should exist").toBeTruthy();
  await surface.waitForLoadState("domcontentloaded");
  return surface;
}

/**
 * Count the surface's own render loop, from inside its page.
 *
 * The loop is a `setTimeout` chain, so wrapping `setTimeout` counts exactly
 * one tick per frame. This is the only way to tell the two possible meanings
 * of "paused" apart: a loop that has been torn down stops calling it, and a
 * loop that runs and returns early does not. Architecture invariant 7 is
 * precisely that distinction, and nothing observable from outside the page -
 * not the pixels, which a nearly-still sky leaves unchanged anyway - can see
 * it. The surface has no page API by design, so the instrumentation is the
 * test's and lives here rather than in the product.
 *
 * @param {import("@playwright/test").Page} surface
 */
async function countTicks(surface) {
  await surface.evaluate(() => {
    if (window.__ticks !== undefined) return;
    window.__ticks = 0;
    const real = window.setTimeout.bind(window);
    window.setTimeout = (fn, ms, ...rest) => {
      window.__ticks += 1;
      return real(fn, ms, ...rest);
    };
  });
}

/**
 * How many ticks the loop runs over a window of time.
 * @param {import("@playwright/test").Page} surface
 */
async function ticksOver(surface, ms = 700) {
  const before = await surface.evaluate(() => window.__ticks);
  await new Promise((resolve) => setTimeout(resolve, ms));
  const after = await surface.evaluate(() => window.__ticks);
  return after - before;
}

test("locking the session tears the render loop down, and unlocking rebuilds it (US-013)", async () => {
  test.skip(process.platform !== "win32", "the desktop host is Windows-only");

  // Nobody can lock a session from a test, but powerMonitor is an EventEmitter
  // and the watcher subscribes to it like any other listener - so the event it
  // would have received is delivered directly. Everything after that is the
  // real path: the policy, the IPC, the surface.
  const surface = await startWallpaper();
  await countTicks(surface);

  expect(await ticksOver(surface), "a running wallpaper should be ticking").toBeGreaterThan(3);

  await app.evaluate(({ powerMonitor }) => powerMonitor.emit("lock-screen"));

  const locked = await editor.evaluate(() => window.dayAndNight.getWallpaperState());
  expect(locked.paused).toBe(true);
  expect(locked.pausedBecause).toMatch(/locked/);

  // The windows stay. Invariant 7 is about the render loop, not the surfaces -
  // destroying and rebuilding a window per screen every time somebody locks
  // their machine would cost more than it saved.
  expect(locked.on).toBe(true);
  expect(locked.screens).toBeGreaterThan(0);

  // And this is the invariant itself: zero ticks, not fewer ticks.
  expect(
    await ticksOver(surface),
    "a paused surface should have torn its loop down, not be running it and returning early"
  ).toBe(0);

  await app.evaluate(({ powerMonitor }) => powerMonitor.emit("unlock-screen"));

  const unlocked = await editor.evaluate(() => window.dayAndNight.getWallpaperState());
  expect(unlocked.paused).toBe(false);
  expect(unlocked.pausedBecause).toBe(null);
  expect(await ticksOver(surface), "unlocking should start it again").toBeGreaterThan(3);
});

test("when several reasons are true at once, the one shown explains the most (US-013)", async () => {
  test.skip(process.platform !== "win32", "the desktop host is Windows-only");

  await startWallpaper();

  await app.evaluate(({ powerMonitor }) => {
    powerMonitor.emit("lock-screen");
    powerMonitor.emit("suspend");
  });

  const state = await editor.evaluate(() => window.dayAndNight.getWallpaperState());
  expect(state.paused).toBe(true);
  expect(
    state.pausedBecause,
    "a locked machine that is also suspending is leaving, which is the bigger fact"
  ).toMatch(/sleep/);

  await app.evaluate(({ powerMonitor }) => {
    powerMonitor.emit("resume");
    powerMonitor.emit("unlock-screen");
  });

  expect(
    (await editor.evaluate(() => window.dayAndNight.getWallpaperState())).paused,
    "waking up should start it again"
  ).toBe(false);
});

test("the tray icon is there, and it can answer for the wallpaper (OQ-1)", async () => {
  test.skip(process.platform !== "win32", "the tray is part of the Windows shell");

  // Electron keeps no registry of trays, so the module has to be asked - and
  // `require` is not in scope inside electronApplication.evaluate, which only
  // receives the electron module itself. `process.mainModule.require` is the
  // way in, but it resolves relative to the electron module rather than to
  // main.js, so the path has to be an absolute one built from the app root.
  const present = await app.evaluate(async ({ app: electronApp }) => {
    const path = process.mainModule.require("node:path");
    const tray = process.mainModule.require(
      path.join(electronApp.getAppPath(), "desktop", "tray.js")
    );
    return tray.exists();
  });

  expect(present, "a wallpaper with no window of its own needs a way back to it").toBe(true);
});

test("the editor agrees with Windows about starting at login (OQ-1)", async () => {
  test.skip(process.platform !== "win32", "login items are a Windows thing");

  // Read only, and deliberately so. Setting it writes to the user's Run key,
  // and a test that left the application in somebody's startup list - or took
  // it out of one they had put it in - would be doing real damage to the
  // machine it ran on.
  //
  // Asked over IPC rather than of the module, which makes this the better
  // test: it goes through the handler, the preload bridge and the renderer,
  // so a break anywhere on that path shows up here rather than in use.
  const overIpc = await editor.evaluate(() => window.dayAndNight.getStartWithWindows());
  expect(typeof overIpc, "the editor should get an answer at all").toBe("boolean");

  const checkbox = editor.locator("#startup");
  await expect(checkbox).toBeEnabled();
  expect(
    await checkbox.isChecked(),
    "the box should show what Windows actually thinks, not a remembered value"
  ).toBe(overIpc);
});

test("the About panel can read the documents the build ships", async () => {
  // In a browser there are no documents and the panel says so; here there are,
  // and this is the only place that path runs. A build that shipped the files
  // but could not find them at runtime - the packaged and development folders
  // differ - would look exactly like the browser case.
  const titles = await editor.evaluate(() => window.dayAndNight.listLegal());
  expect(titles.length, "five documents ship with every build").toBe(5);

  await expect(editor.locator("#legalList button")).toHaveCount(5);
  await expect(editor.locator("#aboutVersion")).toHaveText(/^v\d/);

  const eula = await editor.evaluate(() => window.dayAndNight.readLegal("eula"));
  expect(eula, "the licence should be readable from the application").toBeTruthy();
  expect(eula).toContain("End User Licence Agreement");

  // And an identifier that is not one of ours gets nothing, rather than
  // reaching a path it should not.
  const nothing = await editor.evaluate(() => window.dayAndNight.readLegal("../../package.json"));
  expect(nothing).toBe(null);
});
