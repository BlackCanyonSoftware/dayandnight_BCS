// @ts-check
/**
 * Coordinate systems, and getting between them.
 *
 * Three frames are in play, and keeping them straight is most of the work:
 *
 * - **Ecliptic** (longitude, latitude) - where the orbital theories put
 *   things, referred to the plane of Earth's orbit.
 * - **Equatorial** (right ascension, declination) - referred to Earth's
 *   equator. What a star catalogue uses.
 * - **Horizontal** (altitude, azimuth) - what an observer at a place and an
 *   instant actually sees, and the only one the renderer cares about.
 *
 * @module engine/astro/coords
 */

import { DEG, RAD, cosDeg, sinDeg, tanDeg, wrap360 } from "./julian.js";

/**
 * @typedef {object} Equatorial
 * @property {number} rightAscension degrees, 0..360
 * @property {number} declination degrees, -90..90
 */

/**
 * @typedef {object} Horizontal
 * @property {number} altitude degrees above the horizon; negative below
 * @property {number} azimuth degrees clockwise from north, 0..360
 */

/**
 * The mean obliquity of the ecliptic: the tilt of Earth's axis.
 *
 * Meeus's expression (22.2), in arcseconds off a base of 23 degrees 26
 * minutes 21.448 seconds. It decreases by about 47 arcseconds a century.
 *
 * @param {number} T Julian centuries since J2000, in TT
 * @returns {number} degrees
 */
export function meanObliquity(T) {
  const seconds = 21.448 - T * (46.815 + T * (0.00059 - T * 0.001813));
  return 23 + (26 + seconds / 60) / 60;
}

/**
 * Nutation in longitude and obliquity, to the accuracy this needs.
 *
 * The full theory is a hundred terms; these are the two largest, driven by the
 * regression of the Moon's nodes and by the Sun. They are worth up to about
 * 17 arcseconds in longitude - a hundredth of the half-degree the product
 * promises, so this would be defensible to skip entirely. It is here because
 * it also feeds the true obliquity, and because leaving it out is the sort of
 * thing that makes a comparison against an almanac fail by a margin nobody can
 * explain.
 *
 * @param {number} T Julian centuries since J2000, in TT
 * @returns {{ longitude: number, obliquity: number }} both in degrees
 */
export function nutation(T) {
  // Longitude of the ascending node of the Moon's mean orbit.
  const omega = 125.04452 - 1934.136261 * T;
  // Mean longitudes of the Sun and the Moon.
  const L = 280.4665 + 36000.7698 * T;
  const Lm = 218.3165 + 481267.8813 * T;

  const longitude =
    (-17.2 * sinDeg(omega) -
      1.32 * sinDeg(2 * L) -
      0.23 * sinDeg(2 * Lm) +
      0.21 * sinDeg(2 * omega)) /
    3600;

  const obliquity =
    (9.2 * cosDeg(omega) + 0.57 * cosDeg(2 * L) + 0.1 * cosDeg(2 * Lm) - 0.09 * cosDeg(2 * omega)) /
    3600;

  return { longitude, obliquity };
}

/**
 * Ecliptic coordinates to equatorial.
 *
 * @param {number} longitude degrees
 * @param {number} latitude degrees
 * @param {number} obliquity degrees
 * @returns {Equatorial}
 */
export function eclipticToEquatorial(longitude, latitude, obliquity) {
  const sinLon = sinDeg(longitude);

  const rightAscension = Math.atan2(
    sinLon * cosDeg(obliquity) - tanDeg(latitude) * sinDeg(obliquity),
    cosDeg(longitude)
  );

  const declination = Math.asin(
    sinDeg(latitude) * cosDeg(obliquity) + cosDeg(latitude) * sinDeg(obliquity) * sinLon
  );

  return {
    rightAscension: wrap360(rightAscension * RAD),
    declination: declination * RAD
  };
}

/**
 * Equatorial coordinates to what an observer sees.
 *
 * Meeus gives azimuth measured westward from **south**, which is the
 * convention of the old almanacs and a reliable source of 180-degree errors.
 * This returns it clockwise from **north**, which is what a compass reads and
 * what the renderer wants, so the conversion happens once, here.
 *
 * @param {Equatorial} equatorial
 * @param {number} localSiderealTime degrees
 * @param {number} latitude degrees north
 * @returns {Horizontal}
 */
export function equatorialToHorizontal(equatorial, localSiderealTime, latitude) {
  // The hour angle: how far the object is past the observer's meridian.
  const H = localSiderealTime - equatorial.rightAscension;

  const sinLat = sinDeg(latitude);
  const cosLat = cosDeg(latitude);
  const sinDec = sinDeg(equatorial.declination);
  const cosDec = cosDeg(equatorial.declination);
  const cosH = cosDeg(H);

  const altitude = Math.asin(sinLat * sinDec + cosLat * cosDec * cosH) * RAD;

  // atan2 rather than atan: it gets the quadrant right without a chain of
  // sign tests, which is where this transform usually goes wrong.
  const azimuthFromSouth = Math.atan2(
    sinDeg(H),
    cosH * sinLat - tanDeg(equatorial.declination) * cosLat
  );

  return {
    altitude,
    azimuth: wrap360(azimuthFromSouth * RAD + 180)
  };
}

/**
 * How much the atmosphere lifts an object near the horizon.
 *
 * Light bends coming through the air, so everything looks higher than it is -
 * by about 34 arcminutes at the horizon, which is slightly more than the Sun's
 * own diameter. That is why sunrise happens while the Sun is still
 * geometrically below the horizon, and why ignoring refraction makes sunrise
 * a few minutes late.
 *
 * Meeus (16.4), which takes an apparent altitude. The expression misbehaves
 * well below the horizon, so it is faded out: at -2 degrees there is no more
 * refraction to speak of, and a body that far down is not being drawn anyway.
 *
 * @param {number} apparentAltitude degrees
 * @returns {number} degrees to add to the true altitude
 */
export function refraction(apparentAltitude) {
  if (apparentAltitude < -2) return 0;

  const h = Math.max(apparentAltitude, -0.9);
  const minutes = 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * DEG);
  return minutes / 60;
}

/**
 * The parallactic angle: how the sky is rotated at a point, as seen by an
 * observer.
 *
 * This is what orients the Moon's terminator. The lit side always faces the
 * Sun, but "which way is that on screen" depends on where the observer is -
 * the crescent that stands upright like a bowl in the tropics lies on its side
 * in Scotland. Getting this wrong is the kind of error a user notices without
 * being able to say why (US-004).
 *
 * @param {Equatorial} equatorial
 * @param {number} localSiderealTime degrees
 * @param {number} latitude degrees north
 * @returns {number} degrees
 */
export function parallacticAngle(equatorial, localSiderealTime, latitude) {
  const H = localSiderealTime - equatorial.rightAscension;
  const q = Math.atan2(
    sinDeg(H),
    tanDeg(latitude) * cosDeg(equatorial.declination) - sinDeg(equatorial.declination) * cosDeg(H)
  );
  return q * RAD;
}
