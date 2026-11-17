import test from "node:test";
import assert from "node:assert/strict";

import {
  conditionsAt,
  effectivePreset,
  makeConditions,
  precipitationIntensity
} from "../../app/engine/sky/conditions.js";
import { defaultPreset } from "../../app/engine/defaults.js";
import { frameSignature } from "../../app/engine/signature.js";
import windSource from "../../desktop/wind-source.js";

const { parseConditions, precipitationIntensity: sourceIntensity } = windSource;

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 10, 17, 12);

const sample = (hours, over = {}) => ({
  t: T0 + hours * HOUR,
  cloud: 0.5,
  precip: 0,
  snow: 0,
  fog: 0,
  ...over
});

/** Shaped like MET Norway's compact response: what is read, and nothing more. */
function forecast(steps) {
  return { properties: { timeseries: steps } };
}

const step = (hours, details, next = {}) => ({
  time: new Date(T0 + hours * HOUR).toISOString(),
  data: { instant: { details }, ...next }
});

test("the values between two hours are the line between them", () => {
  const series = makeConditions([
    sample(0, { cloud: 0.2, precip: 0, fog: 0 }),
    sample(2, { cloud: 0.8, precip: 0.6, fog: 0.4 })
  ]);

  const half = conditionsAt(series, T0 + HOUR);
  assert.ok(Math.abs(half.cloud - 0.5) < 1e-12);
  assert.ok(Math.abs(half.precip - 0.3) < 1e-12);
  assert.ok(Math.abs(half.fog - 0.2) < 1e-12);

  const at = conditionsAt(series, T0);
  assert.equal(at.cloud, 0.2);
  assert.equal(conditionsAt(series, T0 + 2 * HOUR).cloud, 0.8);
});

test("it is believed a little past its ends and not beyond them", () => {
  const series = makeConditions([sample(0, { cloud: 0.3 }), sample(3, { cloud: 0.9 })]);

  assert.equal(conditionsAt(series, T0 - 0.5 * HOUR).cloud, 0.3, "just before: the first value");
  assert.equal(conditionsAt(series, T0 + 3.5 * HOUR).cloud, 0.9, "just after: the last");

  assert.equal(conditionsAt(series, T0 - 2 * HOUR), null, "long before there is nothing to follow");
  assert.equal(
    conditionsAt(series, T0 + 10 * HOUR),
    null,
    "a stale forecast does not hold the sky"
  );
  assert.equal(conditionsAt(null, T0), null);
});

test("an unusable series is refused, not repaired", () => {
  assert.equal(makeConditions([]), null);
  assert.equal(makeConditions([sample(0)]), null, "one hour is not a series");
  assert.equal(makeConditions([sample(1), sample(0)]), null, "out of order");
  assert.equal(makeConditions([sample(0), sample(0)]), null, "a repeated time");
  assert.equal(makeConditions([sample(0), sample(1, { cloud: NaN })]), null);
  assert.equal(makeConditions(/** @type {any} */ (null)), null);
});

test("values are kept inside zero and one", () => {
  const series = makeConditions([sample(0, { cloud: -3, precip: 9 }), sample(1, { fog: 2 })]);
  const a = conditionsAt(series, T0);
  assert.equal(a.cloud, 0);
  assert.equal(a.precip, 1);
  assert.equal(conditionsAt(series, T0 + HOUR).fog, 1);
});

test("the forecast stands in for four settings and leaves everything else alone", () => {
  const own = { ...defaultPreset(), cloudCover: 0.1, saturation: 1.4, turbidity: 3 };
  const series = makeConditions([
    sample(0, { cloud: 0.9, precip: 0.7, snow: 1, fog: 0.3 }),
    sample(1, { cloud: 0.9, precip: 0.7, snow: 1, fog: 0.3 })
  ]);

  const followed = effectivePreset(own, series, T0 + 0.5 * HOUR);
  assert.equal(followed.cloudCover, 0.9);
  assert.equal(followed.precipitation, 0.7);
  assert.equal(followed.precipitationKind, "snow");
  assert.equal(followed.fog, 0.3);

  // The look the user made is the user's.
  assert.equal(followed.saturation, 1.4);
  assert.equal(followed.turbidity, 3);
  assert.equal(own.cloudCover, 0.1, "and their own preset was not touched");
});

test("with nothing to follow it is the very same preset, which keeps a dry day exact", () => {
  const own = defaultPreset();
  assert.equal(effectivePreset(own, null, T0), own);
  assert.equal(effectivePreset(own, undefined, T0), own);

  const series = makeConditions([sample(0), sample(1)]);
  assert.equal(effectivePreset(own, series, T0 + 30 * HOUR), own);
});

test("whether it falls as rain or snow is whichever is nearer", () => {
  const series = makeConditions([
    sample(0, { snow: 0, precip: 0.5 }),
    sample(2, { snow: 1, precip: 0.5 })
  ]);
  const kind = (h) => effectivePreset(defaultPreset(), series, T0 + h * HOUR).precipitationKind;
  assert.equal(kind(0.2), "rain");
  assert.equal(kind(1.8), "snow");
});

test("how hard a rainfall looks: nothing below a trace, saturating above", () => {
  assert.equal(precipitationIntensity(0), 0);
  assert.equal(precipitationIntensity(0.04), 0, "a trace is not rain");
  assert.ok(
    precipitationIntensity(0.2) > 0 && precipitationIntensity(0.2) < 0.15,
    "a drizzle is light"
  );
  assert.ok(precipitationIntensity(2.5) > 0.55 && precipitationIntensity(2.5) < 0.7, "steady");
  assert.ok(precipitationIntensity(10) > 0.95, "heavy is nearly all of it");

  let previous = 0;
  for (let mm = 0.1; mm <= 30; mm += 0.1) {
    const v = precipitationIntensity(mm);
    assert.ok(v >= previous && v <= 1, `not monotonic at ${mm}`);
    previous = v;
  }

  // The desktop's copy of the curve is the engine's, since one is CommonJS and
  // cannot import the other.
  for (const mm of [0, 0.04, 0.1, 0.5, 1, 2.5, 6, 12, 40]) {
    assert.equal(sourceIntensity(mm), precipitationIntensity(mm), `at ${mm} mm`);
  }
});

test("the forecast is read for cloud, rain, snow and fog", () => {
  const samples = parseConditions(
    forecast([
      step(0, { cloud_area_fraction: 100, air_temperature: 8 }),
      step(
        1,
        { cloud_area_fraction: 40, air_temperature: 8 },
        {
          next_1_hours: { summary: { symbol_code: "rain" }, details: { precipitation_amount: 2.5 } }
        }
      ),
      step(
        2,
        { cloud_area_fraction: 95, air_temperature: -2 },
        {
          next_1_hours: {
            summary: { symbol_code: "heavysnow" },
            details: { precipitation_amount: 3 }
          }
        }
      ),
      step(
        3,
        { cloud_area_fraction: 10 },
        { next_1_hours: { summary: { symbol_code: "fog" }, details: { precipitation_amount: 0 } } }
      ),
      step(
        4,
        { cloud_area_fraction: 70, air_temperature: -1 },
        {
          next_6_hours: { summary: { symbol_code: "cloudy" }, details: { precipitation_amount: 3 } }
        }
      )
    ])
  );

  assert.equal(samples.length, 5);

  assert.equal(samples[0].cloud, 1);
  assert.equal(samples[0].precip, 0);

  assert.equal(samples[1].cloud, 0.4);
  assert.ok(Math.abs(samples[1].precip - precipitationIntensity(2.5)) < 1e-12);
  assert.equal(samples[1].snow, 0, "rain at eight degrees is rain");

  assert.equal(samples[2].snow, 1, "a snow symbol is snow");

  assert.ok(samples[3].fog > 0.4, "a fog symbol is fog");
  assert.equal(samples[3].precip, 0);

  // Only a six-hour amount: a sixth of it an hour. And rain below freezing falls
  // as snow whatever the symbol says.
  assert.ok(Math.abs(samples[4].precip - precipitationIntensity(0.5)) < 1e-12);
  assert.equal(samples[4].snow, 1);

  assert.ok(makeConditions(samples), "and what is read is accepted by the engine");
});

test("a step without a cloud cover is skipped, and the order is kept", () => {
  const samples = parseConditions(
    forecast([
      step(0, { cloud_area_fraction: 50 }),
      step(1, { air_temperature: 3 }),
      step(2, { cloud_area_fraction: "lots" }),
      { time: "not a time", data: { instant: { details: { cloud_area_fraction: 50 } } } },
      step(2, { cloud_area_fraction: 60 }),
      step(2, { cloud_area_fraction: 70 }),
      step(1.5, { cloud_area_fraction: 80 })
    ])
  );

  assert.deepEqual(
    samples.map((s) => s.t),
    [T0, T0 + 2 * HOUR]
  );

  for (const nonsense of [null, undefined, {}, [], "x", { properties: {} }]) {
    assert.deepEqual(parseConditions(nonsense), []);
  }
});

test("the weather the engine follows is in the frame's signature", () => {
  const request = (conditions) => ({
    t: T0 + 0.5 * HOUR,
    place: { lat: 39.7, lon: -105 },
    crop: { x: 0, y: 0, w: 1920, h: 1080 },
    span: { w: 1920, h: 1080 },
    pixelRatio: 1,
    conditions
  });

  const sig = (conditions) =>
    frameSignature(
      effectivePreset(defaultPreset(), conditions, T0 + 0.5 * HOUR),
      request(conditions),
      1920,
      1080
    );

  const clear = makeConditions([sample(0, { cloud: 0 }), sample(1, { cloud: 0 })]);
  const grey = makeConditions([sample(0, { cloud: 0.9 }), sample(1, { cloud: 0.9 })]);
  const wet = makeConditions([
    sample(0, { cloud: 0.9, precip: 0.6 }),
    sample(1, { cloud: 0.9, precip: 0.6 })
  ]);

  assert.notEqual(sig(clear), sig(grey));
  assert.notEqual(sig(grey), sig(wet));
  assert.equal(sig(null), sig(undefined));
});
