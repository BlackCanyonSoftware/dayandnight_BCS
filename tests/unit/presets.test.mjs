import test from "node:test";
import assert from "node:assert/strict";

import { LOOKS, lookIdFor, presetFor } from "../../app/ui/presets.js";
import { defaultPreset } from "../../app/engine/defaults.js";
import { readDocument, writeDocument } from "../../app/ui/settings.js";

/**
 * A preset is a complete appearance and nothing else. The checks that matter
 * are that each shipped look is *valid* - every key present, every value in
 * range - and that none of them quietly carries a place or a frame rate with
 * it, which would mean switching looks moved somebody's sky to another
 * country.
 */

test("every look is a complete, valid preset", () => {
  for (const look of LOOKS) {
    const preset = presetFor(look.id);
    assert.ok(preset, `${look.id} should resolve`);

    // Every key the defaults have, and no others: a look that was missing a
    // key would inherit it silently, and one with a spare key would be
    // carrying a setting that no longer exists.
    assert.deepEqual(
      Object.keys(preset).sort(),
      Object.keys(defaultPreset()).sort(),
      `${look.id} has the wrong set of keys`
    );

    for (const [key, value] of Object.entries(preset)) {
      if (typeof value === "number") {
        assert.ok(Number.isFinite(value), `${look.id}.${key} is ${value}`);
      }
    }
  }
});

test("every look survives being saved and loaded", () => {
  // Settings normalisation clamps and validates, so a look with a value
  // outside the allowed range would come back altered - and the preset list
  // would then show Custom immediately after the user chose it.
  for (const look of LOOKS) {
    const preset = presetFor(look.id);
    assert.ok(preset);

    const { doc, problem } = readDocument(
      writeDocument(
        { preset, place: { lat: 39.7, lon: -105 }, fps: 20, theme: "dark" },
        Date.UTC(2026, 0, 1)
      )
    );

    assert.equal(problem, null, `${look.id} should save cleanly`);
    assert.ok(doc);
    assert.deepEqual(doc.cfg.preset, preset, `${look.id} came back changed`);
  }
});

test("a look is recognised again after a round trip", () => {
  // The panel works out which look is showing by comparison rather than by
  // remembering, so this is what keeps the name in the list rather than
  // "Custom" the instant a preset is chosen.
  for (const look of LOOKS) {
    const preset = presetFor(look.id);
    assert.ok(preset);
    assert.equal(lookIdFor(preset), look.id, `${look.id} should be recognised`);
  }
});

test("an edited preset is Custom, and editing back restores the name", () => {
  const quiet = presetFor("quiet");
  assert.ok(quiet);

  assert.equal(lookIdFor({ ...quiet, saturation: quiet.saturation + 0.3 }), null);
  assert.equal(lookIdFor({ ...quiet, nightTint: "#112233" }), null);

  // And back again.
  assert.equal(lookIdFor({ ...quiet }), "quiet");
});

test("a value a slider can represent still matches its look", () => {
  // A step-0.1 control writes back 3.2000000000000006 for 3.2, and a strict
  // comparison would make a look appear edited the moment it was applied.
  const cinematic = presetFor("cinematic");
  assert.ok(cinematic);

  const nudged = { ...cinematic, bodyScale: cinematic.bodyScale + 1e-12 };
  assert.equal(lookIdFor(nudged), "cinematic");
});

test("Clear is exactly the defaults", () => {
  // The one to judge the others against, so it has to be the physics and
  // nothing else.
  assert.deepEqual(presetFor("clear"), defaultPreset());
});

test("the looks are actually different from one another", () => {
  const seen = new Map();
  for (const look of LOOKS) {
    const key = JSON.stringify(presetFor(look.id));
    assert.ok(!seen.has(key), `${look.id} is identical to ${seen.get(key)}`);
    seen.set(key, look.id);
  }
});

test("every look has a name and a hint that says something", () => {
  const ids = new Set();
  for (const look of LOOKS) {
    assert.ok(!ids.has(look.id), `${look.id} appears twice`);
    ids.add(look.id);

    assert.ok(look.name.length > 0, `${look.id} needs a name`);
    assert.ok(
      look.hint.length > 60,
      `${look.id} needs a hint that says why you would pick it, not just what it is called`
    );
  }
});

test("an unknown look resolves to nothing rather than to the defaults", () => {
  assert.equal(presetFor("no-such-look"), null);
});
