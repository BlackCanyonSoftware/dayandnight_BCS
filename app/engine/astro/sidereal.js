// @ts-check
/**
 * Sidereal time: where the sky has got to.
 *
 * Solar time is keyed to the Sun; sidereal time is keyed to the stars. They
 * differ because the Earth both spins and goes round the Sun, so a sidereal
 * day is about 23h 56m 04s - roughly four minutes shorter than a solar day.
 * That four minutes a day is why the constellations rise earlier through the
 * year, and it is what the star field's rotation has to be driven by (US-005).
 *
 * @module engine/astro/sidereal
 */

import { J2000, cosDeg, julianCenturies, wrap360 } from "./julian.js";
import { meanObliquity, nutation } from "./coords.js";

/**
 * Greenwich mean sidereal time, in degrees.
 *
 * Meeus (12.4), which takes a Julian Day in **UT**, not TT - sidereal time
 * follows the Earth's actual rotation, so it is one of the few things here
 * that wants civil time. Passing an ephemeris day would be a small silent
 * error.
 *
 * @param {number} jd Julian Day, UT
 * @returns {number} degrees, 0..360
 */
export function greenwichMeanSiderealTime(jd) {
  const T = julianCenturies(jd);
  const theta =
    280.46061837 + 360.98564736629 * (jd - J2000) + 0.000387933 * T * T - (T * T * T) / 38_710_000;

  return wrap360(theta);
}

/**
 * Greenwich apparent sidereal time, in degrees.
 *
 * The mean value plus the equation of the equinoxes - nutation in longitude
 * projected onto the equator. Worth about a second of time, which is below
 * anything this product can show, but it is one multiplication and it keeps a
 * comparison against an almanac honest.
 *
 * @param {number} jd Julian Day, UT
 * @returns {number} degrees, 0..360
 */
export function greenwichApparentSiderealTime(jd) {
  const T = julianCenturies(jd);
  const { longitude, obliquity } = nutation(T);
  const trueObliquity = meanObliquity(T) + obliquity;

  return wrap360(greenwichMeanSiderealTime(jd) + longitude * cosDeg(trueObliquity));
}

/**
 * Local apparent sidereal time, in degrees.
 *
 * East longitude is positive here, which is the modern convention and the
 * opposite of the one Meeus's own examples use. The sign of a longitude is
 * the single most common way to get an astronomical calculation exactly as
 * wrong as the observer is far from Greenwich, so it is stated plainly: pass
 * Denver as -105, not +105.
 *
 * @param {number} jd Julian Day, UT
 * @param {number} longitude degrees east
 * @returns {number} degrees, 0..360
 */
export function localSiderealTime(jd, longitude) {
  return wrap360(greenwichApparentSiderealTime(jd) + longitude);
}
