import test from "node:test";
import assert from "node:assert/strict";

import {
  boundingBox,
  cropFor,
  describe,
  geometryFor,
  intersects,
  physicalRectFor
} from "../../app/engine/span.js";

/**
 * Milestone 2's exit criteria name four arrangements that break naive span
 * code. Nobody is going to plug them in, so each one is a list of rectangles
 * here instead - which is the entire reason this arithmetic was pulled out of
 * `monitors.js` and away from Electron.
 *
 * The arrangements are the ones that actually occur: a row of three, a 4K
 * screen at 200% next to a 1080p one, a portrait screen beside a landscape
 * one, a vertical stack, an L-shape with a gap in it, and - the one that
 * catches the classic bug - a second screen placed to the LEFT of the primary,
 * where the virtual-desktop coordinates go negative.
 */

let nextId = 1;

/**
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {{ scale?: number, primary?: boolean }} [options]
 */
function screenAt(x, y, w, h, options = {}) {
  return {
    id: nextId++,
    bounds: { x, y, w, h },
    scale: options.scale ?? 1,
    primary: options.primary ?? false
  };
}

/** The arrangements, each named as somebody would describe it out loud. */
const ARRANGEMENTS = {
  "one screen": [screenAt(0, 0, 2560, 1440, { primary: true })],

  "a row of three": [
    screenAt(0, 0, 1920, 1080, { primary: true }),
    screenAt(1920, 0, 1920, 1080),
    screenAt(3840, 0, 1920, 1080)
  ],

  // A 4K panel at 200% reports 1920x1080 in DIP, the same as its 1080p
  // neighbour. The difference is entirely in the scale factor.
  "mixed DPI": [
    screenAt(0, 0, 1920, 1080, { primary: true }),
    screenAt(1920, 0, 1920, 1080, { scale: 2 })
  ],

  // Windows reports a rotated screen with its sides swapped, so portrait needs
  // no special handling - but it does make the span taller than any one screen
  // and leaves the landscape screen with a non-zero crop.y.
  "a rotated screen beside a landscape one": [
    screenAt(0, 420, 1920, 1080, { primary: true }),
    screenAt(1920, 0, 1080, 1920)
  ],

  "a vertical stack": [
    screenAt(0, 0, 1920, 1080, { primary: true }),
    screenAt(0, 1080, 1920, 1080)
  ],

  // Above and to the right, so two corners of the bounding box are sky that no
  // screen will ever show.
  "an L-shape with a gap": [
    screenAt(0, 0, 1920, 1080, { primary: true }),
    screenAt(1920, -1080, 1920, 1080)
  ],

  // The primary is not the leftmost screen. Every coordinate on the second
  // screen is negative, and a crop that forgets to subtract the span's origin
  // comes out negative too - which is the bug this whole module exists to make
  // impossible to ship.
  "a screen to the left of the primary": [
    screenAt(0, 0, 1920, 1080, { primary: true }),
    screenAt(-1920, 0, 1920, 1080)
  ],

  // Both axes negative, which is the above with a vertical offset as well.
  "a screen above and left of the primary": [
    screenAt(0, 0, 2560, 1440, { primary: true }),
    screenAt(-1920, -1080, 1920, 1080)
  ]
};

test("the span is the bounding box of every screen", () => {
  assert.deepEqual(boundingBox(ARRANGEMENTS["a row of three"]), {
    x: 0,
    y: 0,
    w: 5760,
    h: 1080
  });

  assert.deepEqual(boundingBox(ARRANGEMENTS["a vertical stack"]), {
    x: 0,
    y: 0,
    w: 1920,
    h: 2160
  });

  // Negative origins are the point: the box starts where the leftmost,
  // topmost screen starts, not at 0,0.
  assert.deepEqual(boundingBox(ARRANGEMENTS["a screen above and left of the primary"]), {
    x: -1920,
    y: -1080,
    w: 4480,
    h: 2520
  });
});

test("a crop is never negative, in any arrangement", () => {
  // The classic multi-monitor bug, stated as a test. A crop is relative to the
  // span, so it is non-negative even when the screen's desktop coordinates are
  // not.
  for (const [name, monitors] of Object.entries(ARRANGEMENTS)) {
    for (const monitor of monitors) {
      const crop = cropFor(monitor, monitors);
      assert.ok(crop.x >= 0, `${name}: crop.x is ${crop.x}`);
      assert.ok(crop.y >= 0, `${name}: crop.y is ${crop.y}`);
    }
  }
});

test("every crop lies inside the span, in any arrangement", () => {
  for (const [name, monitors] of Object.entries(ARRANGEMENTS)) {
    const box = boundingBox(monitors);

    for (const monitor of monitors) {
      const crop = cropFor(monitor, monitors);
      assert.ok(crop.x + crop.w <= box.w, `${name}: crop runs ${crop.x + crop.w - box.w}px wide`);
      assert.ok(crop.y + crop.h <= box.h, `${name}: crop runs ${crop.y + crop.h - box.h}px tall`);
    }
  }
});

test("the span is tight: some screen touches each edge of it", () => {
  // A span larger than it needs to be would waste sky, and - worse - would
  // move the sun, because the horizontal field of view is spread across the
  // whole span.
  for (const [name, monitors] of Object.entries(ARRANGEMENTS)) {
    const box = boundingBox(monitors);
    const crops = monitors.map((m) => cropFor(m, monitors));

    assert.ok(
      crops.some((c) => c.x === 0),
      `${name}: nothing touches the left edge`
    );
    assert.ok(
      crops.some((c) => c.y === 0),
      `${name}: nothing touches the top edge`
    );
    assert.ok(
      crops.some((c) => c.x + c.w === box.w),
      `${name}: nothing touches the right edge`
    );
    assert.ok(
      crops.some((c) => c.y + c.h === box.h),
      `${name}: nothing touches the bottom edge`
    );
  }
});

test("no two screens are given overlapping slices", () => {
  // Two surfaces drawing the same sky into the same place would be wasted
  // work, and on a real desktop it would mean one window covering another.
  for (const [name, monitors] of Object.entries(ARRANGEMENTS)) {
    const crops = monitors.map((m) => cropFor(m, monitors));

    for (let i = 0; i < crops.length; i += 1) {
      for (let j = i + 1; j < crops.length; j += 1) {
        const a = crops[i];
        const b = crops[j];
        assert.ok(a && b);
        assert.ok(
          !intersects(a, b),
          `${name}: slice ${i} overlaps slice ${j} (${JSON.stringify(a)} / ${JSON.stringify(b)})`
        );
      }
    }
  }
});

test("a row of three tiles the span exactly, with no gap and no seam", () => {
  const monitors = ARRANGEMENTS["a row of three"];
  const crops = monitors.map((m) => cropFor(m, monitors));

  assert.deepEqual(crops, [
    { x: 0, y: 0, w: 1920, h: 1080 },
    { x: 1920, y: 0, w: 1920, h: 1080 },
    { x: 3840, y: 0, w: 1920, h: 1080 }
  ]);

  // Edge to edge: each crop begins exactly where the last one ended, which is
  // the seam test stated arithmetically. A one-pixel error here is a visible
  // line down the join.
  for (let i = 1; i < crops.length; i += 1) {
    const previous = crops[i - 1];
    const here = crops[i];
    assert.ok(previous && here);
    assert.equal(here.x, previous.x + previous.w, `a gap or overlap before screen ${i}`);
  }

  assert.equal(describe(monitors).gapFraction, 0);
});

test("mixed DPI gives equal angular slices at different pixel densities", () => {
  // The substance of US-012's "each screen's slice is correct for its own
  // resolution and scaling". The two screens report the same DIP size, so they
  // get the same slice of sky; only the pixel ratio differs, which is what
  // makes the 4K screen draw it with four times the pixels.
  const monitors = ARRANGEMENTS["mixed DPI"];
  const [standard, dense] = monitors.map((m) => geometryFor(m, monitors));

  assert.ok(standard && dense);
  assert.equal(standard.crop.w, dense.crop.w);
  assert.equal(standard.pixelRatio, 1);
  assert.equal(dense.pixelRatio, 2);

  // And both are told the same span, because there is one sky.
  assert.deepEqual(standard.span, dense.span);
  assert.deepEqual(standard.span, { w: 3840, h: 1080 });
});

test("a rotated screen makes the span taller and offsets its neighbour", () => {
  const monitors = ARRANGEMENTS["a rotated screen beside a landscape one"];
  const box = boundingBox(monitors);

  assert.equal(box.h, 1920, "the portrait screen sets the height");
  assert.equal(box.w, 3000);

  const [landscape, portrait] = monitors.map((m) => cropFor(m, monitors));
  assert.ok(landscape && portrait);

  // The landscape screen sits part way down the span, so its slice of sky
  // starts below the top. Forgetting this is how a shorter screen ends up
  // showing the wrong part of the sky vertically.
  assert.equal(portrait.y, 0);
  assert.equal(landscape.y, 420);
  assert.equal(landscape.y + landscape.h, 1500);
});

test("a gap in an L-shape stays a gap", () => {
  // Closing it would be the bug: it would shift one screen's slice and move
  // the sun off its true azimuth there, which architecture invariant 5
  // forbids.
  const monitors = ARRANGEMENTS["an L-shape with a gap"];
  const facts = describe(monitors);

  assert.deepEqual(facts.box, { x: 0, y: -1080, w: 3840, h: 2160 });
  assert.equal(facts.overlaps, false);

  // Two screens of 1920x1080 inside a box of 3840x2160: exactly half of it is
  // sky nobody sees.
  assert.equal(facts.covered, 2 * 1920 * 1080);
  assert.equal(facts.area, 3840 * 2160);
  assert.equal(facts.gapFraction, 0.5);
});

test("a screen left of the primary gets the left-hand slice, not a negative one", () => {
  const monitors = ARRANGEMENTS["a screen to the left of the primary"];
  const [primary, left] = monitors;
  assert.ok(primary && left);

  assert.deepEqual(cropFor(left, monitors), { x: 0, y: 0, w: 1920, h: 1080 });
  assert.deepEqual(cropFor(primary, monitors), { x: 1920, y: 0, w: 1920, h: 1080 });
});

test("physical rectangles are normalised to the virtual screen's top-left", () => {
  // The conversion is injected because it cannot be computed; this stub is
  // what a single-scale arrangement does, where DIP and physical agree.
  /** @param {{x: number, y: number, w: number, h: number}} bounds */
  const identity = (bounds) => ({ ...bounds });

  const monitors = ARRANGEMENTS["a screen to the left of the primary"];
  const [primary, left] = monitors;
  assert.ok(primary && left);

  assert.deepEqual(physicalRectFor(left, monitors, identity), {
    x: 0,
    y: 0,
    w: 1920,
    h: 1080
  });
  assert.deepEqual(physicalRectFor(primary, monitors, identity), {
    x: 1920,
    y: 0,
    w: 1920,
    h: 1080
  });
});

test("physical rectangles follow the OS through a mixed-DPI arrangement", () => {
  // What Windows actually reports for a 1080p screen at 100% with a 4K screen
  // at 200% to its right: the second screen's physical width is 3840, so the
  // virtual screen is 5760 physical pixels wide even though it is 3840 in DIP.
  // Multiplying either screen's DIP bounds by either scale factor gives the
  // wrong answer, which is why the real conversion is the OS's.
  const monitors = ARRANGEMENTS["mixed DPI"];
  const [standard, dense] = monitors;
  assert.ok(standard && dense);

  /** @param {{x: number, y: number, w: number, h: number}} bounds */
  const osConversion = (bounds) =>
    bounds.x === 0 ? { x: 0, y: 0, w: 1920, h: 1080 } : { x: 1920, y: 0, w: 3840, h: 2160 };

  assert.deepEqual(physicalRectFor(standard, monitors, osConversion), {
    x: 0,
    y: 0,
    w: 1920,
    h: 1080
  });
  assert.deepEqual(physicalRectFor(dense, monitors, osConversion), {
    x: 1920,
    y: 0,
    w: 3840,
    h: 2160
  });
});

test("overlapping screens are reported rather than hidden", () => {
  // Windows allows it - cloned or partly mirrored screens - and a wallpaper is
  // in no position to refuse. The editor needs to be able to say so.
  const monitors = [screenAt(0, 0, 1920, 1080, { primary: true }), screenAt(960, 0, 1920, 1080)];

  const facts = describe(monitors);
  assert.equal(facts.overlaps, true);

  // Covered area exceeds the box, and the gap is clamped rather than reported
  // as negative.
  assert.ok(facts.covered > facts.area);
  assert.equal(facts.gapFraction, 0);
});

test("no screens at all still gives a usable span", () => {
  // A headless test run, and the moment between the last monitor leaving and
  // the application noticing. A zero-sized span would divide by zero in the
  // renderer's aspect arithmetic.
  const box = boundingBox([]);
  assert.ok(box.w > 0);
  assert.ok(box.h > 0);
});

test("the sun crosses the span, which is why one sky is composed for all of it", () => {
  // US-012's "the sun occupies its true azimuth within that span and so
  // crosses from the left monitor to the right over the day", expressed as the
  // geometric fact the renderer relies on: a point at a given fraction of the
  // span lands on exactly one screen, and as that fraction sweeps from 0 to 1
  // it visits the screens in order.
  const monitors = ARRANGEMENTS["a row of three"];
  const box = boundingBox(monitors);
  const crops = monitors.map((m) => cropFor(m, monitors));

  /** @param {number} fraction */
  const screenAtFraction = (fraction) => {
    const x = fraction * box.w;
    return crops.findIndex((c) => x >= c.x && x < c.x + c.w);
  };

  assert.equal(screenAtFraction(0.0), 0);
  assert.equal(screenAtFraction(0.2), 0);
  assert.equal(screenAtFraction(0.5), 1);
  assert.equal(screenAtFraction(0.8), 2);
  assert.equal(screenAtFraction(0.99), 2);

  // Monotonic, with no fraction falling through a crack.
  let previous = 0;
  for (let i = 0; i <= 100; i += 1) {
    const found = screenAtFraction(i / 100.000001);
    assert.notEqual(found, -1, `nothing shows the sky at ${i}% across the span`);
    assert.ok(found >= previous, `the sun went backwards at ${i}%`);
    previous = found;
  }
});
