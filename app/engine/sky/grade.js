// @ts-check
/**
 * The user's opinion, applied over a sky that is already correct.
 *
 * ADR 0004 chose a physical model with a grade on top precisely so that these
 * two things could stay separate: the model decides where the light is and
 * what colour it really is, and this decides how the picture should look. The
 * division is what makes architecture invariant 5 enforceable - nothing here
 * can move the sun, because nothing here knows where it is beyond the one
 * number the tint ramp is keyed to.
 *
 * Three kinds of control, in the order they apply:
 *
 * - **Turbidity** is not really a grade at all - it is a model parameter, how
 *   much haze the air holds. It lives next to the others because that is
 *   where a user looks for it, and it is applied by scaling the Mie term the
 *   lookup table already keeps separate (see `atmosphere.js`), so dragging it
 *   costs nothing where rebuilding the table would cost most of a second.
 * - **The tint ramp** keys a colour to the sun's altitude, which is the one
 *   piece of authored expressiveness ADR 0004 kept from the alternative it
 *   rejected. It multiplies linear light, so it tints without flattening.
 * - **Saturation and contrast** are applied last, in Oklab, where they do
 *   what their names say: one scales chroma and the other bends lightness,
 *   and neither disturbs the other.
 *
 * ## A deliberate deviation from ADR 0004
 *
 * That ADR specified "a three-band lift / gamma / gain in Oklab, so a user can
 * warm the horizon without greying the zenith". That is a colourist's control
 * surface - nine numbers - and it is the wrong shape for this panel: the
 * stated goal, warming the horizon without touching the zenith, is what the
 * altitude-keyed tint ramp already does, and does more directly. Saturation
 * and contrast are what remain of the idea and are what people actually reach
 * for. Recorded in docs/ROADMAP.md rather than quietly dropped; if the
 * three-band version is ever wanted, nothing here is in its way.
 *
 * @module engine/sky/grade
 */

import { hexToSrgb, sampleRampViaOklab, srgbToLinear } from "./oklab.js";

/** @typedef {import("./oklab.js").Vec3} Vec3 */
/** @typedef {import("../types.js").Preset} Preset */

/**
 * The sun altitudes the three tint stops sit at.
 *
 * Three rather than a freely editable list, because three is what a settings
 * panel can hold without becoming a curve editor, and because these are the
 * three states a day actually has: lit, the hour either side of the horizon,
 * and dark. The ramp between them is interpolated in Oklab, so a warm
 * twilight tint fades into a cool night one without passing through grey.
 */
const TINT_ALTITUDES = { day: 25, twilight: 0, night: -14 };

/**
 * The tint for a sun altitude, as a linear-light multiplier.
 *
 * Neutral tints give exactly (1, 1, 1), so a default preset multiplies by one
 * and the physical sky is untouched - which is the property that makes the
 * grade optional rather than load-bearing.
 *
 * @param {Preset} preset
 * @param {number} sunAltitude degrees
 * @returns {Vec3}
 */
export function tintFor(preset, sunAltitude) {
  const stops = [
    { at: TINT_ALTITUDES.night, color: hexToSrgb(preset.nightTint) },
    { at: TINT_ALTITUDES.twilight, color: hexToSrgb(preset.twilightTint) },
    { at: TINT_ALTITUDES.day, color: hexToSrgb(preset.dayTint) }
  ];

  const tint = sampleRampViaOklab(stops, sunAltitude);

  // Interpolated as a colour, applied as a multiplier on light. The sRGB
  // value is converted rather than used directly, because multiplying linear
  // radiance by a gamma-encoded number darkens far more than it looks like it
  // should - a "50% grey" tint would take four fifths of the light, not half.
  //
  // Scaled so that a mid-grey tint is neutral: the stops are a colour cast,
  // not an exposure control, and exposure has its own.
  const linear = srgbToLinear(tint);
  const mean = (linear[0] + linear[1] + linear[2]) / 3;
  if (mean <= 0) return [1, 1, 1];

  return [linear[0] / mean, linear[1] / mean, linear[2] / mean];
}
