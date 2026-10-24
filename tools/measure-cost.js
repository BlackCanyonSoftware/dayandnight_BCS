"use strict";

/**
 * Measure what the wallpaper actually costs, for NFR-1.
 *
 *   node tools/measure-cost.js [secondsPerScenario]
 *
 * Milestone 0's job is partly to find out whether Electron can hold a 24/7
 * wallpaper inside the performance budget, before any art is built on top of
 * the assumption that it can (ADR 0001). This is how that number is taken.
 *
 * It runs several scenarios in one launch so the cost can be decomposed rather
 * than quoted as a single mystery number. The interesting question is not
 * "what does it cost" but "how much of that is per frame and how much is the
 * floor" - because only the first kind can be optimised by drawing less.
 *
 * Method, stated so the number can be argued with:
 *
 * - The editor window is hidden throughout: its preview is a second renderer
 *   and is not part of what a user leaves running.
 * - A settling period is discarded before each scenario: start-up and shader
 *   compilation are real costs but they are not the steady state.
 * - CPU is the sum of processor-seconds across every process of the
 *   application, read from the OS, expressed as a percentage of ONE core.
 *   That is the honest unit for a background task; "0.95% of the machine"
 *   on a 12-thread CPU flatters it by a factor of twelve.
 * - Memory is the sum of working sets.
 *
 * Two modes, because the question changed once the renderer learned to skip
 * identical frames:
 *
 * - The default sweep decomposes the cost into a floor and a slope per frame
 *   per second, which is what Milestone 0 needed in order to know whether
 *   drawing less would help. It would.
 * - `--shipped` measures one thing: the configuration a user actually leaves
 *   running, with the editor CLOSED rather than merely hidden, in windows long
 *   enough to resolve a figure around two per cent. The sweep cannot answer
 *   NFR-1 any more, for two reasons. Its floor includes a loaded editor, which
 *   is a third of the memory and none of the product. And now that identical
 *   frames are skipped, every scenario collapses onto that floor, so a
 *   six-second window reports noise with a number in front of it.
 *
 * What this does NOT measure: GPU time. There is no dependency-free way to
 * read it on Windows, and a number invented from a frame counter would not be
 * a measurement. It is reported as not verified.
 */

const { execFileSync } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");

const args = process.argv.slice(2);

/** Measure only the configuration a user leaves running. See the header. */
const SHIPPED_ONLY = args.includes("--shipped");

/**
 * Seconds per scenario. The shipped figure defaults to far longer windows
 * because it is a small number: at two per cent of one core, six seconds holds
 * about a tenth of a processor-second of signal, which is the same size as the
 * machine twitching in the background.
 */
const SECONDS = Number(args.find((arg) => /^\d+$/.test(arg))) || (SHIPPED_ONLY ? 300 : 30);
const ROOT = path.join(__dirname, "..");

/**
 * How long to let a scenario settle before believing it.
 *
 * The first run of this tool used six seconds and produced two impossible
 * samples - an idle reading above a 5 fps reading - because start-up work was
 * still landing inside the measurement window. Twelve is enough for shader
 * compilation, the first presents and Chromium's own start-up to finish.
 */
const SETTLE_SECONDS = 12;

/**
 * Each scenario is measured as several short windows rather than one long one.
 *
 * A single window cannot tell a real number from a contaminated one. Several
 * can: the median ignores a window that caught a background task, and the
 * spread between them says whether the machine was quiet enough to believe
 * any of it.
 */
const REPEATS = 5;

/**
 * Total processor-seconds and working set across the application's processes.
 *
 * Inline PowerShell rather than a .ps1 file, because a default Windows
 * execution policy refuses scripts but allows commands.
 *
 * @returns {{ cpuSeconds: number, workingSetMb: number, processes: number }}
 */
function sample() {
  const script = [
    "$p = Get-Process -Name electron -ErrorAction SilentlyContinue",
    "if (-not $p) { '0 0 0' } else {",
    "  $cpu = ($p | Measure-Object -Property CPU -Sum).Sum",
    "  $ws  = ($p | Measure-Object -Property WorkingSet64 -Sum).Sum",
    '  "$cpu $ws $($p.Count)"',
    "}"
  ].join("; ");

  const out = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    windowsHide: true
  }).trim();

  const [cpu, ws, count] = out.split(/\s+/).map(Number);
  return {
    cpuSeconds: Number.isFinite(cpu) ? cpu : 0,
    workingSetMb: Number.isFinite(ws) ? ws / (1024 * 1024) : 0,
    processes: Number.isFinite(count) ? count : 0
  };
}

/** @param {number} seconds */
function wait(seconds) {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

/**
 * @param {number[]} values
 * @returns {number}
 */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

/**
 * @typedef {object} Row
 * @property {string} label
 * @property {number} perCore median across the windows
 * @property {number} spread highest window minus lowest
 * @property {number[]} windows every window's figure, so a bad one is visible
 * @property {number} memoryMb
 * @property {number} processes
 */

/**
 * Measure one scenario as several short windows, and report the median.
 *
 * @param {string} label
 * @returns {Promise<Row>}
 */
async function measure(label) {
  await wait(SETTLE_SECONDS);

  const windowSeconds = SECONDS / REPEATS;
  /** @type {number[]} */
  const windows = [];

  let last = sample();
  for (let i = 0; i < REPEATS; i += 1) {
    const startedAt = Date.now();
    await wait(windowSeconds);
    const now = sample();

    const elapsed = (Date.now() - startedAt) / 1000;
    windows.push(((now.cpuSeconds - last.cpuSeconds) / elapsed) * 100);
    last = now;
  }

  const perCore = median(windows);
  const spread = Math.max(...windows) - Math.min(...windows);

  /** @type {Row} */
  const row = {
    label,
    perCore,
    spread,
    windows,
    memoryMb: last.workingSetMb,
    processes: last.processes
  };

  // The spread is printed next to every figure on purpose. A median with a
  // wide spread behind it is not a measurement, and the first run of this
  // tool would have shown that rather than hiding it in a single number.
  const noisy = spread > Math.max(1, perCore * 0.5) ? "  <- noisy" : "";
  console.log(
    `  ${label.padEnd(30)} ${perCore.toFixed(2).padStart(6)} %core ` +
      `(spread ${spread.toFixed(2).padStart(5)})   ` +
      `${row.memoryMb.toFixed(0).padStart(4)} MB   ${row.processes} proc${noisy}`
  );
  return row;
}

async function main() {
  if (process.platform !== "win32") {
    console.error("This measures the Windows build; there is nothing to measure elsewhere.");
    process.exitCode = 1;
    return;
  }

  const { _electron: electron } = require("@playwright/test");

  const app = await electron.launch({ args: [ROOT], cwd: ROOT });
  const editor = await app.firstWindow();
  await editor.waitForLoadState("domcontentloaded");

  /**
   * Turn the clouds on or off through the real control.
   *
   * Driven through the editor rather than written into the settings file,
   * because the settings file is read by the renderer and the renderer is
   * about to be closed - and because a measurement of a path nobody uses is
   * not a measurement of the product.
   *
   * @param {number} cover
   */
  const setCloudCover = async (cover) => {
    await editor.evaluate((value) => {
      const input = /** @type {HTMLInputElement | null} */ (document.querySelector("#cloudCover"));
      if (!input) throw new Error("the cloud cover control is missing");
      input.value = String(value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, cover);
  };

  /** @param {number} fps */
  const setFps = async (fps) => {
    await editor.evaluate((value) => {
      const input = /** @type {HTMLInputElement | null} */ (document.querySelector("#fps"));
      if (!input) throw new Error("the frame-rate control is missing");
      input.value = String(value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, fps);
  };

  // The editor is the focusable window and the wallpaper surfaces are not,
  // which is how all three of these tell them apart without a handle on
  // either.
  const hideEditor = async () => {
    await app.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed() && window.isFocusable()) window.hide();
      }
    });
  };

  const showEditor = async () => {
    await app.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed() && window.isFocusable()) window.show();
      }
    });
  };

  const closeEditor = async () => {
    await app.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed() && window.isFocusable()) window.close();
      }
    });
  };

  console.log(
    `machine : ${os.cpus()[0]?.model?.trim() ?? "unknown"} (${os.cpus().length} threads)`
  );
  console.log(
    `method  : ${REPEATS} windows of ${(SECONDS / REPEATS).toFixed(0)}s per scenario, ` +
      `after ${SETTLE_SECONDS}s settling; the median is reported`
  );

  const scenarios = SHIPPED_ONLY ? 3 : 6;
  const minutes = ((SETTLE_SECONDS + SECONDS) * scenarios) / 60;
  console.log(`runtime : about ${minutes.toFixed(0)} minutes. Leave the machine alone.`);
  console.log("");

  /** @type {Row[]} */
  const rows = [];

  // The floor: the application running with nothing drawing at all. Only the
  // sweep takes it, and only the sweep can take it. With the wallpaper off and
  // the editor closed there are no windows left, and Electron quits.
  if (!SHIPPED_ONLY) {
    await hideEditor();
    rows.push(await measure("idle, wallpaper off"));
    await showEditor();
  }

  await editor.locator("#wallBtn").click();

  const deadline = Date.now() + 20_000;
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
  if (state.host !== "workerw") {
    console.error(`The wallpaper did not attach (host: ${state.host}). Not measuring.`);
    await app.close();
    process.exitCode = 1;
    return;
  }
  console.log(`  (attached to ${state.screens} screen${state.screens === 1 ? "" : "s"})`);

  if (SHIPPED_ONLY) {
    await setFps(20);

    // The same scenario twice, hidden then closed, in windows of the same
    // length. Milestone 0 measured the hidden case, so this is what makes the
    // comparison against it a comparison rather than a guess: between these
    // two rows the only thing that changes is the editor, and between the
    // hidden row and Milestone 0 the only thing that changes is that frames
    // are now skipped.
    await setCloudCover(0);
    await hideEditor();
    rows.push(await measure("20 fps, hidden, clear"));

    // The same again with clouds, which is the only pair that answers what
    // they cost. Everything else about the two rows is identical, and the
    // editor stays hidden for both so that closing it cannot be mistaken for
    // the clouds being cheap.
    //
    // The clouds are the first thing here that moves, so this is also the only
    // row where the frame-skipping is doing real work rather than skipping
    // everything.
    await showEditor();
    await setCloudCover(0.5);
    await hideEditor();
    rows.push(await measure("20 fps, hidden, clouds"));

    // Closed, not hidden. A hidden editor is still a loaded renderer holding a
    // WebGL context and most of the memory, and nobody leaves one of those
    // running for a day. NFR-1 asks what the product costs, so the editor has
    // to be gone before the figure means anything.
    await closeEditor();
    rows.push(await measure("shipped: 20 fps, closed, clouds"));
  } else {
    // The wallpaper at descending frame rates. The slope between these is the
    // per-frame cost; the intercept is what Electron charges for simply
    // existing, which no amount of drawing less will recover.
    for (const fps of [30, 20, 10, 5, 1]) {
      await setFps(fps);
      await hideEditor();
      rows.push(await measure(`wallpaper on, ${String(fps).padStart(2)} fps`));
    }
  }

  // The slope, taken from 30 and 10 rather than from the extremes: the 1 fps
  // end is where a contaminated window does the most damage to a gradient.
  const at30 = rows.find((r) => r.label.includes("30 fps"));
  const at10 = rows.find((r) => r.label.includes("10 fps"));
  const at1 = rows.find((r) => r.label.includes(" 1 fps"));
  const idle = rows[0];

  console.log("");

  // Sanity, before any conclusion is drawn from the numbers. A scenario that
  // draws cannot cost less than one that draws nothing; if it appears to, the
  // run was contaminated and the figures should not be quoted. The first run
  // of this tool hit exactly this and it was only caught by reading carefully.
  /** @type {string[]} */
  const impossible = [];

  // Only the sweep has a floor to compare against. In shipped mode the first
  // row is a scenario that legitimately costs more than the second - that
  // difference is the whole point of the run - and comparing against it
  // declared the good figure impossible the first time this ran.
  if (idle && !SHIPPED_ONLY) {
    for (const row of rows.slice(1)) {
      // The tolerance comes from the two scenarios and their own spreads
      // rather than from a fixed figure. Once identical frames are skipped, a
      // scenario that draws genuinely costs about what the floor costs, so
      // "below idle" stopped being impossible and became the expected result.
      // What is still impossible is below idle by more than the variation
      // within either scenario could account for.
      const tolerance = 0.2 + (row.spread + idle.spread) / 2;
      if (row.perCore < idle.perCore - tolerance) {
        impossible.push(
          `${row.label} (${row.perCore.toFixed(2)}) is ${tolerance.toFixed(2)} or more ` +
            `below idle (${idle.perCore.toFixed(2)}), which the spreads cannot explain`
        );
      }
    }
  }
  const noisy = rows.filter((r) => r.spread > Math.max(1, r.perCore * 0.5));

  if (impossible.length > 0 || noisy.length > 0) {
    console.log("!!! THIS RUN IS NOT TRUSTWORTHY ".padEnd(61, "!"));
    for (const line of impossible) console.log(`  impossible: ${line}`);
    for (const row of noisy) {
      console.log(
        `  noisy     : ${row.label} spread ${row.spread.toFixed(2)} across [${row.windows.map((w) => w.toFixed(1)).join(", ")}]`
      );
    }
    console.log("  Close other applications and run it again.");
    console.log("");
  }

  console.log("=== NFR-1 ===================================================");
  const shipped = rows.find((row) => row.label.startsWith("shipped"));
  if (shipped) {
    const budget = 2;

    // Half the spread is added before comparing, on purpose. A figure that
    // only sits under the budget because its noise band straddles it has not
    // met anything.
    const verdict =
      shipped.perCore + shipped.spread / 2 < budget
        ? "met"
        : shipped.perCore < budget
          ? "met at the median, but the spread crosses the budget"
          : "NOT met";

    console.log(`shipped, 20 fps, editor shut : ${shipped.perCore.toFixed(2)} % of one core`);
    console.log(
      `  windows                    : [${shipped.windows.map((w) => w.toFixed(2)).join(", ")}]`
    );
    console.log(`  spread                     : ${shipped.spread.toFixed(2)}`);
    console.log(`budget                       : ${budget.toFixed(2)} % of one core`);
    console.log(`against the budget           : ${verdict}`);

    const clear = rows.find((row) => row.label.includes("hidden, clear"));
    const cloudy = rows.find((row) => row.label.includes("hidden, clouds"));

    if (clear && cloudy) {
      const clouds = cloudy.perCore - clear.perCore;
      console.log(
        `the clouds themselves        : ${clouds.toFixed(2)} % of one core ` +
          `(${clear.perCore.toFixed(2)} clear against ${cloudy.perCore.toFixed(2)} cloudy)`
      );

      // ADR 0007 dropped occlusion detection because the drawing component was
      // below what the instrument could resolve, and named clouds as the thing
      // that would bring it back. This is that test, stated where the number
      // appears rather than left for somebody to remember.
      console.log(
        `ADR 0007                     : ${
          clouds > 0.5
            ? "REOPENS - drawing now costs enough for occlusion to be worth re-examining"
            : "stands - drawing is still too cheap for occlusion to pay for itself"
        }`
      );
    }
    console.log(
      `working set, whole app       : ${shipped.memoryMb.toFixed(0)} MB ` +
        `across ${shipped.processes} processes`
    );
    console.log("  (the 80 MB per screen in NFR-1 is GPU memory, which is not measured)");
  } else if (at30 && at10 && idle) {
    const perFrame = (at30.perCore - at10.perCore) / (30 - 10);
    console.log(`floor (app, nothing drawing) : ${idle.perCore.toFixed(2)} % of one core`);
    console.log(`cost per frame per second    : ${perFrame.toFixed(3)} % of one core`);
    console.log(`  so at 20 fps, drawing costs: ${(perFrame * 20).toFixed(2)} %`);
    console.log(`  and the floor is           : ${idle.perCore.toFixed(2)} %`);
    if (at1) {
      console.log(`nearly-still (1 fps)         : ${at1.perCore.toFixed(2)} % of one core`);
    }
  }
  console.log(`screens                      : ${state.screens}`);
  console.log(`GPU                          : not measured`);
  console.log(
    `verdict                      : ${
      impossible.length > 0 || noisy.length > 0 ? "UNRELIABLE - re-run" : "usable"
    }`
  );
  console.log("=============================================================");

  await app.close();
}

// Guarded so the pieces can be exercised without launching anything: this
// tool is the one that decides whether NFR-1 is met, so its arithmetic should
// be checkable without taking over somebody's desktop.
if (require.main === module) {
  void main();
}

module.exports = { sample, median };
