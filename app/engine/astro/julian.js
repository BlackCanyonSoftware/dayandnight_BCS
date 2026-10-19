// @ts-check
/**
 * Dates, and the two timescales the astronomy needs.
 *
 * Everything in `astro/` is driven by the Julian Day - a continuous count of
 * days that has no months, no leap years and no time zones in it. Converting
 * once, here, is what keeps every other file free of calendar arithmetic.
 *
 * **Two timescales, and why it matters.** Civil time (UT) follows the Earth's
 * rotation, which is irregular and slowing. Dynamical time (TT) is uniform and
 * is what the orbital theories are written in. They differ by delta-T, about
 * 75 seconds in 2026. For the Sun that is worth 0.0003 degrees and could be
 * ignored; for the Moon, which moves about half a degree an hour, it is worth
 * roughly 0.01 degrees. Neither threatens the half-degree the product
 * promises, but both are free to get right, and conflating the two is the kind
 * of mistake that is invisible until someone checks against an almanac.
 *
 * @module engine/astro/julian
 */

/** The Julian Day of the J2000.0 epoch: 2000 January 1.5 TT. */
export const J2000 = 2451545.0;

/** Days in a Julian century. */
export const DAYS_PER_CENTURY = 36525;

/** The Julian Day at the Unix epoch, 1970 January 1.0 UTC. */
const JD_UNIX_EPOCH = 2440587.5;

const MS_PER_DAY = 86_400_000;

/**
 * A Unix timestamp to a Julian Day in UT.
 *
 * @param {number} t milliseconds since the Unix epoch, UTC
 * @returns {number} Julian Day
 */
export function toJulianDay(t) {
  return t / MS_PER_DAY + JD_UNIX_EPOCH;
}

/**
 * A Julian Day back to a Unix timestamp.
 *
 * @param {number} jd
 * @returns {number} milliseconds since the Unix epoch
 */
export function fromJulianDay(jd) {
  return (jd - JD_UNIX_EPOCH) * MS_PER_DAY;
}

/**
 * Julian centuries since J2000.0.
 *
 * The argument of nearly every polynomial in this folder.
 *
 * @param {number} jd
 * @returns {number}
 */
export function julianCenturies(jd) {
  return (jd - J2000) / DAYS_PER_CENTURY;
}

/**
 * Delta-T: TT minus UT, in seconds.
 *
 * The polynomial Espenak and Meeus fit for 2005-2050, which is the window
 * this application will plausibly run in. Outside it the expression drifts,
 * so it is clamped to the ends rather than extrapolated into nonsense - a
 * wrong delta-T of a few minutes is still far below the product's tolerance,
 * whereas an unbounded polynomial is not.
 *
 * @param {number} jd Julian Day in UT
 * @returns {number} seconds
 */
export function deltaT(jd) {
  const year = approximateYear(jd);
  const clamped = Math.min(2150, Math.max(1900, year));
  const t = clamped - 2000;
  return 62.92 + 0.32217 * t + 0.005589 * t * t;
}

/**
 * The Julian Ephemeris Day: the same instant on the dynamical timescale.
 *
 * This is what the solar and lunar theories want. Passing a UT Julian Day to
 * them instead is a small, silent error, which is exactly why the conversion
 * has a name.
 *
 * @param {number} jd Julian Day in UT
 * @returns {number} Julian Ephemeris Day (TT)
 */
export function toEphemerisDay(jd) {
  return jd + deltaT(jd) / 86400;
}

/**
 * A rough calendar year from a Julian Day, good to a fraction of a year.
 *
 * Only ever used to pick a delta-T, which needs nothing better.
 *
 * @param {number} jd
 * @returns {number}
 */
function approximateYear(jd) {
  return 2000 + (jd - J2000) / 365.25;
}

/* --------------------------------------------------------------- angles */

/**
 * Fold an angle into 0..360.
 * @param {number} degrees
 * @returns {number}
 */
export function wrap360(degrees) {
  const a = degrees % 360;
  return a < 0 ? a + 360 : a;
}

/**
 * Fold an angle into -180..180.
 * @param {number} degrees
 * @returns {number}
 */
export function wrap180(degrees) {
  return wrap360(degrees + 180) - 180;
}

/** Degrees to radians. */
export const DEG = Math.PI / 180;

/** Radians to degrees. */
export const RAD = 180 / Math.PI;

/**
 * Sine of an angle in degrees. The astronomy is written in degrees because
 * the source tables are, and converting at every call site is how sign errors
 * get in.
 * @param {number} degrees
 * @returns {number}
 */
export function sinDeg(degrees) {
  return Math.sin(degrees * DEG);
}

/**
 * @param {number} degrees
 * @returns {number}
 */
export function cosDeg(degrees) {
  return Math.cos(degrees * DEG);
}

/**
 * @param {number} degrees
 * @returns {number}
 */
export function tanDeg(degrees) {
  return Math.tan(degrees * DEG);
}
