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

import { boundingBox, cropFor as cropWithin, describe as describeSpan } from "../engine/span.js";

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

/**
 * Seconds of no input before the wallpaper stops drawing. Zero never stops.
 * Outside the preset, like `fps` and `place`: it is a cost, not a look.
 */
export let awaySeconds = 600;

/**
 * Whether the wallpaper was up when the settings were last written.
 *
 * Kept so that a restart puts the sky back rather than leaving somebody to
 * wonder where it went. It is the shell's fact rather than the editor's, so
 * the editor only ever mirrors what the shell reports.
 */
export let wallpaperOn = false;

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

/** @param {number} next */
export function setAwaySeconds(next) {
  awaySeconds = Math.max(0, Math.round(next));
}

/** @param {boolean} next */
export function setWallpaperOn(next) {
  wallpaperOn = next;
}

/** @param {Monitor[]} next */
export function setMonitors(next) {
  monitors = next;
}

/* ---------------------------------------------------------------- derived */

/**
 * The span: the box that contains every monitor, in virtual-desktop pixels.
 *
 * The scene is composed for this rather than for one screen, which is the whole
 * mechanism behind US-012. With no monitors reported yet - the browser, before
 * the shell has answered - `boundingBox` falls back to a single 1080p screen so
 * the preview has something sane to be.
 *
 * The arithmetic is `engine/span.js` rather than a copy here, and that is not
 * tidiness. `desktop/monitors.js` requires the same file to decide where each
 * wallpaper window goes; when the editor had its own version, the two could
 * drift and the preview would frame the sky differently from the wallpaper it
 * was previewing - a bug that would look like the renderer being wrong.
 *
 * @returns {Span}
 */
export function span() {
  const box = boundingBox(monitors);
  return { w: box.w, h: box.h };
}

/**
 * The span's origin in virtual-desktop coordinates.
 *
 * Windows puts the primary screen at 0,0 and lets everything else go negative,
 * so a monitor to the left of the primary has a negative x. Crop rectangles are
 * relative to the span, not to the desktop, so this is what shifts them.
 *
 * @returns {{ x: number, y: number }}
 */
export function spanOrigin() {
  const box = boundingBox(monitors);
  return { x: box.x, y: box.y };
}

/**
 * One monitor's rectangle within the span.
 *
 * @param {Monitor} monitor
 * @returns {Rect}
 */
export function cropFor(monitor) {
  return cropWithin(monitor, monitors);
}

/**
 * What the arrangement looks like as a whole: the box, how much of it the
 * screens actually cover, and whether any of them overlap.
 *
 * @returns {ReturnType<typeof describeSpan>}
 */
export function arrangement() {
  return describeSpan(monitors);
}
