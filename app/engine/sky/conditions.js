// @ts-check
/**
 * The real weather, as a series the engine can follow: how cloudy, how hard it
 * is raining or snowing, how foggy, at each hour a forecast gives.
 *
 * Like the real wind (`wind.js`), the engine never fetches it: the host does,
 * on the user's consent, and hands the same table to every surface. And like the
 * wind it is a pure function of the instant: the value at any time is a linear
 * interpolation between two samples, so two screens, or one after a pause, agree
 * and nothing is remembered.
 *
 * ## What it replaces
 *
 * While there is a forecast for the moment being drawn, four of the preset's
 * settings - cloud cover, how hard it falls, what falls, and fog - are taken
 * from it instead of from the sliders. The rest of the look is untouched: the
 * sky, the grade, the horizon and the wind's speed are still the user's.
 * Nothing here can make the sun wrong (invariant 5): these are appearance.
 *
 * ## When it stops
 *
 * A forecast covers a few days, and a stale one should not hold a sky for ever.
 * Within an hour of its ends the nearest value is used; further out the preset
 * is the user's own again, which is also what an unreachable provider gives.
 *
 * @module engine/sky/conditions
 */

const HOUR_MS = 3_600_000;

/** How far past the data's ends the nearest sample is still believed. */
const GRACE_MS = HOUR_MS;

/**
 * One hour of the weather.
 *
 * @typedef {object} ConditionSample
 * @property {number} t milliseconds since the epoch, UTC
 * @property {number} cloud cloud cover, 0 clear to 1 overcast
 * @property {number} precip how hard it falls, 0 to 1
 * @property {number} snow 1 if it falls as snow or sleet, 0 if as rain
 * @property {number} fog 0 clear to 1 thick
 */

/**
 * Samples prepared for lookup. Immutable.
 *
 * @typedef {object} Conditions
 * @property {Float64Array} t
 * @property {Float64Array} cloud
 * @property {Float64Array} precip
 * @property {Float64Array} snow
 * @property {Float64Array} fog
 */

/**
 * How hard a given rate of rainfall looks, 0 to 1.
 *
 * Rain is judged by how it looks rather than by how much water it is: a tenth
 * of a millimetre an hour is a drizzle you can barely see, two and a half is a
 * steady rain, and past eight it is as hard as it gets on a screen. The curve is
 * saturating, so light rain is not lost and heavy rain does not clip early.
 *
 * @param {number} mmPerHour
 * @returns {number}
 */
export function precipitationIntensity(mmPerHour) {
  if (!(mmPerHour > 0.05)) return 0;
  return 1 - Math.exp(-mmPerHour / 2.5);
}

/**
 * Prepare a series, or refuse one that is not usable.
 *
 * Refused rather than repaired, as the wind is: out-of-order times or a number
 * that is not one are somebody's bug, and null means "use the user's own sky".
 *
 * @param {ConditionSample[]} samples
 * @returns {Conditions | null}
 */
export function makeConditions(samples) {
  if (!Array.isArray(samples) || samples.length < 2) return null;

  const n = samples.length;
  const t = new Float64Array(n);
  const cloud = new Float64Array(n);
  const precip = new Float64Array(n);
  const snow = new Float64Array(n);
  const fog = new Float64Array(n);

  for (let i = 0; i < n; i += 1) {
    const s = samples[i];
    if (
      !s ||
      !Number.isFinite(s.t) ||
      !Number.isFinite(s.cloud) ||
      !Number.isFinite(s.precip) ||
      !Number.isFinite(s.snow) ||
      !Number.isFinite(s.fog)
    ) {
      return null;
    }
    if (i > 0 && !(s.t > t[i - 1])) return null;

    t[i] = s.t;
    cloud[i] = clamp01(s.cloud);
    precip[i] = clamp01(s.precip);
    snow[i] = clamp01(s.snow);
    fog[i] = clamp01(s.fog);
  }

  return Object.freeze({ t, cloud, precip, snow, fog });
}

/** @param {number} v */
function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

/**
 * The weather at an instant, or null where there is no forecast to believe.
 *
 * @param {Conditions | null} series
 * @param {number} ms
 * @returns {{ cloud: number, precip: number, snow: number, fog: number } | null}
 */
export function conditionsAt(series, ms) {
  if (!series) return null;

  const n = series.t.length;
  const first = series.t[0];
  const last = series.t[n - 1];
  if (ms < first - GRACE_MS || ms > last + GRACE_MS) return null;

  if (ms <= first) return at(series, 0, 0);
  if (ms >= last) return at(series, n - 1, 0);

  // The segment containing ms: the largest i with t[i] <= ms.
  let lo = 0;
  let hi = n - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (series.t[mid] <= ms) lo = mid;
    else hi = mid - 1;
  }

  const f = (ms - series.t[lo]) / (series.t[lo + 1] - series.t[lo]);
  return at(series, lo, f);
}

/**
 * @param {Conditions} s
 * @param {number} i
 * @param {number} f how far from i towards i + 1, 0 to 1
 */
function at(s, i, f) {
  const j = f === 0 ? i : i + 1;
  const mix = (/** @type {Float64Array} */ a) => a[i] + (a[j] - a[i]) * f;
  return { cloud: mix(s.cloud), precip: mix(s.precip), snow: mix(s.snow), fog: mix(s.fog) };
}

/**
 * The preset to actually draw: the user's, with the four weather settings taken
 * from the forecast wherever there is one for this instant.
 *
 * Returns the very same object when there is nothing to follow, which is what
 * lets a caller tell cheaply, and keeps a dry day on the old code path exactly.
 *
 * @template {{ cloudCover: number, precipitation: number, precipitationKind: string, fog: number }} P
 * @param {P} preset
 * @param {Conditions | null | undefined} series
 * @param {number} ms
 * @returns {P}
 */
export function effectivePreset(preset, series, ms) {
  const now = conditionsAt(series ?? null, ms);
  if (!now) return preset;

  return {
    ...preset,
    cloudCover: now.cloud,
    precipitation: now.precip,
    // A fraction between rain and snow is whichever is nearer.
    precipitationKind: now.snow >= 0.5 ? "snow" : "rain",
    fog: now.fog
  };
}
