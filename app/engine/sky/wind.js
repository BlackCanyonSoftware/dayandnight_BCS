// @ts-check
/**
 * The wind: a pure function of the date and the place, with an exact integral.
 *
 * ## What it is, and what it is not
 *
 * A *simulation*, not a forecast. It makes the wind over a place wander from
 * day to day in direction and in speed - a few days of a westerly, a spell from
 * the south, a calm, a blow - in the way weather does, so that the clouds are
 * not drifting the same way at the same speed on the first of the month and the
 * thirtieth. It does not know what the wind is. When something that does is
 * available, it replaces `windAt` and `windIntegralKm` and nothing downstream
 * changes: the interface is a velocity and its integral, and the rest of the
 * engine neither knows nor cares where they came from.
 *
 * ## Why an integral, and why it is exact
 *
 * A cloud does not sit at `wind * time`; it sits wherever it has been carried,
 * which is the *integral* of the wind from some starting point to now. For a
 * wind that changes that has to be a pure function of the clock (architecture
 * invariant 1: two screens, or the same screen after a six-hour sleep, must
 * agree), so it cannot be accumulated frame by frame. It is built instead from
 * a constant plus a handful of sinusoids, which integrate in closed form. The
 * position at any instant is evaluated directly, with no history, and is the
 * exact antiderivative of the velocity - a test checks that the one is the
 * derivative of the other rather than trusting the algebra.
 *
 * ## What the velocity is made of
 *
 * - **A prevailing wind** from the latitude: easterlies in the tropics,
 *   westerlies in the mid-latitudes, easterlies again near the poles, with the
 *   transitions smoothed so that moving a place by a degree does not flip it.
 * - **Weather systems**: three vectors turning slowly, with periods of about
 *   three, five and seven days that share no common factor, so the sum does not
 *   repeat for a very long time. These are what swing the direction, and what
 *   occasionally beat the prevailing wind altogether, which is what an easterly
 *   spell in the westerlies is.
 * - **A daily cycle**: stronger in the afternoon, when the sun has mixed the
 *   air down, weaker at night.
 * - **Gusts**: two small, quick terms, so that the speed is never perfectly
 *   steady within an hour.
 *
 * Every phase comes from the place, so the weather over Denver is the weather
 * over Denver on every screen and every run, and the weather over Sydney is
 * different.
 *
 * Speeds are relative to a *typical* speed, the preset's `cloudDrift`, so the
 * one setting that has always been "how fast" now means "how windy a place this
 * is", and the wind wanders around it. A fixed direction switches the whole
 * simulation off: the wind then blows from that bearing at exactly that speed.
 *
 * @module engine/sky/wind
 */

const HOUR_MS = 3_600_000;
const TWO_PI = Math.PI * 2;

/** @param {number} a @param {number} b @param {number} x */
function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * How westerly the prevailing wind is at a latitude: +1 blows toward the east
 * (a westerly), -1 toward the west (an easterly).
 *
 * The three belts the real atmosphere has, with smooth joins. The values are
 * the shape of the real thing and not a climatology.
 *
 * @param {number} latitude degrees
 * @returns {number}
 */
export function prevailingEast(latitude) {
  const a = Math.abs(latitude);
  return -1 + 2 * smoothstep(20, 40, a) - 1.5 * smoothstep(60, 75, a);
}

/**
 * A repeatable number in [0, 1) from a place and a small integer.
 *
 * Integer arithmetic throughout, so that it is the same in every JavaScript
 * engine and on every machine. The place is snapped to half a degree first, so
 * that the weather does not change when the coordinates are nudged.
 *
 * @param {number} cellLat
 * @param {number} cellLon
 * @param {number} k
 * @returns {number}
 */
function hash01(cellLat, cellLon, k) {
  let h =
    Math.imul(cellLat | 0, 0x27d4eb2d) ^
    Math.imul(cellLon | 0, 0x165667b1) ^
    Math.imul(k + 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * The turning vectors that are the weather systems: period in days, and the
 * share of the typical speed each carries. Periods chosen to share no common
 * factor.
 */
const SYSTEMS = [
  { days: 2.9, share: 0.55 },
  { days: 4.6, share: 0.45 },
  { days: 7.3, share: 0.35 }
];

/** The daily cycle's share of the typical speed, and the local hour it peaks at. */
const DIURNAL = { share: 0.2, peakHour: 15 };

/** Gusts: period in minutes, and share. Small and quick. */
const GUSTS = [
  { minutes: 17, share: 0.07 },
  { minutes: 41, share: 0.05 }
];

/**
 * @typedef {object} WindParts
 * @property {number} prevailing  toward-east component of the constant wind, in units of the typical speed
 * @property {{ omega: number, phase: number, share: number }[]} systems  omega in radians per hour
 * @property {{ omega: number, phase: number, share: number, ux: number, uy: number }[]} gusts
 * @property {{ omega: number, phase: number, share: number, sign: number }} daily
 */

/**
 * @param {{ lat: number, lon: number }} place
 * @returns {WindParts}
 */
function partsFor(place) {
  const cellLat = Math.round(place.lat * 2);
  const cellLon = Math.round(place.lon * 2);

  const east = prevailingEast(place.lat);

  return {
    prevailing: 0.9 * east,

    systems: SYSTEMS.map((s, i) => ({
      omega: TWO_PI / (s.days * 24),
      phase: TWO_PI * hash01(cellLat, cellLon, i),
      share: s.share
    })),

    gusts: GUSTS.map((g, i) => {
      const angle = TWO_PI * hash01(cellLat, cellLon, 10 + i);
      return {
        omega: TWO_PI / (g.minutes / 60),
        phase: TWO_PI * hash01(cellLat, cellLon, 20 + i),
        share: g.share,
        ux: Math.cos(angle),
        uy: Math.sin(angle)
      };
    }),

    // The afternoon peak is local solar time, so it follows longitude. It
    // blows along the prevailing direction, which is the one the mixed-down
    // momentum comes from.
    daily: {
      omega: TWO_PI / 24,
      phase: -TWO_PI * ((DIURNAL.peakHour - place.lon / 15) / 24),
      share: DIURNAL.share,
      sign: east >= 0 ? 1 : -1
    }
  };
}

/**
 * @typedef {object} Wind
 * @property {number} east   velocity toward the east, km/h
 * @property {number} north  velocity toward the north, km/h
 * @property {number} kmh    the speed
 * @property {number} fromDegrees  the bearing it blows FROM, clockwise from
 *   north - the meteorological convention, in which a westerly is 270
 */

/**
 * The wind at an instant.
 *
 * @param {number} t milliseconds since the epoch
 * @param {{ lat: number, lon: number }} place
 * @param {number} typicalKmh the preset's `cloudDrift`
 * @param {number | null} fromDegrees a fixed bearing it blows from, or null
 *   for the simulated weather
 * @returns {Wind}
 */
export function windAt(t, place, typicalKmh, fromDegrees) {
  let east;
  let north;

  if (fromDegrees !== null) {
    // Blowing FROM a bearing is blowing TOWARD the opposite one.
    const toward = ((fromDegrees + 180) * Math.PI) / 180;
    east = typicalKmh * Math.sin(toward);
    north = typicalKmh * Math.cos(toward);
  } else {
    const hours = t / HOUR_MS;
    const parts = partsFor(place);

    east = parts.prevailing;
    north = 0;

    for (const s of parts.systems) {
      const angle = s.omega * hours + s.phase;
      east += s.share * Math.cos(angle);
      north += s.share * Math.sin(angle);
    }

    east +=
      parts.daily.sign *
      parts.daily.share *
      Math.cos(parts.daily.omega * hours + parts.daily.phase);

    for (const g of parts.gusts) {
      const swing = g.share * Math.cos(g.omega * hours + g.phase);
      east += g.ux * swing;
      north += g.uy * swing;
    }

    east *= typicalKmh;
    north *= typicalKmh;
  }

  return {
    east,
    north,
    kmh: Math.hypot(east, north),
    fromDegrees: ((((Math.atan2(-east, -north) * 180) / Math.PI) % 360) + 360) % 360
  };
}

/**
 * How far a cloud carried by the wind has travelled, in kilometres east and
 * north, measured from an arbitrary fixed origin: the antiderivative of
 * `windAt`'s velocity. Only differences between two instants mean anything.
 *
 * Exact, not summed: see the module comment.
 *
 * @param {number} t milliseconds since the epoch
 * @param {{ lat: number, lon: number }} place
 * @param {number} typicalKmh
 * @param {number | null} fromDegrees
 * @returns {{ east: number, north: number }}
 */
export function windIntegralKm(t, place, typicalKmh, fromDegrees) {
  const hours = t / HOUR_MS;

  if (fromDegrees !== null) {
    const toward = ((fromDegrees + 180) * Math.PI) / 180;
    return {
      east: typicalKmh * Math.sin(toward) * hours,
      north: typicalKmh * Math.cos(toward) * hours
    };
  }

  const parts = partsFor(place);

  let east = parts.prevailing * hours;
  let north = 0;

  // d/dt of (a/omega) sin(omega t + p) is a cos(omega t + p), and of
  // -(a/omega) cos(omega t + p) is a sin(omega t + p): the circular terms.
  for (const s of parts.systems) {
    const angle = s.omega * hours + s.phase;
    east += (s.share / s.omega) * Math.sin(angle);
    north += -(s.share / s.omega) * Math.cos(angle);
  }

  east +=
    ((parts.daily.sign * parts.daily.share) / parts.daily.omega) *
    Math.sin(parts.daily.omega * hours + parts.daily.phase);

  for (const g of parts.gusts) {
    const swing = (g.share / g.omega) * Math.sin(g.omega * hours + g.phase);
    east += g.ux * swing;
    north += g.uy * swing;
  }

  return { east: east * typicalKmh, north: north * typicalKmh };
}
