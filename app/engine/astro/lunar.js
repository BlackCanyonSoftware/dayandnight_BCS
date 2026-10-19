// @ts-check
/**
 * Where the moon is, and what shape it is.
 *
 * Meeus, *Astronomical Algorithms*, chapter 47 ("Position of the Moon"), using
 * the principal terms of the ELP-2000/82 series, plus chapter 48 for the
 * illuminated fraction and the orientation of the bright limb.
 *
 * The Moon is much harder than the Sun. The Sun's position is a handful of
 * terms because the Earth's orbit is nearly a plain ellipse; the Moon is
 * pulled about by the Sun badly enough that its longitude needs dozens of
 * periodic terms to reach even a tenth of a degree. The tables below are the
 * largest of those terms - enough for well under the half-degree the product
 * promises, and far short of the full theory's few arcseconds.
 *
 * Three things have to be right for US-004, and they fail in different ways:
 *
 * - **Position.** Wrong, and the moon is in the wrong part of the sky.
 * - **Illuminated fraction.** Wrong, and tonight's crescent is the wrong
 *   thickness - which anyone who glances outside can see.
 * - **Orientation of the terminator.** Wrong, and the crescent tilts the wrong
 *   way. This is the one people notice without being able to say why: the
 *   crescent that sits upright like a bowl in the tropics lies on its side
 *   further north, and that is a property of the observer, not the moon.
 *
 * @module engine/astro/lunar
 */

import {
  eclipticToEquatorial,
  equatorialToHorizontal,
  meanObliquity,
  nutation,
  parallacticAngle,
  refraction
} from "./coords.js";
import {
  DEG,
  RAD,
  cosDeg,
  julianCenturies,
  sinDeg,
  toEphemerisDay,
  toJulianDay,
  wrap360
} from "./julian.js";
import { localSiderealTime } from "./sidereal.js";
import { solarEcliptic } from "./solar.js";

/** @typedef {import("./solar.js").Place} Place */

/**
 * Periodic terms for the Moon's longitude and distance (Meeus table 47.A).
 *
 * Each row is `[D, M, M', F, lCoefficient, rCoefficient]`, where the first
 * four are multipliers on the Moon's fundamental arguments, `l` is in units of
 * 1e-6 degrees and `r` in units of 1e-3 km.
 */
const LONGITUDE_DISTANCE = [
  [0, 0, 1, 0, 6288774, -20905355],
  [2, 0, -1, 0, 1274027, -3699111],
  [2, 0, 0, 0, 658314, -2955968],
  [0, 0, 2, 0, 213618, -569925],
  [0, 1, 0, 0, -185116, 48888],
  [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158],
  [2, -1, -1, 0, 57066, -152138],
  [2, 0, 1, 0, 53322, -170733],
  [2, -1, 0, 0, 45758, -204586],
  [0, 1, -1, 0, -40923, -129620],
  [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755],
  [2, 0, 0, -2, 15327, 10321],
  [0, 0, 1, 2, -12528, 0],
  [0, 0, 1, -2, 10980, 79661],
  [4, 0, -1, 0, 10675, -34782],
  [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636],
  [2, 1, -1, 0, -7888, 24208],
  [2, 1, 0, 0, -6766, 30824],
  [1, 0, -1, 0, -5163, -8379],
  [1, 1, 0, 0, 4987, -16675],
  [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445],
  [4, 0, 0, 0, 3861, -11650],
  [2, 0, -3, 0, 3665, 14403],
  [0, 1, -2, 0, -2689, -7003],
  [2, 0, -1, 2, -2602, 0],
  [2, -1, -2, 0, 2390, 10056],
  [1, 0, 1, 0, -2348, 6322],
  [2, -2, 0, 0, 2236, -9884],
  [0, 1, 2, 0, -2120, 5751],
  [0, 2, 0, 0, -2069, 0],
  [2, -2, -1, 0, 2048, -4950],
  [2, 0, 1, -2, -1773, 4130],
  [2, 0, 0, 2, -1595, 0],
  [4, -1, -1, 0, 1215, -3958],
  [0, 0, 2, 2, -1110, 0],
  [3, 0, -1, 0, -892, 3258],
  [2, 1, 1, 0, -810, 2616],
  [4, -1, -2, 0, 759, -1897],
  [0, 2, -1, 0, -713, -2117],
  [2, 2, -1, 0, -700, 2354],
  [2, 1, -2, 0, 691, 0],
  [2, -1, 0, -2, 596, 0],
  [4, 0, 1, 0, 549, -1423],
  [0, 0, 4, 0, 537, -1117],
  [4, -1, 0, 0, 520, -1571],
  [1, 0, -2, 0, -487, -1739],
  [2, 1, 0, -2, -399, 0],
  [0, 0, 2, -2, -381, -4421],
  [1, 1, 1, 0, 351, 0],
  [3, 0, -2, 0, -340, 0],
  [4, 0, -3, 0, 330, 0],
  [2, -1, 2, 0, 327, 0],
  [0, 2, 1, 0, -323, 1165],
  [1, 1, -1, 0, 299, 0],
  [2, 0, 3, 0, 294, 0],
  [2, 0, -1, -2, 0, 8752]
];

/**
 * Periodic terms for the Moon's ecliptic latitude (Meeus table 47.B).
 *
 * `[D, M, M', F, bCoefficient]`, in units of 1e-6 degrees.
 */
const LATITUDE = [
  [0, 0, 0, 1, 5128122],
  [0, 0, 1, 1, 280602],
  [0, 0, 1, -1, 277693],
  [2, 0, 0, -1, 173237],
  [2, 0, -1, 1, 55413],
  [2, 0, -1, -1, 46271],
  [2, 0, 0, 1, 32573],
  [0, 0, 2, 1, 17198],
  [2, 0, 1, -1, 9266],
  [0, 0, 2, -1, 8822],
  [2, -1, 0, -1, 8216],
  [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200],
  [2, 1, 0, -1, -3359],
  [2, -1, -1, 1, 2463],
  [2, -1, 0, 1, 2211],
  [2, -1, -1, -1, 2065],
  [0, 1, -1, -1, -1870],
  [4, 0, -1, -1, 1828],
  [0, 1, 0, 1, -1794],
  [0, 0, 0, 3, -1749],
  [0, 1, -1, 1, -1565],
  [1, 0, 0, 1, -1491],
  [0, 1, 1, 1, -1475],
  [0, 1, 1, -1, -1410],
  [0, 1, 0, -1, -1344],
  [1, 0, 0, -1, -1335],
  [0, 0, 3, 1, 1107],
  [4, 0, 0, -1, 1021],
  [4, 0, -1, 1, 833],
  [0, 0, 1, -3, 777],
  [4, 0, -2, 1, 671],
  [2, 0, 0, -3, 607],
  [2, 0, 2, -1, 596],
  [2, -1, 1, -1, 491],
  [2, 0, -2, 1, -451],
  [0, 0, 3, -1, 439],
  [2, 0, 2, 1, 422],
  [2, 0, -3, -1, 421],
  [2, 1, -1, 1, -366],
  [2, 1, 0, 1, -351],
  [4, 0, 0, 1, 331],
  [2, -1, 1, 1, 315],
  [2, -2, 0, -1, 302],
  [0, 0, 1, 3, -283],
  [2, 1, 1, -1, -229],
  [1, 1, 0, -1, 223],
  [1, 1, 0, 1, 223],
  [0, 1, -2, -1, -220],
  [2, 1, -1, -1, -220],
  [1, 0, 1, 1, -185],
  [2, -1, -2, -1, 181],
  [0, 1, 2, 1, -177],
  [4, 0, -2, -1, 176],
  [4, -1, -1, -1, 166],
  [1, 0, 1, -1, -164],
  [4, 0, 1, -1, 132],
  [1, 0, -1, -1, -119],
  [4, -1, 0, -1, 115],
  [2, -2, 0, 1, 107]
];

/**
 * @typedef {object} MoonEcliptic
 * @property {number} longitude degrees, apparent
 * @property {number} latitude degrees
 * @property {number} distance kilometres, centre to centre
 */

/**
 * The Moon's geocentric ecliptic position.
 *
 * @param {number} T Julian centuries since J2000, in TT
 * @returns {MoonEcliptic}
 */
export function moonEcliptic(T) {
  // The Moon's fundamental arguments (Meeus 47.1 - 47.5).
  const Lp = wrap360(
    218.3164477 + T * (481267.88123421 - T * (0.0015786 - T * (1 / 538841 - T / 65194000)))
  );
  const D = wrap360(
    297.8501921 + T * (445267.1114034 - T * (0.0018819 - T * (1 / 545868 - T / 113065000)))
  );
  const M = wrap360(357.5291092 + T * (35999.0502909 - T * (0.0001536 - T / 24490000)));
  const Mp = wrap360(
    134.9633964 + T * (477198.8675055 + T * (0.0087414 + T * (1 / 69699 - T / 14712000)))
  );
  const F = wrap360(
    93.272095 + T * (483202.0175233 - T * (0.0036539 + T * (1 / 3526000 - T / 863310000)))
  );

  // Three further arguments for terms caused by Venus and Jupiter, and by the
  // flattening of the Earth.
  const A1 = wrap360(119.75 + 131.849 * T);
  const A2 = wrap360(53.09 + 479264.29 * T);
  const A3 = wrap360(313.45 + 481266.484 * T);

  // Earth's orbital eccentricity, which modulates every term involving the
  // Sun's mean anomaly. Terms in M get one factor, terms in 2M get two.
  const E = 1 - T * (0.002516 + T * 0.0000074);

  let sumL = 0;
  let sumR = 0;
  for (const [d, m, mp, f, lCoefficient, rCoefficient] of LONGITUDE_DISTANCE) {
    const argument = d * D + m * M + mp * Mp + f * F;
    const eccentricity = eccentricityFactor(m, E);
    sumL += lCoefficient * eccentricity * sinDeg(argument);
    sumR += rCoefficient * eccentricity * cosDeg(argument);
  }

  let sumB = 0;
  for (const [d, m, mp, f, bCoefficient] of LATITUDE) {
    const argument = d * D + m * M + mp * Mp + f * F;
    sumB += bCoefficient * eccentricityFactor(m, E) * sinDeg(argument);
  }

  // Additive terms, the largest of the perturbations not in the tables.
  sumL += 3958 * sinDeg(A1) + 1962 * sinDeg(Lp - F) + 318 * sinDeg(A2);
  sumB +=
    -2235 * sinDeg(Lp) +
    382 * sinDeg(A3) +
    175 * sinDeg(A1 - F) +
    175 * sinDeg(A1 + F) +
    127 * sinDeg(Lp - Mp) -
    115 * sinDeg(Lp + Mp);

  return {
    longitude: wrap360(Lp + sumL / 1e6 + nutation(T).longitude),
    latitude: sumB / 1e6,
    distance: 385000.56 + sumR / 1000
  };
}

/**
 * @typedef {object} MoonPosition
 * @property {number} altitude degrees above the horizon, refracted
 * @property {number} trueAltitude degrees, geometric
 * @property {number} azimuth degrees clockwise from north
 * @property {number} distance kilometres
 * @property {number} illumination 0..1, the lit fraction of the visible disc
 * @property {number} phase 0..1, where 0 and 1 are new and 0.5 is full
 * @property {number} brightLimbAngle degrees; position angle of the lit edge
 * @property {number} parallacticAngle degrees
 * @property {number} tilt degrees; how the crescent sits on screen
 * @property {boolean} waxing
 */

/**
 * The Moon's apparent position and appearance for an instant and a place.
 *
 * @param {number} t milliseconds since the Unix epoch, UTC
 * @param {Place} place
 * @returns {MoonPosition}
 */
export function moonPosition(t, place) {
  const jd = toJulianDay(t);
  const T = julianCenturies(toEphemerisDay(jd));

  const moon = moonEcliptic(T);
  const sun = solarEcliptic(T);

  const trueObliquity = meanObliquity(T) + nutation(T).obliquity;

  const moonEq = eclipticToEquatorial(moon.longitude, moon.latitude, trueObliquity);
  const sunEq = eclipticToEquatorial(sun.longitude, 0, trueObliquity);

  const lst = localSiderealTime(jd, place.lon);
  const horizontal = equatorialToHorizontal(moonEq, lst, place.lat);
  const altitude = horizontal.altitude + refraction(horizontal.altitude);

  const appearance = moonAppearance(sunEq, moonEq, sun.distance, moon.distance);
  const q = parallacticAngle(moonEq, lst, place.lat);

  return {
    altitude,
    trueAltitude: horizontal.altitude,
    azimuth: horizontal.azimuth,
    distance: moon.distance,
    illumination: appearance.illumination,
    phase: phaseFromElongation(moon.longitude, sun.longitude),
    brightLimbAngle: appearance.brightLimbAngle,
    parallacticAngle: q,
    // What the renderer actually needs: the bright limb's angle as it appears
    // on screen, which is the sky's own angle minus the rotation the observer
    // introduces.
    tilt: appearance.brightLimbAngle - q,
    waxing: appearance.waxing
  };
}

/**
 * How much of the disc is lit, and which way the lit edge faces.
 *
 * Meeus chapter 48.
 *
 * @param {import("./coords.js").Equatorial} sunEq
 * @param {import("./coords.js").Equatorial} moonEq
 * @param {number} sunDistanceAu
 * @param {number} moonDistanceKm
 * @returns {{ illumination: number, brightLimbAngle: number, waxing: boolean }}
 */
function moonAppearance(sunEq, moonEq, sunDistanceAu, moonDistanceKm) {
  const sunDistanceKm = sunDistanceAu * 149_597_870.7;
  const deltaRa = sunEq.rightAscension - moonEq.rightAscension;

  // Geocentric elongation: the angle between the Sun and the Moon as seen
  // from Earth.
  const cosElongation =
    sinDeg(sunEq.declination) * sinDeg(moonEq.declination) +
    cosDeg(sunEq.declination) * cosDeg(moonEq.declination) * cosDeg(deltaRa);
  const elongation = Math.acos(Math.min(1, Math.max(-1, cosElongation)));

  // The phase angle: Sun-Moon-Earth. Not the same as the elongation, because
  // the Sun is a long way further off than the Moon.
  const phaseAngle = Math.atan2(
    sunDistanceKm * Math.sin(elongation),
    moonDistanceKm - sunDistanceKm * Math.cos(elongation)
  );

  // Position angle of the midpoint of the bright limb, measured eastward from
  // the north point of the disc.
  const brightLimbAngle =
    Math.atan2(
      cosDeg(sunEq.declination) * sinDeg(deltaRa),
      sinDeg(sunEq.declination) * cosDeg(moonEq.declination) -
        cosDeg(sunEq.declination) * sinDeg(moonEq.declination) * cosDeg(deltaRa)
    ) * RAD;

  return {
    illumination: (1 + Math.cos(phaseAngle)) / 2,
    brightLimbAngle,
    // Waxing when the Moon is east of the Sun, which is what the sign of the
    // bright limb's position angle reports.
    waxing: Math.sin(deltaRa * DEG) < 0
  };
}

/**
 * The phase as a fraction of the synodic cycle: 0 new, 0.25 first quarter,
 * 0.5 full, 0.75 last quarter.
 *
 * The illuminated fraction alone cannot say this - it is 0.5 at both quarters
 * - so the renderer needs the elongation, which is monotonic through the
 * month.
 *
 * @param {number} moonLongitude degrees
 * @param {number} sunLongitude degrees
 * @returns {number} 0..1
 */
function phaseFromElongation(moonLongitude, sunLongitude) {
  return wrap360(moonLongitude - sunLongitude) / 360;
}

/**
 * Terms involving the Sun's mean anomaly are modulated by Earth's orbital
 * eccentricity, once per power of M.
 *
 * @param {number} m the multiplier on M in this term
 * @param {number} E
 * @returns {number}
 */
function eccentricityFactor(m, E) {
  const power = Math.abs(m);
  if (power === 1) return E;
  if (power === 2) return E * E;
  return 1;
}
