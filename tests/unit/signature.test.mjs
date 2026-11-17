import test from "node:test";
import assert from "node:assert/strict";

import { frameSignature } from "../../app/engine/signature.js";
import { defaultPreset } from "../../app/engine/defaults.js";

/**
 * The frame signature decides whether a frame is drawn at all, so it has one
 * dangerous failure mode: if it misses an input, the sky silently stops
 * updating and nothing reports an error. These tests exist mostly to catch
 * that.
 *
 * The other direction - a signature that changes too eagerly - costs
 * performance but is visually harmless, so it is held to a looser standard.
 */

const DENVER = { lat: 39.74, lon: -104.99 };

/** @returns {import("../../app/engine/types.js").FrameRequest} */
function request(t, overrides = {}) {
  return {
    t,
    place: DENVER,
    crop: { x: 0, y: 0, w: 1920, h: 1080 },
    span: { w: 1920, h: 1080 },
    pixelRatio: 1,
    ...overrides
  };
}

const PRESET = defaultPreset();

/** @param {string} iso */
const at = (iso) => new Date(iso).getTime();

/** @param {import("../../app/engine/types.js").FrameRequest} r */
const sign = (r, preset = PRESET) => frameSignature(preset, r, 1920, 1080);

test("the same inputs give the same signature", () => {
  const t = at("2026-06-21T18:00:00Z");
  assert.equal(sign(request(t)), sign(request(t)));
});

test("a few milliseconds apart, the sky has not changed", () => {
  // The whole point: at 20 fps most ticks are this case.
  const t = at("2026-06-21T18:00:00Z");
  assert.equal(sign(request(t)), sign(request(t + 50)));
});

test("over a long enough interval, it does change", () => {
  // And the whole danger: a signature that never changed would freeze the sky
  // with no error anywhere.
  const t = at("2026-06-21T12:00:00Z");
  assert.notEqual(sign(request(t)), sign(request(t + 10 * 60_000)));
});

test("exposure changes the signature", () => {
  const t = at("2026-06-21T18:00:00Z");
  assert.notEqual(
    sign(request(t), { ...PRESET, exposure: 0 }),
    sign(request(t), { ...PRESET, exposure: 1 })
  );
});

test("turning the camera changes the signature", () => {
  // Framing moves the picture without the sky itself changing, so the probes
  // alone would not notice it.
  const t = at("2026-06-21T18:00:00Z");
  assert.notEqual(
    sign(request(t), { ...PRESET, bearing: 180 }),
    sign(request(t), { ...PRESET, bearing: 90 })
  );
  assert.notEqual(
    sign(request(t), { ...PRESET, horizon: 0.8 }),
    sign(request(t), { ...PRESET, horizon: 0.5 })
  );
  assert.notEqual(
    sign(request(t), { ...PRESET, fieldOfView: 90 }),
    sign(request(t), { ...PRESET, fieldOfView: 120 })
  );
});

test("geometry changes the signature", () => {
  const t = at("2026-06-21T18:00:00Z");
  const base = sign(request(t));

  assert.notEqual(base, sign(request(t, { crop: { x: 100, y: 0, w: 1920, h: 1080 } })), "crop x");
  assert.notEqual(base, sign(request(t, { crop: { x: 0, y: 0, w: 1280, h: 1080 } })), "crop width");
  assert.notEqual(base, sign(request(t, { span: { w: 3840, h: 1080 } })), "span");
  assert.notEqual(
    base,
    frameSignature(PRESET, request(t), 1280, 720),
    "the drawing buffer, which the dither depends on"
  );
});

test("place changes the signature", () => {
  const t = at("2026-06-21T18:00:00Z");
  assert.notEqual(
    sign(request(t)),
    sign(request(t, { place: { lat: -33.87, lon: 151.2 } })),
    "a different place is a different sky at the same instant"
  );
});

test("a whole day redraws often enough to look continuous", () => {
  // Walk a day a second at a time and count how many of those seconds would
  // actually have drawn. This is the measurement that justifies the change:
  // the saving, and the proof that the sky is not freezing.
  const start = at("2026-06-21T00:00:00Z");
  let drawn = 0;
  let previous = null;

  for (let second = 0; second < 86_400; second += 1) {
    const signature = sign(request(start + second * 1000));
    if (signature !== previous) drawn += 1;
    previous = signature;
  }

  // Enough that the sky is genuinely continuous. Each redraw is at most one
  // 8-bit step, so "often enough" and "smooth" are the same statement here.
  assert.ok(drawn > 1000, `only ${drawn} redraws in a day is not a moving sky`);

  // And far fewer than a 20 fps loop's 1,728,000. Anything close to that
  // would mean the signature is churning and the saving has been lost.
  assert.ok(
    drawn < 86_400,
    `${drawn} redraws a day is more than one a second; the signature is too sensitive`
  );
});

// The test that stood here asserted that the middle of the night redraws less than
// sunrise, and it was written to describe a sky that stood still after dark. That
// was the bug, not the design: with nothing in the signature for the stars, the
// moon or the shimmer, the night sky was drawn once and then frozen for hours, and
// a host that skips an unchanged frame never drew it turn. It is replaced by tests
// of what a night sky has to do, and of how much that is allowed to cost.

/**
 * How many distinct frames a stretch of time would draw.
 *
 * @param {string} iso where to start
 * @param {number} seconds how long
 * @param {number} everyMs how often a host would ask
 * @param {import("../../app/engine/types.js").Preset} preset
 * @returns {number}
 */
function distinctFrames(iso, seconds, everyMs, preset) {
  const start = at(iso);
  const seen = new Set();
  let count = 0;
  let previous = null;
  for (let ms = 0; ms < seconds * 1000; ms += everyMs) {
    const signature = sign(request(start + ms), preset);
    if (signature !== previous) count += 1;
    seen.add(signature);
    previous = signature;
  }
  return count;
}

// Denver is near UTC-7: 08:00 UTC is the middle of the night in June, and 11:30
// UTC is around sunrise.
const NIGHT = "2026-06-21T08:00:00Z";
const SUNRISE = "2026-06-21T11:30:00Z";
const NOON = "2026-06-21T19:00:00Z";

test("after dark the stars turn: the sky is redrawn as they move, though no colour changes", () => {
  const still = { ...PRESET, twinkle: 0 };

  // Ten minutes. The sky turns about two and a half degrees in that time, which
  // is some fifty pixels of a hundred-degree view, so a redraw about every
  // twelve seconds.
  const redraws = distinctFrames(NIGHT, 600, 1000, still);

  assert.ok(redraws > 20, `the stars moved fifty pixels and the frame changed ${redraws} times`);
  assert.ok(redraws < 200, `${redraws} redraws in ten minutes is far more than they need`);
});

test("a night sky at twenty frames a second draws only what moved, not every frame", () => {
  const still = { ...PRESET, twinkle: 0 };

  // One minute at 20 fps is 1200 asks.
  const redraws = distinctFrames(NIGHT, 60, 50, still);

  assert.ok(redraws >= 2, `a minute of night should move the sky: ${redraws}`);
  assert.ok(redraws < 30, `${redraws} of 1200 frames is not a resting night sky`);
});

test("the twinkle costs a few redraws a second and not every frame", () => {
  const twinkling = { ...PRESET, twinkle: 0.6 };
  const redraws = distinctFrames(NIGHT, 60, 50, twinkling);

  // Four a second, plus the sky's own motion.
  assert.ok(redraws > 200, `the shimmer should show: ${redraws} redraws in a minute`);
  assert.ok(redraws < 300, `${redraws} redraws in a minute is more than the shimmer needs`);
});

test("by day the stars and the twinkle are not in the signature", () => {
  const on = sign(request(at(NOON)), { ...PRESET, twinkle: 0.6 });
  const off = sign(request(at(NOON)), { ...PRESET, twinkle: 0 });
  assert.equal(on, off, "a shimmer nobody can see must not cost a redraw");

  const later = sign(request(at(NOON) + 5000), { ...PRESET, twinkle: 0.6 });
  assert.ok(typeof later === "string");
});

test("sunrise redraws faster than the resting night", () => {
  const still = { ...PRESET, twinkle: 0 };
  const night = distinctFrames(NIGHT, 600, 1000, still);
  const sunrise = distinctFrames(SUNRISE, 600, 1000, still);

  assert.ok(
    sunrise > night,
    `sunrise (${sunrise}) should redraw more than the middle of the night (${night})`
  );
});
