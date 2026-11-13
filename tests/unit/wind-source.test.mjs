import test from "node:test";
import assert from "node:assert/strict";

import windSource from "../../desktop/wind-source.js";
import { makeWindSeries, windAt } from "../../app/engine/sky/wind.js";

const {
  ATTRIBUTION,
  CONTACT,
  COORDINATE_DECIMALS,
  MIN_INTERVAL_MS,
  SURFACE_TO_CLOUD_LEVEL,
  nextFetchAt,
  parseSamples,
  requestFor,
  truncate
} = windSource;

/**
 * Shaped like MET Norway's documented Locationforecast 2.0 response: a
 * `properties.timeseries` array, each step with a UTC `time` and
 * `data.instant.details` carrying `wind_speed` in m/s and `wind_from_direction`
 * in degrees. Hand-made, so these test the reading and not the weather.
 */
function forecast(steps) {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [-105, 39.7, 1600] },
    properties: { meta: {}, timeseries: steps }
  };
}

const step = (time, speed, from) => ({
  time,
  data: {
    instant: { details: { wind_speed: speed, wind_from_direction: from, air_temperature: 5 } }
  }
});

test("a wind from the west becomes a velocity toward the east, in kilometres an hour", () => {
  const [sample] = parseSamples(forecast([step("2026-11-13T12:00:00Z", 5, 270)]), 1);

  assert.equal(sample.t, Date.UTC(2026, 10, 13, 12));
  assert.ok(
    Math.abs(sample.east - 18) < 1e-9,
    `5 m/s is 18 km/h, and it blows east: ${sample.east}`
  );
  assert.ok(Math.abs(sample.north) < 1e-9);
});

test("from the north blows south, from the south blows north, from the east blows west", () => {
  const read = (from) => parseSamples(forecast([step("2026-11-13T12:00:00Z", 10, from)]), 1)[0];

  assert.ok(read(0).north < -35 && Math.abs(read(0).east) < 1e-9, "a north wind blows south");
  assert.ok(read(180).north > 35, "a south wind blows north");
  assert.ok(read(90).east < -35, "an east wind blows west");
});

test("the ten-metre wind is scaled up to the cloud layers' level", () => {
  const at10 = parseSamples(forecast([step("2026-11-13T12:00:00Z", 4, 270)]), 1)[0];
  const atClouds = parseSamples(forecast([step("2026-11-13T12:00:00Z", 4, 270)]))[0];

  assert.ok(Math.abs(atClouds.east / at10.east - SURFACE_TO_CLOUD_LEVEL) < 1e-9);
});

test("steps without a usable wind are skipped, not invented", () => {
  const samples = parseSamples(
    forecast([
      step("2026-11-13T12:00:00Z", 5, 270),
      { time: "2026-11-13T13:00:00Z", data: { instant: { details: { air_temperature: 4 } } } },
      step("2026-11-13T14:00:00Z", "fast", 270),
      step("not a time", 5, 270),
      { time: "2026-11-13T15:00:00Z" },
      step("2026-11-13T16:00:00Z", 6, 250)
    ]),
    1
  );

  assert.deepEqual(
    samples.map((s) => s.t),
    [Date.UTC(2026, 10, 13, 12), Date.UTC(2026, 10, 13, 16)]
  );
});

test("steps are kept strictly increasing, which is what a series insists on", () => {
  const samples = parseSamples(
    forecast([
      step("2026-11-13T12:00:00Z", 5, 270),
      step("2026-11-13T12:00:00Z", 6, 270),
      step("2026-11-13T11:00:00Z", 7, 270),
      step("2026-11-13T13:00:00Z", 8, 270)
    ]),
    1
  );

  assert.equal(samples.length, 2);
  assert.ok(makeWindSeries(samples), "and the result is something makeWindSeries accepts");
});

test("a response that is not a forecast gives no samples rather than an error", () => {
  for (const nonsense of [
    null,
    undefined,
    {},
    [],
    "text",
    42,
    { properties: {} },
    { properties: { timeseries: "x" } }
  ]) {
    assert.deepEqual(parseSamples(nonsense), []);
  }
});

test("a parsed forecast drives the engine's wind the way it says", () => {
  // The two halves together: 4 m/s from the west at the surface, hourly, for a
  // day, read and handed to the engine as a series.
  const steps = [];
  for (let h = 0; h <= 24; h += 1) {
    steps.push(step(new Date(Date.UTC(2026, 10, 13, h)).toISOString(), 4, 270));
  }

  const series = makeWindSeries(parseSamples(forecast(steps)));
  assert.ok(series);

  const w = windAt(Date.UTC(2026, 10, 13, 6, 30), { lat: 39.7, lon: -105 }, 12, null, series);
  assert.ok(Math.abs(w.fromDegrees - 270) < 1e-6, `blowing from ${w.fromDegrees}`);
  assert.ok(Math.abs(w.kmh - 4 * 3.6 * SURFACE_TO_CLOUD_LEVEL) < 1e-6, `at ${w.kmh} km/h`);
});

test("coordinates are truncated, never rounded, and never to more than the terms allow", () => {
  assert.equal(truncate(39.79), 39.7, "toward zero, so not 39.8");
  assert.equal(truncate(-104.99), -104.9, "toward zero for the west and the south too");
  assert.ok(COORDINATE_DECIMALS <= 4, "MET Norway refuses five decimals and asks for at most four");

  const { url } = requestFor({ lat: 39.74123456, lon: -104.98765432 }, "0.1.0");
  const lat = /lat=(-?\d+(?:\.\d+)?)/.exec(url)?.[1] ?? "";
  const lon = /lon=(-?\d+(?:\.\d+)?)/.exec(url)?.[1] ?? "";

  assert.ok((lat.split(".")[1] ?? "").length <= COORDINATE_DECIMALS, `lat ${lat}`);
  assert.ok((lon.split(".")[1] ?? "").length <= COORDINATE_DECIMALS, `lon ${lon}`);
  assert.equal(lat, "39.7");
  assert.equal(lon, "-104.9");
});

test("the request identifies us and says how to reach us, as the terms require", () => {
  const { url, headers } = requestFor({ lat: 10, lon: 20 }, "1.2.3");

  assert.ok(url.startsWith("https://api.met.no/weatherapi/locationforecast/2.0/"), url);
  assert.ok(headers["User-Agent"].includes("DayAndNight/1.2.3"), headers["User-Agent"]);
  assert.ok(headers["User-Agent"].includes(CONTACT));
  assert.match(CONTACT, /^[^@\s]+@[^@\s]+\.[a-z]+$/i, "a contact that is an address");
});

test("the credit says who, which licence, links to it, and that the data was changed", () => {
  assert.ok(ATTRIBUTION.includes("MET Norway"));
  assert.ok(ATTRIBUTION.includes("CC BY 4.0"));
  assert.ok(ATTRIBUTION.includes("https://creativecommons.org/licenses/by/4.0/"));
  assert.ok(/changed/i.test(ATTRIBUTION), "CC BY asks that changes are indicated");
});

test("it asks again after Expires, never sooner than the minimum, and a little later at random", () => {
  const now = Date.UTC(2026, 10, 13, 12);
  const none = () => 0;
  const all = () => 0.999999;

  // Expires well in the future: that, plus jitter.
  const later = new Date(now + 3 * 3_600_000).toUTCString();
  assert.equal(nextFetchAt({ expires: later }, now, none), now + 3 * 3_600_000);
  assert.ok(nextFetchAt({ expires: later }, now, all) > now + 3 * 3_600_000);

  // Expires already past, or in a minute: the minimum interval, not a hammering.
  const past = new Date(now - 3_600_000).toUTCString();
  assert.equal(nextFetchAt({ expires: past }, now, none), now + MIN_INTERVAL_MS);
  const soon = new Date(now + 60_000).toUTCString();
  assert.equal(nextFetchAt({ expires: soon }, now, none), now + MIN_INTERVAL_MS);

  // Nothing said, or nonsense: an hour.
  assert.equal(nextFetchAt({}, now, none), now + 3_600_000);
  assert.equal(nextFetchAt({ expires: "never" }, now, none), now + 3_600_000);
  assert.equal(nextFetchAt(null, now, none), now + 3_600_000);

  // Fetch API headers, which have .get(), and the capitalised plain-object form.
  assert.equal(nextFetchAt(new Map([["expires", later]]), now, none), now + 3 * 3_600_000);
  assert.equal(nextFetchAt({ Expires: later }, now, none), now + 3 * 3_600_000);
});

test("the jitter is bounded, so a client cannot be told to wait indefinitely", () => {
  const now = Date.UTC(2026, 10, 13, 12);
  const wait = nextFetchAt({}, now, () => 0.999999) - (now + 3_600_000);
  assert.ok(wait >= 0 && wait < 10 * 60_000, `jitter of ${wait} ms`);
});
