import test from "node:test";
import assert from "node:assert/strict";

import {
  EVOLUTION_SECONDS,
  LAYERS,
  PERIOD,
  cloudSteps,
  cloudsVisible,
  driftCells,
  evolution,
  kmPerPixel
} from "../../app/engine/sky/clouds.js";

/**
 * The cloud field, which is the first thing in this product that moves.
 *
 * Two of these exist because of a bug that produced a picture. The drift was
 * allowed to grow without limit from the Unix epoch, on the reasoning that a
 * number increasing by a little each minute takes millennia to lose precision.
 * True in double precision; irrelevant, because the value reaches the shader
 * through a `float` uniform, where the epoch's magnitude resolves in steps of
 * four against a noise lattice measured in units of one. The sky came out
 * looking tiled, which is a long way from the "a few thousand years away" the
 * comment claimed.
 */

/** Every hour of a century, which is where the magnitudes get interesting. */
function* centuryOfInstants() {
  const start = Date.UTC(2000, 0, 1);
  const end = Date.UTC(2100, 0, 1);
  for (let t = start; t < end; t += 37 * 3_600_000) yield t;
}

test("the drift stays small enough for a single-precision uniform", () => {
  // The bug, stated as a test. Float32 has 24 bits of mantissa, so it resolves
  // to about one part in sixteen million; the lattice needs steps well under a
  // cell, and a cell is one scale unit. Anything over a few thousand is
  // already coarse.
  for (const t of centuryOfInstants()) {
    for (const wind of [1, 12, 60, 200]) {
      for (let layer = 0; layer < LAYERS.length; layer += 1) {
        const cells = driftCells(t, wind, layer, 1.6);

        assert.ok(
          cells >= 0 && cells < PERIOD,
          `drift ${cells} outside [0, ${PERIOD}) at t=${t}, wind=${wind}, layer=${layer}`
        );
      }
    }
  }
});

test("the drift is bounded even at absurd wind speeds and far-future dates", () => {
  // The clamp in settings.js stops a preset asking for this, but a settings
  // file is a file and the engine should not depend on the editor having
  // validated it.
  const t = Date.UTC(2999, 0, 1);
  for (const wind of [0, 1e3, 1e6]) {
    const cells = driftCells(t, wind, 2, 1.6);
    assert.ok(Number.isFinite(cells), `drift is ${cells} at wind ${wind}`);
    assert.ok(cells >= 0 && cells < PERIOD);
  }
});

test("the drift advances smoothly and wraps without a jump", () => {
  // The wrap is only acceptable because the noise field is periodic, so the
  // field at the end of a period is the field at the start of one. What is
  // checked here is the CPU half: that the value really does come back to zero
  // rather than to some arbitrary offset, which is what would turn a seamless
  // repeat into a visible jolt every few days.
  const wind = 24;
  const layer = 2;
  const scale = 1.6;

  // A period is PERIOD cells, and a cell is this many kilometres across - the
  // distinction this test exists to pin down, since getting it wrong is what
  // made the sky jump.
  const cellKm = LAYERS[layer].scale * scale;
  const hours = (PERIOD * cellKm) / (wind * LAYERS[layer].drift);

  const start = Date.UTC(2026, 0, 1);
  const after = start + hours * 3_600_000;

  const before = driftCells(start, wind, layer, scale);
  const wrapped = driftCells(after, wind, layer, scale);

  assert.ok(
    Math.abs(wrapped - before) < 1e-6 * PERIOD,
    `a period later the drift should return to where it started: ${before} then ${wrapped}`
  );
});

test("the drift only ever goes backwards at a wrap", () => {
  // It should move the clouds one way. It may cross a wrap while doing so -
  // the starting instant is a real date, not a round number, so where it falls
  // in the period is arbitrary - and that is the one place going backwards is
  // correct. More than once in seven hours would mean it was oscillating.
  const start = Date.UTC(2026, 5, 1);
  let previous = driftCells(start, 12, 1, 1.6);
  let wraps = 0;

  for (let minute = 5; minute < 400; minute += 5) {
    const cells = driftCells(start + minute * 60_000, 12, 1, 1.6);
    if (cells < previous) wraps += 1;
    previous = cells;
  }

  assert.ok(wraps <= 1, `the drift went backwards ${wraps} times, so it is not advancing`);
});

test("every layer drifts at a different rate, which is what parallax is", () => {
  const t = Date.UTC(2026, 5, 1, 12);
  const moved = LAYERS.map((_, i) => driftCells(t, 12, i, 1.6));

  assert.equal(new Set(moved).size, LAYERS.length, "two layers moved together");

  // And the lower layers move further, because they are closer.
  const heights = LAYERS.map((layer) => layer.height);
  assert.deepEqual(
    [...heights].sort((a, b) => b - a),
    heights,
    "LAYERS should run from the highest to the lowest"
  );
});

test("the evolution is bounded too, and advances about once a second", () => {
  for (const t of centuryOfInstants()) {
    const e = evolution(t);
    assert.ok(e >= 0 && e < PERIOD, `evolution ${e} outside [0, ${PERIOD})`);
  }

  // One unit is one EVOLUTION_SECONDS: the shader uses it as a coordinate, so
  // the rate lives in the module rather than in the shader.
  const t = Date.UTC(2026, 0, 1);
  const later = evolution(t + EVOLUTION_SECONDS * 1000) - evolution(t);
  assert.ok(Math.abs(later - 1) < 1e-9, `a full evolution should advance by 1, not ${later}`);
});

test("most frames are skipped, which is the whole point", () => {
  // The reason the signature can ask about clouds cheaply. At twenty frames a
  // second the field moves a fraction of a pixel between most of them, so most
  // draws are skipped - but not all, and asserting that one particular pair is
  // identical would be asserting where the rounding happens to fall. The
  // proportion is the claim.
  const t = Date.UTC(2026, 5, 1, 12);
  const km = kmPerPixel(150, 5760);

  let changed = 0;
  let previous = cloudSteps(t, 12, km);

  for (let frame = 1; frame <= 200; frame += 1) {
    const now = cloudSteps(t + frame * 50, 12, km);
    if (now[0] !== previous[0] || now[1] !== previous[1]) changed += 1;
    previous = now;
  }

  assert.ok(changed < 100, changed + " of 200 frames changed; most should be skipped");
  assert.ok(changed > 0, "nothing changed in ten seconds, so the clouds are frozen");
});

test("a minute does move them, or nothing would ever be redrawn", () => {
  const t = Date.UTC(2026, 5, 1, 12);
  const km = kmPerPixel(150, 5760);

  const now = cloudSteps(t, 12, km);
  const later = cloudSteps(t + 60_000, 12, km);

  assert.notDeepEqual(later, now);
});

test("the redraw rate is somewhere a person would want it", () => {
  // The quantum is the redraw rate, so it is worth asserting what it comes to
  // rather than leaving it to be discovered in a measurement. At the default
  // wind on a two-screen span this should be around once a second: far more
  // than the sixteen seconds a clear sky manages, and far less than the twenty
  // a second it would cost to animate honestly.
  const t = Date.UTC(2026, 5, 1, 12);
  const km = kmPerPixel(150, 3840);

  let draws = 0;
  let previous = cloudSteps(t, 12, km);

  for (let tick = 1; tick <= 20 * 60; tick += 1) {
    const now = cloudSteps(t + tick * 50, 12, km);
    if (now[0] !== previous[0] || now[1] !== previous[1]) draws += 1;
    previous = now;
  }

  // Sixty seconds of ticks at 20 fps.
  assert.ok(draws > 5, `only ${draws} redraws a minute is a slideshow`);
  assert.ok(draws < 400, `${draws} redraws a minute is most of the way back to animating`);
});

test("a pixel covers less ground on a wider span", () => {
  // More pixels across the same sky means a finer quantum, which means more
  // redraws - correctly, because the movement really is more visible.
  const narrow = kmPerPixel(150, 1920);
  const wide = kmPerPixel(150, 5760);

  assert.ok(wide < narrow);
  assert.ok(narrow > 0);
});

test("clouds can be switched off entirely", () => {
  assert.equal(cloudsVisible(0), false);
  assert.equal(cloudsVisible(0.5), true);
});
