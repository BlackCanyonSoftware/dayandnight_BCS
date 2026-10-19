// @ts-check
/**
 * The page's shared state, and the only way to change it.
 *
 * Modules read these through live bindings and write them only through the
 * setters, so no module can hold a stale copy. Same arrangement as Pixel
 * Galaxy Studio's `ui/state.js`, and for the same reason: the page is
 * event-driven, so a change made in one module has to be visible in every
 * other one immediately.
 *
 * @module ui/state
 */

import { defaultPreset } from "../engine/index.js";

/** @typedef {import("../engine/types.js").Place} Place */
/** @typedef {import("../engine/types.js").Preset} Preset */
/** @typedef {import("../engine/types.js").Rect} Rect */
/** @typedef {import("../engine/types.js").Span} Span */

/**
 * One screen, as the shell reports it.
 *
 * @typedef {object} Monitor
 * @property {number} id
 * @property {Rect} bounds in virtual-desktop pixels
 * @property {number} scale device pixel ratio
 * @property {boolean} primary
 */

/**
 * How the editor is choosing its timestamp.
 *
 * - `now` follows the real clock, which is the default and what the wallpaper
 *   always does.
 * - `manual` is a date and a minute the user picked, for authoring across time
 *   (US-020).
 *
 * @typedef {"now" | "manual"} ClockMode
 */

/**
 * @typedef {object} ClockState
 * @property {ClockMode} mode
 * @property {number} dayStart timestamp of local midnight on the chosen date
 * @property {number} minute minutes since that midnight, 0..1439, fractional
 * @property {boolean} playing whether fast-forward is running
 */

/** @type {Preset} */
export let preset = defaultPreset();

/**
 * Where the user is. Denver until they say otherwise - a placeholder that is
 * at least a real place at a middling latitude, so the default looks like
 * something rather than like the equator at Greenwich.
 * @type {Place}
 */
export let place = { lat: 39.7, lon: -105.0 };

/** @type {ClockState} */
export let clock = { mode: "now", dayStart: 0, minute: 0, playing: false };

/**
 * Redraws per second. 20 is the default for the reasons in NFR-1: the goal is
 * never stuttering while the user works, not a high frame rate.
 * @type {number}
 */
export let fps = 20;

/** @type {Monitor[]} */
export let monitors = [];

/* --------------------------------------------------------------- setters */

/** @param {Partial<Preset>} patch */
export function setPreset(patch) {
  preset = { ...preset, ...patch };
}

/** @param {Preset} next */
export function replacePreset(next) {
  preset = { ...next };
}

/** @param {Partial<Place>} patch */
export function setPlace(patch) {
  place = { ...place, ...patch };
}

/** @param {Partial<ClockState>} patch */
export function setClock(patch) {
  clock = { ...clock, ...patch };
}

/** @param {number} next */
export function setFps(next) {
  fps = next;
}

/** @param {Monitor[]} next */
export function setMonitors(next) {
  monitors = next;
}

/* ---------------------------------------------------------------- derived */

/**
 * The span: the box that contains every monitor, in virtual-desktop pixels.
 *
 * The scene is composed for this rather than for one screen, which is the
 * whole mechanism behind US-012. With no monitors reported yet - the browser,
 * before the shell has answered - it falls back to a single 1080p screen so
 * the preview has something sane to be.
 *
 * @returns {Span}
 */
export function span() {
  if (monitors.length === 0) return { w: 1920, h: 1080 };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const m of monitors) {
    minX = Math.min(minX, m.bounds.x);
    minY = Math.min(minY, m.bounds.y);
    maxX = Math.max(maxX, m.bounds.x + m.bounds.w);
    maxY = Math.max(maxY, m.bounds.y + m.bounds.h);
  }

  return { w: maxX - minX, h: maxY - minY };
}

/**
 * The span's origin in virtual-desktop coordinates.
 *
 * Windows puts the primary screen at 0,0 and lets everything else go negative,
 * so a monitor to the left of the primary has a negative x. Crop rectangles
 * are relative to the span, not to the desktop, so this is what shifts them.
 *
 * @returns {{ x: number, y: number }}
 */
export function spanOrigin() {
  if (monitors.length === 0) return { x: 0, y: 0 };
  return {
    x: Math.min(...monitors.map((m) => m.bounds.x)),
    y: Math.min(...monitors.map((m) => m.bounds.y))
  };
}

/**
 * One monitor's rectangle within the span.
 *
 * @param {Monitor} monitor
 * @returns {Rect}
 */
export function cropFor(monitor) {
  const origin = spanOrigin();
  return {
    x: monitor.bounds.x - origin.x,
    y: monitor.bounds.y - origin.y,
    w: monitor.bounds.w,
    h: monitor.bounds.h
  };
}
