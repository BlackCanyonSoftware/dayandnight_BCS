// @ts-check
/**
 * Would this frame look any different from the last one?
 *
 * The sky moves imperceptibly slowly. At a middling latitude the sun's
 * altitude changes by about a fifth of a degree a minute, which is a change in
 * colour far below one step of 8-bit output over several seconds - yet a
 * 20 fps loop would redraw that identical sky twelve hundred times a minute.
 * Measured on a Ryzen 5 3600 with two screens, that waste was most of the
 * 8.5% of a CPU core the application cost (NFR-1, docs/ARCHITECTURE.md).
 *
 * So the host asks this first, and presents a frame only when the answer has
 * changed - which, over a whole day, is about five thousand times instead of
 * one and three quarter million.
 *
 * **Why this lives outside the engine's render path.** It would be natural to
 * give the engine a `renderIfChanged`, and that would break architecture
 * invariant 1: the engine would be remembering something between frames. This
 * is a pure function instead - same inputs, same signature, no memory - and
 * the *host* keeps the last value and makes the decision, which is also
 * invariant 2 (the engine never decides when to draw).
 *
 * **Why it compares colours rather than timestamps.** A signature built from a
 * quantised timestamp or a rounded sun altitude would need a threshold chosen
 * by guesswork, and the right threshold differs through the day: the sky
 * changes far faster at sunrise than at noon. Sampling the colours the frame
 * would actually be drawn with needs no threshold at all. It is exactly as
 * sensitive as the display is, automatically, and it follows the sky's own
 * pace - lazy at midday, every frame through sunrise.
 *
 * @module engine/signature
 */

import { verticalDegrees } from "./view.js";

import { sunPosition } from "./astro/solar.js";
import { resolveBearing } from "./defaults.js";
import { autoExposure, sampleSky } from "./sky/lut.js";
import { tintFor } from "./sky/grade.js";
import { linearToSrgb1 } from "./sky/oklab.js";

/** @typedef {import("./types.js").FrameRequest} FrameRequest */
/** @typedef {import("./types.js").Preset} Preset */

/**
 * Where in the frame the sky is sampled.
 *
 * Fractions across and down the span. Spread so that no single part of the
 * day's change can slip past: along the horizon, where sunrise happens, and
 * up towards the zenith, where it happens last.
 */
const PROBES = [
  [0.02, 0.2],
  [0.5, 0.1],
  [0.98, 0.2],
  [0.02, 0.78],
  [0.5, 0.6],
  [0.98, 0.78],
  [0.5, 0.95]
];

/**
 * A value that changes exactly when the rendered frame would.
 *
 * Anything added to the shader that changes what a pixel ends up being has to
 * be reachable from here too, or the frame will stop updating - which is why
 * this file sits next to the shader in review. The probes cover anything that
 * changes the *sky*; the framing settings are listed explicitly because they
 * move the picture without changing the sky at all.
 *
 * @param {Preset} preset
 * @param {FrameRequest} request
 * @param {number} bufferWidth the drawing buffer, which the dither depends on
 * @param {number} bufferHeight
 * @returns {string}
 */
export function frameSignature(preset, request, bufferWidth, bufferHeight) {
  const { t, place, crop, span } = request;

  const sun = sunPosition(t, place);
  const bearing = resolveBearing(preset, place);
  // The same number the shader is given, from the same function, because a
  // signature computed from a different projection than the one drawn would
  // skip a frame that does not match what is on screen.
  const degreesPerSpanY = verticalDegrees(preset.fieldOfView, preset.horizon, span);

  // The same exposure and tone curve the shader applies, so that what is
  // compared is what a pixel would actually end up being rather than raw
  // radiance - which spans ten orders of magnitude and cannot be quantised
  // usefully.
  const exposure = autoExposure(sun.altitude, 0.12, 4000) * Math.pow(2, preset.exposure);
  const tint = tintFor(preset, sun.altitude);

  /** @type {number[]} */
  const parts = [];

  for (const [fx, fy] of PROBES) {
    const azimuth = bearing + (fx - 0.5) * preset.fieldOfView;
    const elevation = (preset.horizon - fy) * degreesPerSpanY;
    const fromSun = Math.abs(((azimuth - sun.azimuth + 540) % 360) - 180);

    const colour = sampleSky(sun.altitude, elevation, fromSun);

    // Quantised to the 8 bits a display can show. A change smaller than one
    // step is invisible by definition, and the output dither turns what is
    // left into noise rather than a band.
    colour.forEach((channel, i) => {
      const mapped = toneMap(Math.max(0, channel) * exposure * tint[i], preset.whitePoint);
      parts.push(Math.round(linearToSrgb1(Math.min(1, mapped)) * 255));
    });
  }

  return [
    ...parts,
    // Framing: these move the picture without the sky itself changing, so the
    // probes alone would not notice them. Exposure and the white point are
    // deliberately absent - they are already inside every probe, and listing
    // them again would force redraws that change no pixel.
    Math.round(bearing * 100),
    Math.round(preset.horizon * 10000),
    Math.round(preset.fieldOfView * 100),
    // Turbidity and the Oklab grade change every pixel but are not inside the
    // probes: the probes sample the table, and turbidity scales the Mie term
    // in the shader while saturation and contrast are applied after the tone
    // curve. The tint *is* in the probes, so it is not listed again.
    Math.round(preset.turbidity * 1000),
    Math.round(preset.saturation * 1000),
    Math.round(preset.contrast * 1000),
    // Geometry: a window that moved or resized must redraw even if the sky
    // has not changed at all.
    crop.x,
    crop.y,
    crop.w,
    crop.h,
    span.w,
    span.h,
    bufferWidth,
    bufferHeight
  ].join(",");
}

/**
 * The shader's tone curve, on a single channel.
 *
 * The shader maps luminance and scales the colour by the result, to keep hue;
 * here each probe channel is treated on its own, which is close enough for
 * deciding whether a pixel moved by a whole 8-bit step and avoids carrying the
 * luminance arithmetic twice.
 *
 * @param {number} value linear, after exposure
 * @param {number} whitePoint
 * @returns {number}
 */
function toneMap(value, whitePoint) {
  if (value <= 0) return 0;
  return (value * (1 + value / (whitePoint * whitePoint))) / (1 + value);
}
