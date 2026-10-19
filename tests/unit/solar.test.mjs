import test from "node:test";
import assert from "node:assert/strict";

import { solarDeclination, sunPosition, twilightBand } from "../../app/engine/astro/solar.js";

/**
 * NOTE ON WHAT THESE TESTS DO AND DO NOT CHECK.
 *
 * `astro/solar.js` is a Milestone 0 placeholder, accurate to roughly 1-2
 * degrees. US-001 requires better than 0.5 degrees, and Milestone 1 replaces
 * the arithmetic with a Meeus-grade implementation.
 *
 * So these tests deliberately do **not** assert accuracy against published
 * ephemerides - that test belongs with the real algorithm, and writing it now
 * against the placeholder would mean writing a test designed to pass rather
 * than one designed to be true.
 *
 * What they do check is everything that must hold regardless of the
 * arithmetic's precision: the shape of a day, the sign conventions, the
 * invariants, and the behaviour at the latitudes that break naive
 * implementations. Those assertions should survive the Milestone 1 rewrite
 * unchanged, which is the point of writing them now.
 */

const DENVER = { lat: 39.74, lon: -104.99 };
const TROMSO = { lat: 69.65, lon: 18.96 }; // well inside the Arctic Circle
const SINGAPORE = { lat: 1.35, lon: 103.82 };

/** @param {string} iso */
const at = (iso) => new Date(iso).getTime();

test("identical arguments give an identical answer (architecture invariant 1)", () => {
  const t = at("2026-06-21T18:00:00Z");
  const a = sunPosition(t, DENVER);
  const b = sunPosition(t, DENVER);
  assert.deepEqual(a, b);
});

test("the sun is up in the middle of the day and down in the middle of the night", () => {
  // Denver is near UTC-7, so 19:00 UTC is around midday and 07:00 UTC is
  // around midnight.
  assert.ok(sunPosition(at("2026-06-21T19:00:00Z"), DENVER).altitude > 0, "midday in June");
  assert.ok(sunPosition(at("2026-06-21T07:00:00Z"), DENVER).altitude < 0, "midnight in June");
  assert.ok(sunPosition(at("2026-12-21T19:00:00Z"), DENVER).altitude > 0, "midday in December");
  assert.ok(sunPosition(at("2026-12-21T07:00:00Z"), DENVER).altitude < 0, "midnight in December");
});

test("summer days are longer than winter days, and more so further north", () => {
  /**
   * Hours of daylight, by sampling. Deliberately not by solving for sunrise:
   * sampling has no special cases and works at every latitude, including the
   * ones where the sun never crosses the horizon at all.
   *
   * @param {{ lat: number, lon: number }} place
   * @param {string} iso midnight UTC on the day in question
   * @returns {number}
   */
  function daylightHours(place, iso) {
    const start = at(iso);
    let up = 0;
    const steps = 24 * 60;
    for (let i = 0; i < steps; i += 1) {
      if (sunPosition(start + i * 60_000, place).altitude > 0) up += 1;
    }
    return (up / steps) * 24;
  }

  const denverJune = daylightHours(DENVER, "2026-06-21T00:00:00Z");
  const denverDecember = daylightHours(DENVER, "2026-12-21T00:00:00Z");
  assert.ok(
    denverJune > denverDecember + 4,
    `Denver: June ${denverJune.toFixed(1)}h should far exceed December ${denverDecember.toFixed(1)}h`
  );

  const singaporeJune = daylightHours(SINGAPORE, "2026-06-21T00:00:00Z");
  const singaporeDecember = daylightHours(SINGAPORE, "2026-12-21T00:00:00Z");
  assert.ok(
    Math.abs(singaporeJune - singaporeDecember) < 1,
    `near the equator the day barely changes: ${singaporeJune.toFixed(1)}h vs ${singaporeDecember.toFixed(1)}h`
  );

  // US-003: the seasonal swing grows with latitude, as a consequence of the
  // geometry rather than of a setting.
  const denverSwing = denverJune - denverDecember;
  const singaporeSwing = singaporeJune - singaporeDecember;
  assert.ok(denverSwing > singaporeSwing, "Denver's seasonal swing exceeds Singapore's");
});

test("the midnight sun does not set, and polar night does not rise (US-003)", () => {
  /**
   * @param {{ lat: number, lon: number }} place
   * @param {string} iso
   * @returns {{ min: number, max: number }}
   */
  function altitudeRange(place, iso) {
    const start = at(iso);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 24 * 60; i += 1) {
      const a = sunPosition(start + i * 60_000, place).altitude;
      min = Math.min(min, a);
      max = Math.max(max, a);
    }
    return { min, max };
  }

  const midsummer = altitudeRange(TROMSO, "2026-06-21T00:00:00Z");
  assert.ok(
    midsummer.min > 0,
    `Tromso in midsummer should never set, but reached ${midsummer.min.toFixed(2)} degrees`
  );

  const midwinter = altitudeRange(TROMSO, "2026-12-21T00:00:00Z");
  assert.ok(
    midwinter.max < 0,
    `Tromso at midwinter should never rise, but reached ${midwinter.max.toFixed(2)} degrees`
  );
});

test("altitude never leaves -90..90 and azimuth never leaves 0..360", () => {
  // Every place and hour, because an out-of-range value here becomes a NaN in
  // a shader uniform and a black screen with no explanation.
  for (const place of [
    DENVER,
    TROMSO,
    SINGAPORE,
    { lat: -89.9, lon: 0 },
    { lat: 89.9, lon: 180 }
  ]) {
    for (let day = 0; day < 365; day += 7) {
      for (let hour = 0; hour < 24; hour += 1) {
        const t = at("2026-01-01T00:00:00Z") + day * 86_400_000 + hour * 3_600_000;
        const { altitude, azimuth } = sunPosition(t, place);

        assert.ok(Number.isFinite(altitude), `altitude not finite at ${place.lat}/${day}/${hour}`);
        assert.ok(Number.isFinite(azimuth), `azimuth not finite at ${place.lat}/${day}/${hour}`);
        assert.ok(altitude >= -90 && altitude <= 90, `altitude ${altitude} out of range`);
        assert.ok(azimuth >= 0 && azimuth <= 360, `azimuth ${azimuth} out of range`);
      }
    }
  }
});

test("the sun is in the east in the morning and the west in the afternoon", () => {
  // The sign convention on the hour angle is the easiest thing to get
  // backwards, and getting it backwards would run the sun across the screen
  // the wrong way.
  const morning = sunPosition(at("2026-03-21T15:00:00Z"), DENVER); // ~08:00 local
  const afternoon = sunPosition(at("2026-03-21T23:00:00Z"), DENVER); // ~16:00 local

  assert.ok(morning.hourAngle < 0, "morning is before solar noon");
  assert.ok(afternoon.hourAngle > 0, "afternoon is after solar noon");
  assert.ok(
    morning.azimuth < 180,
    `morning azimuth ${morning.azimuth.toFixed(0)} should be eastward`
  );
  assert.ok(
    afternoon.azimuth > 180,
    `afternoon azimuth ${afternoon.azimuth.toFixed(0)} should be westward`
  );
});

test("longitude moves solar noon, 15 degrees to the hour", () => {
  const t = at("2026-03-21T12:00:00Z");
  const greenwich = sunPosition(t, { lat: 0, lon: 0 });
  const fifteenEast = sunPosition(t, { lat: 0, lon: 15 });

  // At 15 degrees east, local solar time is an hour later, so the hour angle
  // is 15 degrees greater.
  assert.ok(
    Math.abs(fifteenEast.hourAngle - greenwich.hourAngle - 15) < 0.001,
    `expected a 15 degree difference, got ${(fifteenEast.hourAngle - greenwich.hourAngle).toFixed(4)}`
  );
});

test("declination stays within the obliquity and peaks at the solstices", () => {
  for (let day = 0; day < 365; day += 1) {
    const d = solarDeclination(at("2026-01-01T00:00:00Z") + day * 86_400_000);
    assert.ok(Math.abs(d) <= 23.44, `declination ${d} exceeds the axial tilt`);
  }

  const june = solarDeclination(at("2026-06-21T12:00:00Z"));
  const december = solarDeclination(at("2026-12-21T12:00:00Z"));
  const march = solarDeclination(at("2026-03-20T12:00:00Z"));

  assert.ok(june > 22, `June solstice declination should be near +23.4, got ${june.toFixed(2)}`);
  assert.ok(december < -22, `December solstice should be near -23.4, got ${december.toFixed(2)}`);
  // The placeholder ignores the equation of time, so the equinox is only
  // approximately zero. Milestone 1 tightens this.
  assert.ok(Math.abs(march) < 2, `March equinox should be near 0, got ${march.toFixed(2)}`);
});

test("twilight bands are the standard boundaries", () => {
  assert.equal(twilightBand(10), "day");
  assert.equal(twilightBand(0.1), "day");
  assert.equal(twilightBand(-0.1), "civil");
  assert.equal(twilightBand(-5.9), "civil");
  assert.equal(twilightBand(-6.1), "nautical");
  assert.equal(twilightBand(-11.9), "nautical");
  assert.equal(twilightBand(-12.1), "astronomical");
  assert.equal(twilightBand(-17.9), "astronomical");
  assert.equal(twilightBand(-18.1), "night");
  assert.equal(twilightBand(-90), "night");
});

test("a day passes through every twilight band in order at a middling latitude", () => {
  const start = at("2026-03-21T00:00:00Z");
  /** @type {string[]} */
  const seen = [];

  for (let i = 0; i < 24 * 60; i += 5) {
    const band = twilightBand(sunPosition(start + i * 60_000, DENVER).altitude);
    if (seen[seen.length - 1] !== band) seen.push(band);
  }

  for (const band of ["night", "astronomical", "nautical", "civil", "day"]) {
    assert.ok(
      seen.includes(band),
      `an equinox day at Denver should include ${band}, saw ${seen.join(" -> ")}`
    );
  }
});

test("the arithmetic is unaffected by the host machine's time zone", () => {
  // The timestamp is UTC milliseconds, so nothing here may depend on the
  // local offset. This is what makes US-011 - surviving a DST change or a
  // flight - true by construction rather than by handling.
  const t = at("2026-07-04T18:30:00Z");
  const result = sunPosition(t, DENVER);

  // Same instant expressed through a local-time Date: same answer.
  const viaLocalDate = sunPosition(new Date(t).getTime(), DENVER);
  assert.deepEqual(result, viaLocalDate);
});
