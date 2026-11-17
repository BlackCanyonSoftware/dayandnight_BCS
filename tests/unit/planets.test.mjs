import test from "node:test";
import assert from "node:assert/strict";

import { PLANETS, planetPositions } from "../../app/engine/astro/planets.js";

/**
 * The planets, checked against things that can be checked without a licensed
 * table: one worked example published in a textbook, and the events everybody
 * agrees on - oppositions, greatest elongations - which pin both the constants
 * and the geometry. The method is the JPL approximate one and is good to a few
 * arcminutes, so the tolerances are a tenth of a degree for a position and a few
 * days for an event.
 */

const at = (iso) => new Date(iso).getTime();
const planet = (id, t) => planetPositions(t).find((p) => p.id === id);

/** The shortest angle between two longitudes, degrees. */
const apart = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

test("there are five planets, in the order they are drawn", () => {
  assert.deepEqual([...PLANETS], ["mercury", "venus", "mars", "jupiter", "saturn"]);
  assert.equal(planetPositions(at("2026-11-17T00:00:00Z")).length, 5);
});

test("Venus on 20 December 1992 is where Meeus says it is, to a tenth of a degree", () => {
  // Astronomical Algorithms, example 33.a: apparent right ascension 21h 04m
  // 41.454s and declination -18 degrees 53 minutes 16.84 seconds, at a distance
  // of 0.910845 AU. The book's time is dynamical, about a minute from UT, which
  // Venus covers in a thousandth of a degree.
  const venus = planet("venus", at("1992-12-20T00:00:00Z"));

  const ra = (21 + 4 / 60 + 41.454 / 3600) * 15;
  const dec = -(18 + 53 / 60 + 16.84 / 3600);

  assert.ok(apart(venus.rightAscension, ra) < 0.1, `RA ${venus.rightAscension} against ${ra}`);
  assert.ok(Math.abs(venus.declination - dec) < 0.1, `Dec ${venus.declination} against ${dec}`);
  assert.ok(Math.abs(venus.distance - 0.910845) < 0.002, `distance ${venus.distance}`);
});

test("the outer planets are at opposition when they are supposed to be", () => {
  // Opposition is when the planet is opposite the sun: an elongation near 180
  // degrees, the planet at its nearest and brightest. Dates from the almanac.
  const events = [
    ["mars", "2025-01-16T00:00:00Z"],
    ["jupiter", "2024-12-07T00:00:00Z"],
    ["saturn", "2025-09-21T00:00:00Z"]
  ];

  for (const [id, iso] of events) {
    const p = planet(id, at(iso));
    assert.ok(p.elongation > 175, `${id} at ${iso}: elongation ${p.elongation.toFixed(1)}`);
  }

  // And a few months either side it is not.
  assert.ok(planet("mars", at("2025-07-16T00:00:00Z")).elongation < 120);
});

test("their distances at the best oppositions are the known ones", () => {
  // Mars at the 2025 opposition: 0.64 AU. Saturn at the 2025 one: 8.6. Jupiter at
  // its closest approach in 59 years, on 26 September 2022: 3.95 AU, which is
  // the figure that was in the news.
  assert.ok(Math.abs(planet("mars", at("2025-01-16T00:00:00Z")).distance - 0.64) < 0.03);
  assert.ok(Math.abs(planet("saturn", at("2025-09-21T00:00:00Z")).distance - 8.6) < 0.15);
  assert.ok(Math.abs(planet("jupiter", at("2022-09-26T12:00:00Z")).distance - 3.95) < 0.03);
});

test("Venus is at its greatest elongation and its inferior conjunction on the right days", () => {
  // Greatest western elongation 1 June 2025, 46 degrees; inferior conjunction 23
  // March 2025, when it is lost in the sun's glare.
  const greatest = planet("venus", at("2025-06-01T00:00:00Z"));
  assert.ok(greatest.elongation > 44 && greatest.elongation < 48, `${greatest.elongation}`);

  const conjunction = planet("venus", at("2025-03-23T00:00:00Z"));
  assert.ok(conjunction.elongation < 10, `${conjunction.elongation}`);
  assert.ok(conjunction.phaseAngle > 160, "a thin crescent, almost between us and the sun");
});

test("the inner planets never wander far from the sun, over fifty years", () => {
  let mercury = 0;
  let venus = 0;

  for (let day = 0; day < 50 * 365; day += 3) {
    const t = at("2000-01-01T00:00:00Z") + day * 86_400_000;
    const sightings = planetPositions(t);
    mercury = Math.max(mercury, sightings[0].elongation);
    venus = Math.max(venus, sightings[1].elongation);
  }

  // Mercury's greatest elongation is between 18 and 28 degrees, Venus's about 47.
  assert.ok(mercury > 25 && mercury < 29, `Mercury reached ${mercury.toFixed(1)}`);
  assert.ok(venus > 44 && venus < 48.5, `Venus reached ${venus.toFixed(1)}`);
});

test("brightness: Venus is the brightest, Mars swells and fades, Jupiter outshines Saturn", () => {
  const now = planetPositions(at("2026-11-17T00:00:00Z"));
  const mag = (id) => now.find((p) => p.id === id).magnitude;

  for (const id of PLANETS) {
    const m = mag(id);
    assert.ok(m > -5 && m < 3, `${id} ${m}`);
  }
  assert.ok(mag("jupiter") < mag("saturn"), "Jupiter is the brighter");

  // Mars at opposition against Mars on the far side of the sun.
  const near = planet("mars", at("2025-01-16T00:00:00Z")).magnitude;
  const far = planet("mars", at("2025-12-01T00:00:00Z")).magnitude;
  assert.ok(near < -1, `Mars at opposition: ${near}`);
  assert.ok(far > 0.8, `Mars near conjunction: ${far}`);

  // Venus is brightest as a crescent between its conjunction and greatest
  // elongation, not at either: at 36 degrees past inferior conjunction it is
  // near -4.7, and it is fainter both right at conjunction and when full.
  const venusGlare = Math.min(
    ...Array.from(
      { length: 120 },
      (_, d) => planet("venus", at("2025-04-01T00:00:00Z") + d * 86_400_000).magnitude
    )
  );
  assert.ok(venusGlare < -4.2 && venusGlare > -5, `Venus's brightest: ${venusGlare}`);
});

test("positions are valid numbers over the whole supported range, and pure", () => {
  for (let year = 1900; year <= 2100; year += 7) {
    const t = Date.UTC(year, 5, 15);
    const a = planetPositions(t);
    const b = planetPositions(t);
    assert.deepEqual(a, b);

    for (const p of a) {
      assert.ok(p.rightAscension >= 0 && p.rightAscension < 360, `${year} ${p.id} RA`);
      assert.ok(
        p.declination >= -30 && p.declination <= 30,
        `${year} ${p.id} Dec ${p.declination}`
      );
      assert.ok(Number.isFinite(p.magnitude), `${year} ${p.id} magnitude`);
      assert.ok(p.distance > 0.2 && p.distance < 11, `${year} ${p.id} distance`);
    }
  }
});

test("they stay near the ecliptic, as planets do", () => {
  // Every planet is within a few degrees of the ecliptic, so its declination is
  // never beyond the obliquity plus a few degrees: a wrong rotation shows up
  // here at once.
  for (let day = 0; day < 4000; day += 20) {
    for (const p of planetPositions(at("2020-01-01T00:00:00Z") + day * 86_400_000)) {
      assert.ok(Math.abs(p.declination) < 28.5, `${p.id} reached declination ${p.declination}`);
    }
  }
});
