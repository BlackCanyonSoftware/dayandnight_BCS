import test from "node:test";
import assert from "node:assert/strict";

import { moonEcliptic, moonPosition } from "../../app/engine/astro/lunar.js";
import { nutation } from "../../app/engine/astro/coords.js";

/**
 * As with the solar tests: the first group checks the transcription against
 * Meeus's worked example, and the rest assert physical facts about the Moon's
 * orbit that a mis-copied coefficient table would get wrong.
 *
 * The orbit is the thing being checked, not the table. A single wrong digit in
 * one of the sixty periodic terms would still pass a "longitude is between 0
 * and 360" test and still look plausible on screen; it would not survive the
 * synodic month, the distance range and the phase-cycle tests together.
 */

const DENVER = { lat: 39.74, lon: -104.99 };
const TROMSO = { lat: 69.65, lon: 18.96 };
const SINGAPORE = { lat: 1.35, lon: 103.82 };

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

test("Meeus example 47.a: the Moon on 1992 April 12.0 TD", () => {
  const T = -0.077221081451;
  const moon = moonEcliptic(T);

  // The example gives the geometric longitude; this implementation returns
  // the apparent one, so nutation is taken back off to compare.
  close(moon.longitude - nutation(T).longitude, 133.162655, 0.0005, "geometric longitude");
  close(moon.latitude, -3.229126, 0.0005, "ecliptic latitude");
  close(moon.distance, 368409.7, 1, "distance in km");
});

test("a solar eclipse falls on a computed new moon", () => {
  // The strongest independent check available without an ephemeris table: a
  // solar eclipse happens when the Moon passes in front of the Sun, so the
  // published date of one is a new moon, fixed by observation rather than by
  // the theory this implements.
  //
  // Two from 2026: the annular eclipse of 17 February and the total eclipse
  // of 12 August that crosses Iceland and Spain. Greatest eclipse and exact
  // conjunction in longitude are not the same instant - they differ by a few
  // minutes - so the window is generous about the time and strict about the
  // illumination.
  for (const [iso, name] of [
    ["2026-02-17T12:12:00Z", "the annular eclipse of February 2026"],
    ["2026-08-12T17:46:00Z", "the total eclipse of August 2026"]
  ]) {
    const eclipse = at(iso);
    const moon = moonPosition(eclipse, { lat: 0, lon: 0 });

    assert.ok(
      moon.illumination < 0.002,
      `${name}: the Moon should be essentially unlit, got ${(moon.illumination * 100).toFixed(3)} per cent`
    );

    // Phase 0 is new; it wraps, so either end of the range counts.
    assert.ok(
      moon.phase < 0.005 || moon.phase > 0.995,
      `${name}: expected a new moon, got phase ${moon.phase.toFixed(4)}`
    );
  }
});

test("the synodic month averages 29.53 days over a decade", () => {
  // The mean has to be taken over many years, not a few months. The length of
  // an individual synodic month swings by about half a day either side of the
  // mean - because both the lunar and the solar orbits are elliptical - and
  // that swing has a period longer than a year, so a twelve-month window
  // samples a biased slice of it rather than averaging it out.
  //
  // This was originally written over one year and failed by about forty
  // minutes. The arithmetic was right and the test was wrong, which is worth
  // recording: over a decade it converges to within seconds of the true value.
  const start = Date.UTC(2020, 0, 1);
  /** @type {number[]} */
  const newMoons = [];

  let previous = moonPosition(start, DENVER).phase;
  for (let hour = 1; hour < 24 * 365 * 10; hour += 1) {
    const t = start + hour * 3_600_000;
    const phase = moonPosition(t, DENVER).phase;
    // The phase runs 0..1 and wraps once a month; a wrap is a new moon.
    if (phase < previous - 0.5) newMoons.push(t);
    previous = phase;
  }

  assert.ok(
    newMoons.length > 120,
    `expected over 120 new moons in a decade, got ${newMoons.length}`
  );

  const span = (newMoons[newMoons.length - 1] - newMoons[0]) / 86_400_000;
  const mean = span / (newMoons.length - 1);
  close(mean, 29.530588, 0.002, "the mean synodic month");

  // And the real swing is present rather than averaged away by a bug.
  const gaps = [];
  for (let i = 1; i < newMoons.length; i += 1) {
    gaps.push((newMoons[i] - newMoons[i - 1]) / 86_400_000);
  }
  const shortest = Math.min(...gaps);
  const longest = Math.max(...gaps);

  for (const gap of gaps) {
    assert.ok(gap > 29.1 && gap < 30.0, `an individual month of ${gap.toFixed(3)} days is wrong`);
  }
  assert.ok(
    longest - shortest > 0.4,
    `the length of the month should visibly vary, got a spread of ${(longest - shortest).toFixed(3)} days`
  );
});

test("the Moon is new when it is dark and full when it is lit", () => {
  // Ties the phase to the illumination, which are computed by different
  // routes - the phase from the elongation in ecliptic longitude, the
  // illumination from the phase angle in equatorial coordinates. If either
  // were wrong they would stop agreeing.
  const start = at("2026-01-01T00:00:00Z");

  let darkest = { phase: 0, illumination: Infinity };
  let brightest = { phase: 0, illumination: -Infinity };

  for (let hour = 0; hour < 24 * 40; hour += 1) {
    const moon = moonPosition(start + hour * 3_600_000, DENVER);
    if (moon.illumination < darkest.illumination) darkest = moon;
    if (moon.illumination > brightest.illumination) brightest = moon;
  }

  assert.ok(darkest.illumination < 0.01, `the new moon was ${darkest.illumination.toFixed(4)} lit`);
  assert.ok(
    brightest.illumination > 0.99,
    `the full moon was ${brightest.illumination.toFixed(4)} lit`
  );

  // The phase runs 0 at new and 0.5 at full.
  assert.ok(
    darkest.phase < 0.02 || darkest.phase > 0.98,
    `the darkest moon should be at phase 0, got ${darkest.phase.toFixed(4)}`
  );
  close(brightest.phase, 0.5, 0.02, "the phase of the full moon");
});

test("the quarters are half lit, and waxing is distinguished from waning", () => {
  const start = at("2026-01-01T00:00:00Z");

  /** @type {{ phase: number, illumination: number, waxing: boolean }[]} */
  const quarters = [];
  for (let hour = 0; hour < 24 * 40; hour += 1) {
    const moon = moonPosition(start + hour * 3_600_000, DENVER);
    if (Math.abs(moon.phase - 0.25) < 0.002 || Math.abs(moon.phase - 0.75) < 0.002) {
      quarters.push(moon);
    }
  }

  assert.ok(quarters.length >= 2, "a 40-day window should contain both quarters");

  for (const quarter of quarters) {
    // Half lit at both quarters: this is exactly why the illuminated fraction
    // alone cannot tell the renderer which way the crescent faces.
    close(quarter.illumination, 0.5, 0.02, `illumination at phase ${quarter.phase.toFixed(3)}`);
    assert.equal(
      quarter.waxing,
      quarter.phase < 0.5,
      `phase ${quarter.phase.toFixed(3)} should be ${quarter.phase < 0.5 ? "waxing" : "waning"}`
    );
  }
});

test("the distance stays within the real perigee and apogee", () => {
  // The Moon's orbit runs between about 356,400 and 406,700 km. A wrong
  // coefficient in the distance table shows up here immediately.
  let closest = Infinity;
  let farthest = -Infinity;

  const start = at("2026-01-01T00:00:00Z");
  for (let hour = 0; hour < 24 * 365; hour += 3) {
    const { distance } = moonPosition(start + hour * 3_600_000, DENVER);
    closest = Math.min(closest, distance);
    farthest = Math.max(farthest, distance);
  }

  assert.ok(
    closest > 356_000 && closest < 362_000,
    `perigee over a year was ${closest.toFixed(0)} km`
  );
  assert.ok(
    farthest > 404_000 && farthest < 407_000,
    `apogee over a year was ${farthest.toFixed(0)} km`
  );
});

test("the Moon moves about 13 degrees a day against the stars", () => {
  const T0 = 0.26;
  const a = moonEcliptic(T0);
  const b = moonEcliptic(T0 + 1 / 36525);

  let moved = b.longitude - a.longitude;
  if (moved < 0) moved += 360;

  // It varies between about 11.8 and 15.4 degrees a day because the orbit is
  // elliptical; the mean is 13.176.
  assert.ok(moved > 11 && moved < 16, `the Moon moved ${moved.toFixed(2)} degrees in a day`);
});

test("the ecliptic latitude stays within the orbit's inclination", () => {
  // The Moon's orbit is tilted about 5.145 degrees to the ecliptic, and the
  // tilt of the orbital plane itself wobbles by about 0.15 degrees.
  let extreme = 0;
  const start = at("2026-01-01T00:00:00Z");
  for (let hour = 0; hour < 24 * 365 * 2; hour += 6) {
    const { latitude } = moonEcliptic(
      (start + hour * 3_600_000 - Date.UTC(2000, 0, 1, 12)) / (86_400_000 * 36525)
    );
    extreme = Math.max(extreme, Math.abs(latitude));
  }

  assert.ok(
    extreme > 4.9 && extreme < 5.4,
    `the extreme latitude was ${extreme.toFixed(3)} degrees`
  );
});

test("the crescent leans differently at different latitudes (US-004)", () => {
  // The lit side always faces the Sun, but how that looks on screen depends on
  // where the observer stands: a crescent that sits upright like a bowl near
  // the equator lies on its side further north. This is the part users notice
  // without being able to name, and it comes from the parallactic angle.
  const t = at("2026-04-20T02:00:00Z");

  const tropical = moonPosition(t, SINGAPORE);
  const arctic = moonPosition(t, TROMSO);

  // Same moon, same instant: the sky-frame angle of the bright limb is a
  // geocentric quantity and barely differs.
  close(tropical.brightLimbAngle, arctic.brightLimbAngle, 2, "the bright limb in the sky frame");

  // But what the observer sees is rotated, and by a lot.
  assert.ok(
    Math.abs(tropical.tilt - arctic.tilt) > 10,
    `the on-screen tilt should differ markedly between latitudes, got ${tropical.tilt.toFixed(1)} and ${arctic.tilt.toFixed(1)}`
  );

  // And the illumination, which is geocentric, must not differ.
  close(tropical.illumination, arctic.illumination, 0.001, "illumination is the same everywhere");
});

test("altitude, azimuth and illumination stay in range everywhere", () => {
  for (const place of [DENVER, TROMSO, SINGAPORE, { lat: -89.9, lon: 0 }]) {
    for (let day = 0; day < 365; day += 13) {
      for (let hour = 0; hour < 24; hour += 3) {
        const t = at("2026-01-01T00:00:00Z") + day * 86_400_000 + hour * 3_600_000;
        const moon = moonPosition(t, place);

        assert.ok(Number.isFinite(moon.altitude), "altitude is finite");
        assert.ok(moon.altitude >= -91 && moon.altitude <= 91, `altitude ${moon.altitude}`);
        assert.ok(moon.azimuth >= 0 && moon.azimuth <= 360, `azimuth ${moon.azimuth}`);
        assert.ok(
          moon.illumination >= 0 && moon.illumination <= 1,
          `illumination ${moon.illumination}`
        );
        assert.ok(moon.phase >= 0 && moon.phase <= 1, `phase ${moon.phase}`);
        assert.ok(Number.isFinite(moon.tilt), "tilt is finite");
      }
    }
  }
});

test("identical arguments give an identical answer (architecture invariant 1)", () => {
  const t = at("2026-06-21T18:00:00Z");
  assert.deepEqual(moonPosition(t, DENVER), moonPosition(t, DENVER));
});
