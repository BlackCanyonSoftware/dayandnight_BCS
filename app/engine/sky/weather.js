// @ts-check
/**
 * Weather in the air in front of the sky: fog, rain and snow.
 *
 * US-031. The clouds are weather far away and this is weather near: the mist
 * that thickens towards the horizon, and the streaks or flakes falling through
 * the foreground. It is drawn after everything else in the scene and before the
 * tone map, as light, so that rain is brightest on a bright day and nearly
 * invisible on a dark night, as it is - rain is lit by the sky around it, it
 * does not glow.
 *
 * ## It is the one thing here that moves quickly
 *
 * The clouds change by a pixel in a minute; a raindrop crosses the screen in a
 * second. So rain and snow redraw every frame, which breaks the arrangement
 * that makes the rest of the product nearly free: the host skips a frame whose
 * signature has not changed. That is the cost, it is paid only while it is
 * raining or snowing, and it is why the looks that use it say so.
 *
 * ## Still a pure function of the instant
 *
 * Nothing here is simulated. Each layer's position is a function of a phase,
 * and the phase is the instant modulo that layer's period, worked out in double
 * precision on the CPU and handed over as a fraction - so two screens, or one
 * after a pause, draw the same rain at the same moment, and a single-precision
 * uniform never has to hold a timestamp.
 *
 * @module engine/sky/weather
 */

import { windAt } from "./wind.js";

/**
 * What can fall.
 *
 * @type {readonly { id: string, name: string, hint: string }[]}
 */
export const KINDS = [
  {
    id: "rain",
    name: "Rain",
    hint: "Streaks falling at three distances, the near ones longer and faster, leaning with the wind. Each is lit by the sky around it, so rain is plain against a bright overcast afternoon and barely there at night."
  },
  {
    id: "snow",
    name: "Snow",
    hint: "Flakes drifting down at three distances, the near ones larger, softer and slower to cross, swaying as they fall. Brighter than rain, because snow is white and catches whatever light there is."
  }
];

/** @param {unknown} value */
export function isKind(value) {
  return KINDS.some((k) => k.id === value);
}

/**
 * The shader's number for a kind: 0 rain, 1 snow. An unknown name is rain,
 * which is also what the default is.
 *
 * @param {string} id
 * @returns {number}
 */
export function kindIndex(id) {
  return id === "snow" ? 1 : 0;
}

/**
 * Whether anything is to be drawn. At zero of both the pass is skipped, which
 * is the bargain every optional layer here makes: a clear day costs exactly
 * what it cost before weather existed.
 *
 * @param {{ fog: number, precipitation: number }} preset
 * @returns {boolean}
 */
export function weatherVisible(preset) {
  return preset.fog > 0.005 || preset.precipitation > 0.005;
}

/**
 * How fast each of the three layers falls, in cycles a second, where a cycle is
 * one repeat of that layer's pattern, which is one `CELL_HEIGHT` tall. Rain's
 * layers fall at about 500, 800 and 1400 pixels a second on a 1080-line screen,
 * far enough that the eye reads a streak and not a dot; the flakes at about 70,
 * 100 and 140.
 *
 * Far to near, because nearer things cross the screen faster.
 */
export const FALL_RATES = Object.freeze({
  rain: Object.freeze([8, 9, 10]),
  snow: Object.freeze([3, 2.6, 2.2])
});

/**
 * How tall each layer's repeating cell is, in pixels of a 1080-line screen, far
 * to near. The shader is built from these numbers, so a layer's speed in pixels
 * a second is exactly `FALL_RATES` times this, and a test can say so.
 */
export const CELL_HEIGHT = Object.freeze({
  rain: Object.freeze([64, 90, 140]),
  snow: Object.freeze([22, 38, 64])
});

/** How fast a flake sways from side to side, in cycles a second. */
export const SWAY_RATE = 0.17;

/**
 * The positions are quantised to this many steps a cycle for the frame
 * signature. A cycle is about a hundred pixels, so this is at most about a
 * pixel a step: nothing is redrawn for motion nobody could see.
 */
export const PHASE_STEPS = 128;

/**
 * Where each layer is in its cycle, and where the sway is, as fractions.
 *
 * Modulo is taken here in double precision, which is the point: a timestamp
 * does not fit in a single-precision uniform at the resolution a streak needs.
 *
 * @param {number} t milliseconds since the epoch
 * @param {string} kind
 * @returns {{ fall: [number, number, number], sway: number }}
 */
export function phases(t, kind) {
  const seconds = t / 1000;
  const rates = kind === "snow" ? FALL_RATES.snow : FALL_RATES.rain;

  /** @param {number} cycles */
  const wrap = (cycles) => cycles - Math.floor(cycles);

  return {
    fall: [wrap(seconds * rates[0]), wrap(seconds * rates[1]), wrap(seconds * rates[2])],
    sway: wrap(seconds * SWAY_RATE)
  };
}

/**
 * How much the fall leans, as a horizontal shift per unit of height: positive
 * leans towards the right of the screen as it falls.
 *
 * The wind's component across the view, which is what a person watching would
 * see. A wind from behind or ahead leans nothing; one from the side leans most.
 * The same wind that carries the clouds, so rain and clouds agree. Capped, since
 * rain in a real gale still falls mostly down, and snow leans less than rain
 * because it is slower and lighter and is carried by smaller gusts rather than
 * by the mean wind.
 *
 * @param {number} t
 * @param {{ lat: number, lon: number }} place
 * @param {{ cloudDrift: number, cloudWindFrom: number | null, precipitationKind: string }} preset
 * @param {number} bearing degrees clockwise from north, the way the view faces
 * @param {import("./wind.js").WindSeries | null} series
 * @returns {number}
 */
export function slant(t, place, preset, bearing, series) {
  const w = windAt(t, place, preset.cloudDrift, preset.cloudWindFrom, series);

  const b = (bearing * Math.PI) / 180;
  const across = w.east * Math.cos(b) - w.north * Math.sin(b);

  const limit = preset.precipitationKind === "snow" ? 0.25 : 0.4;
  const lean = preset.precipitationKind === "snow" ? 0.5 : 1;

  return Math.max(-limit, Math.min(limit, (across / 70) * lean));
}

/**
 * What the weather contributes to a frame's signature.
 *
 * Fog is still, so its setting is all there is. Precipitation moves, so its
 * phases are in it - which is what makes it redraw every frame while it falls.
 *
 * @param {{ fog: number, precipitation: number, precipitationKind: string, cloudDrift: number, cloudWindFrom: number | null }} preset
 * @param {number} t
 * @param {{ lat: number, lon: number }} place
 * @param {number} bearing
 * @param {import("./wind.js").WindSeries | null} series
 * @returns {number[]}
 */
export function weatherParts(preset, t, place, bearing, series) {
  if (!weatherVisible(preset)) return [];

  const parts = [Math.round(preset.fog * 1000), Math.round(preset.precipitation * 1000)];
  if (preset.precipitation <= 0.005) return parts;

  const p = phases(t, preset.precipitationKind);
  parts.push(
    kindIndex(preset.precipitationKind),
    Math.round(p.fall[0] * PHASE_STEPS),
    Math.round(p.fall[1] * PHASE_STEPS),
    Math.round(p.fall[2] * PHASE_STEPS),
    Math.round(p.sway * PHASE_STEPS),
    Math.round(slant(t, place, preset, bearing, series) * 100)
  );
  return parts;
}
