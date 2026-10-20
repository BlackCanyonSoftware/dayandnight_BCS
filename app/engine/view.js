// @ts-check
/**
 * How the span maps to angles.
 *
 * The projection is cylindrical: x is azimuth, linear across the span, and y
 * is elevation, linear up it. That choice costs nothing at width, which is why
 * the default field of view can be 150 degrees without the corners stretching
 * the way a perspective projection's would.
 *
 * There is exactly one piece of arithmetic here and it used to exist three
 * times - once in GLSL, once in `signature.js`, and implicitly in the belief
 * that the two agreed. They have to agree exactly: architecture invariant 1
 * says two renders with the same arguments are byte-identical, and the frame
 * signature is what the host uses to decide not to draw. A formula duplicated
 * between the CPU and the GPU is a slow leak in that promise, so it is
 * computed here, on the CPU, and handed to the shader as a uniform.
 *
 * @module engine/view
 */

/**
 * The widest the sky can be, vertically, before the frame asks for more of it
 * than exists.
 *
 * Elevation runs from -90 to +90 degrees and there is nothing above the
 * zenith. With the horizon at a fraction `horizon` down the frame, the frame
 * reaches `horizon * V` degrees above it and `(1 - horizon) * V` below, so the
 * larger of those two is what has to stay inside 90.
 *
 * @param {number} horizon fraction of the frame height, 0 at the top
 * @returns {number} degrees
 */
export function verticalLimit(horizon) {
  return 90 / Math.max(horizon, 1 - horizon, 1e-6);
}

/**
 * Degrees of sky the span covers vertically.
 *
 * Normally this is just "a degree across the screen is a degree up it", which
 * keeps the picture square and is the whole reason the default looks like a
 * photograph rather than a stretched one.
 *
 * A **tall span breaks that**, and Milestone 2 is where it stops being
 * hypothetical: two screens stacked vertically give a 1920x2160 span, which at
 * the default 150-degree width implies 169 degrees of height - and with the
 * horizon at 0.82 the top of the frame would be 138 degrees above the horizon,
 * which is 48 degrees past the zenith. A single portrait screen is worse still
 * at 267 degrees implied.
 *
 * Nothing crashes, which is the problem. `encodeElevation` clamps at 90, so
 * over the top 29 per cent of such a frame the scattering lookup stops
 * responding to elevation while the phase function goes on varying with
 * azimuth. Measured on a stacked span, the vertical gradient across that
 * region falls from 49 levels to 18: not a flat band, but a slack and wrong
 * top to the sky, which is the kind of fault that ships because it does not
 * look like a bug.
 *
 * So the square-degree rule yields, and only on the arrangements where it
 * cannot hold. The vertical field is capped at what the sky actually offers,
 * which squashes a tall span's picture rather than flattening the top of it.
 * The horizontal field is left alone deliberately: azimuth across the span is
 * what puts the sun at its true bearing and carries it from one screen to the
 * next over the day (US-012), and narrowing it to preserve square degrees
 * would break that to protect an aesthetic.
 *
 * For every ordinary arrangement - any span wider than it is tall, which is
 * all of them bar a stack or a rotated screen - the cap never engages and this
 * is exactly the old formula.
 *
 * @param {number} fieldOfView degrees across the span
 * @param {number} horizon fraction of the frame height
 * @param {{ w: number, h: number }} span
 * @returns {number} degrees of sky from the top of the frame to the bottom
 */
export function verticalDegrees(fieldOfView, horizon, span) {
  const square = fieldOfView * (span.h / Math.max(span.w, 1e-6));
  return Math.min(square, verticalLimit(horizon));
}
