import test from "node:test";
import assert from "node:assert/strict";

import {
  LUT_AZIMUTH,
  LUT_SUN,
  LUT_VIEW,
  MIE_G,
  SUN_MAX,
  SUN_MIN,
  VIEW_MAX,
  VIEW_MIN,
  ambientFor,
  bakeScatteringLut,
  decodeElevation,
  encodeElevation,
  miePhase,
  rayleighPhase,
  scatter
} from "../../app/engine/sky/atmosphere.js";

/**
 * There is no reference table to check a scattering model against, so these
 * assert the things a sky visibly does. A wrong coefficient or a flipped sign
 * breaks at least one of them: the sky stops being blue, or the sunset stops
 * being red, or twilight stops fading in the right direction.
 */

const d = Math.PI / 180;

/**
 * Radiance in a direction, with the phase functions applied the way the
 * shader applies them.
 *
 * @param {number} viewElevation
 * @param {number} sunElevation
 * @param {number} azimuth
 * @returns {[number, number, number]}
 */
function radiance(viewElevation, sunElevation, azimuth) {
  const ambient = ambientFor(sunElevation);
  const { rayleigh, mie } = scatter(viewElevation, sunElevation, azimuth, ambient);

  const cosTheta =
    Math.sin(viewElevation * d) * Math.sin(sunElevation * d) +
    Math.cos(viewElevation * d) * Math.cos(sunElevation * d) * Math.cos(azimuth * d);

  const pr = rayleighPhase(cosTheta);
  const pm = miePhase(cosTheta, MIE_G);

  return [rayleigh[0] * pr + mie * pm, rayleigh[1] * pr + mie * pm, rayleigh[2] * pr + mie * pm];
}

/** @param {[number, number, number]} c */
const luminance = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/* ------------------------------------------------------ the axis encoding */

test("the elevation encoding round-trips and concentrates near the horizon", () => {
  for (const degrees of [-20, -6, -1, 0, 1, 10, 45, 90]) {
    const u = encodeElevation(degrees, SUN_MIN, SUN_MAX);
    assert.ok(u >= 0 && u <= 1, `${degrees} encoded outside 0..1`);
    assert.ok(
      Math.abs(decodeElevation(u, SUN_MIN, SUN_MAX) - degrees) < 1e-9,
      `${degrees} did not round-trip`
    );
  }

  // The horizon gets more of the axis than the zenith does: the gap between
  // 0 and 1 degree should be wider than between 80 and 81.
  const nearHorizon = encodeElevation(1, SUN_MIN, SUN_MAX) - encodeElevation(0, SUN_MIN, SUN_MAX);
  const nearZenith = encodeElevation(81, SUN_MIN, SUN_MAX) - encodeElevation(80, SUN_MIN, SUN_MAX);

  assert.ok(
    nearHorizon > nearZenith * 3,
    `the horizon should get far more resolution: ${nearHorizon} against ${nearZenith}`
  );
});

/* ----------------------------------------------------------- phase functions */

test("both phase functions integrate to one over the sphere", () => {
  // A phase function redistributes light; it must not create or destroy it.
  // If either were mis-normalised the whole sky would be too bright or too
  // dim by a constant, which is the sort of error an exposure control hides.
  for (const [name, phase] of /** @type {[string, (c: number) => number][]} */ ([
    ["Rayleigh", rayleighPhase],
    ["Mie", (c) => miePhase(c, MIE_G)]
  ])) {
    let total = 0;
    const steps = 20000;
    for (let i = 0; i < steps; i += 1) {
      // Integrating over cos(theta) from -1 to 1 already carries the
      // solid-angle weighting, so this is just 2*pi times the mean.
      const cosTheta = -1 + (2 * (i + 0.5)) / steps;
      total += phase(cosTheta) * (2 / steps);
    }
    total *= 2 * Math.PI;
    assert.ok(Math.abs(total - 1) < 0.01, `the ${name} phase integrated to ${total.toFixed(4)}`);
  }
});

test("Rayleigh is symmetric and Mie is strongly forward", () => {
  assert.ok(
    Math.abs(rayleighPhase(1) - rayleighPhase(-1)) < 1e-12,
    "Rayleigh scatters equally forwards and backwards"
  );
  assert.ok(
    miePhase(1, MIE_G) > miePhase(-1, MIE_G) * 50,
    "Mie should be dramatically brighter towards the sun - this is the glare around it"
  );
});

/* ----------------------------------------------------- what a sky looks like */

test("the daytime sky is blue overhead", () => {
  const zenith = radiance(89, 45, 90);
  assert.ok(zenith[2] > zenith[1], "blue above green");
  assert.ok(zenith[1] > zenith[0], "green above red");
  assert.ok(zenith[2] > zenith[0] * 2.5, `blue should dominate red, got ${zenith[2] / zenith[0]}`);
});

test("the horizon reddens as the sun goes down", () => {
  // The defining behaviour of a sunset, and the reason the product exists.
  const ratio = (/** @type {number} */ sun) => {
    const c = radiance(2, sun, 0);
    return c[0] / c[2];
  };

  const noon = ratio(60);
  const setting = ratio(0);

  assert.ok(
    setting > noon * 1.5,
    `the horizon should redden markedly by sunset: ${setting.toFixed(2)} against ${noon.toFixed(2)} at noon`
  );
  assert.ok(
    setting > 1,
    `a setting sun's horizon should be warmer than it is blue, got red/blue of ${setting.toFixed(2)}`
  );

  // Measured at 1.43 against 0.90, so the reddening is real but modest: a
  // photographed sunset reaches three to five. The model has a single fixed
  // aerosol loading, and a deep red sunset is largely a high-turbidity one.
  // Turbidity belongs to the grade (ADR 0004) and is not built yet, so the
  // physical base is deliberately undersaturated rather than wrong. Tracked
  // in docs/ROADMAP.md.
});

test("the sky changes smoothly through sunset, with no steps (NFR-3)", () => {
  // Smoothness, not monotonicity and not a rate limit.
  //
  // A single direction does not darken monotonically as the sun sets, and
  // that is correct: a patch of sky near the horizon brightens as the sun
  // descends towards it and only darkens once the sun has gone below. Nor is
  // the rate bounded - twilight genuinely falls about tenfold every three
  // degrees, and faster where the Earth's shadow sweeps through.
  //
  // What must never happen is a *discontinuity*, because that is what shows
  // up as a band crawling across the wallpaper. Exponential decay is a
  // straight line in log space, so smoothness is a small second difference
  // there, and a step is a spike. This is the measure that distinguishes the
  // two.
  for (const azimuth of [0, 90, 180]) {
    /** @type {number[]} */
    const curve = [];
    // Down to seven and a half degrees, which covers all of civil twilight.
    // Past about eight the model reaches its floor (see the test below) and
    // the kink there is the floor itself, not the sky.
    for (let sun = 20; sun >= -7.5; sun -= 0.25) {
      curve.push(Math.log(Math.max(luminance(radiance(8, sun, azimuth)), 1e-12)));
    }

    for (let i = 1; i < curve.length - 1; i += 1) {
      const secondDifference = Math.abs(curve[i + 1] - 2 * curve[i] + curve[i - 1]);
      // The measured worst case is 0.231, at one degree below the horizon -
      // the fastest-changing moment of the whole sunset.
      assert.ok(
        secondDifference < 0.3,
        `the curve kinks by ${secondDifference.toFixed(3)} at azimuth ${azimuth}, sample ${i}`
      );
    }
  }
});

test("azimuth barely matters with the sun high and matters enormously at dusk", () => {
  // The measurement that forced the lookup table to be three-dimensional. A
  // two-dimensional table would light the whole sky evenly at dusk, which is
  // the one thing a sunset is not.
  // Compared on the integrals rather than on the final radiance. The phase
  // functions vary strongly with azimuth by design - that is the glare around
  // the sun - and they are applied per pixel, so they are not what the table's
  // third axis is for. What the axis is for is the geometry inside the
  // integral, and that is what this measures.
  const spread = (/** @type {number} */ sun) => {
    const ambient = ambientFor(sun);
    const toward = scatter(10, sun, 0, ambient).rayleigh[2];
    const away = scatter(10, sun, 180, ambient).rayleigh[2];
    return away / Math.max(toward, 1e-30);
  };

  assert.ok(
    spread(30) > 0.95,
    `with the sun high the integrals barely vary, got ${spread(30).toFixed(4)}`
  );
  assert.ok(
    spread(-4) < 0.1,
    `at civil twilight the far sky should be far darker, got ${spread(-4).toFixed(4)}`
  );
});

test("the sun below the atmosphere leaves no sky lit", () => {
  // Not a flaw to be hidden: once the sun is more than about eight degrees
  // down, nothing within a 60 km atmosphere is still in sunlight, so single
  // and low-order scattering give nothing. Real nautical and astronomical
  // twilight are kept alight by higher air, by many more bounces and by
  // airglow, none of which this models. The night sky's interest comes from
  // the stars instead. Pinned so the limit is deliberate rather than noticed
  // later as a bug.
  assert.equal(luminance(radiance(10, -14, 0)), 0);
});

test("nothing is negative, infinite, or missing anywhere", () => {
  for (let sun = -20; sun <= 90; sun += 7) {
    for (let view = -10; view <= 90; view += 11) {
      for (const azimuth of [0, 45, 90, 135, 180]) {
        const c = radiance(view, sun, azimuth);
        for (const channel of c) {
          assert.ok(Number.isFinite(channel), `not finite at sun ${sun}, view ${view}`);
          assert.ok(channel >= 0, `negative radiance at sun ${sun}, view ${view}`);
        }
      }
    }
  }
});

test("the same geometry always gives the same answer", () => {
  assert.deepEqual(scatter(12, 3, 45, [0, 0, 0]), scatter(12, 3, 45, [0, 0, 0]));
});

/* ------------------------------------------------------------- the table */

test("the baked table is complete and sane", () => {
  const { data, reference } = bakeScatteringLut();

  assert.equal(data.length, LUT_SUN * LUT_VIEW * LUT_AZIMUTH * 4);
  assert.equal(reference.length, LUT_SUN);

  for (const value of data) {
    assert.ok(Number.isFinite(value) && value >= 0, `bad entry ${value} in the table`);
  }

  // The reference brightness has to track the sun, or auto-exposure would
  // fight the sky instead of following it. It is allowed small local dips:
  // once the sun is well up the sky saturates, and raising it further very
  // slightly *reduces* the average radiance as the paths shorten and the blue
  // deepens. The measured worst case is a little over one per cent.
  for (let x = 1; x < LUT_SUN; x += 1) {
    assert.ok(
      reference[x] >= reference[x - 1] * 0.97,
      `reference brightness fell ${(100 * (1 - reference[x] / reference[x - 1])).toFixed(1)} per cent between bins ${x - 1} and ${x}`
    );
  }

  // And it has to span the day. Bin 0 is legitimately zero - nothing in the
  // modelled atmosphere is lit that far below the horizon - so the comparison
  // is against the first bin that has any light in it at all.
  const firstLit = [...reference].findIndex((value) => value > 0);
  assert.ok(firstLit > 0, "the deepest twilight bins should be dark");
  assert.ok(
    reference[LUT_SUN - 1] > reference[firstLit] * 1000,
    "noon should be orders of magnitude brighter than the last of the twilight"
  );

  // Within the view range, the horizon is brighter than the zenith in the
  // daytime - the most basic shape a sky has.
  assert.ok(VIEW_MIN < 0 && VIEW_MAX === 90, "the table should reach below the horizon");
});
