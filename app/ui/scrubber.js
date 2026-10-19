// @ts-check
/**
 * The day's shape, drawn into the time scrubber.
 *
 * The scrubber is both the control and a summary: a glance at it says "this is
 * a late-December day in Denver, and the good light is here". It is painted by
 * sampling the same scattering table that paints the sky, a few hundred times
 * across the day, so it cannot disagree with the preview above it. See "The
 * time scrubber" in docs/DESIGN.md.
 *
 * @module ui/scrubber
 */

import { resolveBearing, sunPosition } from "../engine/index.js";
import { linearToSrgb } from "../engine/sky/oklab.js";
import { autoExposure, sampleSky } from "../engine/sky/lut.js";

/** @typedef {import("../engine/types.js").Place} Place */
/** @typedef {import("../engine/types.js").Preset} Preset */

const MINUTE_MS = 60_000;
const DAY_MINUTES = 1440;

/**
 * The elevation the band's colour is sampled at.
 *
 * Not the horizon, where the colour is most dramatic but least
 * representative, and not the zenith, which barely changes. Ten degrees up
 * reads as "what colour was the sky at this hour".
 */
const SAMPLE_ELEVATION = 10;

/** Matching the engine, so the bands are exposed like the preview. */
const EXPOSURE_TARGET = 0.12;
const EXPOSURE_MAX = 4000;

/**
 * Paint the bands for one day at one place.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {number} dayStart timestamp of local midnight
 * @param {Place} place
 * @param {Preset} preset
 */
export function drawBands(canvas, dayStart, place, preset) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const bearing = resolveBearing(preset, place);

  // One sample per pixel column. A few hundred table lookups, which is cheap
  // enough to redraw whenever the date, the place or the preset changes -
  // which is what keeps it honest.
  for (let x = 0; x < w; x += 1) {
    const minute = (x / w) * DAY_MINUTES;
    const t = dayStart + minute * MINUTE_MS;
    const sun = sunPosition(t, place);

    const fromSun = Math.abs(((bearing - sun.azimuth + 540) % 360) - 180);
    const radiance = sampleSky(sun.altitude, SAMPLE_ELEVATION, fromSun);

    const exposure =
      autoExposure(sun.altitude, EXPOSURE_TARGET, EXPOSURE_MAX) * Math.pow(2, preset.exposure);

    /** @type {[number, number, number]} */
    const mapped = [
      toneMap(radiance[0] * exposure, preset.whitePoint),
      toneMap(radiance[1] * exposure, preset.whitePoint),
      toneMap(radiance[2] * exposure, preset.whitePoint)
    ];
    const srgb = linearToSrgb(mapped);

    ctx.fillStyle = `rgb(${to255(srgb[0])} ${to255(srgb[1])} ${to255(srgb[2])})`;
    ctx.fillRect(x, 0, 1, h);
  }

  drawSunMarks(ctx, w, h, dayStart, place);
}

/**
 * Tick marks where the sun crosses the horizon.
 *
 * Found by scanning for a sign change in altitude rather than by solving for
 * it: the scan is already being done for the bands, it needs no separate
 * algorithm that could disagree with them, and it degrades correctly at high
 * latitudes - a day with no sunrise simply has no marks, which is the right
 * answer rather than a special case (US-003).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w
 * @param {number} h
 * @param {number} dayStart
 * @param {Place} place
 */
function drawSunMarks(ctx, w, h, dayStart, place) {
  let previous = sunPosition(dayStart, place).altitude;

  ctx.lineWidth = 1;
  for (let x = 1; x < w; x += 1) {
    const t = dayStart + (x / w) * DAY_MINUTES * MINUTE_MS;
    const altitude = sunPosition(t, place).altitude;

    if (previous < 0 && altitude >= 0) mark(ctx, x, h, "rgb(255 255 255 / 0.85)");
    else if (previous >= 0 && altitude < 0) mark(ctx, x, h, "rgb(0 0 0 / 0.55)");

    previous = altitude;
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} h
 * @param {string} color
 */
function mark(ctx, x, h, color) {
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + 0.5, 0);
  ctx.lineTo(x + 0.5, h);
  ctx.stroke();
}

/**
 * The engine's tone curve, per channel.
 * @param {number} value
 * @param {number} whitePoint
 * @returns {number}
 */
function toneMap(value, whitePoint) {
  if (value <= 0) return 0;
  return (value * (1 + value / (whitePoint * whitePoint))) / (1 + value);
}

/** @param {number} v 0..1 @returns {number} 0..255 */
function to255(v) {
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}
