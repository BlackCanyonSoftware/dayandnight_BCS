import test from "node:test";
import assert from "node:assert/strict";

import { APP, VERSION, readDocument, writeDocument } from "../../app/ui/settings.js";
import { defaultPreset } from "../../app/engine/defaults.js";

const NOW = Date.UTC(2026, 9, 18, 12, 0, 0);

/** @returns {{ preset: import("../../app/engine/types.js").Preset, place: { lat: number, lon: number }, fps: number, awaySeconds: number, theme: "dark" }} */
function state() {
  return {
    // Built from the defaults rather than written out, so a new preset key
    // does not quietly stop being covered here.
    preset: { ...defaultPreset(), exposure: 0.5 },
    place: { lat: 39.7, lon: -105 },
    fps: 20,
    awaySeconds: 600,
    theme: "dark"
  };
}

test("a written document round-trips through the reader unchanged", () => {
  const written = writeDocument(state(), NOW);
  const { doc, problem } = readDocument(written);

  assert.equal(problem, null);
  assert.ok(doc);
  assert.equal(doc.app, APP);
  assert.equal(doc.version, VERSION);
  assert.deepEqual(doc.cfg, state_cfg());
});

/** @returns {{ preset: import("../../app/engine/types.js").Preset, place: { lat: number, lon: number }, fps: number, awaySeconds: number }} */
function state_cfg() {
  const s = state();
  return { preset: s.preset, place: s.place, fps: s.fps, awaySeconds: s.awaySeconds };
}

test("the timestamp comes from the caller, not the clock", () => {
  // So that a test is deterministic and so nothing in the project reads the
  // clock in two different places and disagrees with itself.
  assert.equal(writeDocument(state(), NOW).savedAt, new Date(NOW).toISOString());
});

test("nothing usable gives nothing, without complaining", () => {
  // A missing settings file on first run is the normal case, not a problem to
  // report to the user.
  for (const raw of [null, undefined, 0, "", "nonsense", []]) {
    const { doc, problem } = readDocument(raw);
    assert.equal(doc, null, `${JSON.stringify(raw)} should not produce a document`);
    if (raw !== null && typeof raw === "object") continue;
    assert.equal(problem, null, `${JSON.stringify(raw)} should not produce a complaint`);
  }
});

test("another application's file is refused by name", () => {
  const { doc, problem } = readDocument({ app: "pixel-galaxy-studio", version: 1 });
  assert.equal(doc, null);
  assert.match(problem ?? "", /not a Day and Night settings file/);
});

test("a file from a newer build is refused rather than guessed at", () => {
  // The rule from ARCHITECTURE: a newer application opens every older file, an
  // older application refuses a newer one and says so. Guessing would mean
  // silently dropping settings the user can see in the file.
  const { doc, problem } = readDocument({ ...writeDocument(state(), NOW), version: VERSION + 5 });

  assert.equal(doc, null);
  assert.match(problem ?? "", /newer version/);
  assert.match(problem ?? "", new RegExp(String(VERSION + 5)));
});

test("a file with no version is refused", () => {
  for (const version of [undefined, null, "1", 0, -1, 1.5]) {
    const { doc } = readDocument({ app: APP, version });
    assert.equal(doc, null, `version ${JSON.stringify(version)} should be refused`);
  }
});

test("missing fields fall back to defaults rather than failing the load", () => {
  const { doc, problem } = readDocument({ app: APP, version: 1 });

  assert.equal(problem, null);
  assert.ok(doc);
  assert.equal(doc.cfg.preset.exposure, 0);
  assert.equal(doc.cfg.fps, 20);
  assert.equal(doc.ui.theme, "dark");
  assert.ok(Number.isFinite(doc.cfg.place.lat));
  assert.ok(Number.isFinite(doc.cfg.place.lon));
});

test("out-of-range and non-finite values are clamped, never passed through", () => {
  // This is the security-relevant case: a NaN or an Infinity reaching a shader
  // uniform turns the screen black and gives no clue why, and a settings file
  // is the one piece of outside data the application reads.
  const { doc } = readDocument({
    app: APP,
    version: 1,
    cfg: {
      preset: { exposure: Number.POSITIVE_INFINITY },
      place: { lat: 1000, lon: Number.NaN },
      fps: -50
    },
    ui: { theme: "chartreuse" }
  });

  assert.ok(doc);
  assert.ok(Number.isFinite(doc.cfg.preset.exposure), "exposure is finite");
  assert.ok(doc.cfg.preset.exposure <= 8);
  assert.ok(doc.cfg.place.lat <= 89.9, `latitude clamped, got ${doc.cfg.place.lat}`);
  assert.ok(Number.isFinite(doc.cfg.place.lon), "longitude is finite");
  assert.ok(doc.cfg.fps >= 1, `fps clamped, got ${doc.cfg.fps}`);
  assert.equal(doc.ui.theme, "dark", "an unknown theme falls back");
});

test("latitude stops short of the poles", () => {
  // At exactly 90 the azimuth transform divides by cos(lat), which is zero.
  const { doc } = readDocument({
    app: APP,
    version: 1,
    cfg: { place: { lat: 90, lon: 0 } }
  });

  assert.ok(doc);
  assert.ok(Math.abs(doc.cfg.place.lat) < 90, `got ${doc.cfg.place.lat}`);
});

test("a string where an object belongs does not throw", () => {
  const { doc } = readDocument({ app: APP, version: 1, cfg: "nope", ui: 7 });
  assert.ok(doc, "it should still produce a document from defaults");
  assert.equal(doc.cfg.fps, 20);
});

test("the three valid themes survive a round trip", () => {
  for (const theme of /** @type {const} */ (["light", "dark", "system"])) {
    const { doc } = readDocument(writeDocument({ ...state(), theme }, NOW));
    assert.ok(doc);
    assert.equal(doc.ui.theme, theme);
  }
});
