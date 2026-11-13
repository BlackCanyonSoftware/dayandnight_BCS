import test from "node:test";
import assert from "node:assert/strict";

import { LAYERS, driftCells, layerDisplacementKm } from "../../app/engine/sky/clouds.js";
import {
  makeWindSeries,
  prevailingEast,
  windAt,
  windIntegralKm
} from "../../app/engine/sky/wind.js";

/**
 * The wind. A simulation, so there is no truth to compare it against; what can
 * be checked is that it is internally consistent (the position really is the
 * integral of the velocity), that it behaves the way weather does (changes from
 * day to day, blows from the west in the mid-latitudes), and that it is the
 * same everywhere it is asked.
 */

const DENVER = { lat: 39.74, lon: -104.99 };
const SYDNEY = { lat: -33.87, lon: 151.21 };
const QUITO = { lat: -0.18, lon: -78.47 };
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

test("the position is the integral of the velocity", () => {
  // The claim the whole design rests on: that the closed-form position is the
  // exact antiderivative of the closed-form velocity, not a neighbour of it
  // with a sign wrong somewhere. Differentiate it numerically and compare, over two seconds either side:
  // the quickest term has a period of 17 minutes, and over a longer step the
  // numerical derivative of that term alone is off by about a thousandth of a
  // kilometre an hour, which is the instrument and not the algebra.
  const dt = 2_000;

  for (const place of [DENVER, SYDNEY, QUITO]) {
    for (const from of [null, 270, 45]) {
      for (let k = 0; k < 40; k += 1) {
        const t = Date.UTC(2026, 2, 3) + k * 7.3 * HOUR + 913;

        const a = windIntegralKm(t - dt, place, 17, from);
        const b = windIntegralKm(t + dt, place, 17, from);
        const velocity = windAt(t, place, 17, from);

        // km over (2 * dt) milliseconds -> km/h
        const east = ((b.east - a.east) / (2 * dt)) * HOUR;
        const north = ((b.north - a.north) / (2 * dt)) * HOUR;

        assert.ok(
          Math.abs(east - velocity.east) < 2e-4 && Math.abs(north - velocity.north) < 2e-4,
          `at ${place.lat},${place.lon} from ${from}: the integral moves at ` +
            `(${east.toFixed(4)}, ${north.toFixed(4)}) but the velocity is ` +
            `(${velocity.east.toFixed(4)}, ${velocity.north.toFixed(4)})`
        );
      }
    }
  }
});

test("it is the same everywhere it is asked, because it is a function of the clock and the place", () => {
  const t = Date.UTC(2026, 7, 9, 13, 30);
  assert.deepEqual(windAt(t, DENVER, 12, null), windAt(t, DENVER, 12, null));
  assert.deepEqual(windIntegralKm(t, DENVER, 12, null), windIntegralKm(t, DENVER, 12, null));

  // And a different place has a different sky of weather.
  assert.notDeepEqual(windAt(t, DENVER, 12, null), windAt(t, SYDNEY, 12, null));
});

test("a place nudged by a few hundredths of a degree keeps its weather", () => {
  // The phases come from the place snapped to half a degree, so a nudge that
  // stays inside one cell changes nothing about when the weather turns. The
  // prevailing wind follows the latitude continuously, so it is close, not
  // identical. (A nudge that crosses a cell boundary is a different place, by
  // design: 39.74 snaps one way and 39.78 the other.)
  const t = Date.UTC(2026, 4, 1, 9);
  const here = windAt(t, DENVER, 12, null);
  const near = windAt(t, { lat: DENVER.lat - 0.03, lon: DENVER.lon - 0.03 }, 12, null);
  assert.ok(Math.abs(here.east - near.east) < 0.2 && Math.abs(here.north - near.north) < 1e-9);
});

test("the weather changes from day to day, in direction and in speed", () => {
  // The point of it. Sampled at the same hour on thirty days.
  const speeds = [];
  const bearings = [];

  for (let day = 0; day < 30; day += 1) {
    const w = windAt(Date.UTC(2026, 5, 1 + day, 18), DENVER, 12, null);
    speeds.push(w.kmh);
    bearings.push(w.fromDegrees);
  }

  const fastest = Math.max(...speeds);
  const slowest = Math.min(...speeds);
  assert.ok(
    fastest / Math.max(slowest, 0.1) > 3,
    `speed barely varies: ${slowest.toFixed(1)} to ${fastest.toFixed(1)} km/h`
  );

  // Directions: how many different eighths of the compass it blows from.
  const eighths = new Set(bearings.map((b) => Math.round(b / 45) % 8));
  assert.ok(eighths.size >= 5, `it only ever blew from ${eighths.size} of eight directions`);
});

test("it blows from the west in the mid-latitudes on average, and from the east in the tropics", () => {
  // The prevailing wind, which is what the weather is a departure from. Averaged
  // over ninety days at hourly samples, where the turning terms cancel.
  const mean = (place) => {
    let east = 0;
    let n = 0;
    for (let h = 0; h < 90 * 24; h += 1) {
      east += windAt(Date.UTC(2026, 0, 1) + h * HOUR, place, 12, null).east;
      n += 1;
    }
    return east / n;
  };

  assert.ok(
    mean(DENVER) > 4,
    `Denver's mean wind toward the east was ${mean(DENVER).toFixed(1)} km/h; it should be a westerly`
  );
  assert.ok(mean(SYDNEY) > 4, "the southern mid-latitudes are westerly too");
  assert.ok(
    mean(QUITO) < -4,
    `at the equator the mean wind toward the east was ${mean(QUITO).toFixed(1)}; it should be an easterly`
  );
});

test("the prevailing belts are the right way round, and joined smoothly", () => {
  assert.ok(prevailingEast(0) < 0 && prevailingEast(15) < 0, "easterlies in the tropics");
  assert.ok(prevailingEast(45) > 0 && prevailingEast(55) > 0, "westerlies in the mid-latitudes");
  assert.ok(prevailingEast(85) < 0, "easterlies again at the pole");

  // No cliffs: a degree of latitude never changes it by much.
  for (let lat = 0; lat < 90; lat += 1) {
    assert.ok(
      Math.abs(prevailingEast(lat + 1) - prevailingEast(lat)) < 0.25,
      `a cliff at ${lat} degrees`
    );
  }
  assert.equal(prevailingEast(-45), prevailingEast(45), "symmetric about the equator");
});

test("a fixed direction blows from exactly there, at exactly the typical speed, for good", () => {
  for (const from of [0, 90, 180, 270, 135]) {
    for (const t of [Date.UTC(2026, 0, 1), Date.UTC(2031, 6, 9, 5)]) {
      const w = windAt(t, DENVER, 20, from);
      assert.ok(Math.abs(w.kmh - 20) < 1e-9, `a speed of ${w.kmh}`);

      // Compare as bearings on a circle, so 0 and 360 are the same.
      const off = Math.abs(((w.fromDegrees - from + 540) % 360) - 180);
      assert.ok(off < 1e-9, `blowing from ${w.fromDegrees} instead of ${from}`);
    }
  }
});

test("blowing from the west carries a cloud toward the east", () => {
  const t = Date.UTC(2026, 3, 1);
  const a = windIntegralKm(t, DENVER, 10, 270);
  const b = windIntegralKm(t + HOUR, DENVER, 10, 270);

  assert.ok(Math.abs(b.east - a.east - 10) < 1e-9, "ten kilometres east in an hour");
  assert.ok(Math.abs(b.north - a.north) < 1e-9, "and none north");
});

test("no wind, no drift", () => {
  const t = Date.UTC(2026, 3, 1);
  for (const from of [null, 90]) {
    const a = layerDisplacementKm(t, DENVER, { cloudDrift: 0, cloudWindFrom: from }, 1);
    const b = layerDisplacementKm(t + 5 * DAY, DENVER, { cloudDrift: 0, cloudWindFrom: from }, 1);
    assert.equal(a.east, b.east);
    assert.equal(a.north, b.north);
  }
});

test("twice the typical speed carries a cloud twice as far", () => {
  const t0 = Date.UTC(2026, 3, 1);
  const t1 = t0 + 9 * HOUR;
  const travel = (speed) => {
    const a = layerDisplacementKm(t0, DENVER, { cloudDrift: speed, cloudWindFrom: null }, 1);
    const b = layerDisplacementKm(t1, DENVER, { cloudDrift: speed, cloudWindFrom: null }, 1);
    return Math.hypot(b.east - a.east, b.north - a.north);
  };
  assert.ok(Math.abs(travel(24) / travel(12) - 2) < 1e-9);
});

test("the wind turns with height, clockwise in the north and the other way in the south", () => {
  // From the west, every layer blows toward the east, and the veer turns that
  // toward the south-east (clockwise from above) in the northern hemisphere.
  const t = Date.UTC(2026, 3, 1);
  const preset = { cloudDrift: 10, cloudWindFrom: 270 };

  /** The bearing a layer's clouds travel TOWARD. */
  const heading = (place, layer) => {
    const a = layerDisplacementKm(t, place, preset, layer);
    const b = layerDisplacementKm(t + HOUR, place, preset, layer);
    const east = b.east - a.east;
    const north = b.north - a.north;
    return ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
  };

  const highest = 0;
  const lowest = LAYERS.length - 1;

  assert.ok(
    heading(DENVER, highest) > heading(DENVER, lowest),
    "in the north, higher is more clockwise"
  );
  assert.ok(
    Math.abs(heading(DENVER, lowest) - 90) < 1e-9,
    "the lowest layer has no veer, so it heads due east"
  );

  assert.ok(
    heading(SYDNEY, highest) < heading(SYDNEY, lowest),
    "in the south, higher is less clockwise"
  );
});

test("every layer's drift stays inside the period whichever way the wind blows", () => {
  for (const from of [0, 37, 90, 180, 271, null]) {
    for (let day = 0; day < 40; day += 1) {
      const t = Date.UTC(2026, 0, 1) + day * 11.3 * HOUR;
      for (let layer = 0; layer < LAYERS.length; layer += 1) {
        const [x, z] = driftCells(
          t,
          DENVER,
          { cloudDrift: 30, cloudWindFrom: from, cloudScale: 2 },
          layer
        );
        assert.ok(x >= 0 && x < 256 && z >= 0 && z < 256, `(${x}, ${z}) out of range`);
      }
    }
  }
});

// ---------------------------------------------------------------- a real wind

/** A made-up but wiggly series: a sample every hour for two days. */
function wigglySeries(start = Date.UTC(2026, 5, 1)) {
  const samples = [];
  for (let h = 0; h <= 48; h += 1) {
    samples.push({
      t: start + h * HOUR,
      east: 14 + 9 * Math.sin(h * 0.61) - 4 * Math.cos(h * 0.23),
      north: -6 + 7 * Math.cos(h * 0.47) + 3 * Math.sin(h * 1.1)
    });
  }
  return { start, samples, series: makeWindSeries(samples) };
}

test("inside a series, the position is the integral of the velocity it gives", () => {
  // The same claim as for the simulation, for the piecewise-linear velocity: a
  // quadratic inside each segment and a prefix sum between them, and it is easy
  // to get a half or a segment wrong in either.
  const { start, series } = wigglySeries();
  assert.ok(series, "the series should be usable");

  const dt = 2_000;
  for (let k = 0; k < 60; k += 1) {
    // Thirty seconds past a minute, so that no instant is within the two-second
    // window of an hourly sample: across one the velocity has a kink and a
    // central difference is not exact there, which is the instrument again.
    const t = start + (5 + k * 47) * 60_000 + 30_000;
    if (t + dt > start + 48 * HOUR) break;

    const a = windIntegralKm(t - dt, DENVER, 12, null, series);
    const b = windIntegralKm(t + dt, DENVER, 12, null, series);
    const v = windAt(t, DENVER, 12, null, series);

    const east = ((b.east - a.east) / (2 * dt)) * HOUR;
    const north = ((b.north - a.north) / (2 * dt)) * HOUR;

    assert.ok(
      Math.abs(east - v.east) < 1e-6 && Math.abs(north - v.north) < 1e-6,
      `the integral moves at (${east}, ${north}) but the velocity is (${v.east}, ${v.north})`
    );
  }
});

test("a constant series carries a cloud exactly as far as the speed says", () => {
  const start = Date.UTC(2026, 5, 1);
  const series = makeWindSeries([
    { t: start, east: 20, north: -5 },
    { t: start + 6 * HOUR, east: 20, north: -5 }
  ]);

  const a = windIntegralKm(start + HOUR, DENVER, 12, null, series);
  const b = windIntegralKm(start + 4 * HOUR, DENVER, 12, null, series);

  assert.ok(Math.abs(b.east - a.east - 60) < 1e-9, "three hours at 20 km/h is 60 km east");
  assert.ok(Math.abs(b.north - a.north + 15) < 1e-9, "and 15 km south");
});

test("the slider scales a real wind and leaves its direction alone", () => {
  // The default slider is the data as it is.
  const { start, series } = wigglySeries();
  const t0 = start + 3 * HOUR;
  const t1 = start + 20 * HOUR;

  const travel = (speed) => {
    const a = windIntegralKm(t0, DENVER, speed, null, series);
    const b = windIntegralKm(t1, DENVER, speed, null, series);
    return { east: b.east - a.east, north: b.north - a.north };
  };

  const asGiven = travel(12);
  const doubled = travel(24);
  assert.ok(Math.abs(doubled.east - 2 * asGiven.east) < 1e-9);
  assert.ok(Math.abs(doubled.north - 2 * asGiven.north) < 1e-9);

  // Compared with === and not assert.equal, which tells -0 from 0: a scale of
  // zero times a negative number is -0, and nobody cares.
  const none = travel(0);
  assert.ok(
    none.east === 0 && none.north === 0,
    `no wind moved the clouds by (${none.east}, ${none.north})`
  );
});

test("the position is continuous where the data starts and where it ends", () => {
  const { start, series } = wigglySeries();
  const end = start + 48 * HOUR;

  for (const edge of [start, end]) {
    const before = windIntegralKm(edge - 1, DENVER, 12, null, series);
    const at = windIntegralKm(edge, DENVER, 12, null, series);
    const after = windIntegralKm(edge + 1, DENVER, 12, null, series);

    // A millisecond at twenty or thirty kilometres an hour is under a centimetre.
    assert.ok(
      Math.abs(at.east - before.east) < 1e-5 && Math.abs(after.east - at.east) < 1e-5,
      "east jumped"
    );
    assert.ok(
      Math.abs(at.north - before.north) < 1e-5 && Math.abs(after.north - at.north) < 1e-5,
      "north jumped"
    );
  }
});

test("outside the data the weather carries on, moving as the simulation moves", () => {
  // Not "stops" and not "jumps": a screen with no data for this date gets the
  // clouds it always had, from where the data left them.
  const { start, series } = wigglySeries();
  const end = start + 48 * HOUR;

  const later = (t) => windIntegralKm(t, DENVER, 12, null, series);
  const sim = (t) => windIntegralKm(t, DENVER, 12, null, null);

  for (const hours of [1, 9, 50, 400]) {
    const t = end + hours * HOUR;
    const movedReal = {
      east: later(t).east - later(end).east,
      north: later(t).north - later(end).north
    };
    const movedSim = { east: sim(t).east - sim(end).east, north: sim(t).north - sim(end).north };
    assert.ok(
      Math.abs(movedReal.east - movedSim.east) < 1e-6 &&
        Math.abs(movedReal.north - movedSim.north) < 1e-6
    );
  }

  // And before the data starts, the same.
  for (const hours of [1, 30, 300]) {
    const t = start - hours * HOUR;
    const movedReal = {
      east: later(start).east - later(t).east,
      north: later(start).north - later(t).north
    };
    const movedSim = {
      east: sim(start).east - sim(t).east,
      north: sim(start).north - sim(t).north
    };
    assert.ok(
      Math.abs(movedReal.east - movedSim.east) < 1e-6 &&
        Math.abs(movedReal.north - movedSim.north) < 1e-6
    );
  }
});

test("a fixed direction ignores a real wind, because the owner said where it blows from", () => {
  const { start, series } = wigglySeries();
  const t = start + 10 * HOUR;
  assert.deepEqual(windAt(t, DENVER, 12, 90, series), windAt(t, DENVER, 12, 90, null));
  assert.deepEqual(
    windIntegralKm(t, DENVER, 12, 90, series),
    windIntegralKm(t, DENVER, 12, 90, null)
  );
});

test("a series that is not usable is refused, not repaired", () => {
  const t = Date.UTC(2026, 5, 1);
  assert.equal(makeWindSeries([]), null, "empty");
  assert.equal(makeWindSeries([{ t, east: 1, north: 1 }]), null, "one sample is no series");
  assert.equal(makeWindSeries(null), null);
  assert.equal(
    makeWindSeries([
      { t: t + HOUR, east: 1, north: 1 },
      { t, east: 1, north: 1 }
    ]),
    null,
    "out of order"
  );
  assert.equal(
    makeWindSeries([
      { t, east: 1, north: 1 },
      { t, east: 2, north: 2 }
    ]),
    null,
    "a repeated instant"
  );
  assert.equal(
    makeWindSeries([
      { t, east: 1, north: 1 },
      { t: t + HOUR, east: NaN, north: 1 }
    ]),
    null,
    "a missing number"
  );
});
