// @ts-check
/**
 * Where the sun is.
 *
 * ---------------------------------------------------------------------------
 * MILESTONE 0 PLACEHOLDER. This is not the real algorithm.
 *
 * It is accurate to roughly 1-2 degrees, which is enough to drive a walking
 * skeleton and to make a gradient move convincingly over a day, and is **not**
 * enough for US-001, which requires better than 0.5 degrees.
 *
 * What is wrong with it, specifically:
 *
 * - **The equation of time is ignored.** Real solar noon drifts from clock
 *   noon by up to about 16 minutes over the year (the analemma). This treats
 *   them as the same, so the whole day can be a quarter of an hour out.
 * - **Declination is a cosine approximation** against day-of-year rather than
 *   the sun's true longitude, worth another degree or so, and worst at the
 *   equinoxes - where it matters most, because that is when the sun crosses
 *   the horizon fastest.
 * - **No refraction.** The real sun is visible when it is geometrically about
 *   0.57 degrees below the horizon, which is why sunrise is earlier than the
 *   geometry says.
 * - **No parallax, no nutation, no aberration.** All small, all real.
 *
 * Milestone 1 replaces this file with a Meeus-grade implementation and the
 * unit tests that hold it to 0.5 degrees against published ephemerides. The
 * *interface* below is final; only the arithmetic changes. Tracked in
 * docs/ROADMAP.md under tech debt.
 * ---------------------------------------------------------------------------
 *
 * @module engine/astro/solar
 */

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/** Earth's axial tilt, degrees. */
const OBLIQUITY = 23.4397;

/**
 * @typedef {object} Place
 * @property {number} lat degrees north, -90..90
 * @property {number} lon degrees east, -180..180
 */

/**
 * @typedef {object} SunPosition
 * @property {number} altitude degrees above the horizon; negative below
 * @property {number} azimuth degrees clockwise from north, 0..360
 * @property {number} declination degrees; the sun's tilt for this date
 * @property {number} hourAngle degrees; negative before solar noon
 */

/**
 * The sun's apparent position for an instant and a place.
 *
 * Takes the timestamp as an argument and never reads the clock, so that the
 * live wallpaper and the editor's time scrubber are the same code path
 * (architecture invariant 1).
 *
 * @param {number} t milliseconds since the Unix epoch, UTC
 * @param {Place} place
 * @returns {SunPosition}
 */
export function sunPosition(t, place) {
  const lat = place.lat * DEG;

  const declination = solarDeclination(t);
  const dec = declination * DEG;

  const hourAngle = solarHourAngle(t, place.lon);
  const H = hourAngle * DEG;

  // The standard altitude-azimuth transform from the hour angle.
  const sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
  const altitude = Math.asin(clamp(sinAlt, -1, 1));

  // Azimuth from north. acos gives 0..180, which is the morning half; the
  // afternoon is its mirror, chosen by the sign of the hour angle.
  const cosAz =
    (Math.sin(dec) - Math.sin(altitude) * Math.sin(lat)) / (Math.cos(altitude) * Math.cos(lat));
  let azimuth = Math.acos(clamp(cosAz, -1, 1)) * RAD;
  if (hourAngle > 0) azimuth = 360 - azimuth;

  return {
    altitude: altitude * RAD,
    azimuth,
    declination,
    hourAngle
  };
}

/**
 * The sun's declination, degrees.
 *
 * Placeholder: a cosine against day-of-year, with the phase set so that the
 * minimum lands near the December solstice. Good to one or two degrees.
 *
 * @param {number} t
 * @returns {number}
 */
export function solarDeclination(t) {
  const n = dayOfYearUtc(t);
  // 10 days: the offset from 1 January back to the December solstice.
  return -OBLIQUITY * Math.cos(((2 * Math.PI) / 365.25) * (n + 10));
}

/**
 * The solar hour angle, degrees. Zero at local solar noon, negative in the
 * morning, positive in the afternoon, 15 degrees per hour.
 *
 * Placeholder: clock noon is treated as solar noon, ignoring the equation of
 * time. Longitude is handled properly, so the sun is in the right place
 * east-to-west; it is only the time of day that can be minutes out.
 *
 * @param {number} t
 * @param {number} lon degrees east
 * @returns {number}
 */
export function solarHourAngle(t, lon) {
  const d = new Date(t);
  const utcHours =
    d.getUTCHours() +
    d.getUTCMinutes() / 60 +
    d.getUTCSeconds() / 3600 +
    d.getUTCMilliseconds() / 3_600_000;

  const solarHours = utcHours + lon / 15;
  return wrap180((solarHours - 12) * 15);
}

/**
 * Which twilight band an altitude falls in. The boundaries are the standard
 * ones and are the reason the scene is driven by altitude rather than by the
 * clock: they come out of the geometry for free, at every latitude and season.
 *
 * @param {number} altitude degrees
 * @returns {"day" | "civil" | "nautical" | "astronomical" | "night"}
 */
export function twilightBand(altitude) {
  if (altitude > 0) return "day";
  if (altitude > -6) return "civil";
  if (altitude > -12) return "nautical";
  if (altitude > -18) return "astronomical";
  return "night";
}

/* ------------------------------------------------------------------ helpers */

/**
 * Day of the year in UTC, 0-based, fractional.
 * @param {number} t
 * @returns {number}
 */
function dayOfYearUtc(t) {
  const d = new Date(t);
  const startOfYear = Date.UTC(d.getUTCFullYear(), 0, 1);
  return (t - startOfYear) / 86_400_000;
}

/**
 * @param {number} v
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Fold an angle into -180..180.
 * @param {number} deg
 * @returns {number}
 */
function wrap180(deg) {
  const a = (((deg + 180) % 360) + 360) % 360;
  return a - 180;
}
