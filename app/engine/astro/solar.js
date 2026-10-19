// @ts-check
/**
 * Where the sun is.
 *
 * Meeus, *Astronomical Algorithms*, chapter 25 ("Solar Coordinates"), the
 * lower-accuracy series - which is still good to about 0.01 degrees, fifty
 * times finer than the half-degree US-001 asks for and far finer than anything
 * a sky gradient can show.
 *
 * This replaces the Milestone 0 placeholder, which was good to a degree or two
 * and ignored the equation of time. What that means in practice: the sun now
 * arrives at the right place at the right *minute*, where before the whole day
 * could be a quarter of an hour out.
 *
 * The chain is always the same, and every function here is a step of it:
 *
 *   timestamp -> Julian Day -> ephemeris day -> the Sun's ecliptic longitude
 *   -> right ascension and declination -> altitude and azimuth here, now
 *
 * @module engine/astro/solar
 */

import {
  eclipticToEquatorial,
  equatorialToHorizontal,
  meanObliquity,
  nutation,
  refraction
} from "./coords.js";
import {
  cosDeg,
  julianCenturies,
  sinDeg,
  toEphemerisDay,
  toJulianDay,
  wrap180,
  wrap360
} from "./julian.js";
import { localSiderealTime } from "./sidereal.js";

/** @typedef {import("./coords.js").Equatorial} Equatorial */

/**
 * @typedef {object} Place
 * @property {number} lat degrees north, -90..90
 * @property {number} lon degrees east, -180..180
 */

/**
 * @typedef {object} SunPosition
 * @property {number} altitude degrees above the horizon, refracted; negative below
 * @property {number} trueAltitude degrees, geometric, before refraction
 * @property {number} azimuth degrees clockwise from north, 0..360
 * @property {number} declination degrees
 * @property {number} rightAscension degrees
 * @property {number} hourAngle degrees, negative before solar noon
 * @property {number} distance astronomical units
 * @property {number} eclipticLongitude degrees, apparent
 */

/**
 * The Sun's apparent position for an instant and a place.
 *
 * Takes the timestamp as an argument and never reads the clock, so the live
 * wallpaper and the editor's scrubber are the same code path (architecture
 * invariant 1).
 *
 * @param {number} t milliseconds since the Unix epoch, UTC
 * @param {Place} place
 * @returns {SunPosition}
 */
export function sunPosition(t, place) {
  const jd = toJulianDay(t);
  const T = julianCenturies(toEphemerisDay(jd));

  const { longitude, distance } = solarEcliptic(T);

  const trueObliquity = meanObliquity(T) + nutation(T).obliquity;
  const equatorial = eclipticToEquatorial(longitude, 0, trueObliquity);

  const lst = localSiderealTime(jd, place.lon);
  const horizontal = equatorialToHorizontal(equatorial, lst, place.lat);

  // The refracted altitude is what a person actually sees, and is what the
  // sky should be drawn from: it is the reason sunrise happens while the Sun
  // is still geometrically below the horizon.
  const altitude = horizontal.altitude + refraction(horizontal.altitude);

  return {
    altitude,
    trueAltitude: horizontal.altitude,
    azimuth: horizontal.azimuth,
    declination: equatorial.declination,
    rightAscension: equatorial.rightAscension,
    hourAngle: wrap180(lst - equatorial.rightAscension),
    distance,
    eclipticLongitude: longitude
  };
}

/**
 * The Sun's apparent ecliptic longitude and distance.
 *
 * Meeus 25.2 onwards. The Sun has no ecliptic latitude worth the name - under
 * a second of arc - so it is taken as zero throughout.
 *
 * @param {number} T Julian centuries since J2000, in TT
 * @returns {{ longitude: number, distance: number, trueAnomaly: number, meanAnomaly: number }}
 */
export function solarEcliptic(T) {
  // Geometric mean longitude, referred to the mean equinox of the date.
  const L0 = wrap360(280.46646 + T * (36000.76983 + T * 0.0003032));

  // Mean anomaly: where the Sun would be if the orbit were circular.
  const M = wrap360(357.52911 + T * (35999.05029 - T * 0.0001537));

  // Eccentricity of Earth's orbit. Slowly decreasing.
  const e = 0.016708634 - T * (0.000042037 + T * 0.0000001267);

  // The equation of the centre: the correction for the orbit being an ellipse
  // rather than a circle. This is the larger half of the equation of time,
  // and the half the Milestone 0 placeholder was missing entirely.
  const C =
    (1.914602 - T * (0.004817 + T * 0.000014)) * sinDeg(M) +
    (0.019993 - 0.000101 * T) * sinDeg(2 * M) +
    0.000289 * sinDeg(3 * M);

  const trueLongitude = L0 + C;
  const trueAnomaly = M + C;

  // The radius vector, in astronomical units (Meeus 25.5).
  const distance = (1.000001018 * (1 - e * e)) / (1 + e * cosDeg(trueAnomaly));

  // Apparent longitude: corrected for nutation and for aberration, the
  // apparent displacement caused by the Earth's own motion.
  const omega = 125.04 - 1934.136 * T;
  const longitude = wrap360(trueLongitude - 0.00569 - 0.00478 * sinDeg(omega));

  return { longitude, distance, trueAnomaly, meanAnomaly: M };
}

/**
 * The equation of time: apparent solar time minus mean solar time.
 *
 * Why a sundial disagrees with a clock, by up to about 16 minutes either way
 * over the year. Exposed because it is the single clearest check that the new
 * arithmetic is doing something the placeholder was not - the placeholder's
 * value was exactly zero, every day of the year.
 *
 * @param {number} t milliseconds since the Unix epoch, UTC
 * @returns {number} minutes
 */
export function equationOfTime(t) {
  const T = julianCenturies(toEphemerisDay(toJulianDay(t)));
  const { meanAnomaly } = solarEcliptic(T);

  const L0 = wrap360(280.46646 + T * (36000.76983 + T * 0.0003032));
  const e = 0.016708634 - T * (0.000042037 + T * 0.0000001267);
  const trueObliquity = meanObliquity(T) + nutation(T).obliquity;

  // y = tan^2(epsilon / 2), Meeus 28.3.
  const y = Math.pow(Math.tan((trueObliquity / 2) * (Math.PI / 180)), 2);

  const E =
    y * sinDeg(2 * L0) -
    2 * e * sinDeg(meanAnomaly) +
    4 * e * y * sinDeg(meanAnomaly) * cosDeg(2 * L0) -
    0.5 * y * y * sinDeg(4 * L0) -
    1.25 * e * e * sinDeg(2 * meanAnomaly);

  // E comes out in radians; four minutes of time to the degree.
  return E * (180 / Math.PI) * 4;
}

/**
 * Which twilight band an altitude falls in.
 *
 * The boundaries are the standard ones, and they are the reason the scene is
 * driven by altitude rather than by the clock: they come out of the geometry
 * for free, at every latitude and season, including the ones where a day never
 * reaches one of them at all.
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
