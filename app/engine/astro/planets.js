// @ts-check
/**
 * Where the naked-eye planets are.
 *
 * Mercury, Venus, Mars, Jupiter and Saturn from the six Keplerian elements and
 * their rates in NASA/JPL's "Approximate Positions of the Planets", Table 1,
 * which is good for 1800 to 2050 AD to a few arcminutes - far finer than a
 * pixel of a wallpaper and far coarser than a telescope would need. The numbers
 * are published constants (E. M. Standish, JPL Solar System Dynamics), not a
 * licensed dataset.
 *
 * ## What it is and is not
 *
 * Geocentric right ascension and declination of date, so they go into the same
 * sidereal-time arithmetic the stars use and rise, set and turn with them. The
 * distances and the phase angle follow from the same triangle, and with the
 * standard apparent-magnitude formulas give each planet's brightness: Venus is
 * brilliant near its greatest elongation and thin and faint near the sun, Mars
 * swells and fades over two years, which is what people notice about them.
 *
 * Not included: light-time, aberration and nutation (arcseconds), the Earth's
 * offset from the Earth-Moon barycentre (a few thousandths of a degree at
 * worst), Saturn's rings in its brightness, and Uranus and Neptune, which a
 * person cannot see without help. None can be seen at the size of a pixel.
 *
 * A pure function of the instant, like everything here.
 *
 * @module engine/astro/planets
 */

import { julianCenturies, toJulianDay, wrap180, wrap360 } from "./julian.js";

const RAD = Math.PI / 180;

/**
 * Elements at J2000 and their change per Julian century, from the JPL table:
 * semi-major axis (AU), eccentricity, inclination, mean longitude, longitude of
 * perihelion, longitude of the ascending node (all angles in degrees).
 *
 * @typedef {object} Elements
 * @property {[number, number]} a
 * @property {[number, number]} e
 * @property {[number, number]} I
 * @property {[number, number]} L
 * @property {[number, number]} varpi
 * @property {[number, number]} node
 */

/** @type {Record<string, Elements>} */
const ELEMENTS = {
  mercury: {
    a: [0.38709927, 0.00000037],
    e: [0.20563593, 0.00001906],
    I: [7.00497902, -0.00594749],
    L: [252.2503235, 149472.67411175],
    varpi: [77.45779628, 0.16047689],
    node: [48.33076593, -0.12534081]
  },
  venus: {
    a: [0.72333566, 0.0000039],
    e: [0.00677672, -0.00004107],
    I: [3.39467605, -0.0007889],
    L: [181.9790995, 58517.81538729],
    varpi: [131.60246718, 0.00268329],
    node: [76.67984255, -0.27769418]
  },
  // The Earth-Moon barycentre, which is the Earth to well within a pixel.
  earth: {
    a: [1.00000261, 0.00000562],
    e: [0.01671123, -0.00004392],
    I: [-0.00001531, -0.01294668],
    L: [100.46457166, 35999.37244981],
    varpi: [102.93768193, 0.32327364],
    node: [0, 0]
  },
  mars: {
    a: [1.52371034, 0.00001847],
    e: [0.0933941, 0.00007882],
    I: [1.84969142, -0.00813131],
    L: [-4.55343205, 19140.30268499],
    varpi: [-23.94362959, 0.44441088],
    node: [49.55953891, -0.29257343]
  },
  jupiter: {
    a: [5.202887, -0.00011607],
    e: [0.04838624, -0.00013253],
    I: [1.30439695, -0.00183714],
    L: [34.39644051, 3034.74612775],
    varpi: [14.72847983, 0.21252668],
    node: [100.47390909, 0.20469106]
  },
  saturn: {
    a: [9.53667594, -0.0012506],
    e: [0.05386179, -0.00050991],
    I: [2.48599187, 0.00193609],
    L: [49.95424423, 1222.49362201],
    varpi: [92.59887831, -0.41897216],
    node: [113.66242448, -0.28867794]
  }
};

/**
 * How each planet looks: its colour as the eye sees it (linear, near one in
 * brightness so that magnitude carries the brightness), and the constants of its
 * apparent-magnitude formula.
 *
 * Magnitude is `base + 5 log10(r * delta) + phase terms`, from the Astronomical
 * Almanac's formulae as given in Meeus, *Astronomical Algorithms*, chapter 41.
 *
 * @type {Record<string, { name: string, colour: [number, number, number], magnitude: (rd: number, i: number) => number }>}
 */
const LOOK = {
  mercury: {
    name: "Mercury",
    colour: [1.0, 0.93, 0.82],
    magnitude: (rd, i) =>
      -0.42 + 5 * Math.log10(rd) + 0.038 * i - 0.000273 * i * i + 0.000002 * i ** 3
  },
  venus: {
    name: "Venus",
    colour: [1.0, 0.97, 0.88],
    magnitude: (rd, i) =>
      -4.4 + 5 * Math.log10(rd) + 0.0009 * i + 0.000239 * i * i - 0.00000065 * i ** 3
  },
  mars: {
    name: "Mars",
    colour: [1.0, 0.58, 0.4],
    magnitude: (rd, i) => -1.52 + 5 * Math.log10(rd) + 0.016 * i
  },
  jupiter: {
    name: "Jupiter",
    colour: [1.0, 0.93, 0.8],
    magnitude: (rd, i) => -9.4 + 5 * Math.log10(rd) + 0.005 * i
  },
  saturn: {
    name: "Saturn",
    colour: [1.0, 0.9, 0.7],
    // The rings, which change its brightness by more than a magnitude over a
    // Saturnian year, are not modelled: a mean value.
    magnitude: (rd, i) => -8.88 + 5 * Math.log10(rd) + 0.044 * i
  }
};

/** The order they are drawn and reported in. */
export const PLANETS = Object.freeze(Object.keys(LOOK));

/**
 * @param {Elements} el
 * @param {number} T Julian centuries since J2000
 * @returns {{ x: number, y: number, z: number, r: number }} heliocentric,
 *   ecliptic and equinox of J2000, in AU
 */
function heliocentric(el, T) {
  const a = el.a[0] + el.a[1] * T;
  const e = el.e[0] + el.e[1] * T;
  const I = (el.I[0] + el.I[1] * T) * RAD;
  const L = el.L[0] + el.L[1] * T;
  const varpi = el.varpi[0] + el.varpi[1] * T;
  const node = (el.node[0] + el.node[1] * T) * RAD;

  const omega = varpi * RAD - node;
  const M = wrap180(L - varpi) * RAD;

  // Kepler's equation, by Newton's method. Eccentricities here are under 0.21,
  // for which it converges in a handful of steps from the mean anomaly.
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 12; i += 1) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-12) break;
  }

  // In the orbital plane, then turned into the ecliptic.
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);

  const cw = Math.cos(omega);
  const sw = Math.sin(omega);
  const cn = Math.cos(node);
  const sn = Math.sin(node);
  const ci = Math.cos(I);
  const si = Math.sin(I);

  const x = (cw * cn - sw * sn * ci) * xp + (-sw * cn - cw * sn * ci) * yp;
  const y = (cw * sn + sw * cn * ci) * xp + (-sw * sn + cw * cn * ci) * yp;
  const z = sw * si * xp + cw * si * yp;

  return { x, y, z, r: Math.hypot(x, y, z) };
}

/**
 * One planet, as seen from the Earth.
 *
 * @typedef {object} PlanetSighting
 * @property {string} id
 * @property {string} name
 * @property {number} rightAscension degrees, of date
 * @property {number} declination degrees, of date
 * @property {number} distance from the Earth, AU
 * @property {number} elongation from the sun, degrees: how far from it in the sky
 * @property {number} phaseAngle the sun-planet-Earth angle, degrees
 * @property {number} magnitude apparent visual magnitude
 * @property {[number, number, number]} colour
 */

/**
 * The five bright planets at an instant.
 *
 * @param {number} t milliseconds since the epoch, UTC
 * @returns {PlanetSighting[]}
 */
export function planetPositions(t) {
  const jd = toJulianDay(t);
  const T = julianCenturies(jd);

  const earth = heliocentric(ELEMENTS.earth, T);

  // Precession from J2000 to the date, in ecliptic longitude, and the
  // obliquity of the date, so that the result goes into the same sidereal-time
  // arithmetic as everything else without a quarter of a degree of error.
  const precession = (1.3969713 * T * Math.PI) / 180;
  const obliquity = (23.439291 - 0.0130042 * T) * RAD;

  return PLANETS.map((id) => {
    const body = heliocentric(ELEMENTS[id], T);

    const gx = body.x - earth.x;
    const gy = body.y - earth.y;
    const gz = body.z - earth.z;
    const delta = Math.hypot(gx, gy, gz);

    // To ecliptic longitude and latitude, advance the longitude by the
    // precession, and turn that into the equator of the date.
    const lon = Math.atan2(gy, gx) + precession;
    const lat = Math.asin(gz / delta);

    const sinDec =
      Math.sin(lat) * Math.cos(obliquity) + Math.cos(lat) * Math.sin(obliquity) * Math.sin(lon);
    const ra = Math.atan2(
      Math.sin(lon) * Math.cos(obliquity) - Math.tan(lat) * Math.sin(obliquity),
      Math.cos(lon)
    );

    // Elongation: the angle at the Earth between the sun and the planet. The
    // sun is at the origin, so its direction from the Earth is minus the Earth.
    const toSun = [-earth.x, -earth.y, -earth.z];
    const cosElongation = (toSun[0] * gx + toSun[1] * gy + toSun[2] * gz) / (earth.r * delta);

    // The phase angle, at the planet, from the triangle sun-Earth-planet.
    const cosPhase = (body.r * body.r + delta * delta - earth.r * earth.r) / (2 * body.r * delta);

    const phaseAngle = Math.acos(Math.max(-1, Math.min(1, cosPhase))) / RAD;
    const look = LOOK[id];

    return {
      id,
      name: look.name,
      rightAscension: wrap360(ra / RAD),
      declination: Math.asin(Math.max(-1, Math.min(1, sinDec))) / RAD,
      distance: delta,
      elongation: Math.acos(Math.max(-1, Math.min(1, cosElongation))) / RAD,
      phaseAngle,
      magnitude: look.magnitude(body.r * delta, phaseAngle),
      colour: look.colour
    };
  });
}
