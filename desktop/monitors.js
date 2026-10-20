// @ts-check
"use strict";

/**
 * Which screens exist, and when that changes.
 *
 * Everything here needs Electron's `screen` module: asking Windows what is
 * plugged in, converting device-independent pixels to physical ones, and
 * noticing a rearrangement. The arithmetic that turns those answers into one
 * sky and a slice per screen lives in `app/engine/span.js`, with no Electron
 * in it, so that the arrangements nobody owns the hardware for can be tested
 * (US-012, and Milestone 2's exit criteria).
 *
 * @module desktop/monitors
 */

const { screen } = require("electron");

// An ES module, reached from CommonJS. The arithmetic belongs to the engine -
// `crop` and `span` are two fields of a FrameRequest - and the editor imports
// the same file, which is the point: the preview and the wallpaper have to
// frame the sky identically or the preview is lying.
const span = require("../app/engine/span.js");

/** @typedef {import("../app/engine/span.js").Rect} Rect */
/** @typedef {import("../app/engine/span.js").Monitor} Monitor */

/**
 * Every screen Windows reports.
 *
 * `bounds` is used rather than `workArea` deliberately: the work area excludes
 * the taskbar, and a wallpaper goes behind the taskbar, not beside it.
 *
 * @returns {Monitor[]}
 */
function list() {
  const primaryId = screen.getPrimaryDisplay().id;

  return screen.getAllDisplays().map((display) => ({
    id: display.id,
    bounds: {
      x: display.bounds.x,
      y: display.bounds.y,
      w: display.bounds.width,
      h: display.bounds.height
    },
    scale: display.scaleFactor,
    primary: display.id === primaryId
  }));
}

/**
 * Device-independent pixels to physical ones, in virtual-screen coordinates.
 *
 * Electron's own conversion, which is the only thing that gets a mixed-DPI
 * arrangement right - see the note in `span.physicalRectFor`.
 *
 * @param {Rect} bounds
 * @returns {Rect}
 */
function toPhysical(bounds) {
  const rect = screen.dipToScreenRect(null, {
    x: bounds.x,
    y: bounds.y,
    width: bounds.w,
    height: bounds.h
  });
  return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
}

/**
 * @param {Monitor} monitor
 * @param {readonly Monitor[]} all
 * @returns {Rect}
 */
function physicalRectFor(monitor, all) {
  return span.physicalRectFor(monitor, all, toPhysical);
}

/**
 * Call back whenever the arrangement changes.
 *
 * All three events matter: a screen arriving, a screen leaving, and a screen
 * changing resolution, scaling or position. The last one is the easiest to
 * forget and the most common in practice, because it fires when a user drags a
 * monitor in Display Settings.
 *
 * @param {() => void} onChange
 * @returns {() => void} stop listening
 */
function watch(onChange) {
  screen.on("display-added", onChange);
  screen.on("display-removed", onChange);
  screen.on("display-metrics-changed", onChange);

  return () => {
    screen.off("display-added", onChange);
    screen.off("display-removed", onChange);
    screen.off("display-metrics-changed", onChange);
  };
}

module.exports = {
  list,
  watch,
  toPhysical,
  physicalRectFor,
  // Re-exported so that callers have one import for "what do my screens mean",
  // and so that moving the arithmetic out did not become a change to main.js.
  span: span.boundingBox,
  geometryFor: span.geometryFor,
  describe: span.describe
};
