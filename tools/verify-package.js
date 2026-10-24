// @ts-check
"use strict";

/**
 * Check that a packaged build actually works.
 *
 *   npm run build && node tools/verify-package.js
 *
 * **This opens windows and briefly replaces the desktop background.**
 *
 * Why this exists separately from `tests/desktop/`. Those tests run the
 * application from source, which answers "does the code work". A packaged
 * build asks a different question, and the difference is not cosmetic: the
 * application is inside an asar archive, served through a custom scheme, with
 * koffi's native binary moved outside the archive because a `.node` file
 * cannot be loaded from inside one.
 *
 * `desktop/build/check-bundle.js` already asserts, at build time, that the
 * binary landed outside the archive. It cannot assert that it loads. The
 * failure mode that reaches a customer is precisely that gap: the installer
 * builds, the application starts, the editor appears - and then nothing
 * happens to the desktop, because the one call that finds it could not be
 * made. Nothing but launching the packaged build finds that.
 *
 * It checks the unpacked build (`dist/win-unpacked`) rather than running the
 * installer, so it leaves nothing behind in Installed Programs.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const UNPACKED = path.join(ROOT, "dist", "win-unpacked");
const EXECUTABLE = path.join(UNPACKED, "Day and Night.exe");

/** Relative to the application's `resources/`, and part of what it ships. */
const SHIPPED_DOCUMENTS = [
  path.join("licenses", "EULA.md"),
  path.join("licenses", "DISCLAIMER.md"),
  path.join("licenses", "PRIVACY.md"),
  path.join("licenses", "THIRD-PARTY-NOTICES.md")
];

/** @param {number} seconds */
function wait(seconds) {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

/** @type {string[]} */
const failures = [];

/**
 * @param {string} what
 * @param {boolean} ok
 * @param {string} [detail]
 */
function check(what, ok, detail) {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail ? ` - ${detail}` : ""}`);
  if (!ok) failures.push(what + (detail ? ` (${detail})` : ""));
}

async function main() {
  if (process.platform !== "win32") {
    console.error("The packaged build is a Windows build; there is nothing to verify elsewhere.");
    process.exitCode = 1;
    return;
  }

  if (!fs.existsSync(EXECUTABLE)) {
    console.error(`No packaged build at ${EXECUTABLE}.\nRun \`npm run build\` first.`);
    process.exitCode = 1;
    return;
  }

  const { _electron: electron } = require("@playwright/test");

  console.log(`verifying ${EXECUTABLE}`);
  console.log("");

  // The documents, on disk, beside the application the user would run. The
  // build hook checked these too; checking them here as well is what makes
  // this tool runnable against a build somebody else made.
  for (const document of SHIPPED_DOCUMENTS) {
    const where = path.join(UNPACKED, "resources", document);
    check(`ships ${document.replace(/\\/g, "/")}`, fs.existsSync(where));
  }

  // No `args`: a packaged application carries its own entry point, and passing
  // a directory would make it open that instead.
  const app = await electron.launch({ executablePath: EXECUTABLE });

  try {
    const editor = await app.firstWindow();
    await editor.waitForLoadState("domcontentloaded");

    check("the editor window opens", true);

    // asar and the custom scheme in one assertion: if packaging had broken the
    // scheme handler, this would be a file:// URL or nothing at all.
    const url = editor.url();
    check(
      "served from its own scheme, not file://",
      /^dayandnight:\/\/app\/index\.html$/.test(url),
      url
    );

    check(
      "a secure context, so ES modules and WebGL behave",
      await editor.evaluate(() => window.isSecureContext)
    );

    // WebGL inside the packaged application. The engine is the product; a
    // build that cannot compile its shaders is worth catching here.
    await wait(0.6);
    const frame = await editor.evaluate(() => window.DayAndNight.lastFrame());
    check(
      "the engine renders a frame",
      frame !== null && Number.isFinite(frame.sunAltitude),
      frame ? `sun at ${frame.sunAltitude.toFixed(1)} deg, ${frame.band}` : "no frame"
    );

    // The documents, read by the packaged application rather than merely
    // present on disk. `legal.js` resolves a different folder when packaged -
    // beside the executable instead of in the repository - and that branch
    // runs nowhere else, so without this it would be the version that passes
    // every test and then ships broken.
    const documents = await editor.evaluate(() => {
      if (!window.dayAndNight) throw new Error("the shell bridge is missing");
      return window.dayAndNight.listLegal();
    });
    const eula = await editor.evaluate(() => {
      if (!window.dayAndNight) throw new Error("the shell bridge is missing");
      return window.dayAndNight.readLegal("eula");
    });
    check(
      "the application can read its own licence",
      Array.isArray(documents) && documents.length === 5 && typeof eula === "string",
      `${Array.isArray(documents) ? documents.length : 0} listed, licence ${
        typeof eula === "string" ? `${eula.length} chars` : "unreadable"
      }`
    );

    // The reason this tool exists.
    await editor.locator("#wallBtn").click();

    const deadline = Date.now() + 20_000;
    /** @returns {Promise<DayAndNightWallpaperState>} */
    const readState = () =>
      editor.evaluate(() => {
        if (!window.dayAndNight) throw new Error("the shell bridge is missing");
        return window.dayAndNight.getWallpaperState();
      });

    let state = await readState();
    while (state.host === "starting" && Date.now() < deadline) {
      await wait(0.5);
      state = await readState();
    }

    check("the wallpaper turns on", state.on === true);
    check(
      "koffi loaded from outside the asar and found the desktop",
      state.host === "workerw",
      `host: ${state.host}${state.reason ? `, ${state.reason}` : ""}`
    );
    check("a surface per screen", state.screens > 0, `${state.screens} screen(s)`);

    const windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    check(
      "one window per screen, plus the editor",
      windows === state.screens + 1,
      `${windows} window(s)`
    );

    // Put the desktop back before leaving, rather than relying on the
    // application exiting to do it.
    await editor.locator("#wallBtn").click();
    await wait(0.5);
  } finally {
    await app.close();
  }

  console.log("");
  if (failures.length > 0) {
    console.log("=== the packaged build is NOT good ==========================");
    for (const failure of failures) console.log(`  ${failure}`);
    console.log("=============================================================");
    process.exitCode = 1;
    return;
  }

  console.log("=== the packaged build works ================================");
  console.log("A sky reached the real desktop from the packaged application.");
  console.log("Still not checked here: the installer itself, which only adds");
  console.log("shortcuts and an uninstall entry on top of what ran above.");
  console.log("=============================================================");
}

void main();
