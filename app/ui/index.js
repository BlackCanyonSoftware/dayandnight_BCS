// @ts-check
/**
 * Boot, and the wiring of every control.
 *
 * The only module that touches the DOM broadly. It reads the saved document,
 * puts the state together, starts the preview loop, and connects each control
 * to a setter in `state.js`. Nothing here computes anything about the sky.
 *
 * @module ui/index
 */

import { defaultPreset, resolveBearing, twilightBand } from "../engine/index.js";
import * as timeline from "./clock.js";
import * as shell from "./desktop.js";
import { createPreview } from "./preview.js";
import { drawBands } from "./scrubber.js";
import { readDocument, writeDocument } from "./settings.js";
import {
  clock,
  cropFor,
  fps,
  monitors,
  place,
  preset,
  replacePreset,
  setFps,
  setMonitors,
  setPlace,
  setPreset,
  span
} from "./state.js";
import { cycleTheme, initTheme, setTheme, theme } from "./theme.js";
import {
  $,
  fmtBearing,
  fmtDegrees,
  fmtExposure,
  fmtTime,
  input,
  notice,
  toDateInputValue
} from "./util.js";

/** @typedef {import("../engine/types.js").FrameInfo} FrameInfo */

const previewCanvas = /** @type {HTMLCanvasElement} */ ($("#preview"));
const bandsCanvas = /** @type {HTMLCanvasElement} */ ($("#scrubBands"));

/** @type {ReturnType<typeof createPreview> | null} */
let preview = null;

/**
 * The scrubber bands are a few hundred evaluations, so they are repainted at
 * the end of a burst of changes rather than on every input event of a drag.
 */
let bandsDirty = true;

/* ------------------------------------------------------------------- boot */

async function boot() {
  initTheme();

  await loadSaved();
  setMonitors(await shell.getMonitors());
  paintMonitors();

  try {
    preview = createPreview(previewCanvas, onFrame);
  } catch (error) {
    // No WebGL2 is the one failure that stops the product working, so it is
    // said plainly rather than logged. The message comes from the engine and
    // is written for a user.
    notice(error instanceof Error ? error.message : String(error));
    return;
  }

  wireControls();
  timeline.snapToNow(Date.now());
  paintFromState();
  syncClockControls();

  preview.start();
  void refreshWallpaperState();

  shell.onMonitorsChanged((next) => {
    setMonitors(next);
    paintMonitors();
    preview?.resize();
    bandsDirty = true;
  });

  shell.onWallpaperState(paintWallpaperState);

  // Invariant 7: a preview nobody can see is torn down, not left spinning.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) preview?.stop();
    else preview?.start();
  });

  window.addEventListener("resize", () => preview?.resize());
}

async function loadSaved() {
  const { doc, problem } = readDocument(await shell.loadSettings());
  if (problem) notice(problem);
  if (!doc) return;

  replacePreset(doc.cfg.preset);
  setPlace(doc.cfg.place);
  setFps(doc.cfg.fps);
  setTheme(doc.ui.theme);
}

/* --------------------------------------------------------------- controls */

function wireControls() {
  bindRange("lat", (v) => {
    setPlace({ lat: v });
    bandsDirty = true;
  });
  bindRange("lon", (v) => {
    setPlace({ lon: v });
    bandsDirty = true;
  });
  bindRange("exposure", (v) => {
    setPreset({ exposure: v });
    bandsDirty = true;
  });
  bindRange("whitePoint", (v) => {
    setPreset({ whitePoint: v });
    bandsDirty = true;
  });
  // -1 on the slider is "auto": face whichever side of the sky the sun
  // crosses. It is the leftmost position rather than a separate control,
  // because a checkbox beside a slider for the same setting reads as two
  // settings.
  bindRange("bearing", (v) => {
    setPreset({ bearing: v < 0 ? null : v });
    bandsDirty = true;
  });
  bindRange("horizon", (v) => setPreset({ horizon: v }));
  bindRange("fieldOfView", (v) => setPreset({ fieldOfView: v }));
  bindRange("fps", (v) => setFps(Math.round(v)));

  input("scrub").addEventListener("input", (event) => {
    timeline.setMinute(Number(/** @type {HTMLInputElement} */ (event.target).value));
    syncClockControls();
  });

  input("date").addEventListener("change", (event) => {
    if (!timeline.setDate(/** @type {HTMLInputElement} */ (event.target).value)) return;
    bandsDirty = true;
    syncClockControls();
  });

  $("#nowBtn").addEventListener("click", () => {
    timeline.snapToNow(Date.now());
    bandsDirty = true;
    syncClockControls();
  });

  $("#playBtn").addEventListener("click", togglePlay);
  $("#ffBtn").addEventListener("click", togglePlay);

  $("#themeBtn").addEventListener("click", () => {
    cycleTheme();
    save();
  });

  $("#guessBtn").addEventListener("click", guessLongitude);
  $("#wallBtn").addEventListener("click", toggleWallpaper);
  $("#resetBtn").addEventListener("click", resetAll);
  $("#saveBtn").addEventListener("click", downloadSettings);
  $("#loadBtn").addEventListener("click", () => {
    notice(
      "Loading a settings file arrives with the preset library in Milestone 5. Save already writes a file you can keep."
    );
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === " " && !(event.target instanceof HTMLInputElement)) {
      event.preventDefault();
      togglePlay();
    }
  });
}

/**
 * Wire a range input to a setter, keeping its readout and the saved document
 * in step.
 *
 * @param {string} id
 * @param {(value: number) => void} set
 */
function bindRange(id, set) {
  const element = input(id);
  element.addEventListener("input", () => {
    set(Number(element.value));
    paintFromState();
    save();
  });
}

function togglePlay() {
  timeline.setPlaying(!clock.playing, Date.now());
  syncClockControls();
}

/**
 * Longitude from the system time zone: each hour of offset is 15 degrees.
 *
 * This is a guess and is labelled as one. It is right to within half a time
 * zone - a few hundred kilometres, enough to put sunrise within a few minutes
 * - and it is free. Latitude cannot be guessed this way at all, so it is left
 * alone and the note says so. The searchable city picker and the optional
 * lookup that is the only thing in the application to touch the network arrive
 * in Milestone 1 (US-010).
 */
function guessLongitude() {
  // getTimezoneOffset is the minutes to add to local time to reach UTC, so it
  // is positive west of Greenwich - the opposite sign from longitude.
  const offsetHours = -new Date().getTimezoneOffset() / 60;
  setPlace({ lon: Math.max(-180, Math.min(180, offsetHours * 15)) });

  bandsDirty = true;
  paintFromState();
  save();

  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "your time zone";
  $("#guessNote").textContent =
    `Longitude set from ${zone}. Latitude cannot be guessed from a time zone, so set it yourself.`;
}

async function toggleWallpaper() {
  const state = await shell.getWallpaperState();
  const next = await shell.setWallpaper(!state.on);

  paintWallpaperState(next);
  notice(next.reason && !next.on ? next.reason : null);
  pushRuntime();
}

function resetAll() {
  replacePreset(defaultPreset());
  setFps(20);
  timeline.snapToNow(Date.now());

  bandsDirty = true;
  paintFromState();
  syncClockControls();
  save();
  notice(null);
}

/**
 * The current settings as a file the user keeps (US-022). The preset library
 * lands in Milestone 5; this is the honest minimum until then.
 */
function downloadSettings() {
  const doc = writeDocument({ preset, place, fps, theme: theme() }, Date.now());
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `dayandnight-${toDateInputValue(Date.now())}.json`;
  link.click();

  URL.revokeObjectURL(url);
}

/* ---------------------------------------------------------------- painting */

/** Push every state value into the controls and their readouts. */
function paintFromState() {
  input("lat").value = String(place.lat);
  input("lon").value = String(place.lon);
  input("exposure").value = String(preset.exposure);
  input("whitePoint").value = String(preset.whitePoint);
  input("bearing").value = String(preset.bearing === null ? -1 : preset.bearing);
  input("horizon").value = String(preset.horizon);
  input("fieldOfView").value = String(preset.fieldOfView);
  input("fps").value = String(fps);

  $("#latVal").textContent = fmtDegrees(place.lat);
  $("#lonVal").textContent = fmtDegrees(place.lon);
  $("#exposureVal").textContent = `${preset.exposure.toFixed(1)} EV`;
  $("#whitePointVal").textContent = preset.whitePoint.toFixed(1);
  $("#bearingVal").textContent =
    preset.bearing === null
      ? `Auto (${compass(resolveBearing(preset, place))})`
      : compass(preset.bearing);
  $("#horizonVal").textContent = `${Math.round(preset.horizon * 100)}%`;
  $("#fieldOfViewVal").textContent = `${Math.round(preset.fieldOfView)}°`;
  $("#fpsVal").textContent = `${fps} fps`;

  pushRuntime();
}

function paintMonitors() {
  const s = span();

  $("#monList").textContent =
    monitors.length === 0
      ? "none reported"
      : monitors
          .map(
            (m) =>
              `${m.bounds.w}×${m.bounds.h}` +
              (m.scale === 1 ? "" : ` @${m.scale}×`) +
              (m.primary ? " (primary)" : "")
          )
          .join(", ");

  $("#spanNote").textContent = `span ${s.w}×${s.h}`;

  // Monitor boundaries over the preview, so a span reads as screens rather
  // than as one wide picture.
  const splits = $("#previewSplits");
  splits.replaceChildren();
  for (const monitor of monitors) {
    const crop = cropFor(monitor);
    if (crop.x <= 0) continue;
    const bar = document.createElement("span");
    bar.style.left = `${(crop.x / s.w) * 100}%`;
    splits.append(bar);
  }
}

/** @param {import("./desktop.js").WallpaperState} state */
function paintWallpaperState(state) {
  $("#wallBtn").textContent = state.on ? "Turn the wallpaper off" : "Turn the wallpaper on";

  const box = $("#wallState");
  box.replaceChildren();

  if (!state.on) {
    box.textContent = shell.hasShell()
      ? "Not running."
      : "Not available: this is a browser, not the application.";
    $("#hostNote").textContent = shell.hasShell() ? "wallpaper off" : "browser preview";
    return;
  }

  const screens = `${state.screens} screen${state.screens === 1 ? "" : "s"}`;
  const paused = state.paused ? ", paused" : "";

  const line = document.createElement("span");

  if (state.host === "starting") {
    line.textContent = `Starting on ${screens}…`;
    box.append(line);
    $("#hostNote").textContent = "host: starting";
    return;
  }

  if (state.host === "fallback") {
    line.className = "host-fallback";
    line.textContent = `Running on ${screens}${paused}, in front of the desktop wallpaper rather than behind the icons.`;
    $("#hostNote").textContent = "host: fallback";
  } else {
    line.className = "host-ok";
    line.textContent = `Running on ${screens}${paused}, behind the desktop icons.`;
    $("#hostNote").textContent = "host: WorkerW";
  }
  box.append(line);

  if (state.reason) box.append(` ${state.reason}`);
}

async function refreshWallpaperState() {
  paintWallpaperState(await shell.getWallpaperState());
}

/** Keep the scrubber, the date and the play button in step with the clock. */
function syncClockControls() {
  const realNow = Date.now();

  input("scrub").value = String(Math.round(timeline.scrubValue(realNow)));
  input("date").value = timeline.dateInputValue(realNow);

  const button = $("#playBtn");
  button.textContent = clock.playing ? "⏸" : "▶";
  button.setAttribute("aria-label", clock.playing ? "Pause" : "Play");
  $("#ffBtn").setAttribute("aria-pressed", clock.playing ? "true" : "false");
}

/**
 * Called after every frame.
 *
 * @param {FrameInfo} info
 * @param {number} t
 */
function onFrame(info, t) {
  $("#readout").textContent = [
    fmtTime(t),
    `alt ${fmtDegrees(info.sunAltitude)}`,
    `az ${fmtBearing(info.sunAzimuth)}`,
    twilightBand(info.sunAltitude),
    `${fmtExposure(info.exposure)} EV`
  ].join("  ·  ");

  if (bandsDirty) {
    bandsDirty = false;
    redrawBands();
  }

  // While fast-forward runs, the scrubber follows it rather than sitting still.
  if (clock.playing) {
    input("scrub").value = String(Math.round(clock.minute));
  }
}

function redrawBands() {
  const width = Math.max(1, bandsCanvas.clientWidth || 600);
  if (bandsCanvas.width !== width) bandsCanvas.width = width;
  drawBands(bandsCanvas, clock.dayStart, place, preset);
}

/** Hand the wallpaper windows what they need in order to draw. */
function pushRuntime() {
  shell.pushConfig({ preset, place, fps });
}

/**
 * A bearing as a compass direction with its number.
 *
 * "SW 225" rather than "225": a bearing is a direction, and most people read
 * the letters faster than the degrees.
 *
 * @param {number} degrees
 * @returns {string}
 */
function compass(degrees) {
  const points = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const index = Math.round((((degrees % 360) + 360) % 360) / 45) % 8;
  return `${points[index]} ${Math.round(degrees)}°`;
}

let saveTimer = 0;

/** Debounced, so a slider drag is one write rather than one per pixel. */
function save() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    shell.saveSettings(writeDocument({ preset, place, fps, theme: theme() }, Date.now()));
  }, 400);
}

/* --------------------------------------------------------------- page API */

/**
 * The small set of things a test or a script may ask of the editor without
 * clicking. The browser tests hold it to these promises.
 */
Object.defineProperty(window, "DayAndNight", {
  value: Object.freeze({
    /** @returns {FrameInfo | null} */
    lastFrame: () => preview?.lastFrame() ?? null,

    /** @returns {import("./settings.js").SettingsDoc} */
    document: () => writeDocument({ preset, place, fps, theme: theme() }, Date.now()),

    /**
     * @param {unknown} raw
     * @returns {string | null} a problem, or null on success
     */
    apply: (raw) => {
      const { doc, problem } = readDocument(raw);
      if (!doc) return problem ?? "That is not a settings document.";

      replacePreset(doc.cfg.preset);
      setPlace(doc.cfg.place);
      setFps(doc.cfg.fps);
      setTheme(doc.ui.theme);

      bandsDirty = true;
      paintFromState();
      return null;
    },

    /** @param {number} minute */
    scrubTo: (minute) => {
      timeline.setMinute(minute);
      syncClockControls();
    },

    /** @param {string} value `YYYY-MM-DD` */
    dateTo: (value) => {
      if (!timeline.setDate(value)) return;
      bandsDirty = true;
      syncClockControls();
    },

    version: () => shell.version()
  }),
  writable: false
});

boot().catch((error) => {
  notice(error instanceof Error ? error.message : String(error));
});
