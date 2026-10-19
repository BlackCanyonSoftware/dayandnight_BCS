// @ts-check
/**
 * The sun and the moon: how big they are, what colour, and which way the
 * moon's crescent faces.
 *
 * Everything here is geometry and photometry on the CPU; the drawing is in
 * `shaders.js`. The split is the usual one - this decides *what* to draw and
 * the shader decides how it looks.
 *
 * ## On angular size
 *
 * Both discs are about half a degree across, which is far smaller than people
 * remember: at a 150 degree field of view across a 1920-pixel span, the sun is
 * seven pixels wide. That is correct, and it is also why the glare matters so
 * much. What makes the sun read as the sun in a photograph is not the disc, it
 * is everything around it.
 *
 * The moon's size genuinely varies - its orbit is elliptical enough that it is
 * about a seventh wider at perigee than at apogee, which is the whole of the
 * "supermoon" story - so it is computed from the distance rather than fixed.
 *
 * @module engine/bodies
 */

import { moonPosition } from "./astro/lunar.js";
import { sunPosition } from "./astro/solar.js";

/** @typedef {import("./types.js").Place} Place */

/** The sun's angular radius at one astronomical unit, in degrees. */
const SUN_ANGULAR_RADIUS_AU = 0.2666;

/** The moon's radius, kilometres. */
const MOON_RADIUS_KM = 1737.4;

/**
 * The sun's radiance at the top of the atmosphere, in the same units as the
 * sky.
 *
 * Tuned rather than derived, like the stars: what matters is that the disc is
 * far brighter than anything else in the frame so that it clips to white
 * through the tone curve, while still reddening correctly as the
 * transmittance takes the blue out of it.
 */
const SUN_RADIANCE = 26;

/**
 * The full moon's surface radiance.
 *
 * This is a *surface* brightness and does not change with phase: a crescent
 * is not a dimmer moon, it is a smaller lit area of the same moon, which is
 * why the phase is drawn geometrically rather than by fading the disc.
 *
 * The value is a compromise and worth being honest about. A real full moon
 * and a real daytime sky have *comparable* surface brightness - which is
 * exactly why you can see the moon in the afternoon - and at that value the
 * moon would clip to a featureless white blob at night, because the exposure
 * is following the sky and the sky at night is a millionth as bright.
 *
 * So it is set about thirty times lower than life, which keeps the phase
 * readable on a night sky at the price of the moon being invisible in
 * daylight. The night moon is the headline (US-004); the daytime one is not.
 * Both this and the missing moonlight on the sky are in the roadmap.
 */
const MOON_RADIANCE = 3.5e-4;

/**
 * @typedef {object} Body
 * @property {number} altitude degrees, refracted
 * @property {number} azimuth degrees clockwise from north
 * @property {number} angularRadius degrees
 * @property {[number, number, number]} radiance linear, per unit area of disc
 * @property {number} phase cos of the phase angle: 1 full, 0 half, -1 new
 * @property {number} limbAngle degrees on screen, measured from up, towards
 *   which side of the disc is lit
 */

/**
 * The sun, ready to draw.
 *
 * @param {number} t
 * @param {Place} place
 * @param {[number, number, number]} transmittance what survives of its light
 * @returns {Body}
 */
export function sunBody(t, place, transmittance) {
  const sun = sunPosition(t, place);

  return {
    altitude: sun.altitude,
    azimuth: sun.azimuth,
    // Slightly larger when the Earth is nearer it, in January.
    angularRadius: SUN_ANGULAR_RADIUS_AU / sun.distance,
    radiance: [
      SUN_RADIANCE * transmittance[0],
      SUN_RADIANCE * transmittance[1],
      SUN_RADIANCE * transmittance[2]
    ],
    // The sun has no phase: it is always fully lit from here.
    phase: 1,
    limbAngle: 0
  };
}

/**
 * The moon, ready to draw.
 *
 * @param {number} t
 * @param {Place} place
 * @param {[number, number, number]} transmittance
 * @returns {Body}
 */
export function moonBody(t, place, transmittance) {
  const moon = moonPosition(t, place);

  // Its light crosses the same air the sun's does, so it reddens at the
  // horizon for the same reason - which is why a rising moon is orange.
  const radiance = /** @type {[number, number, number]} */ ([
    MOON_RADIANCE * transmittance[0],
    MOON_RADIANCE * transmittance[1],
    MOON_RADIANCE * transmittance[2]
  ]);

  return {
    altitude: moon.altitude,
    azimuth: moon.azimuth,
    angularRadius: (Math.atan(MOON_RADIUS_KM / moon.distance) * 180) / Math.PI,
    radiance,
    // The illuminated fraction is (1 + cos i) / 2, so this inverts it: the
    // shader wants the cosine, because that is what the terminator's shape
    // depends on.
    phase: 2 * moon.illumination - 1,
    limbAngle: moon.tilt
  };
}
