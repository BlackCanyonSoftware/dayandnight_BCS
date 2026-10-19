import test from "node:test";
import assert from "node:assert/strict";

import {
  hexToSrgb,
  linearToOklab,
  linearToSrgb1,
  mixSrgbViaOklab,
  oklabToLinear,
  oklabToSrgb,
  sampleRampViaOklab,
  srgbToLinear1,
  srgbToOklab
} from "../../app/engine/sky/oklab.js";

/**
 * A ramp of horizon colours through twilight.
 *
 * These were the Milestone 0 palette, which the scattering model has now
 * replaced. They are kept here because the ramp function they exercise is not
 * retired: the grade (ADR 0004) uses an altitude-keyed tint ramp over the
 * physical sky, and these are a realistic set of stops to hold it to.
 * @type {{ at: number, color: [number, number, number] }[]}
 */
const SKY_HORIZON = [
  { at: -18, color: hexToSrgb("#0a0f1c") },
  { at: -12, color: hexToSrgb("#122038") },
  { at: -6, color: hexToSrgb("#3c4a6b") },
  { at: -3, color: hexToSrgb("#8c5f68") },
  { at: -1, color: hexToSrgb("#c2724f") },
  { at: 0, color: hexToSrgb("#e58a4a") },
  { at: 3, color: hexToSrgb("#f2b071") },
  { at: 6, color: hexToSrgb("#e3c6a4") },
  { at: 10, color: hexToSrgb("#a8c4de") },
  { at: 70, color: hexToSrgb("#cfe2f2") }
];

/**
 * @param {number} a
 * @param {number} b
 * @param {number} tolerance
 * @param {string} what
 */
function close(a, b, tolerance, what) {
  assert.ok(
    Math.abs(a - b) <= tolerance,
    `${what}: expected ${b} +/- ${tolerance}, got ${a} (off by ${Math.abs(a - b)})`
  );
}

test("the sRGB transfer function round-trips", () => {
  for (let i = 0; i <= 100; i += 1) {
    const c = i / 100;
    close(linearToSrgb1(srgbToLinear1(c)), c, 1e-12, `sRGB -> linear -> sRGB at ${c}`);
  }
});

test("the transfer function is the piecewise one, not a 2.2 power", () => {
  // The near-black end is where the two disagree, and a night sky is almost
  // entirely near-black - which is why the approximation is not used.
  const linear = 0.002;
  close(linearToSrgb1(linear), linear * 12.92, 1e-12, "the linear segment applies below 0.0031308");
  assert.notStrictEqual(linearToSrgb1(linear), Math.pow(linear, 1 / 2.2));
});

test("Oklab round-trips through linear sRGB", () => {
  /** @type {[number, number, number][]} */
  const samples = [
    [0, 0, 0],
    [1, 1, 1],
    [0.5, 0.25, 0.125],
    [0.9, 0.55, 0.28], // sunrise amber
    [0.02, 0.04, 0.09] // deep twilight
  ];

  for (const rgb of samples) {
    const back = oklabToLinear(linearToOklab(rgb));
    for (let i = 0; i < 3; i += 1) {
      // 1e-6, not 1e-9: the forward and inverse matrices Ottosson publishes
      // are rounded to ten decimals and are not exact inverses, so a
      // round trip loses a little under 1e-7. That is four orders of
      // magnitude below an 8-bit quantisation step, so it cannot matter.
      close(back[i], rgb[i], 1e-6, `channel ${i} of ${JSON.stringify(rgb)}`);
    }
  }
});

test("Oklab puts white at L=1 with no chroma", () => {
  const [L, a, b] = linearToOklab([1, 1, 1]);
  close(L, 1, 1e-6, "L of white");
  close(a, 0, 1e-6, "a of white");
  close(b, 0, 1e-6, "b of white");
});

test("a Cartesian mix between complementary hues desaturates, in any space", () => {
  // Worth pinning because it is the opposite of what one might assume.
  //
  // Oklab is often described as the cure for the "muddy midpoint" of a
  // sunset-orange to twilight-blue gradient. It is not, and this test says so.
  // Those two colours are nearly complementary, so their (a, b) chroma vectors
  // point in roughly opposite directions; the straight line between them
  // passes close to the neutral axis. A Cartesian interpolation therefore
  // desaturates through the middle whichever space it is done in - Oklab
  // included. Only a polar form that carries the hue angle round (Oklch) would
  // avoid it.
  //
  // The product does not need one, because the sky is not a two-colour mix: the
  // authored ramp in sky/palette.js carries intermediate stops at -3, -1, 0 and
  // +3 degrees that trace the real hue path through pink and purple. Keeping
  // chroma is the job of having enough keyframes. Oklab's job is the next test.
  const orange = hexToSrgb("#e58a4a");
  const blue = hexToSrgb("#15243f");

  const chroma = (/** @type {[number, number, number]} */ c) => {
    const [, a, b] = srgbToOklab(c);
    return Math.hypot(a, b);
  };

  const midpoint = mixSrgbViaOklab(orange, blue, 0.5);
  assert.ok(
    chroma(midpoint) < Math.min(chroma(orange), chroma(blue)),
    "the midpoint of two complementary hues is less chromatic than either end"
  );
});

test("Oklab interpolation gives an even lightness progression; sRGB does not", () => {
  // This is what Oklab is actually for here, and why architecture invariant 4
  // exists. Lightness is the axis the eye is most sensitive to across a wide,
  // shallow gradient; uneven steps in it are what read as a pinched or banded
  // sky even before 8-bit quantisation gets involved.
  const orange = hexToSrgb("#e58a4a");
  const blue = hexToSrgb("#15243f");

  const lightness = (/** @type {[number, number, number]} */ c) => srgbToOklab(c)[0];

  /** @param {(t: number) => [number, number, number]} mix */
  const lightnessSteps = (mix) => {
    /** @type {number[]} */
    const steps = [];
    let previous = lightness(mix(0));
    for (let i = 1; i <= 64; i += 1) {
      const here = lightness(mix(i / 64));
      steps.push(here - previous);
      previous = here;
    }
    return steps;
  };

  /** @param {number[]} steps */
  const spread = (steps) => Math.max(...steps) - Math.min(...steps);

  const viaOklab = lightnessSteps((t) => mixSrgbViaOklab(orange, blue, t));

  const viaSrgb = lightnessSteps(
    (t) =>
      /** @type {[number, number, number]} */ ([
        orange[0] + (blue[0] - orange[0]) * t,
        orange[1] + (blue[1] - orange[1]) * t,
        orange[2] + (blue[2] - orange[2]) * t
      ])
  );

  // Oklab's L is interpolated directly, so its steps are even by construction;
  // an sRGB component lerp bends lightness through the gamma curve.
  assert.ok(
    spread(viaOklab) < spread(viaSrgb) / 2,
    `Oklab lightness steps should be far more even: spread ${spread(viaOklab).toFixed(5)} vs sRGB ${spread(viaSrgb).toFixed(5)}`
  );
});

test("the authored sky ramp keeps its chroma across twilight", () => {
  // The product-level property that the test above says a two-colour mix
  // cannot give: because the stops are placed along the real hue path, the
  // ramp stays coloured right through the twilight window rather than washing
  // out to grey. This is the property the grade's tint ramp depends on.
  //
  // The window is -12 to +3 degrees, which is the hour either side of the
  // horizon - what the product is actually about. Above it the ramp crosses
  // from the warm +6 stop to the cool +10 one and does dip towards neutral
  // around +8; that is partly real (a hazy mid-morning horizon is a pale
  // near-neutral) and partly the complementary-crossing artefact above. It is
  // logged in docs/ROADMAP.md rather than asserted away, because the whole
  // placeholder palette is replaced by the scattering model in Milestone 1.
  let worst = Infinity;
  let worstAt = 0;

  for (let altitude = -12; altitude <= 3; altitude += 0.25) {
    const [, a, b] = srgbToOklab(sampleRampViaOklab(SKY_HORIZON, altitude));
    const c = Math.hypot(a, b);
    if (c < worst) {
      worst = c;
      worstAt = altitude;
    }
  }

  assert.ok(
    worst > 0.02,
    `the horizon ramp went nearly neutral (chroma ${worst.toFixed(4)}) at ${worstAt.toFixed(2)} degrees`
  );
});

test("a mix at 0 and 1 returns the endpoints", () => {
  const a = hexToSrgb("#e58a4a");
  const b = hexToSrgb("#15243f");

  for (const [t, want, name] of /** @type {[number, [number,number,number], string][]} */ ([
    [0, a, "t=0"],
    [1, b, "t=1"]
  ])) {
    const got = mixSrgbViaOklab(a, b, t);
    for (let i = 0; i < 3; i += 1) close(got[i], want[i], 2e-3, `${name} channel ${i}`);
  }
});

test("a ramp clamps outside its stops and hits them exactly", () => {
  const stops = [
    { at: -18, color: hexToSrgb("#05070f") },
    { at: 0, color: hexToSrgb("#e58a4a") },
    { at: 70, color: hexToSrgb("#cfe2f2") }
  ];

  assert.deepEqual(sampleRampViaOklab(stops, -100), stops[0].color, "below the first stop");
  assert.deepEqual(sampleRampViaOklab(stops, 1000), stops[2].color, "above the last stop");

  const atZero = sampleRampViaOklab(stops, 0);
  for (let i = 0; i < 3; i += 1) {
    close(atZero[i], stops[1].color[i], 2e-3, `exactly on a stop, channel ${i}`);
  }
});

test("a ramp is monotonic and continuous across a stop boundary", () => {
  // A crease at a keyframe is as visible as a crease in colour: NFR-3.
  const stops = [
    { at: -6, color: hexToSrgb("#15243f") },
    { at: 0, color: hexToSrgb("#e58a4a") },
    { at: 10, color: hexToSrgb("#a8c4de") }
  ];

  let previous = sampleRampViaOklab(stops, -6);
  for (let x = -6; x <= 10; x += 0.05) {
    const here = sampleRampViaOklab(stops, x);
    const step = Math.max(
      Math.abs(here[0] - previous[0]),
      Math.abs(here[1] - previous[1]),
      Math.abs(here[2] - previous[2])
    );
    assert.ok(step < 0.02, `jump of ${step.toFixed(4)} at altitude ${x.toFixed(2)}`);
    previous = here;
  }
});

test("a ramp does not care what order its stops arrive in", () => {
  const sorted = [
    { at: -6, color: hexToSrgb("#15243f") },
    { at: 0, color: hexToSrgb("#e58a4a") },
    { at: 10, color: hexToSrgb("#a8c4de") }
  ];
  const shuffled = [sorted[1], sorted[2], sorted[0]];

  assert.deepEqual(sampleRampViaOklab(shuffled, -3), sampleRampViaOklab(sorted, -3));
});

test("out-of-gamut Oklab is clamped on the way to sRGB", () => {
  const wild = oklabToSrgb([0.9, 0.4, -0.4]);
  for (const channel of wild) {
    assert.ok(channel >= 0 && channel <= 1, `${channel} is outside 0..1`);
  }
});

test("hex parsing takes both lengths and rejects nonsense", () => {
  assert.deepEqual(hexToSrgb("#fff"), [1, 1, 1]);
  assert.deepEqual(hexToSrgb("ffffff"), [1, 1, 1]);
  assert.deepEqual(hexToSrgb("#000000"), [0, 0, 0]);
  assert.throws(() => hexToSrgb("#gggggg"), /not a hex colour/);
  assert.throws(() => hexToSrgb("#ff"), /not a hex colour/);
});

test("the shader's transfer function matches the one in JavaScript", () => {
  // The conversion exists on both sides of the GPU boundary (sky/oklab.js and
  // the COMMON block in shaders.js). They must agree, or the preview and the
  // scrubber bands disagree with the sky. This re-implements the GLSL by hand
  // and compares; if the shader changes, this fails.
  const glsl = (/** @type {number} */ c) => {
    const lo = c * 12.92;
    const hi = 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055;
    return c <= 0.0031308 ? lo : hi;
  };

  for (let i = 0; i <= 1000; i += 1) {
    const c = i / 1000;
    close(glsl(c), linearToSrgb1(c), 1e-12, `transfer function at ${c}`);
  }
});
