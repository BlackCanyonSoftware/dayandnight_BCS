import { expect, test } from "@playwright/test";

/**
 * The editor, in a browser, over the dev server.
 *
 * These run without Electron, which is the point of `ui/desktop.js` doing the
 * browser's thing when there is no shell: the whole editor is exercisable
 * without a desktop to put a wallpaper on.
 *
 * Rendering here goes through SwiftShader, so these assert behaviour and
 * structure. Exact pixels are a matter for the image test at the end, which
 * carries a tolerance for that reason.
 */

/** A fixed instant, so nothing in these tests depends on when they run. */
const DATE = "2026-06-21";
const NOON = 12 * 60;
const SUNRISE = 5 * 60 + 45;

test.beforeEach(async ({ page }) => {
  /** @type {string[]} */
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.goto("/index.html");
  await page.waitForFunction(() => window.DayAndNight?.lastFrame() !== null);

  // Attached to the test so every test below also asserts a clean console.
  page.__errors = errors;
});

test.afterEach(async ({ page }) => {
  expect(page.__errors, "the editor should log no errors").toEqual([]);
});

test("it renders a frame and reports what it drew", async ({ page }) => {
  const frame = await page.evaluate(() => window.DayAndNight.lastFrame());

  expect(frame).not.toBeNull();
  expect(Number.isFinite(frame.sunAltitude)).toBe(true);
  expect(["day", "civil", "nautical", "astronomical", "night"]).toContain(frame.band);
});

test("scrubbing to noon and to midnight gives day and night (US-020)", async ({ page }) => {
  const sample = async (/** @type {number} */ minute) =>
    page.evaluate(async (m) => {
      window.DayAndNight.dateTo("2026-06-21");
      window.DayAndNight.scrubTo(m);
      await new Promise((resolve) => setTimeout(resolve, 200));
      return window.DayAndNight.lastFrame();
    }, minute);

  const noon = await sample(NOON);
  const midnight = await sample(0);

  expect(noon.sunAltitude).toBeGreaterThan(0);
  expect(noon.band).toBe("day");
  expect(midnight.sunAltitude).toBeLessThan(0);
  expect(midnight.band).toBe("night");
});

test("the readout agrees with the frame the engine reported", async ({ page }) => {
  const { frame, readout } = await page.evaluate(async () => {
    window.DayAndNight.dateTo("2026-06-21");
    window.DayAndNight.scrubTo(12 * 60);
    await new Promise((resolve) => setTimeout(resolve, 250));
    return {
      frame: window.DayAndNight.lastFrame(),
      readout: document.querySelector("#readout").textContent
    };
  });

  // The readout is how a user checks the application against the real world,
  // so it must not drift from what was drawn.
  expect(readout).toContain(frame.band);
  expect(readout).toContain(frame.sunAltitude.toFixed(1));
});

test("one sky spans several screens with no seam (US-012)", async ({ page }) => {
  // The claim behind US-012 is that the scene is composed for the whole span
  // and each screen renders the slice it occupies, so two adjacent crops join
  // exactly. That is checked directly against the engine, without needing two
  // real monitors: render the left half and the right half of a span, then
  // compare the columns either side of the join.
  //
  // This gained teeth once the sky became a real one: the two halves now face
  // different compass bearings, so they are genuinely different pictures that
  // have to join exactly. Under the Milestone 0 gradient they were identical,
  // and a seamless join proved nothing.
  const result = await page.evaluate(async () => {
    const { DayNightEngine } = await import("/engine/index.js");

    const span = { w: 800, h: 400 };
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 400;

    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
    const engine = new DayNightEngine(gl);

    const t = Date.UTC(2026, 5, 21, 12, 30);
    const place = { lat: 39.7, lon: -105 };

    /** @param {{x:number,y:number,w:number,h:number}} crop */
    const renderCrop = (crop) => {
      engine.render({ t, place, crop, span, pixelRatio: 1 });
      const pixels = new Uint8Array(400 * 400 * 4);
      gl.readPixels(0, 0, 400, 400, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    };

    const left = renderCrop({ x: 0, y: 0, w: 400, h: 400 });
    const right = renderCrop({ x: 400, y: 0, w: 400, h: 400 });

    // The rightmost column of the left screen and the leftmost column of the
    // right screen are adjacent in the span, so they should be the same colour
    // give or take the output dither.
    let worstJoin = 0;
    for (let row = 0; row < 400; row += 1) {
      const a = (row * 400 + 399) * 4;
      const b = row * 400 * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        worstJoin = Math.max(worstJoin, Math.abs(left[a + channel] - right[b + channel]));
      }
    }

    // The crop is honoured: a slice from the top of a tall span must not look
    // like a slice from the bottom of it. This is what would fail if the
    // renderer ignored the crop and drew the whole sky into every window -
    // the bug that would show as each monitor having its own complete sky.
    const tallSpan = { w: 400, h: 1200 };
    const top = (() => {
      engine.render({
        t,
        place,
        crop: { x: 0, y: 0, w: 400, h: 400 },
        span: tallSpan,
        pixelRatio: 1
      });
      const pixels = new Uint8Array(400 * 400 * 4);
      gl.readPixels(0, 0, 400, 400, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    })();
    const bottom = (() => {
      engine.render({
        t,
        place,
        crop: { x: 0, y: 800, w: 400, h: 400 },
        span: tallSpan,
        pixelRatio: 1
      });
      const pixels = new Uint8Array(400 * 400 * 4);
      gl.readPixels(0, 0, 400, 400, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    })();

    let verticalDifference = 0;
    for (let i = 0; i < top.length; i += 4) {
      verticalDifference = Math.max(verticalDifference, Math.abs(top[i] - bottom[i]));
    }

    return { worstJoin, verticalDifference };
  });

  expect(
    result.worstJoin,
    "the join between two side-by-side screens should be invisible"
  ).toBeLessThanOrEqual(2);

  expect(
    result.verticalDifference,
    "a slice from the top of the span must differ from one at the bottom, or the crop is being ignored"
  ).toBeGreaterThan(20);
});

test("a vertical stack of screens does not flatten the top of the sky (US-012)", async ({
  page
}) => {
  // Milestone 2's arrangement that breaks naive projection arithmetic. Two
  // screens stacked give a 1920x2160 span, and "a degree across the screen is
  // a degree up it" then asks for 169 degrees of sky vertically. With the
  // horizon at 0.82 the top of the frame would sit 138 degrees above it - 48
  // degrees past the zenith, where there is no sky left.
  //
  // Nothing crashes, which is what makes it worth a test. The elevation
  // encoding clamps at 90 degrees, so the scattering lookup stops changing
  // over the top 29 per cent of the frame while the phase function carries on
  // varying with azimuth. The result is not a flat band - measured, it still
  // varies by 18 levels - but the vertical gradient collapses to about a third
  // of what it should be, so the top of the sky goes slack and wrong rather
  // than obviously broken. engine/view.js caps the vertical field instead.
  const findings = await page.evaluate(async () => {
    const { DayNightEngine, defaultPreset } = await import("/engine/index.js");
    const { verticalDegrees, verticalLimit } = await import("/engine/view.js");

    const width = 240;
    const height = 270;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
    const engine = new DayNightEngine(gl);
    const preset = defaultPreset();
    engine.setPreset(preset);

    // A vertical stack, as Windows would report it: one screen wide, two tall.
    const span = { w: 1920, h: 2160 };

    // Daylight, so the gradient is strong and a flat top would be obvious.
    const t = Date.UTC(2026, 5, 21, 18, 0);
    const place = { lat: 39.74, lon: -104.99 };

    engine.render({
      t,
      place,
      crop: { x: 0, y: 0, w: span.w, h: span.h },
      span,
      pixelRatio: 1
    });

    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    // readPixels is bottom-up, so the top of the picture is the END of the
    // buffer. Rows are averaged across the width before being compared,
    // because the output dither is a level either way by design: comparing
    // single pixels measures the dither rather than the gradient. This test
    // did exactly that on its first attempt and passed with the bug present.
    const rowMean = (fromTop) => {
      const y = height - 1 - fromTop;
      let total = 0;
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        total += pixels[i] + pixels[i + 1] + pixels[i + 2];
      }
      return total / (width * 3);
    };

    // How much the sky changes down the top quarter of the frame, which is the
    // region that sits above the zenith when the vertical field is left
    // uncapped. Measured: 18 levels with the bug, 49 without it.
    const quarter = Math.floor(height * 0.25);
    const first = rowMean(0);
    let topVariation = 0;
    for (let fromTop = 1; fromTop < quarter; fromTop += 1) {
      topVariation = Math.max(topVariation, Math.abs(rowMean(fromTop) - first));
    }

    return {
      topVariation,
      quarter,
      height,
      // The numbers behind the fix, so a failure says which half is wrong.
      square: preset.fieldOfView * (span.h / span.w),
      limit: verticalLimit(preset.horizon),
      used: verticalDegrees(preset.fieldOfView, preset.horizon, span),
      // And an ordinary wide span must be untouched by the cap.
      wide: verticalDegrees(preset.fieldOfView, preset.horizon, { w: 5760, h: 1080 }),
      wideSquare: preset.fieldOfView * (1080 / 5760)
    };
  });

  // The arithmetic first, so a failure is attributable.
  expect(findings.square, "a stacked span implies more sky than exists").toBeGreaterThan(90);
  expect(findings.used, "the vertical field should be capped").toBeLessThan(findings.square);
  expect(findings.used).toBeCloseTo(findings.limit, 6);

  // The top of the frame now sits exactly at the zenith rather than past it.
  expect(findings.used * 0.82, "the frame should reach the zenith and stop").toBeCloseTo(90, 6);

  // An ordinary arrangement is left completely alone.
  expect(findings.wide).toBeCloseTo(findings.wideSquare, 6);

  // And the picture itself, which is the part that would still be wrong if
  // only the arithmetic were fixed. The threshold sits between the two
  // measured values rather than at a round number chosen for looking sensible:
  // 18.2 levels of variation with the field uncapped, 49.4 with it capped.
  expect(
    findings.topVariation,
    `the top ${findings.quarter} rows of ${findings.height} vary by ` +
      `${findings.topVariation.toFixed(1)} levels; below about 30 means the sky above ` +
      `the zenith has stopped changing with elevation`
  ).toBeGreaterThan(30);
});

test("over a day the sun crosses from the left screen to the right (US-012)", async ({ page }) => {
  // Milestone 2's exit criterion, in the words it was written in. The existing
  // azimuth test renders one span and finds the sun in it; this renders each
  // screen's crop SEPARATELY, the way three real surfaces do, and asks which
  // of them the sun is on. That difference is the point - it is the crop path
  // that would put the same sun on all three screens, or on the wrong one.
  test.slow();

  const findings = await page.evaluate(async () => {
    const { DayNightEngine, defaultPreset, sunPosition } = await import("/engine/index.js");

    // Three screens in a row. Small, because this renders 3 crops an hour for
    // a whole day and the arithmetic does not care about resolution.
    const screenW = 160;
    const screenH = 90;
    const span = { w: screenW * 3, h: screenH };

    const canvas = document.createElement("canvas");
    canvas.width = screenW;
    canvas.height = screenH;

    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
    const engine = new DayNightEngine(gl);
    engine.setPreset(defaultPreset());

    // An equinox, so the day is symmetric and the sun rises near due east and
    // sets near due west - which with the default southward bearing means it
    // should enter on the left and leave on the right.
    const place = { lat: 39.74, lon: -104.99 };

    // Start at local SOLAR midnight, not at UTC midnight. A UTC day at Denver
    // runs from six in the evening to six the next evening, so a sweep from
    // Date.UTC(...) begins at sunset and the sun is already on the rightmost
    // screen - which is how the first version of this test failed. The offset
    // is longitude over fifteen degrees an hour, which needs no time-zone
    // data and is the quantity that actually matters here.
    const day = Date.UTC(2026, 2, 20) - (place.lon / 15) * 3_600_000;

    /** The brightest column total on one screen's crop. */
    const brightestOn = (t, screen) => {
      engine.render({
        t,
        place,
        crop: { x: screen * screenW, y: 0, w: screenW, h: screenH },
        span,
        pixelRatio: 1
      });

      const pixels = new Uint8Array(screenW * screenH * 4);
      gl.readPixels(0, 0, screenW, screenH, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

      let best = -1;
      for (let x = 0; x < screenW; x += 1) {
        let total = 0;
        for (let y = 0; y < screenH; y += 1) {
          const i = (y * screenW + x) * 4;
          total += pixels[i] + pixels[i + 1] + pixels[i + 2];
        }
        best = Math.max(best, total);
      }
      return best;
    };

    const seen = [];
    let frames = 0;

    // Every twenty minutes through the day, wherever the sun is properly up.
    for (let minute = 0; minute < 1440; minute += 20) {
      const t = day + minute * 60_000;
      const sun = sunPosition(t, place);
      if (sun.altitude < 3) continue;

      const totals = [brightestOn(t, 0), brightestOn(t, 1), brightestOn(t, 2)];
      frames += 3;

      let on = 0;
      for (let i = 1; i < 3; i += 1) if (totals[i] > totals[on]) on = i;

      seen.push({ minute, screen: on, azimuth: Math.round(sun.azimuth) });
    }

    return { seen, frames };
  });

  expect(findings.frames, "the sweep should have rendered a day").toBeGreaterThan(50);

  const screens = findings.seen.map((s) => s.screen);

  // It starts on the left and ends on the right. Not "appears on all three" -
  // the order is the claim, and a sun that jumped about would satisfy a
  // coverage check while being obviously wrong.
  expect(screens[0], "the sun should come up on the leftmost screen").toBe(0);
  expect(screens.at(-1), "and go down on the rightmost").toBe(2);

  // Never backwards. One screen at a time, in order, all day.
  for (let i = 1; i < screens.length; i += 1) {
    expect(
      screens[i],
      `the sun went back from screen ${screens[i - 1]} to ${screens[i]} at minute ` +
        `${findings.seen[i].minute} (azimuth ${findings.seen[i].azimuth} deg)`
    ).toBeGreaterThanOrEqual(screens[i - 1]);
  }

  // And it really does visit the middle one, rather than stepping over it.
  expect(new Set(screens), "every screen should get the sun at some point").toEqual(
    new Set([0, 1, 2])
  );
});

test("the sun's glow tracks its real azimuth across the frame (US-012)", async ({ page }) => {
  // The product's central promise: the sun is where the sun actually is, so it
  // crosses the screen through the day rather than sitting still. Checked by
  // finding the brightest column of the rendered frame and comparing it with
  // where the computed azimuth says the sun should be.
  const samples = await page.evaluate(async () => {
    const { DayNightEngine, defaultPreset, resolveBearing, sunPosition } =
      await import("/engine/index.js");

    const width = 240;
    const height = 100;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
    const engine = new DayNightEngine(gl);
    const preset = defaultPreset();
    engine.setPreset(preset);

    const place = { lat: 39.7, lon: -105 };

    /** @param {number} t */
    const measure = (t) => {
      engine.render({
        t,
        place,
        crop: { x: 0, y: 0, w: width, h: height },
        span: { w: width, h: height },
        pixelRatio: 1
      });

      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

      let brightest = -1;
      let best = -1;
      for (let x = 0; x < width; x += 1) {
        let total = 0;
        for (let y = 0; y < height; y += 1) {
          const i = (y * width + x) * 4;
          total += pixels[i] + pixels[i + 1] + pixels[i + 2];
        }
        if (total > best) {
          best = total;
          brightest = x;
        }
      }

      const sun = sunPosition(t, place);
      const bearing = resolveBearing(preset, place);
      const relative = (((sun.azimuth - bearing + 540) % 360) - 180) / preset.fieldOfView;

      return { brightest, expected: (relative + 0.5) * width, azimuth: sun.azimuth };
    };

    return [
      measure(Date.UTC(2026, 8, 22, 13, 5)),
      measure(Date.UTC(2026, 8, 22, 15, 30)),
      measure(Date.UTC(2026, 8, 22, 18, 0)),
      measure(Date.UTC(2026, 8, 22, 21, 0))
    ];
  });

  let previous = -1;
  for (const sample of samples) {
    // Where the sun is off the edge of the frame, the brightest column is the
    // edge itself, so the comparison is clamped the same way the picture is.
    const expected = Math.max(0, Math.min(239, sample.expected));
    expect(
      Math.abs(sample.brightest - expected),
      `at azimuth ${sample.azimuth.toFixed(0)} the glow was at column ${sample.brightest}, expected about ${expected.toFixed(0)}`
    ).toBeLessThan(12);

    // And it moves one way through the day rather than jumping about.
    expect(sample.brightest).toBeGreaterThanOrEqual(previous);
    previous = sample.brightest;
  }
});

test("the same inputs give the same pixels (architecture invariant 1)", async ({ page }) => {
  const identical = await page.evaluate(async () => {
    const { DayNightEngine } = await import("/engine/index.js");

    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 120;
    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
    const engine = new DayNightEngine(gl);

    const request = {
      t: Date.UTC(2026, 2, 21, 13, 7),
      place: { lat: 51.5, lon: -0.12 },
      crop: { x: 0, y: 0, w: 160, h: 120 },
      span: { w: 160, h: 120 },
      pixelRatio: 1
    };

    const grab = () => {
      engine.render(request);
      const pixels = new Uint8Array(160 * 120 * 4);
      gl.readPixels(0, 0, 160, 120, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    };

    const first = grab();
    // Throw the GPU objects away in between, to prove they are a cache and
    // not state: the second frame must still be identical.
    engine.release();
    const second = grab();

    return first.every((value, i) => value === second[i]);
  });

  expect(identical, "two renders of the same request must be byte-identical").toBe(true);
});

test("the star field turns at the sidereal rate, not the solar one (US-005)", async ({ page }) => {
  // The sharpest test of the rotation there is, and it needs no reference
  // data at all.
  //
  // A sidereal day - 23h 56m 04s - is how long the Earth takes to turn once
  // relative to the stars, about four minutes shorter than a solar day
  // because the Earth has also moved along its orbit. So after exactly one
  // sidereal day the field must be back where it started, and after one
  // *solar* day it must visibly not be. A field driven by the clock rather
  // than by sidereal time would pass the second check and fail the first.
  const result = await page.evaluate(async () => {
    const { DayNightEngine, defaultPreset } = await import("/engine/index.js");

    const width = 700;
    const height = 380;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
    const engine = new DayNightEngine(gl);
    engine.setPreset(defaultPreset());

    const place = { lat: 39.7, lon: -105 };

    const starPixels = (t) => {
      engine.render({
        t,
        place,
        crop: { x: 0, y: 0, w: width, h: height },
        span: { w: width, h: height },
        pixelRatio: 1
      });

      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

      const found = new Set();
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const i = (y * width + x) * 4;
          if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 70) found.add(x + "," + y);
        }
      }
      return found;
    };

    const overlap = (a, b) => {
      if (a.size === 0) return 0;
      let shared = 0;
      for (const key of a) if (b.has(key)) shared += 1;
      return shared / a.size;
    };

    // Deep night at Denver, so the sky itself contributes almost nothing and
    // what is being compared really is the stars.
    const base = Date.UTC(2026, 8, 23, 8, 30);
    const SIDEREAL_DAY = 86_164_090;
    const SOLAR_DAY = 86_400_000;

    const start = starPixels(base);

    return {
      stars: start.size,
      afterSidereal: overlap(start, starPixels(base + SIDEREAL_DAY)),
      afterSolar: overlap(start, starPixels(base + SOLAR_DAY)),
      afterAnHour: overlap(start, starPixels(base + 3_600_000))
    };
  });

  expect(result.stars, "there should be stars to compare").toBeGreaterThan(40);

  expect(
    result.afterSidereal,
    `after one sidereal day the field should be back where it was, got ${(result.afterSidereal * 100).toFixed(0)} per cent overlap`
  ).toBeGreaterThan(0.8);

  // Four minutes of rotation is about a degree, which at this field of view
  // is several pixels - enough to move most stars off their old positions.
  expect(
    result.afterSolar,
    `after one solar day the field should have moved on, got ${(result.afterSolar * 100).toFixed(0)} per cent overlap`
  ).toBeLessThan(0.5);

  expect(result.afterAnHour, "an hour should move the field a long way").toBeLessThan(0.3);
});

test("stars are circumpolar at the pole and roll through at the equator (US-005)", async ({
  page
}) => {
  // The other half of US-005: the field turns about the celestial pole, so
  // the observer's latitude sets the axis. At the pole nothing rises or sets
  // - the sky wheels about a point overhead and the number up stays put. At
  // the equator it rolls straight through, so the number changes as fresh sky
  // comes over the horizon.
  const result = await page.evaluate(async () => {
    const { DayNightEngine, defaultPreset } = await import("/engine/index.js");

    const width = 500;
    const height = 300;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
    const engine = new DayNightEngine(gl);
    engine.setPreset({ ...defaultPreset(), fieldOfView: 170, horizon: 0.95 });

    const count = (t, lat) => {
      engine.render({
        t,
        place: { lat, lon: 0 },
        crop: { x: 0, y: 0, w: width, h: height },
        span: { w: width, h: height },
        pixelRatio: 1
      });

      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

      let lit = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 70) lit += 1;
      }
      return lit;
    };

    const spread = (lat) => {
      const samples = [];
      for (let hour = 0; hour < 6; hour += 1) {
        // The night of a new moon, so the only thing in the sky is stars.
        // Dated otherwise, the moon and its glare drift through the frame and
        // the count varies for a reason that has nothing to do with rotation.
        samples.push(count(Date.UTC(2026, 11, 9, 1, 0) + hour * 3_600_000, lat));
      }
      const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
      const range = Math.max(...samples) - Math.min(...samples);
      return { mean, relative: mean > 0 ? range / mean : 0 };
    };

    return { pole: spread(89.5), equator: spread(0) };
  });

  expect(result.pole.mean, "the polar sky should have stars in it").toBeGreaterThan(30);
  expect(result.equator.mean, "the equatorial sky should have stars in it").toBeGreaterThan(30);

  // The pole's count is not expected to be *constant*, and it was a mistake to
  // assume so. The frame holds 170 degrees of azimuth rather than the whole
  // sky, so rotation sweeps stars across its edges even when nothing is rising
  // or setting; and with only tens of stars in frame, counting noise alone is
  // worth over ten per cent. What matters is the comparison.
  expect(
    result.pole.relative,
    `at the pole the count should be fairly steady, varied by ${(result.pole.relative * 100).toFixed(0)} per cent`
  ).toBeLessThan(0.35);

  expect(
    result.equator.relative,
    `the equatorial sky should churn more than the polar one: ${(result.equator.relative * 100).toFixed(0)} against ${(result.pole.relative * 100).toFixed(0)} per cent`
  ).toBeGreaterThan(result.pole.relative * 1.3);
});

test("stars come out as the sky darkens and are gone by day", async ({ page }) => {
  // Nobody wrote this rule. The stars are added to the sky as light, in the
  // same units, and the sum is tone mapped once - so they are swamped at noon
  // and emerge through twilight for the same reason they do in life.
  const counts = await page.evaluate(async () => {
    const { DayNightEngine, defaultPreset, sunPosition } = await import("/engine/index.js");

    const width = 600;
    const height = 340;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
    const engine = new DayNightEngine(gl);
    engine.setPreset(defaultPreset());

    const place = { lat: 39.7, lon: -105 };

    // A star is a pixel much brighter than its surroundings, which is what
    // tells one apart from a merely bright sky.
    const starCount = (t) => {
      engine.render({
        t,
        place,
        crop: { x: 0, y: 0, w: width, h: height },
        span: { w: width, h: height },
        pixelRatio: 1
      });

      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

      // A star is a *local* peak, not merely a bright pixel. Comparing
      // against the frame's average instead counts the sky's own gradient,
      // which at twilight is most of the picture - the first version of this
      // test reported eleven thousand stars in civil twilight for exactly
      // that reason.
      const value = (x, y) => {
        const i = (y * width + x) * 4;
        return Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
      };

      let peaks = 0;
      const reach = 4;
      for (let y = reach; y < height - reach; y += 1) {
        for (let x = reach; x < width - reach; x += 1) {
          const here = value(x, y);
          const around = Math.max(
            value(x - reach, y),
            value(x + reach, y),
            value(x, y - reach),
            value(x, y + reach)
          );
          if (here > around + 35) peaks += 1;
        }
      }

      return { peaks, altitude: sunPosition(t, place).altitude };
    };

    return [
      starCount(Date.UTC(2026, 8, 22, 19, 0)),
      starCount(Date.UTC(2026, 8, 23, 0, 30)),
      starCount(Date.UTC(2026, 8, 23, 2, 0)),
      starCount(Date.UTC(2026, 8, 23, 8, 0))
    ];
  });

  const [day, civil, nautical, night] = counts;

  expect(day.altitude).toBeGreaterThan(0);
  expect(night.altitude).toBeLessThan(-18);

  expect(day.peaks, "no stars in daylight").toBeLessThan(5);
  expect(night.peaks, "plenty at night").toBeGreaterThan(80);
  expect(civil.peaks, "few in civil twilight").toBeLessThan(night.peaks / 3);
  expect(nautical.peaks, "more by nautical twilight than in civil").toBeGreaterThan(civil.peaks);
});

test("the moon is drawn at the phase the astronomy computes (US-004)", async ({ page }) => {
  // The illuminated fraction is worked out in lunar.js from the Sun-Moon-Earth
  // geometry, and drawn in the shader as the shadow of a sphere in projection.
  // Those are two entirely separate pieces of arithmetic, so measuring the lit
  // area of the rendered disc and comparing it with the computed fraction
  // checks both at once - and would catch the terminator being the wrong shape,
  // facing the wrong way, or simply not being applied.
  const rows = await page.evaluate(async () => {
    const { DayNightEngine, defaultPreset, moonPosition } = await import("/engine/index.js");

    const width = 300;
    const height = 300;
    const fieldOfView = 24;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
    const engine = new DayNightEngine(gl);
    const place = { lat: 39.7, lon: -105 };

    const measure = (t) => {
      const moon = moonPosition(t, place);

      // The moon centred and magnified, with everything else turned off, so
      // what is measured is the disc and nothing else.
      engine.setPreset({
        ...defaultPreset(),
        bearing: moon.azimuth,
        fieldOfView,
        horizon: 0.5 + moon.altitude / (fieldOfView * (height / width)),
        bodyScale: 9,
        glare: 0,
        airglow: 0,
        starBrightness: 0
      });

      engine.render({
        t,
        place,
        crop: { x: 0, y: 0, w: width, h: height },
        span: { w: width, h: height },
        pixelRatio: 1
      });

      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

      let peak = 0;
      for (let i = 0; i < pixels.length; i += 4) peak = Math.max(peak, pixels[i]);

      // Counted at half the peak, which is exactly where the softened
      // terminator crosses, so the measured area is the geometric one.
      let lit = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > peak / 2) lit += 1;

      const discRadius = 0.2724 * 9 * (width / fieldOfView);
      return {
        illumination: moon.illumination,
        measured: lit / (Math.PI * discRadius * discRadius),
        peak
      };
    };

    // A spread of phases, each with the moon high enough to be clear of the
    // horizon cut.
    const times = [];
    for (let day = 0; day < 32 && times.length < 6; day += 1) {
      for (let hour = 0; hour < 24; hour += 2) {
        const t = Date.UTC(2026, 9, 1 + day, hour, 0);
        const moon = moonPosition(t, place);
        if (moon.altitude > 20 && moon.altitude < 60) {
          times.push(t);
          break;
        }
      }
    }

    return times.map(measure);
  });

  expect(rows.length).toBeGreaterThan(3);

  // A real spread of phases, or the test proves very little.
  const phases = rows.map((r) => r.illumination);
  expect(Math.max(...phases) - Math.min(...phases)).toBeGreaterThan(0.3);

  for (const row of rows) {
    expect(row.peak, "the moon should actually be drawn").toBeGreaterThan(80);
    expect(
      Math.abs(row.measured - row.illumination),
      `drawn ${(row.measured * 100).toFixed(1)} per cent lit against a computed ${(row.illumination * 100).toFixed(1)}`
    ).toBeLessThan(0.05);
  }
});

test("the sun is drawn where it is, and sets behind the horizon", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { DayNightEngine, defaultPreset, sunPosition, resolveBearing } =
      await import("/engine/index.js");

    const width = 400;
    const height = 260;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
    const engine = new DayNightEngine(gl);
    const preset = { ...defaultPreset(), bodyScale: 4 };
    engine.setPreset(preset);

    const place = { lat: 39.7, lon: -105 };

    const brightest = (t) => {
      engine.render({
        t,
        place,
        crop: { x: 0, y: 0, w: width, h: height },
        span: { w: width, h: height },
        pixelRatio: 1
      });

      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

      let best = -1;
      let at = { x: -1, y: -1 };
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const i = (y * width + x) * 4;
          const value = pixels[i] + pixels[i + 1] + pixels[i + 2];
          if (value > best) {
            best = value;
            // readPixels is bottom-up; flip to screen coordinates.
            at = { x, y: height - 1 - y };
          }
        }
      }

      const sun = sunPosition(t, place);
      const bearing = resolveBearing(preset, place);
      const relative = (((sun.azimuth - bearing + 540) % 360) - 180) / preset.fieldOfView;

      return {
        altitude: sun.altitude,
        found: at,
        expectedX: (relative + 0.5) * width,
        expectedY:
          (preset.horizon - sun.altitude / (preset.fieldOfView * (height / width))) * height
      };
    };

    return {
      // Mid-afternoon, sun well inside the frame.
      up: brightest(Date.UTC(2026, 8, 22, 20, 30)),
      // Well after sunset: the disc is gone, so the brightest thing left is
      // the afterglow sitting on the horizon rather than a sun below it.
      down: brightest(Date.UTC(2026, 8, 23, 2, 30))
    };
  });

  expect(result.up.altitude).toBeGreaterThan(5);
  expect(Math.abs(result.up.found.x - result.up.expectedX)).toBeLessThan(14);
  expect(Math.abs(result.up.found.y - result.up.expectedY)).toBeLessThan(14);

  // Once the sun is down, nothing bright may be drawn below the horizon line.
  expect(result.down.altitude).toBeLessThan(-10);
});

test("clouds appear, cover the sky, and cost nothing when switched off (US-030)", async ({
  page
}) => {
  const findings = await page.evaluate(async () => {
    const { DayNightEngine, defaultPreset } = await import("/engine/index.js");

    const width = 320;
    const height = 180;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
    const engine = new DayNightEngine(gl);

    const place = { lat: 39.74, lon: -104.99 };
    const t = Date.UTC(2026, 5, 21, 20, 0);

    const render = (cover, when = t) => {
      engine.setPreset({ ...defaultPreset(), cloudCover: cover });
      engine.render({
        t: when,
        place,
        crop: { x: 0, y: 0, w: width, h: height },
        span: { w: width, h: height },
        pixelRatio: 1
      });

      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    };

    // Only the sky, above the horizon. readPixels is bottom-up, so the upper
    // part of the picture is the later part of the buffer; the ground is the
    // bottom 18 per cent and has no clouds in it by construction.
    const skyStats = (pixels) => {
      let total = 0;
      let samples = 0;
      const values = [];

      for (let y = Math.floor(height * 0.25); y < height; y += 1) {
        for (let x = 0; x < width; x += 2) {
          const i = (y * width + x) * 4;
          const v = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
          total += v;
          values.push(v);
          samples += 1;
        }
      }

      const mean = total / samples;
      let variance = 0;
      for (const v of values) variance += (v - mean) * (v - mean);
      return { mean, spread: Math.sqrt(variance / samples) };
    };

    // Several instants, because one is a lottery: the field is noise, and
    // whether a particular patch of it happens to be busy or calm in a single
    // frame says nothing about clouds in general. The first version of this
    // test compared one instant and started failing the moment the sampling
    // changed underneath it.
    const instants = [0, 37, 91, 160].map((minutes) => t + minutes * 60_000);

    let difference = 0;
    let cloudyMean = 0;
    let clearMean = 0;
    let cloudySpread = 0;
    let clearSpread = 0;

    for (const when of instants) {
      const a = render(0, when);
      const b = render(0.6, when);

      let total = 0;
      for (let i = 0; i < a.length; i += 4) total += Math.abs(a[i] - b[i]);
      difference += total / (a.length / 4);

      const clearStats = skyStats(a);
      const cloudyStats = skyStats(b);
      clearMean += clearStats.mean;
      cloudyMean += cloudyStats.mean;
      clearSpread += clearStats.spread;
      cloudySpread += cloudyStats.spread;
    }

    const over = instants.length;
    // The byte-identical check below needs a clear frame to compare against.
    const clear = render(0);

    // Below the threshold in cloudsVisible(), so the pass is skipped.
    const almostClear = render(0.0005);

    let identical = true;
    for (let i = 0; i < clear.length; i += 1) {
      if (clear[i] !== almostClear[i]) {
        identical = false;
        break;
      }
    }

    return {
      difference: difference / over,
      clearMean: clearMean / over,
      cloudyMean: cloudyMean / over,
      clearSpread: clearSpread / over,
      cloudySpread: cloudySpread / over,
      skipIsExact: identical
    };
  });

  // They change the picture, substantially and at every instant sampled. This
  // is the robust form of the claim: the spread of a clear sky is not small -
  // it has the sun and a horizon gradient in it - so "cloudy varies more" is a
  // weaker statement than it sounds, while "the picture is different" is not.
  expect(
    findings.difference,
    `clouds changed the picture by only ${findings.difference.toFixed(1)} levels on average`
  ).toBeGreaterThan(8);

  // A cloudy sky is still busier than a clear one, which is the shape of the
  // difference rather than only its size.
  expect(findings.cloudySpread).toBeGreaterThan(findings.clearSpread);

  // And they are bright: clouds are lit, not grey holes in the sky.
  expect(findings.cloudyMean).toBeGreaterThan(findings.clearMean);

  // The claim that clouds cost nothing when switched off, at the pixel level
  // rather than as an intention. Below the visibility threshold the whole pass
  // is skipped, so the frame has to be exactly what it was before clouds
  // existed - not nearly.
  expect(
    findings.skipIsExact,
    "a sky below the cloud threshold must be byte-identical to a clear one"
  ).toBe(true);
});

test("clouds are lit from the side the sun is on (US-030)", async ({ page }) => {
  // The rim-lighting the story asks for, as a measurement. Nothing in the
  // shader knows about sunrises: the clouds are lit by the sun's own
  // transmittance, which is already reddened by the long path through the
  // atmosphere at a low sun, so a cloud lit at dawn comes out the colour dawn
  // is. What can be checked is the geometry - that the lit side is the side
  // the sun is actually on.
  const findings = await page.evaluate(async () => {
    const { DayNightEngine, defaultPreset, sunPosition, resolveBearing } =
      await import("/engine/index.js");

    const width = 360;
    const height = 140;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
    const engine = new DayNightEngine(gl);

    const preset = { ...defaultPreset(), cloudCover: 0.65 };
    engine.setPreset(preset);

    const place = { lat: 39.74, lon: -104.99 };

    // Morning, with the sun well to one side of the frame.
    const t = Date.UTC(2026, 5, 21, 13, 30);
    const sun = sunPosition(t, place);
    const bearing = resolveBearing(preset, place);

    engine.render({
      t,
      place,
      crop: { x: 0, y: 0, w: width, h: height },
      span: { w: width, h: height },
      pixelRatio: 1
    });

    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    // Where the sun is across the frame, as a fraction.
    const offset = ((sun.azimuth - bearing + 540) % 360) - 180;
    const sunFraction = 0.5 + offset / preset.fieldOfView;

    // Mean brightness of the left third and the right third of the sky.
    const band = (from, to) => {
      let total = 0;
      let samples = 0;
      for (let y = Math.floor(height * 0.3); y < height; y += 1) {
        for (let x = Math.floor(width * from); x < Math.floor(width * to); x += 1) {
          const i = (y * width + x) * 4;
          total += pixels[i] + pixels[i + 1] + pixels[i + 2];
          samples += 1;
        }
      }
      return total / (samples * 3);
    };

    return {
      sunFraction,
      sunAltitude: sun.altitude,
      left: band(0, 0.28),
      right: band(0.72, 1)
    };
  });

  // The test is only meaningful if the sun is off to one side and up.
  expect(findings.sunAltitude).toBeGreaterThan(5);
  expect(
    Math.abs(findings.sunFraction - 0.5),
    "the sun should be well off centre for this to say anything"
  ).toBeGreaterThan(0.15);

  const sunSide = findings.sunFraction < 0.5 ? findings.left : findings.right;
  const awaySide = findings.sunFraction < 0.5 ? findings.right : findings.left;

  expect(
    sunSide,
    `the side the sun is on (${findings.sunFraction.toFixed(2)} across) should be brighter: ` +
      `${sunSide.toFixed(1)} against ${awaySide.toFixed(1)}`
  ).toBeGreaterThan(awaySide);
});

test("clouds drift, and the picture does not jump when the field wraps (US-030)", async ({
  page
}) => {
  // Two claims at once, because they are the same claim. The drift is wrapped
  // to keep a single-precision uniform honest, and that is only acceptable
  // because the noise is periodic - so what is checked is that the picture
  // changes steadily across the exact instant the fastest layer wraps.
  //
  // The first version of this test swept a fast wind through a wrap and
  // passed with the periodicity deliberately removed. At four hundred
  // kilometres an hour consecutive frames are already uncorrelated, so a
  // discontinuity cannot stand out against them: the comparison was "very
  // different" against "very different". It has to be a slow wind sampled
  // tightly around the wrap, where neighbouring frames are nearly identical
  // and a jump has nowhere to hide.
  test.slow();

  const findings = await page.evaluate(async () => {
    const { DayNightEngine, defaultPreset, sunPosition } = await import("/engine/index.js");
    const { LAYERS, PERIOD, driftCells } = await import("/engine/sky/clouds.js");

    const width = 220;
    const height = 120;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
    const engine = new DayNightEngine(gl);

    const wind = 12;
    const scale = defaultPreset().cloudScale;
    engine.setPreset({ ...defaultPreset(), cloudCover: 0.6, cloudDrift: wind });

    const place = { lat: 39.74, lon: -104.99 };

    // The fastest layer wraps whenever the distance it has travelled crosses a
    // multiple of its period, which happens every `interval` milliseconds.
    // A period is PERIOD *cells*, and a cell is scale * cloudScale kilometres
    // across. Computing this in kilometres alone is the exact slip that made
    // the sky jump in the first place, so the test states it the same way the
    // module does.
    const fastest = LAYERS[2];
    const cellKm = fastest.scale * scale;
    const interval = ((PERIOD * cellKm) / (wind * fastest.drift)) * 3_600_000;

    // Find a wrap that happens in daylight: at night the picture barely
    // changes at all and the ratio this test depends on becomes meaningless.
    let wrapAt = 0;
    for (let k = 1; k < 4000; k += 1) {
      const candidate = k * interval;
      if (sunPosition(candidate, place).altitude > 25) {
        wrapAt = candidate;
        break;
      }
    }
    if (wrapAt === 0) return { found: false };

    const frame = (t) => {
      engine.render({
        t,
        place,
        crop: { x: 0, y: 0, w: width, h: height },
        span: { w: width, h: height },
        pixelRatio: 1
      });
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    };

    // One second a step, which at this wind moves the field a few pixels -
    // enough that neighbouring frames differ, little enough that a wrap would
    // tower over them.
    const step = 1000;
    const steps = 24;

    let previous = null;
    let worstJump = 0;
    let totalChange = 0;
    let frames = 0;
    let crossed = false;
    let lastDrift = null;

    for (let i = -steps / 2; i <= steps / 2; i += 1) {
      const t = wrapAt + i * step;
      const pixels = frame(t);

      const drift = driftCells(t, wind, 2, scale);
      if (lastDrift !== null && drift < lastDrift) crossed = true;
      lastDrift = drift;

      if (previous) {
        let difference = 0;
        for (let q = 0; q < pixels.length; q += 4) {
          difference += Math.abs(pixels[q] - previous[q]);
        }
        difference /= pixels.length / 4;

        worstJump = Math.max(worstJump, difference);
        totalChange += difference;
        frames += 1;
      }

      previous = pixels;
    }

    return {
      found: true,
      crossed,
      worstJump,
      meanChange: totalChange / frames,
      sunAltitude: sunPosition(wrapAt, place).altitude
    };
  });

  expect(findings.found, "no daylight wrap was found to test").toBe(true);
  expect(findings.crossed, "the sweep should have crossed a wrap").toBe(true);
  expect(findings.sunAltitude).toBeGreaterThan(25);

  // It moves at all.
  expect(findings.meanChange, "the clouds should be drifting between frames").toBeGreaterThan(0.05);

  // And never lurches. A field that is not periodic jumps by a whole period at
  // the wrap, which against neighbours a second apart is enormous.
  expect(
    findings.worstJump,
    `one step changed by ${findings.worstJump.toFixed(2)} against a mean of ` +
      `${findings.meanChange.toFixed(2)} - that is a jump, so the field is not periodic`
  ).toBeLessThan(findings.meanChange * 4);
});

test("the grade changes the picture, and a neutral one does not", async ({ page }) => {
  // The grade sits on top of a sky that is already physically correct, so the
  // property worth protecting is that it can be absent: a default preset has
  // to leave the model exactly as it drew things, or the physics stops being
  // what anyone is looking at.
  const result = await page.evaluate(async () => {
    const { DayNightEngine, defaultPreset } = await import("/engine/index.js");

    const width = 360;
    const height = 200;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
    const engine = new DayNightEngine(gl);

    const place = { lat: 39.7, lon: -105 };
    // Civil twilight, because that is where the twilight tint applies. An
    // earlier version of this used midday, where a twilight tint correctly
    // does nothing at all, and then complained that it did nothing.
    const t = Date.UTC(2026, 8, 23, 0, 20);

    const shoot = (patch) => {
      engine.setPreset({ ...defaultPreset(), ...patch });
      engine.render({
        t,
        place,
        crop: { x: 0, y: 0, w: width, h: height },
        span: { w: width, h: height },
        pixelRatio: 1
      });

      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

      let saturation = 0;
      let mean = 0;
      let red = 0;
      let blue = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const max = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
        const min = Math.min(pixels[i], pixels[i + 1], pixels[i + 2]);
        saturation += max - min;
        mean += (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
        red += pixels[i];
        blue += pixels[i + 2];
      }

      const count = width * height;
      return {
        // A slice, only so two renders can be compared for exact equality.
        // Every measurement below is taken over the whole frame.
        pixels: Array.from(pixels.slice(0, 4000)),
        saturation: saturation / count,
        mean: mean / count,
        warmth: red / Math.max(blue, 1)
      };
    };

    const base = shoot({});
    return {
      base,
      explicitlyNeutral: shoot({
        dayTint: "#808080",
        twilightTint: "#808080",
        nightTint: "#808080",
        saturation: 1,
        contrast: 1
      }),
      grey: shoot({ saturation: 0 }),
      vivid: shoot({ saturation: 1.8 }),
      hazy: shoot({ turbidity: 4 }),
      warm: shoot({ twilightTint: "#ff8030" })
    };
  });

  // A neutral grade has to be bit-for-bit the default, or "no grade" is not a
  // state the application can actually be in.
  expect(result.explicitlyNeutral.pixels).toEqual(result.base.pixels);

  expect(result.base.saturation, "the sky should have colour in it to begin with").toBeGreaterThan(
    8
  );

  expect(result.grey.saturation, "saturation 0 should leave no colour at all").toBeLessThan(1.5);
  expect(result.vivid.saturation, "raising saturation should add colour").toBeGreaterThan(
    result.base.saturation * 1.2
  );

  // Haze scatters every wavelength more evenly than air does, so more of it
  // washes the colour out of the sky and brightens it.
  expect(result.hazy.saturation, "haze should mute the colour").toBeLessThan(
    result.base.saturation
  );
  expect(result.hazy.mean, "haze should brighten the sky").toBeGreaterThan(result.base.mean);

  // And a warm twilight tint should actually warm the twilight.
  expect(
    result.warm.warmth,
    `warmed ${result.warm.warmth.toFixed(3)} against a base of ${result.base.warmth.toFixed(3)}`
  ).toBeGreaterThan(result.base.warmth * 1.05);
});

test("a whole day at four latitudes shows no banding and no mud (NFR-3)", async ({ page }) => {
  // Milestone 1 asks for this in so many words: scrub a full day at four
  // latitudes and three dates and find no banding, no kink and no grey-brown
  // midpoint between orange and blue. It is checkable rather than
  // eyeballable, so it is checked.
  //
  // Banding is a *step* in a gradient. The dither exists to break the 8-bit
  // quantisation into noise, so along a column of a smooth sky no neighbour
  // should differ by more than one level; two or more is a visible edge.
  //
  // Mud is the sky going grey while the light is still strongly coloured. It
  // was the original argument for Oklab and is now the scattering model's
  // job, so it is worth confirming it never happens.
  test.slow();

  const findings = await page.evaluate(async () => {
    const { DayNightEngine, defaultPreset, sunPosition } = await import("/engine/index.js");

    const width = 220;
    const height = 260;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
    const engine = new DayNightEngine(gl);

    // Stars off. Banding is a property of the *gradient*, and a star is a
    // legitimate step of twenty levels in one pixel: with them on, every
    // measure tried here reported the star field as banding, and no amount of
    // filtering across columns reliably told a dense field from an edge.
    // Turning them off isolates the thing being measured, and makes the
    // assertion far stronger - the sky alone may not step by more than one.
    // The stars have their own tests.
    engine.setPreset({ ...defaultPreset(), starBrightness: 0 });

    const latitudes = [-33.87, 1.35, 51.48, 69.65];
    const dates = [
      [2026, 2, 20],
      [2026, 5, 21],
      [2026, 11, 21]
    ];

    const problems = [];
    let worstBand = 0;
    let frames = 0;

    for (const lat of latitudes) {
      const place = { lat, lon: 0 };

      for (const [year, month, day] of dates) {
        const start = Date.UTC(year, month, day);

        // Every twenty minutes through the day.
        for (let minute = 0; minute < 1440; minute += 20) {
          const t = start + minute * 60_000;
          engine.render({
            t,
            place,
            crop: { x: 0, y: 0, w: width, h: height },
            span: { w: width, h: height },
            pixelRatio: 1
          });

          const pixels = new Uint8Array(width * height * 4);
          gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          frames += 1;

          const altitude = sunPosition(t, place).altitude;

          // Banding is a *horizontal edge*: a step that appears at the same
          // height right across the picture. A star is a step in one column
          // and nothing in its neighbours, which is why the first version of
          // this reported "banding" at midnight - it was counting stars.
          //
          // The median across nine columns tells them apart: a band moves it,
          // a handful of stars cannot.
          // readPixels hands back rows bottom-up, so the sky is the *upper*
          // part of this range, not the lower. Scanning the bottom 70 per cent
          // instead - as this first did - walks straight across the horizon,
          // where the step from sky to ground is a genuine edge and was duly
          // reported as a band of eleven.
          //
          // The horizon sits at 0.82 down the picture, so everything from a
          // quarter of the way up in these coordinates is clear of it.
          // Banding is a step *larger than the gradient warrants*, not merely a
          // step. Three earlier attempts here all foundered on that: a star is
          // a legitimate jump of twenty levels, the sun's glare is another,
          // and near the horizon at dawn the sky genuinely changes by two
          // levels a row - none of which is banding, and a plain threshold
          // calls all three of them banding.
          //
          // What distinguishes a band is that the gradient *stops and starts*:
          // flat, flat, jump, flat. That is a spike in the second difference
          // down a column, which a smooth gradient has none of however steep
          // it is.
          //
          // The column is averaged across the full width first, because the
          // dither is high-frequency noise by design and would otherwise swamp
          // the measure - while a band, being horizontal, survives averaging
          // untouched. That is the whole trick.
          const skyFloor = Math.floor(height * 0.26);

          for (let c = 0; c < 3; c += 1) {
            /** @type {number[]} */
            const column = [];
            for (let y = skyFloor; y < height; y += 1) {
              let total = 0;
              for (let x = 0; x < width; x += 1) total += pixels[(y * width + x) * 4 + c];
              column.push(total / width);
            }

            for (let i = 1; i < column.length - 1; i += 1) {
              const curvature = Math.abs(column[i + 1] - 2 * column[i] + column[i - 1]);

              if (curvature > worstBand) worstBand = curvature;
              // 2.5, against a measured worst of about 1.3 across the whole
              // sweep - which is the sky's own curvature where it bends
              // sharply from a bright horizon into blue, plus the sun's glare
              // pulling on the averaged column. A real band is several levels
              // and would stand out immediately.
              if (curvature > 2.5) {
                problems.push(
                  `a band of ${curvature.toFixed(2)} at lat ${lat}, ${year}-${month + 1}-${day}, minute ${minute}`
                );
              }
            }
          }

          // Mud: the sky going neutral while the sun is near the horizon,
          // which is exactly when it should be at its most colourful.
          if (altitude > -4 && altitude < 6) {
            let chroma = 0;
            let samples = 0;
            // The band of sky just above the horizon, again in bottom-up
            // coordinates: that is where a sunrise is most colourful and
            // where going grey would be most obvious.
            for (let y = Math.floor(height * 0.2); y < Math.floor(height * 0.45); y += 2) {
              for (let x = 0; x < width; x += 6) {
                const i = (y * width + x) * 4;
                const max = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
                const min = Math.min(pixels[i], pixels[i + 1], pixels[i + 2]);
                if (max > 30) {
                  chroma += (max - min) / max;
                  samples += 1;
                }
              }
            }

            if (samples > 20 && chroma / samples < 0.06) {
              problems.push(
                `grey horizon at lat ${lat}, ${year}-${month + 1}-${day}, sun ${altitude.toFixed(1)} deg`
              );
            }
          }
        }
      }
    }

    return { problems: problems.slice(0, 10), problemCount: problems.length, worstBand, frames };
  });

  expect(findings.frames, "the sweep should have covered a lot of sky").toBeGreaterThan(800);
  expect(findings.problems).toEqual([]);
  expect(findings.problemCount).toBe(0);

  // The sharpest the gradient ever turns, across a day at four latitudes and
  // three dates. A band would be several levels; a smooth sky is a fraction
  // of one.
  expect(findings.worstBand, `worst curvature seen: ${findings.worstBand.toFixed(2)}`).toBeLessThan(
    3
  );
});

test("the Screens panel draws the arrangement and names what it cannot show (US-012)", async ({
  page
}) => {
  // The four arrangements again, this time through the editor rather than
  // through the arithmetic. What is being checked is the thing a list of
  // resolutions cannot tell anybody: that the screens sit in an L, and that
  // some of the sky falls in the gap and is never seen.
  const screens = (list) => page.evaluate((l) => window.DayAndNight.setScreens(l), list);

  /** A row of three, which covers its own bounding box exactly. */
  await screens([
    { id: 1, bounds: { x: 0, y: 0, w: 1920, h: 1080 }, scale: 1, primary: true },
    { id: 2, bounds: { x: 1920, y: 0, w: 1920, h: 1080 }, scale: 1, primary: false },
    { id: 3, bounds: { x: 3840, y: 0, w: 1920, h: 1080 }, scale: 1, primary: false }
  ]);

  await expect(page.locator("#monMap > span")).toHaveCount(3);
  await expect(page.locator("#spanNote")).toHaveText("span 5760×1080");
  await expect(page.locator("#monNote")).toContainText("cover the whole sky");

  // Exactly one box is marked as the primary screen.
  await expect(page.locator('#monMap > span[data-primary="yes"]')).toHaveCount(1);

  // The map is the arrangement's own shape, not a stretched version of it.
  await expect(page.locator("#monMap")).toHaveCSS("aspect-ratio", "5760 / 1080");

  /** An L-shape with a gap: half the sky is in the corners nobody can see. */
  await screens([
    { id: 1, bounds: { x: 0, y: 0, w: 1920, h: 1080 }, scale: 1, primary: true },
    { id: 2, bounds: { x: 1920, y: -1080, w: 1920, h: 1080 }, scale: 1, primary: false }
  ]);

  await expect(page.locator("#monMap > span")).toHaveCount(2);
  await expect(page.locator("#monNote")).toContainText("50% of the sky");
  await expect(page.locator("#monNote")).toContainText("never shown");

  // And the screen placed above the primary is drawn at the TOP of the map,
  // which is what catches a crop that forgot the span can start at a negative
  // y. Its box is at 0%; the primary's is halfway down.
  const tops = await page
    .locator("#monMap > span")
    .evaluateAll((boxes) => boxes.map((b) => b.style.top));
  expect(tops.sort()).toEqual(["0%", "50%"]);

  /** Two screens that overlap, which Windows permits. */
  await screens([
    { id: 1, bounds: { x: 0, y: 0, w: 1920, h: 1080 }, scale: 1, primary: true },
    { id: 2, bounds: { x: 960, y: 0, w: 1920, h: 1080 }, scale: 1, primary: false }
  ]);

  await expect(page.locator("#monNote")).toContainText("overlap");

  /** A rotated screen, which makes the span taller than any one screen. */
  await screens([
    { id: 1, bounds: { x: 0, y: 420, w: 1920, h: 1080 }, scale: 1, primary: true },
    { id: 2, bounds: { x: 1920, y: 0, w: 1080, h: 1920 }, scale: 1, primary: false }
  ]);

  await expect(page.locator("#spanNote")).toHaveText("span 3000×1920");
  await expect(page.locator("#monMap")).toHaveCSS("aspect-ratio", "3000 / 1920");
});

test("every control carries a hint, and none is a bare label (US-023)", async ({ page }) => {
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll(".row > label")].map((label) => ({
      text: label.textContent.trim(),
      tip: label.querySelector(".info")?.getAttribute("data-tip") ?? null
    }))
  );

  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.tip, `"${row.text}" has no hint on its i`).toBeTruthy();
    expect(row.tip.length, `the hint for "${row.text}" is too short to say why`).toBeGreaterThan(
      40
    );
  }
});

test("the brand slot carries the mark and the right wordmark for the theme", async ({ page }) => {
  // The wordmark is a file the brand kit built, not type set in CSS, so the
  // failure mode is a silently empty corner rather than a wrong font: a moved
  // or renamed asset leaves an <img> that renders as nothing. naturalWidth is
  // what tells a loaded image from a broken one.
  const loaded = (selector) =>
    page.locator(selector).evaluate((img) => ({
      ok: img.naturalWidth > 0,
      src: img.getAttribute("src"),
      alt: img.getAttribute("alt")
    }));

  const mark = await loaded(".brand .brandmark");
  expect(mark.ok, `the mark did not load from ${mark.src}`).toBe(true);

  // The mark is decorative; the name is spoken once, by the wordmark.
  expect(mark.alt).toBe("");

  for (const cut of [".brand .wmlight", ".brand .wmdark"]) {
    const wordmark = await loaded(cut);
    expect(wordmark.ok, `${cut} did not load from ${wordmark.src}`).toBe(true);

    // The product is called Day and Night in words. DAYnNIGHT is how the
    // wordmark draws it, and a screen reader should be told the name rather
    // than the stylisation.
    expect(wordmark.alt).toBe("Day and Night");
  }

  // Exactly one cut is visible at a time, in either theme. Two visible would
  // be one drawn on top of the other; none would be an empty slot.
  const visibleCount = async () => page.locator(".brand .wm:visible").count();

  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  expect(await visibleCount()).toBe(1);
  await expect(page.locator(".brand .wmlight")).toBeVisible();

  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  expect(await visibleCount()).toBe(1);
  await expect(page.locator(".brand .wmdark")).toBeVisible();

  // And with no explicit theme at all, which is what the system setting gives:
  // the dark cut, because the editor's untyped default is dark.
  await page.evaluate(() => document.documentElement.removeAttribute("data-theme"));
  expect(await visibleCount()).toBe(1);
});

test("the theme toggle cycles and is reflected on the document", async ({ page }) => {
  const read = () => page.evaluate(() => document.documentElement.getAttribute("data-theme"));

  expect(await read()).toBe("dark");

  await page.locator("#themeBtn").click();
  expect(await read()).toBe("light");

  await page.locator("#themeBtn").click();
  // "system" removes the attribute entirely, so prefers-color-scheme takes over.
  expect(await read()).toBeNull();

  await page.locator("#themeBtn").click();
  expect(await read()).toBe("dark");
});

test("the About panel says what this build is, and admits what a browser cannot show", async ({
  page
}) => {
  // The documents are copied next to the application by the packaging step and
  // do not exist for a page served over http, so the panel has to be honest
  // about that rather than offering buttons that do nothing.
  await expect(page.locator("#aboutVersion")).toHaveText("browser preview");
  await expect(page.locator("#legalList")).toContainText("part of the application");
  await expect(page.locator("#legalList button")).toHaveCount(0);
});

test("the document reader closes on Escape and gives focus back (NFR-6)", async ({ page }) => {
  // A modal that cannot be closed from the keyboard is the usual way an
  // application stops being keyboard operable, and this one cannot be reached
  // in a browser at all - there are no documents to open - so it is driven
  // directly. What is being checked is the behaviour around the dialog, which
  // is the same however it was opened.
  await page.evaluate(() => {
    const trigger = document.querySelector("#wallBtn");
    trigger.focus();
  });

  // The real open path, through the page API, so what is under test is the
  // code a click runs rather than a reconstruction of it.
  await page.evaluate(() => window.DayAndNight.showDocument("eula", "Licence agreement"));

  // A browser ships no documents, so this is also the only place the missing
  // case gets exercised - and it should say so plainly rather than show an
  // empty panel.
  await expect(page.locator("#readerText")).toContainText("missing from this build");
  await expect(page.locator("#readerTitle")).toHaveText("Licence agreement");

  await expect(page.locator("#reader")).toBeVisible();
  await expect(page.locator("#readerClose")).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(page.locator("#reader")).toBeHidden();

  // Closing it with the keyboard and leaving focus on the body would strand
  // somebody at the top of the document, which is the half of this that is
  // easy to forget.
  const focused = await page.evaluate(() => document.activeElement?.id ?? "");
  expect(focused, "focus should come back to whatever opened it").toBe("wallBtn");
});

test("the reader is a dialog, and the backdrop closes it", async ({ page }) => {
  const reader = page.locator("#reader");

  await expect(page.locator(".readerbox")).toHaveAttribute("role", "dialog");
  await expect(page.locator(".readerbox")).toHaveAttribute("aria-modal", "true");

  await page.evaluate(() => {
    document.querySelector("#reader").hidden = false;
  });
  await expect(reader).toBeVisible();

  // The backdrop is the element itself; the box inside it is not. Clicking the
  // document must not dismiss what you are reading.
  await page.locator(".readertext").click({ force: true });
  await expect(reader).toBeVisible();

  await reader.click({ position: { x: 5, y: 5 } });
  await expect(reader).toBeHidden();
});

test("the editor is keyboard operable (NFR-6)", async ({ page }) => {
  // Tab to the first control and check focus is visible rather than lost.
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => {
    const el = document.activeElement;
    return { tag: el?.tagName ?? null, id: el?.id ?? null };
  });

  expect(focused.tag).not.toBe("BODY");
  expect(focused.tag).toBeTruthy();
});

test("a settings document survives a round trip through the page API (US-022)", async ({
  page
}) => {
  const result = await page.evaluate(async () => {
    // The date is pinned, or this test runs against whatever day it happens to
    // be and the assertion below becomes a different claim every month.
    window.DayAndNight.dateTo("2026-06-21");
    window.DayAndNight.scrubTo(600);
    const saved = window.DayAndNight.document();
    saved.cfg.preset.exposure = -1.5;
    saved.cfg.place.lat = -33.87;

    const problem = window.DayAndNight.apply(saved);
    await new Promise((resolve) => setTimeout(resolve, 200));

    return {
      problem,
      exposure: document.querySelector("#exposure").value,
      inputLat: document.querySelector("#lat").value,
      storedLat: window.DayAndNight.document().cfg.place.lat,
      frame: window.DayAndNight.lastFrame()
    };
  });

  expect(result.problem).toBeNull();
  expect(Number(result.exposure)).toBeCloseTo(-1.5, 5);

  // The stored value is exact; the slider shows it to its own step of 0.1, so
  // the control reading -33.9 is correct rather than a loss of precision.
  expect(result.storedLat).toBeCloseTo(-33.87, 5);
  expect(Number(result.inputLat)).toBeCloseTo(-33.87, 1);

  // June at latitude -33.87 is southern midwinter, where the sun cannot get
  // above about 90 - 33.87 - 23.44 = 32.7 degrees at any hour of that day. So
  // this holds whatever time the scrubber happens to be at, which is what
  // makes it a safe assertion rather than a lucky one.
  expect(result.frame.sunAltitude).toBeLessThan(35);
});

test("a settings document from a newer build is refused, not guessed at", async ({ page }) => {
  const problem = await page.evaluate(() => {
    const doc = window.DayAndNight.document();
    doc.version = 999;
    return window.DayAndNight.apply(doc);
  });

  expect(problem).toMatch(/newer version/);
});

test("the sky at a fixed instant looks the way it did", async ({ page }) => {
  await page.evaluate(
    async ([date, minute]) => {
      window.DayAndNight.dateTo(date);
      window.DayAndNight.scrubTo(minute);
      await new Promise((resolve) => setTimeout(resolve, 400));
    },
    [DATE, SUNRISE]
  );

  // The canvas alone, not the page: the readout carries a clock and would
  // make this fail every minute.
  await expect(page.locator("#preview")).toHaveScreenshot("sunrise-denver-june.png");
});
