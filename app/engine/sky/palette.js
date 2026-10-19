// @ts-check
/**
 * Sun altitude to a two-colour gradient.
 *
 * ---------------------------------------------------------------------------
 * MILESTONE 0 STAND-IN for the real sky.
 *
 * ADR 0004 decided the sky is a physical scattering model with a user-authored
 * grade over it, baked into an altitude-by-height lookup texture. None of that
 * exists yet. This module is the cheapest thing that makes a day look like a
 * day: nine authored keyframes against sun altitude, interpolated in Oklab,
 * giving a zenith colour, a horizon colour and how tightly the gradient bunches
 * near the horizon.
 *
 * It is a placeholder in substance but not in craft - the keyframes are
 * interpolated the way the real thing will be, so what this proves about
 * smoothness and banding carries over. Milestone 1 replaces the keyframes with
 * scattering and the two colours with a full vertical ramp.
 *
 * Tracked in docs/ROADMAP.md under tech debt.
 * ---------------------------------------------------------------------------
 *
 * @module engine/sky/palette
 */

import { hexToSrgb, sampleRampViaOklab, srgbToLinear } from "./oklab.js";

/** @typedef {import("./oklab.js").Vec3} Vec3 */

/**
 * Zenith colour against sun altitude in degrees.
 *
 * The altitudes are not evenly spaced, and that is the point: the sky changes
 * more between -2 and +2 degrees than it does between +20 and +70, so the
 * keyframes crowd around the horizon where the action is.
 */
const ZENITH = [
  { at: -18, color: hexToSrgb("#05070f") }, // astronomical night
  { at: -12, color: hexToSrgb("#070b18") }, // nautical twilight
  { at: -6, color: hexToSrgb("#15243f") }, // civil twilight begins
  { at: -3, color: hexToSrgb("#1d2d4e") },
  { at: 0, color: hexToSrgb("#3f5680") }, // sun on the horizon
  { at: 3, color: hexToSrgb("#4a6794") },
  { at: 10, color: hexToSrgb("#5680b5") },
  { at: 30, color: hexToSrgb("#437cc2") },
  { at: 70, color: hexToSrgb("#2f6dbd") } // high summer noon
];

/**
 * Horizon colour against sun altitude.
 *
 * This is where a day is won or lost. The warm band from -3 to +3 degrees is
 * the whole reason the product exists, so it carries four of the nine stops.
 */
const HORIZON = [
  { at: -18, color: hexToSrgb("#0a0f1c") },
  { at: -12, color: hexToSrgb("#122038") },
  { at: -6, color: hexToSrgb("#3c4a6b") },
  { at: -3, color: hexToSrgb("#8c5f68") }, // the first warmth, still mostly cold
  { at: -1, color: hexToSrgb("#c2724f") },
  { at: 0, color: hexToSrgb("#e58a4a") }, // sunrise and sunset
  { at: 3, color: hexToSrgb("#f2b071") },
  // +6 exists because the unit tests found the ramp crossing from the warm
  // +3 stop straight to the cool +10 one, which are near-complementary: the
  // interpolation passed through near-perfect grey around +7, a dead
  // washed-out band mid-morning. A pale warm stop carries the hue across.
  { at: 6, color: hexToSrgb("#e3c6a4") },
  { at: 10, color: hexToSrgb("#a8c4de") }, // the warmth is gone fast
  { at: 70, color: hexToSrgb("#cfe2f2") }
];

/**
 * How hard the gradient bunches towards the horizon, against sun altitude.
 *
 * Higher means the horizon colour is confined to a narrower band at the bottom
 * of the screen. At midday the sky is nearly uniform except low down, so the
 * curve is steep; at twilight the colour is spread up the whole sky, so it
 * flattens.
 */
const CURVE = [
  { at: -18, value: 1.4 },
  { at: -6, value: 1.6 },
  { at: 0, value: 2.0 },
  { at: 10, value: 2.6 },
  { at: 70, value: 3.0 }
];

/**
 * @typedef {object} SkyColors
 * @property {Vec3} zenith linear light at the top of the span
 * @property {Vec3} horizon linear light at the bottom
 * @property {number} curve gradient exponent
 */

/**
 * The gradient for a sun altitude.
 *
 * Pure: the same altitude always gives the same colours (architecture
 * invariant 1).
 *
 * @param {number} sunAltitude degrees above the horizon; negative below
 * @returns {SkyColors}
 */
export function skyColors(sunAltitude) {
  return {
    zenith: srgbToLinear(sampleRampViaOklab(ZENITH, sunAltitude)),
    horizon: srgbToLinear(sampleRampViaOklab(HORIZON, sunAltitude)),
    curve: sampleScalar(CURVE, sunAltitude)
  };
}

/**
 * Linear interpolation over a scalar ramp. Scalars have no colour-space
 * problem, so this does not need Oklab - but it is smoothstepped for the same
 * reason the colour ramp is: a crease in the gradient's shape is as visible as
 * a crease in its colour.
 *
 * @param {{ at: number, value: number }[]} stops sorted ascending
 * @param {number} x
 * @returns {number}
 */
function sampleScalar(stops, x) {
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (!first || !last) throw new Error("sampleScalar: no stops");
  if (x <= first.at) return first.value;
  if (x >= last.at) return last.value;

  for (let i = 0; i < stops.length - 1; i += 1) {
    const lo = stops[i];
    const hi = stops[i + 1];
    if (!lo || !hi) continue;
    if (x >= lo.at && x <= hi.at) {
      const span = hi.at - lo.at;
      const t = span === 0 ? 0 : (x - lo.at) / span;
      const e = t * t * (3 - 2 * t);
      return lo.value + (hi.value - lo.value) * e;
    }
  }
  return last.value;
}
