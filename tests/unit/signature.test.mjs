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

test("the night sky is nearly static, and sunrise is not", () => {
  // The behaviour that makes this better than a fixed threshold: it follows
  // the sky's own pace rather than one chosen by guesswork.
  /** @param {string} iso @returns {number} */
  function redrawsInTenMinutes(iso) {
    const start = at(iso);
    let count = 0;
    let previous = null;
    for (let second = 0; second < 600; second += 1) {
      const signature = sign(request(start + second * 1000));
      if (signature !== previous) count += 1;
      previous = signature;
    }
    return count;
  }

  // Denver is near UTC-7: 08:00 UTC is the middle of the night in June.
  const night = redrawsInTenMinutes("2026-06-21T08:00:00Z");
  // and 11:30 UTC is around sunrise.
  const sunrise = redrawsInTenMinutes("2026-06-21T11:30:00Z");

  assert.ok(
    sunrise > night,
    `sunrise (${sunrise}) should redraw more than the middle of the night (${night})`
  );
});
