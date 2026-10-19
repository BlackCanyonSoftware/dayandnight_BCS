// @ts-check
/**
 * Would this frame look any different from the last one?
 *
 * The sky moves imperceptibly slowly. At a middling latitude the sun's
 * altitude changes by about a fifth of a degree a minute, which is a change in
 * colour far below one step of 8-bit output over several seconds - yet a
 * 20 fps loop redraws that identical gradient twelve hundred times a minute.
 * Measured on a Ryzen 5 3600 with two screens, that waste was most of the
 * 8.5% of a CPU core the application cost (NFR-1, docs/ARCHITECTURE.md).
 *
 * So the host asks this first, and presents a frame only when the answer has
 * changed.
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
 * changes far faster at sunrise than at noon. Comparing the colours the frame
 * would actually be drawn with needs no threshold at all. It is exactly as
 * sensitive as the display is, automatically, and it follows the sky's own
 * pace - lazy at midday, every frame through sunrise.
 *
 * @module engine/signature
 */

import { sunPosition } from "./astro/solar.js";
import { skyColors } from "./sky/palette.js";

/** @typedef {import("./types.js").FrameRequest} FrameRequest */
/** @typedef {import("./types.js").Preset} Preset */

/**
 * A value that changes exactly when the rendered frame would.
 *
 * Two calls with the same signature are guaranteed to produce the same pixels,
 * because the signature is built from every input the fragment shader reads.
 * Anything added to the shader's uniforms must be added here too, or the
 * frame will stop updating - which is why this file sits next to the shader
 * in review.
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
  const colors = skyColors(sun.altitude);
  const gain = Math.pow(2, preset.exposure);

  // Quantised to 8 bits, because that is what the display can show. A change
  // smaller than one step is invisible by definition, and the output dither
  // turns what is left into noise rather than a band.
  const q = (/** @type {number} */ value) => Math.round(value * gain * 255);

  return [
    q(colors.zenith[0]),
    q(colors.zenith[1]),
    q(colors.zenith[2]),
    q(colors.horizon[0]),
    q(colors.horizon[1]),
    q(colors.horizon[2]),
    // The gradient's shape, finely enough that a slow bend is not missed.
    Math.round(colors.curve * 1000),
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
