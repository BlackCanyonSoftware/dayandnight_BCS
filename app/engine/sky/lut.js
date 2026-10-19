// @ts-check
/**
 * The baked sky table, and the two ways things read it.
 *
 * The table is expensive to build and identical every time, so it is built
 * once per process and shared. Everything that wants to know what colour the
 * sky is goes through here: the shader, by uploading it as a texture, and the
 * editor's scrubber, by sampling it on the CPU. One source, so the bands under
 * the scrubber cannot disagree with the sky above them.
 *
 * @module engine/sky/lut
 */

import {
  LUT_AZIMUTH,
  LUT_SUN,
  LUT_VIEW,
  MIE_G,
  SUN_MAX,
  SUN_MIN,
  VIEW_MAX,
  VIEW_MIN,
  bakeScatteringLut,
  encodeElevation,
  miePhase,
  rayleighPhase
} from "./atmosphere.js";

/** @typedef {{ data: Float32Array, reference: Float32Array }} Baked */

/** @type {Baked | null} */
let baked = null;

/**
 * The table, building it on first use.
 *
 * Module-level rather than per-engine: a process has at most a handful of
 * engines and they would all build the same numbers. This is a cache of a
 * pure function, not state - throw it away and the next call rebuilds
 * something identical, which is why it does not violate invariant 1.
 *
 * @returns {Baked}
 */
export function skyLut() {
  if (baked === null) baked = bakeScatteringLut();
  return baked;
}

/** Whether the table has been built yet. Lets a host show something first. */
export function isBaked() {
  return baked !== null;
}

/**
 * The auto-exposure gain for a sun elevation.
 *
 * The sky spans six thousand to one between noon and civil twilight, and
 * several more orders of magnitude below that, so a fixed exposure can only
 * ever show one end of the day. This adapts, the way an eye does - but as a
 * pure function of the sun's position, so it cannot drift, cannot lag, and is
 * identical on every screen (architecture invariant 1).
 *
 * Clamped at the dark end on purpose. Below nautical twilight there is
 * essentially nothing to expose for, and letting the gain run away would turn
 * numerical noise into a visible grey fog over what should be a dark sky.
 *
 * @param {number} sunAltitude degrees
 * @param {number} targetBrightness the mid-grey the sky is exposed towards
 * @param {number} maxGain
 * @returns {number}
 */
export function autoExposure(sunAltitude, targetBrightness, maxGain) {
  const { reference } = skyLut();

  const u = encodeElevation(sunAltitude, SUN_MIN, SUN_MAX) * LUT_SUN - 0.5;
  const i = Math.floor(u);
  const t = u - i;

  const a = reference[Math.min(LUT_SUN - 1, Math.max(0, i))] ?? 0;
  const b = reference[Math.min(LUT_SUN - 1, Math.max(0, i + 1))] ?? 0;
  const brightness = a + (b - a) * Math.min(1, Math.max(0, t));

  if (brightness <= 0) return maxGain;
  return Math.min(maxGain, targetBrightness / brightness);
}

/**
 * Sample the table on the CPU, with the phase functions applied.
 *
 * Used by the editor's scrubber, which paints the day's shape into its own
 * track a few hundred times and has no GPU context of its own. The shader
 * does the same arithmetic; this is the readable version of it.
 *
 * @param {number} sunAltitude degrees
 * @param {number} viewElevation degrees
 * @param {number} azimuthFromSun degrees, 0..180
 * @returns {[number, number, number]} linear radiance
 */
export function sampleSky(sunAltitude, viewElevation, azimuthFromSun) {
  const { data } = skyLut();

  const x = encodeElevation(sunAltitude, SUN_MIN, SUN_MAX) * LUT_SUN - 0.5;
  const y = encodeElevation(viewElevation, VIEW_MIN, VIEW_MAX) * LUT_VIEW - 0.5;
  // The azimuth axis stores its endpoints exactly, so it maps differently
  // from the two elevation axes.
  const z = (Math.min(180, Math.abs(azimuthFromSun)) / 180) * (LUT_AZIMUTH - 1);

  const entry = trilinear(data, x, y, z);

  const d = Math.PI / 180;
  const cosTheta =
    Math.sin(viewElevation * d) * Math.sin(sunAltitude * d) +
    Math.cos(viewElevation * d) * Math.cos(sunAltitude * d) * Math.cos(azimuthFromSun * d);

  const pr = rayleighPhase(cosTheta);
  const pm = miePhase(cosTheta, MIE_G);

  return [
    entry[0] * pr + entry[3] * pm,
    entry[1] * pr + entry[3] * pm,
    entry[2] * pr + entry[3] * pm
  ];
}

/**
 * Trilinear read, clamped at the edges, matching what the GPU does.
 *
 * @param {Float32Array} data
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {[number, number, number, number]}
 */
function trilinear(data, x, y, z) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);

  const fx = x - x0;
  const fy = y - y0;
  const fz = z - z0;

  const out = /** @type {[number, number, number, number]} */ ([0, 0, 0, 0]);

  for (let dz = 0; dz <= 1; dz += 1) {
    const wz = dz === 0 ? 1 - fz : fz;
    if (wz === 0) continue;

    for (let dy = 0; dy <= 1; dy += 1) {
      const wy = dy === 0 ? 1 - fy : fy;
      if (wy === 0) continue;

      for (let dx = 0; dx <= 1; dx += 1) {
        const wx = dx === 0 ? 1 - fx : fx;
        if (wx === 0) continue;

        const i = index(x0 + dx, y0 + dy, z0 + dz);
        const w = wx * wy * wz;
        out[0] += data[i] * w;
        out[1] += data[i + 1] * w;
        out[2] += data[i + 2] * w;
        out[3] += data[i + 3] * w;
      }
    }
  }

  return out;
}

/**
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {number}
 */
function index(x, y, z) {
  const cx = Math.min(LUT_SUN - 1, Math.max(0, x));
  const cy = Math.min(LUT_VIEW - 1, Math.max(0, y));
  const cz = Math.min(LUT_AZIMUTH - 1, Math.max(0, z));
  return ((cz * LUT_VIEW + cy) * LUT_SUN + cx) * 4;
}
