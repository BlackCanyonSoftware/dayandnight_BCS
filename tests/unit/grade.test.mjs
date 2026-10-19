import test from "node:test";
import assert from "node:assert/strict";

import { tintFor } from "../../app/engine/sky/grade.js";
import { defaultPreset } from "../../app/engine/defaults.js";

/**
 * The grade sits on top of a sky that is already physically correct, so the
 * property that matters most is that it can be *absent*: a default preset has
 * to leave the model untouched, or the physics is not what anyone is actually
 * looking at.
 */

/** @param {Partial<import("../../app/engine/types.js").Preset>} patch */
const preset = (patch = {}) => ({ ...defaultPreset(), ...patch });

/**
 * @param {number} got
 * @param {number} want
 * @param {number} tolerance
 * @param {string} what
 */
function close(got, want, tolerance, what) {
  assert.ok(
    Math.abs(got - want) <= tolerance,
    `${what}: expected ${want} +/- ${tolerance}, got ${got}`
  );
}

test("the default grade is exactly neutral", () => {
  // If this drifts, every preset quietly inherits a colour cast and the
  // scattering model stops being what is on screen.
  for (const altitude of [-20, -6, 0, 10, 45, 80]) {
    const tint = tintFor(preset(), altitude);
    for (const channel of tint) {
      close(channel, 1, 1e-6, `tint at sun altitude ${altitude}`);
    }
  }
});

test("any neutral grey is neutral, whatever its lightness", () => {
  // The stops are a colour cast, not an exposure control: a dark grey must
  // not darken the sky, because that is what the exposure slider is for.
  for (const grey of ["#202020", "#808080", "#d8d8d8"]) {
    const tint = tintFor(preset({ dayTint: grey, twilightTint: grey, nightTint: grey }), 12);
    for (const channel of tint) close(channel, 1, 1e-6, `tint from ${grey}`);
  }
});

test("a tint is keyed to the sun's altitude, not applied everywhere", () => {
  // The whole point of the ramp: warm the hour either side of the horizon
  // without touching the middle of the day.
  const warmTwilight = preset({ twilightTint: "#ff9040" });

  const atTwilight = tintFor(warmTwilight, 0);
  assert.ok(atTwilight[0] > atTwilight[2] * 1.5, "twilight should come out warm");

  const atNoon = tintFor(warmTwilight, 45);
  for (const channel of atNoon) {
    close(channel, 1, 0.02, "the middle of the day should be untouched");
  }

  const atNight = tintFor(warmTwilight, -20);
  for (const channel of atNight) {
    close(channel, 1, 0.02, "the middle of the night should be untouched");
  }
});

test("the ramp moves smoothly between its stops", () => {
  // A step in the tint would be a band sweeping across the wallpaper as the
  // sun moved, which is exactly what NFR-3 forbids.
  // Smoothness, not a rate limit. With strongly contrasting stops the ramp
  // legitimately moves a long way over the fourteen degrees between them, and
  // bounding the step size just measures how different the two colours are.
  // A discontinuity is a spike in the *second* difference, which is what this
  // looks for - the same measure the atmosphere's continuity test uses.
  const graded = preset({ twilightTint: "#ff8030", nightTint: "#3050a0" });

  /** @type {number[][]} */
  const curve = [];
  for (let altitude = -25; altitude <= 50; altitude += 0.5) curve.push(tintFor(graded, altitude));

  for (let i = 1; i < curve.length - 1; i += 1) {
    for (let c = 0; c < 3; c += 1) {
      const secondDifference = Math.abs(curve[i + 1][c] - 2 * curve[i][c] + curve[i - 1][c]);
      // Bounded, not zero. At the outermost stops the ramp goes from constant
      // to curving, and smoothstep has zero *slope* at its ends but not zero
      // curvature - so there is a step in the second difference there, worth
      // about 0.010. That is a C1 join, which is what the architecture claims
      // and what the eye needs: the colour and its rate of change are both
      // continuous, and only the curvature turns a corner. A real
      // discontinuity would be an order of magnitude larger.
      assert.ok(
        secondDifference < 0.02,
        `the tint kinks by ${secondDifference.toFixed(4)} at sample ${i}, channel ${c}`
      );
    }
  }
});

test("a tint colours without changing the overall brightness", () => {
  // It multiplies linear light, so an unbalanced tint would double as an
  // exposure change and the two controls would fight. The channels are
  // normalised so their mean is one.
  for (const colour of ["#ff4020", "#2040ff", "#40ff80"]) {
    const tint = tintFor(preset({ dayTint: colour, twilightTint: colour, nightTint: colour }), 20);
    const mean = (tint[0] + tint[1] + tint[2]) / 3;
    close(mean, 1, 1e-6, `mean of the tint from ${colour}`);

    // ...and it really is a cast, not a no-op.
    assert.ok(Math.max(...tint) - Math.min(...tint) > 0.2, `${colour} should be a visible cast`);
  }
});

test("a malformed tint is never allowed to reach the renderer", () => {
  // tintFor parses hex, and a bad value would throw out of the render loop.
  // Settings normalisation is what guarantees this, and this is the check
  // that the two agree about what a tint looks like.
  assert.throws(() => tintFor(preset({ dayTint: "not a colour" }), 20));
});
