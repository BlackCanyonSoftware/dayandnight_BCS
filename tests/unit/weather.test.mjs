import test from "node:test";
import assert from "node:assert/strict";

import {
  CELL_HEIGHT,
  FALL_RATES,
  KINDS,
  PHASE_STEPS,
  isKind,
  kindIndex,
  phases,
  slant,
  weatherParts,
  weatherVisible
} from "../../app/engine/sky/weather.js";
import { defaultPreset } from "../../app/engine/defaults.js";
import { frameSignature } from "../../app/engine/signature.js";
import { readDocument, writeDocument } from "../../app/ui/settings.js";
import { decodeLook, encodeLook } from "../../app/ui/share-code.js";

const DENVER = { lat: 39.74, lon: -104.99 };
const T = Date.UTC(2026, 10, 13, 18);

const base = (over = {}) => ({ ...defaultPreset(), ...over });

test("a dry, clear sky draws no weather at all", () => {
  // The bargain every optional layer makes: a day without weather costs what it
  // did before weather existed.
  assert.equal(weatherVisible(base()), false);
  assert.deepEqual(weatherParts(base(), T, DENVER, 180, null), []);
});

test("fog or precipitation, either, switches it on", () => {
  assert.equal(weatherVisible(base({ fog: 0.3 })), true);
  assert.equal(weatherVisible(base({ precipitation: 0.3 })), true);
  assert.equal(weatherVisible(base({ fog: 0.004, precipitation: 0.004 })), false, "a hair is none");
});

test("kinds are rain and snow, each with a hint, and anything else is rain", () => {
  assert.deepEqual(
    KINDS.map((k) => k.id),
    ["rain", "snow"]
  );
  for (const k of KINDS) assert.ok(k.hint.length > 40, `${k.id} has no real hint`);

  assert.equal(isKind("rain"), true);
  assert.equal(isKind("hail"), false);
  assert.equal(kindIndex("snow"), 1);
  assert.equal(kindIndex("rain"), 0);
  assert.equal(kindIndex("hail"), 0);
});

test("the fall is a pure function of the instant, in fractions of a cycle", () => {
  const a = phases(T, "rain");
  const b = phases(T, "rain");
  assert.deepEqual(a, b);

  for (const v of [...a.fall, a.sway]) assert.ok(v >= 0 && v < 1, `${v} is not a fraction`);

  // Moving on by exactly a cycle of a layer leaves that layer where it was.
  const period = 1000 / FALL_RATES.rain[0];
  const later = phases(T + period, "rain");
  assert.ok(
    Math.abs(later.fall[0] - a.fall[0]) < 1e-6 ||
      Math.abs(Math.abs(later.fall[0] - a.fall[0]) - 1) < 1e-6
  );

  // And it keeps its precision a century from now, which a timestamp in a
  // single-precision uniform would not.
  const far = phases(Date.UTC(2126, 0, 1), "rain");
  for (const v of far.fall) assert.ok(v >= 0 && v < 1);
});

test("nearer layers fall faster in pixels a second, and snow is slower than rain", () => {
  // Speed is cycles a second times the cell's height: the rates alone say
  // nothing, because each layer's cell is a different size.
  const speed = (kind) => FALL_RATES[kind].map((rate, i) => rate * CELL_HEIGHT[kind][i]);

  for (const kind of ["rain", "snow"]) {
    const [far, mid, near] = speed(kind);
    assert.ok(far < mid && mid < near, `${kind}: nearer should be quicker: ${speed(kind)}`);
  }

  assert.ok(
    Math.max(...speed("snow")) < Math.min(...speed("rain")),
    "the quickest flake is slower than the slowest drop"
  );
});

test("rain leans the way the wind carries it across the view, and not along it", () => {
  // A fixed wind from the west blows toward the east. Facing south, east is to
  // the left; facing north, to the right.
  const preset = base({ cloudWindFrom: 270, cloudDrift: 30, precipitationKind: "rain" });

  const south = slant(T, DENVER, preset, 180, null);
  const north = slant(T, DENVER, preset, 0, null);
  assert.ok(south < -0.1, `facing south it should lean left: ${south}`);
  assert.ok(north > 0.1, `facing north it should lean right: ${north}`);

  // Facing east the same wind is straight behind the viewer: no lean.
  assert.ok(Math.abs(slant(T, DENVER, preset, 90, null)) < 1e-9);
});

test("the lean is capped, and snow leans less than rain", () => {
  const gale = base({ cloudWindFrom: 270, cloudDrift: 120 });
  assert.ok(
    Math.abs(slant(T, DENVER, { ...gale, precipitationKind: "rain" }, 0, null)) <= 0.4 + 1e-9
  );
  assert.ok(
    Math.abs(slant(T, DENVER, { ...gale, precipitationKind: "snow" }, 0, null)) <= 0.25 + 1e-9
  );

  const breeze = base({ cloudWindFrom: 270, cloudDrift: 20 });
  const rain = slant(T, DENVER, { ...breeze, precipitationKind: "rain" }, 0, null);
  const snow = slant(T, DENVER, { ...breeze, precipitationKind: "snow" }, 0, null);
  assert.ok(Math.abs(snow) < Math.abs(rain));
});

test("fog alone is still, so it costs no redraws; rain moves, so it costs every frame", () => {
  const request = (t) => ({
    t,
    place: DENVER,
    crop: { x: 0, y: 0, w: 1920, h: 1080 },
    span: { w: 1920, h: 1080 },
    pixelRatio: 1
  });
  const sig = (preset, t) => frameSignature(preset, request(t), 1920, 1080);

  const fog = base({ fog: 0.5 });
  assert.equal(sig(fog, T), sig(fog, T + 50), "fog does not change a frame by itself");

  const rain = base({ precipitation: 0.6 });
  assert.notEqual(sig(rain, T), sig(rain, T + 50), "rain has moved in fifty milliseconds");

  // And it is the same twice, which is what lets the host skip a frame it has.
  assert.equal(sig(rain, T), sig(rain, T));

  // Fog and rain differ from a dry day, and from each other.
  assert.notEqual(sig(base(), T), sig(fog, T));
  assert.notEqual(sig(fog, T), sig(rain, T));
});

test("the motion is quantised to about a pixel, so nothing redraws for nothing", () => {
  // A step is a cell's height over the number of steps: the most a layer moves
  // between two signatures that differ. About a pixel is invisible; many would
  // be a frame skipped that should not have been.
  for (const kind of ["rain", "snow"]) {
    for (const height of CELL_HEIGHT[kind]) {
      const pixelsPerStep = height / PHASE_STEPS;
      assert.ok(pixelsPerStep <= 1.6, `${kind}: ${pixelsPerStep} px a step`);
    }
  }

  // And the same instant is the same signature part, so a frame can be skipped.
  const parts = (t) => weatherParts(base({ precipitation: 0.5 }), t, DENVER, 180, null);
  assert.deepEqual(parts(T), parts(T));
});

test("the new settings are saved and read back, and bad ones are put right", () => {
  const preset = base({ fog: 0.4, precipitation: 0.7, precipitationKind: "snow" });
  const written = writeDocument(
    { preset, place: DENVER, fps: 20, awaySeconds: 600, wallpaperOn: false, theme: "dark" },
    0
  );
  const { doc } = readDocument(written);
  assert.equal(doc?.cfg.preset.fog, 0.4);
  assert.equal(doc?.cfg.preset.precipitation, 0.7);
  assert.equal(doc?.cfg.preset.precipitationKind, "snow");

  const bad = JSON.parse(JSON.stringify(written));
  bad.cfg.preset.fog = 9;
  bad.cfg.preset.precipitation = -3;
  bad.cfg.preset.precipitationKind = "hail";
  const fixed = readDocument(bad).doc?.cfg.preset;
  assert.equal(fixed?.fog, 1, "clamped");
  assert.equal(fixed?.precipitation, 0, "clamped");
  assert.equal(fixed?.precipitationKind, "rain", "an unknown word is the default, not a guess");

  // A file from before weather existed takes the defaults, which are dry.
  const old = JSON.parse(JSON.stringify(written));
  delete old.cfg.preset.fog;
  delete old.cfg.preset.precipitation;
  delete old.cfg.preset.precipitationKind;
  const dry = readDocument(old).doc?.cfg.preset;
  assert.equal(dry?.fog, 0);
  assert.equal(dry?.precipitation, 0);
});

test("a share code carries the weather", async () => {
  const preset = base({ fog: 0.35, precipitation: 0.5, precipitationKind: "snow" });
  const code = await encodeLook(preset);
  const back = await decodeLook(code);
  assert.equal(back.problem, null);
  assert.equal(back.preset?.fog, 0.35);
  assert.equal(back.preset?.precipitation, 0.5);
  assert.equal(back.preset?.precipitationKind, "snow");
});
