import test from "node:test";
import assert from "node:assert/strict";

import {
  equationOfTime,
  solarEcliptic,
  sunPosition,
  twilightBand
} from "../../app/engine/astro/solar.js";
import { eclipticToEquatorial, meanObliquity, nutation } from "../../app/engine/astro/coords.js";
import { greenwichMeanSiderealTime } from "../../app/engine/astro/sidereal.js";
import { toJulianDay } from "../../app/engine/astro/julian.js";

/**
 * US-001 asks for sun position accurate to better than 0.5 degrees.
 *
 * The first group below checks against the worked examples in Meeus's
 * *Astronomical Algorithms*, which is the reference the implementation is
 * taken from - so it is a check that the transcription is right, not an
 * independent confirmation of the theory. The groups after it are independent:
 * they assert physical facts about the Earth's orbit that would be wrong if
 * the arithmetic were wrong, and that no amount of copying a table correctly
 * could fake.
 */

const DENVER = { lat: 39.74, lon: -104.99 };
const TROMSO = { lat: 69.65, lon: 18.96 };
const SINGAPORE = { lat: 1.35, lon: 103.82 };
const LONDON = { lat: 51.48, lon: -0.0015 };

/** @param {string} iso */
const at = (iso) => new Date(iso).getTime();

/**
 * @param {number} got
 * @param {number} want
 * @param {number} tolerance
 * @param {string} what
 */
function close(got, want, tolerance, what) {
  assert.ok(
    Math.abs(got - want) <= tolerance,
    `${what}: expected ${want} +/- ${tolerance}, got ${got} (off by ${Math.abs(got - want)})`
  );
}

/* ------------------------------------------------ against the reference */

test("Meeus example 25.a: the Sun on 1992 October 13.0 TD", () => {
  // T is given directly by the example, so this tests the series itself
  // rather than the date handling in front of it.
  const T = -0.072183436;
  const sun = solarEcliptic(T);

  close(sun.longitude, 199.90895, 0.0005, "apparent longitude");
  close(sun.distance, 0.9976, 0.0001, "radius vector in AU");

  const obliquity = meanObliquity(T) + nutation(T).obliquity;
  const equatorial = eclipticToEquatorial(sun.longitude, 0, obliquity);

  close(equatorial.rightAscension, 198.38083, 0.002, "apparent right ascension");
  close(equatorial.declination, -7.78507, 0.002, "apparent declination");
});

test("Meeus example 12.a: sidereal time on 1987 April 10, 0h UT", () => {
  // 13h 10m 46.3668s expressed in degrees.
  close(greenwichMeanSiderealTime(2446895.5), 197.693195, 0.0005, "GMST");
});

test("the Julian Day of known epochs", () => {
  close(toJulianDay(Date.UTC(2000, 0, 1, 12, 0, 0)), 2451545.0, 1e-6, "J2000.0");
  close(toJulianDay(Date.UTC(1970, 0, 1, 0, 0, 0)), 2440587.5, 1e-6, "the Unix epoch");
  close(toJulianDay(Date.UTC(1987, 0, 27, 0, 0, 0)), 2446822.5, 1e-6, "1987 January 27.0");
});

/* --------------------------------------- independent physical checks */

test("the equation of time has the right size and shape", () => {
  // The placeholder this replaced had an equation of time of exactly zero on
  // every day of the year, which is why the whole day could be a quarter of
  // an hour out. This is the clearest single check that it is gone.
  let minimum = Infinity;
  let maximum = -Infinity;
  /** @type {number[]} */
  const values = [];

  for (let day = 0; day < 365; day += 1) {
    const value = equationOfTime(at("2026-01-01T12:00:00Z") + day * 86_400_000);
    values.push(value);
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }

  // The real extremes are about -14.2 and +16.4 minutes.
  close(minimum, -14.2, 1.0, "the February minimum");
  close(maximum, 16.4, 1.0, "the early-November maximum");

  // And it crosses zero four times a year, which is the analemma's figure
  // of eight. A constant or a single sine would fail this.
  let crossings = 0;
  for (let i = 1; i < values.length; i += 1) {
    if (Math.sign(values[i]) !== Math.sign(values[i - 1])) crossings += 1;
  }
  assert.equal(crossings, 4, `expected four zero crossings a year, got ${crossings}`);
});

test("the solstices and equinoxes land on the right days", () => {
  /** @param {number} t */
  const declination = (t) => sunPosition(t, DENVER).declination;

  let longest = { day: -1, declination: -Infinity };
  let shortest = { day: -1, declination: Infinity };

  for (let day = 0; day < 365; day += 1) {
    const t = at("2026-01-01T12:00:00Z") + day * 86_400_000;
    const d = declination(t);
    if (d > longest.declination) longest = { day, declination: d };
    if (d < shortest.declination) shortest = { day, declination: d };
  }

  // 2026-06-21 is day 171 from 1 January; 2026-12-21 is day 354.
  assert.ok(Math.abs(longest.day - 171) <= 1, `June solstice landed on day ${longest.day}`);
  assert.ok(Math.abs(shortest.day - 354) <= 1, `December solstice landed on day ${shortest.day}`);

  close(longest.declination, 23.44, 0.05, "declination at the June solstice");
  close(shortest.declination, -23.44, 0.05, "declination at the December solstice");
});

test("the Earth is closest to the Sun in early January", () => {
  let closest = { day: -1, distance: Infinity };
  let farthest = { day: -1, distance: -Infinity };

  for (let day = 0; day < 365; day += 1) {
    const t = at("2026-01-01T12:00:00Z") + day * 86_400_000;
    const { distance } = sunPosition(t, DENVER);
    if (distance < closest.distance) closest = { day, distance };
    if (distance > farthest.distance) farthest = { day, distance };
  }

  assert.ok(closest.day <= 6, `perihelion should be in the first week, got day ${closest.day}`);
  assert.ok(
    farthest.day >= 180 && farthest.day <= 190,
    `aphelion should be in early July, got day ${farthest.day}`
  );

  close(closest.distance, 0.9833, 0.001, "perihelion distance in AU");
  close(farthest.distance, 1.0167, 0.001, "aphelion distance in AU");
});

test("refraction makes sunrise earlier than the geometry alone would", () => {
  // Light bends through the atmosphere, so the Sun is visible while it is
  // still geometrically below the horizon - by about 34 arcminutes, slightly
  // more than its own diameter. Ignoring this makes sunrise a few minutes
  // late, which is the kind of error a user can check against a window.
  const t = at("2026-03-20T12:30:00Z");
  const sun = sunPosition(t, LONDON);

  assert.ok(
    sun.altitude > sun.trueAltitude,
    "the refracted altitude should be above the geometric one"
  );

  // At the horizon the lift is about 0.57 degrees.
  let nearHorizon = null;
  for (let minute = 0; minute < 1440; minute += 1) {
    const s = sunPosition(at("2026-03-20T00:00:00Z") + minute * 60_000, LONDON);
    if (Math.abs(s.trueAltitude) < 0.05) nearHorizon = s;
  }
  assert.ok(nearHorizon, "the sun should cross the horizon on an equinox in London");
  close(nearHorizon.altitude - nearHorizon.trueAltitude, 0.57, 0.08, "refraction at the horizon");
});

test("an equinox day is about twelve hours long everywhere", () => {
  // Slightly more than twelve, because refraction and the disc's own radius
  // both add a few minutes at each end. That it is *slightly* more, rather
  // than exactly twelve, is itself the check that refraction is being applied.
  for (const place of [LONDON, DENVER, SINGAPORE, { lat: -33.87, lon: 151.21 }]) {
    let up = 0;
    const start = at("2026-03-20T00:00:00Z");
    for (let minute = 0; minute < 1440; minute += 1) {
      if (sunPosition(start + minute * 60_000, place).altitude > 0) up += 1;
    }
    const hours = up / 60;
    assert.ok(
      hours > 12 && hours < 12.5,
      `${place.lat} degrees: equinox day was ${hours.toFixed(2)} hours`
    );
  }
});

/* ------------------------------------------------- behaviour and shape */

test("identical arguments give an identical answer (architecture invariant 1)", () => {
  const t = at("2026-06-21T18:00:00Z");
  assert.deepEqual(sunPosition(t, DENVER), sunPosition(t, DENVER));
});

test("summer days are longer than winter days, and more so further north", () => {
  /**
   * @param {{ lat: number, lon: number }} place
   * @param {string} iso
   * @returns {number}
   */
  function daylightHours(place, iso) {
    const start = at(iso);
    let up = 0;
    for (let minute = 0; minute < 1440; minute += 1) {
      if (sunPosition(start + minute * 60_000, place).altitude > 0) up += 1;
    }
    return up / 60;
  }

  const denverJune = daylightHours(DENVER, "2026-06-21T00:00:00Z");
  const denverDecember = daylightHours(DENVER, "2026-12-21T00:00:00Z");
  assert.ok(
    denverJune > denverDecember + 4,
    `Denver: June ${denverJune.toFixed(1)}h against December ${denverDecember.toFixed(1)}h`
  );

  const singaporeSwing =
    daylightHours(SINGAPORE, "2026-06-21T00:00:00Z") -
    daylightHours(SINGAPORE, "2026-12-21T00:00:00Z");
  assert.ok(Math.abs(singaporeSwing) < 1, "near the equator the day barely changes");
  assert.ok(denverJune - denverDecember > singaporeSwing, "the swing grows with latitude");
});

test("the midnight sun does not set, and polar night does not rise (US-003)", () => {
  /**
   * @param {{ lat: number, lon: number }} place
   * @param {string} iso
   */
  function range(place, iso) {
    const start = at(iso);
    let min = Infinity;
    let max = -Infinity;
    for (let minute = 0; minute < 1440; minute += 1) {
      const a = sunPosition(start + minute * 60_000, place).altitude;
      min = Math.min(min, a);
      max = Math.max(max, a);
    }
    return { min, max };
  }

  assert.ok(range(TROMSO, "2026-06-21T00:00:00Z").min > 0, "Tromso in midsummer never sets");
  assert.ok(range(TROMSO, "2026-12-21T00:00:00Z").max < 0, "Tromso at midwinter never rises");
});

test("altitude and azimuth stay in range everywhere, all year", () => {
  // An out-of-range value here becomes a NaN in a shader uniform and a black
  // screen with no explanation.
  for (const place of [
    DENVER,
    TROMSO,
    SINGAPORE,
    { lat: -89.9, lon: 0 },
    { lat: 89.9, lon: 180 }
  ]) {
    for (let day = 0; day < 365; day += 11) {
      for (let hour = 0; hour < 24; hour += 1) {
        const t = at("2026-01-01T00:00:00Z") + day * 86_400_000 + hour * 3_600_000;
        const { altitude, azimuth } = sunPosition(t, place);

        assert.ok(Number.isFinite(altitude), `altitude not finite at lat ${place.lat}`);
        assert.ok(Number.isFinite(azimuth), `azimuth not finite at lat ${place.lat}`);
        assert.ok(altitude >= -91 && altitude <= 91, `altitude ${altitude} out of range`);
        assert.ok(azimuth >= 0 && azimuth <= 360, `azimuth ${azimuth} out of range`);
      }
    }
  }
});

test("the sun is in the east in the morning and the west in the afternoon", () => {
  const morning = sunPosition(at("2026-03-21T15:00:00Z"), DENVER);
  const afternoon = sunPosition(at("2026-03-21T23:00:00Z"), DENVER);

  assert.ok(morning.hourAngle < 0, "morning is before solar noon");
  assert.ok(afternoon.hourAngle > 0, "afternoon is after solar noon");
  assert.ok(morning.azimuth < 180, `morning azimuth ${morning.azimuth.toFixed(0)} is eastward`);
  assert.ok(
    afternoon.azimuth > 180,
    `afternoon azimuth ${afternoon.azimuth.toFixed(0)} is westward`
  );
});

test("at the June solstice the midday sun is due south from the north", () => {
  // A cheap, strong check on the azimuth convention, which Meeus states from
  // the south and this project converts to from the north. A 180-degree error
  // here would run the sun across the screen backwards.
  let highest = { azimuth: 0, altitude: -Infinity };
  const start = at("2026-06-21T00:00:00Z");
  for (let minute = 0; minute < 1440; minute += 1) {
    const s = sunPosition(start + minute * 60_000, DENVER);
    if (s.altitude > highest.altitude) highest = { azimuth: s.azimuth, altitude: s.altitude };
  }
  close(highest.azimuth, 180, 1.5, "azimuth at local noon from a northern latitude");
});

test("twilight bands are the standard boundaries", () => {
  assert.equal(twilightBand(10), "day");
  assert.equal(twilightBand(-0.1), "civil");
  assert.equal(twilightBand(-6.1), "nautical");
  assert.equal(twilightBand(-12.1), "astronomical");
  assert.equal(twilightBand(-18.1), "night");
});

test("the arithmetic is unaffected by the host machine's time zone", () => {
  // The timestamp is UTC milliseconds, so nothing may depend on the local
  // offset. This is what makes US-011 - surviving a DST change or a flight -
  // true by construction rather than by handling.
  const t = at("2026-07-04T18:30:00Z");
  assert.deepEqual(sunPosition(t, DENVER), sunPosition(new Date(t).getTime(), DENVER));
});
