// @ts-check
/**
 * The only colour-space conversions in the project (architecture invariant 4).
 *
 * Three spaces are in play:
 *
 * - **sRGB**, 0..1, non-linear. What a colour picker gives and what a display
 *   wants. Never do arithmetic in it.
 * - **Linear sRGB**, 0..1 (and beyond, for light brighter than white). Where
 *   light is summed, because light adds linearly and sRGB does not.
 * - **Oklab**, perceptually uniform. Where colours are *interpolated*, because
 *   its lightness axis matches perception: a ramp interpolated here steps
 *   evenly to the eye, where an sRGB component lerp bends lightness through
 *   the gamma curve and reads as pinched.
 *
 * One thing Oklab is often claimed to do and does not: it does not rescue an
 * interpolation between complementary hues. Sunset orange and twilight blue
 * have (a, b) vectors pointing in roughly opposite directions, so the straight
 * line between them passes near the neutral axis and desaturates - in Oklab
 * exactly as in sRGB. Only a polar form carrying the hue angle round (Oklch)
 * would avoid that. The sky does not need one: the authored ramp in palette.js
 * places stops along the real hue path, so neighbouring stops are close in hue
 * and the interpolation never has to cross. Keeping chroma is the keyframes'
 * job; stepping evenly is Oklab's. Both are pinned by tests/unit/oklab.test.mjs.
 *
 * Oklab is Björn Ottosson's 2020 colour space; the matrices below are his.
 *
 * @module engine/sky/oklab
 */

/** @typedef {[number, number, number]} Vec3 */

/* -------------------------------------------------------- transfer function */

/**
 * One sRGB channel to linear.
 * @param {number} c 0..1, non-linear
 * @returns {number} 0..1, linear
 */
export function srgbToLinear1(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * One linear channel to sRGB.
 * @param {number} c 0..1, linear
 * @returns {number} 0..1, non-linear
 */
export function linearToSrgb1(c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/**
 * @param {Vec3} rgb sRGB, 0..1
 * @returns {Vec3} linear sRGB
 */
export function srgbToLinear(rgb) {
  return [srgbToLinear1(rgb[0]), srgbToLinear1(rgb[1]), srgbToLinear1(rgb[2])];
}

/**
 * @param {Vec3} rgb linear sRGB
 * @returns {Vec3} sRGB, 0..1
 */
export function linearToSrgb(rgb) {
  return [linearToSrgb1(rgb[0]), linearToSrgb1(rgb[1]), linearToSrgb1(rgb[2])];
}

/* ------------------------------------------------------------------- Oklab */

/**
 * Linear sRGB to Oklab.
 * @param {Vec3} rgb linear sRGB
 * @returns {Vec3} [L, a, b]
 */
export function linearToOklab(rgb) {
  const [r, g, b] = rgb;

  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  // Cube root, sign-preserving: linear light can go negative after a grade.
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_
  ];
}

/**
 * Oklab to linear sRGB.
 *
 * The result can fall outside 0..1 - Oklab is larger than the sRGB gamut, and
 * interpolating between two in-gamut colours can leave it. Clamping is the
 * caller's decision, because the right answer differs between "this is a
 * colour" and "this is light to be tone-mapped".
 *
 * @param {Vec3} lab [L, a, b]
 * @returns {Vec3} linear sRGB, possibly out of gamut
 */
export function oklabToLinear(lab) {
  const [L, A, B] = lab;

  const l_ = L + 0.3963377774 * A + 0.2158037573 * B;
  const m_ = L - 0.1055613458 * A - 0.0638541728 * B;
  const s_ = L - 0.0894841775 * A - 1.291485548 * B;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ];
}

/** @param {Vec3} rgb sRGB 0..1 @returns {Vec3} Oklab */
export function srgbToOklab(rgb) {
  return linearToOklab(srgbToLinear(rgb));
}

/** @param {Vec3} lab Oklab @returns {Vec3} sRGB 0..1, clamped */
export function oklabToSrgb(lab) {
  const rgb = linearToSrgb(oklabToLinear(lab));
  return [clamp01(rgb[0]), clamp01(rgb[1]), clamp01(rgb[2])];
}

/* ------------------------------------------------------------ interpolation */

/**
 * Mix two colours through Oklab, so the lightness steps evenly.
 *
 * Between neighbouring ramp stops - which are close in hue, by construction -
 * this is the function the look of the product rests on. Between two colours
 * of opposing hue it desaturates through the middle like any Cartesian
 * interpolation; see the module header.
 *
 * @param {Vec3} aSrgb sRGB 0..1
 * @param {Vec3} bSrgb sRGB 0..1
 * @param {number} t 0..1
 * @returns {Vec3} sRGB 0..1
 */
export function mixSrgbViaOklab(aSrgb, bSrgb, t) {
  const A = srgbToOklab(aSrgb);
  const B = srgbToOklab(bSrgb);
  const u = clamp01(t);
  return oklabToSrgb([
    A[0] + (B[0] - A[0]) * u,
    A[1] + (B[1] - A[1]) * u,
    A[2] + (B[2] - A[2]) * u
  ]);
}

/**
 * Sample a ramp of colour stops in Oklab.
 *
 * Stops need not be evenly spaced and need not be sorted by the caller. The
 * blend between neighbours is smoothstepped so the ramp is C1 - a plain linear
 * blend leaves a visible crease at every stop, which on a 30-degree gradient
 * across 2560 pixels is exactly the kind of thing that reads as cheap.
 *
 * @param {{ at: number, color: Vec3 }[]} stops `color` is sRGB 0..1
 * @param {number} x where to sample, in the stops' own units
 * @returns {Vec3} sRGB 0..1
 */
export function sampleRampViaOklab(stops, x) {
  if (stops.length === 0) throw new Error("sampleRampViaOklab: no stops");
  const sorted = [...stops].sort((p, q) => p.at - q.at);

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) throw new Error("sampleRampViaOklab: no stops");
  if (x <= first.at) return [...first.color];
  if (x >= last.at) return [...last.color];

  for (let i = 0; i < sorted.length - 1; i += 1) {
    const lo = sorted[i];
    const hi = sorted[i + 1];
    if (!lo || !hi) continue;
    if (x >= lo.at && x <= hi.at) {
      const span = hi.at - lo.at;
      const t = span === 0 ? 0 : (x - lo.at) / span;
      return mixSrgbViaOklab(lo.color, hi.color, smoothstep(t));
    }
  }

  return [...last.color];
}

/* ------------------------------------------------------------------ helpers */

/** @param {number} v @returns {number} */
export function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * The C1 ease used between ramp stops.
 * @param {number} t 0..1
 * @returns {number}
 */
export function smoothstep(t) {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
}

/**
 * Parse `#rgb`, `#rrggbb` to sRGB 0..1.
 * @param {string} hex
 * @returns {Vec3}
 */
export function hexToSrgb(hex) {
  const h = hex.trim().replace(/^#/, "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`hexToSrgb: not a hex colour: ${hex}`);
  return [
    parseInt(full.slice(0, 2), 16) / 255,
    parseInt(full.slice(2, 4), 16) / 255,
    parseInt(full.slice(4, 6), 16) / 255
  ];
}
