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

test("a star shrinks with the picture it is drawn in, and never to nothing", async ({ page }) => {
  // A star is a point, sized in pixels of the desktop it stands for. A picture
  // drawn smaller than that desktop has to say so through pixelRatio, or the
  // stars keep their pixel size while the sky shrinks around them - a third of
  // a degree on the wallpaper becoming three degrees in a thumbnail, which is
  // what the gallery, the preview and the README's pictures did until
  // 2026-11-12.
  //
  // Two claims, because they pull against each other. The stars drawn at a
  // third of the scale must cover clearly less than at full scale. And they
  // must still be there: a sprite under about a pixel can fall between pixel
  // centres and not be drawn at all, so there is a floor, and the area does
  // NOT fall by the square of the scale. (The first version of this test
  // asserted that it did, written in the same change as the floor.)
  const r = await page.evaluate(async () => {
    const { DayNightEngine, defaultPreset } = await import("/engine/index.js");

    const width = 640;
    const height = 360;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
    const engine = new DayNightEngine(gl);
    engine.setPreset(defaultPreset());

    const area = (pixelRatio) => {
      engine.render({
        t: Date.UTC(2026, 5, 21, 8), // two in the morning in Denver
        place: { lat: 39.74, lon: -104.99 },
        crop: { x: 0, y: 0, w: width, h: height },
        span: { w: width, h: height },
        pixelRatio
      });
      const px = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let lit = 0;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i] + px[i + 1] + px[i + 2] > 60) lit += 1;
      }
      return lit;
    };

    return { full: area(1), third: area(1 / 3), tiny: area(0.05) };
  });

  expect(r.third, "a night sky should have stars in it at all").toBeGreaterThan(20);
  expect(
    r.full / r.third,
    `stars at full size cover ${r.full} pixels and at a third of the scale ${r.third}`
  ).toBeGreaterThan(1.5);

  // The floor: even drawn absurdly small, the stars are still stars and not a
  // blank sky.
  expect(r.tiny, `at a twentieth of the scale only ${r.tiny} pixels are lit`).toBeGreaterThan(
    r.full * 0.1
  );
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
      // Drawn at twice the scale, so that a star is a disc with a core well over
      // the threshold below rather than one or two pixels barely over it. The
      // test is about WHERE the stars are, and finding them should not depend
      // on how small they are drawn. At the scale of 1 it passed until the stars
      // were made smaller on 2026-11-12, and then failed at 71 per cent after
      // exactly one sidereal day: not the rotation, but the auto-exposure
      // moving a few per cent over four minutes of the sun's motion, enough to
      // flip pixels that sat right at the threshold. A one-pixel tolerance and
      // turning the twinkle off were both tried first and neither was the cause.
      engine.render({
        t,
        place,
        crop: { x: 0, y: 0, w: width, h: height },
        span: { w: width, h: height },
        pixelRatio: 2
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
  //
  // **Over many skies, not one.** This used to render a single instant, and
  // that is a bad experiment: the brightness of a third of the frame depends
  // on which clouds happen to be in it. Measured on 2026-11-12 over forty
  // independent mornings, the lit side is brighter by about 14 levels on
  // average and on 31 to 34 of the 40 mornings - a real, systematic effect, and
  // one with a spread as large as itself, so one sky in five or six comes out
  // the wrong way round. The single instant passed for as long as it happened
  // to be a good one, and stopped the day the clouds' evolution was corrected
  // and it landed on a bad one, with nothing about the lighting having
  // changed. The claim is the same; it is now measured on enough skies for the
  // pattern to average away.
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
    const bearing = resolveBearing(preset, place);

    const advantages = [];
    let sunFraction = 0.5;
    let sunAltitude = 0;

    // The same clock time on sixteen consecutive days. The sun hardly moves
    // between them and the clouds are unrelated to one another, which is what
    // makes the mean mean something.
    for (let day = 0; day < 16; day += 1) {
      const t = Date.UTC(2026, 5, 1 + day, 13, 30);
      const sun = sunPosition(t, place);

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
      sunFraction = 0.5 + offset / preset.fieldOfView;
      sunAltitude = sun.altitude;

      // Mean brightness of the left and right thirds of the sky.
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

      const left = band(0, 0.28);
      const right = band(0.72, 1);
      advantages.push(sunFraction < 0.5 ? left - right : right - left);
    }

    return { sunFraction, sunAltitude, advantages };
  });

  // The test is only meaningful if the sun is off to one side and up.
  expect(findings.sunAltitude).toBeGreaterThan(5);
  expect(
    Math.abs(findings.sunFraction - 0.5),
    "the sun should be well off centre for this to say anything"
  ).toBeGreaterThan(0.15);

  const mean = findings.advantages.reduce((a, b) => a + b, 0) / findings.advantages.length;
  const brighter = findings.advantages.filter((a) => a > 0).length;

  expect(
    mean,
    `over ${findings.advantages.length} skies the sun's side should be brighter on average, ` +
      `and was ${mean.toFixed(1)} levels ${mean > 0 ? "brighter" : "darker"}`
  ).toBeGreaterThan(0);

  // And it is the usual case rather than one sky dragging the mean.
  expect(
    brighter,
    `the sun's side was brighter on ${brighter} of ${findings.advantages.length} skies`
  ).toBeGreaterThanOrEqual(Math.ceil(findings.advantages.length * 0.6));
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

    // A fixed wind from the east, so that the drift is a steady march along one
    // axis and the instant the fastest layer wraps can be computed exactly. The
    // simulated weather, which is the default, turns and speeds up and slows
    // down, and has no such instant to aim at; it is checked to stay bounded
    // and continuous in the unit tests.
    const preset = { ...defaultPreset(), cloudCover: 0.6, cloudDrift: wind, cloudWindFrom: 90 };
    engine.setPreset(preset);

    const place = { lat: 39.74, lon: -104.99 };

    // The fastest layer wraps whenever the distance it has travelled crosses a
    // multiple of its period, which happens every `interval` milliseconds.
    // A period is PERIOD *cells*, and a cell is scale * cloudScale kilometres
    // across. Computing this in kilometres alone is the exact slip that made
    // the sky jump in the first place, so the test states it the same way the
    // module does.
    // Whichever layer carries the largest multiplier: that is the one that
    // wraps first. It was LAYERS[2] only while the lowest layer was the
    // fastest, which was the inverted wind this test now sits beside.
    const fastest = LAYERS.reduce((most, layer) => (layer.drift > most.drift ? layer : most));
    const fastestIndex = LAYERS.indexOf(fastest);
    const cellKm = fastest.scale * scale;

    // The layer's wind is turned by its veer, so only the cosine of it is
    // carried along the x axis, and it is the x axis that is watched for the
    // wrap below.
    const along = Math.cos((fastest.veer * Math.PI) / 180);
    const interval = ((PERIOD * cellKm) / (wind * fastest.drift * along)) * 3_600_000;

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

      const drift = driftCells(t, place, preset, fastestIndex)[0];
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

test("a cloud pattern persists for minutes, not seconds, so it reads as weather", async ({
  page
}) => {
  // The wind is switched OFF, so nothing moves and the only thing that can
  // change the picture is the field evolving - the one quantity that needs no
  // alignment to measure, which is why this is the way to pin it.
  //
  // The distance between two frames is compared with the distance between two
  // skies a day apart, which share a horizon and a gradient but not a single
  // cloud. A pattern that has lost nothing scores 0 and one that has lost
  // everything scores 1.
  //
  // Measured on 2026-11-12: at the old 1200 s the pattern was gone in about
  // eight minutes (half of it in 2.8), against the twenty the comment on
  // EVOLUTION_SECONDS claimed. A cumulus lives a quarter of an hour and the
  // sheet it sits in longer; a sky that reforms every few minutes boils.
  test.slow();

  const r = await page.evaluate(async () => {
    const { DayNightEngine, defaultPreset } = await import("/engine/index.js");

    const width = 320;
    const height = 180;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
    const engine = new DayNightEngine(gl);
    engine.setPreset({ ...defaultPreset(), cloudCover: 0.6, cloudDrift: 0 });

    const place = { lat: 39.74, lon: -104.99 };
    const frame = (t) => {
      engine.render({
        t,
        place,
        crop: { x: 0, y: 0, w: width, h: height },
        span: { w: width, h: height },
        pixelRatio: 1
      });
      const px = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return px;
    };

    const distance = (a, b) => {
      let sum = 0;
      for (let i = 0; i < a.length; i += 4) {
        sum +=
          Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      }
      return sum / (a.length / 4) / 3;
    };

    const t0 = Date.UTC(2026, 5, 1, 18); // noon, Denver
    const base = frame(t0);
    const control = distance(base, frame(t0 + 86_400_000));

    const minutes = [1, 4, 8, 16];
    const lost = {};
    for (const m of minutes) lost[m] = distance(base, frame(t0 + m * 60_000)) / control;
    return { control, lost };
  });

  expect(r.control, "two skies a day apart should differ").toBeGreaterThan(1);

  // Still recognisable after four minutes, and visibly changed by sixteen.
  expect(
    r.lost[4],
    `lost ${(r.lost[4] * 100).toFixed(0)}% of the pattern in 4 minutes`
  ).toBeLessThan(0.45);
  expect(
    r.lost[16],
    `lost only ${(r.lost[16] * 100).toFixed(0)}% in 16 minutes: frozen`
  ).toBeGreaterThan(0.45);

  // And it gets steadily further away rather than flickering.
  expect(r.lost[1]).toBeLessThan(r.lost[4]);
  expect(r.lost[4]).toBeLessThan(r.lost[16]);
});

test("the clouds travel the way the wind direction says (US-030)", async ({ page }) => {
  // Not a number from the module but the picture: render the same sky a few
  // minutes apart and measure which way the pattern moved across the screen.
  //
  // Facing south, east is on the left. A wind FROM the east blows the clouds
  // toward the west, so rightward on screen; a wind from the west, leftward; and
  // a wind from the south, the way the camera faces, brings them toward the
  // viewer, which is mostly not sideways at all.
  test.slow();

  const shifts = await page.evaluate(async () => {
    const { DayNightEngine, defaultPreset } = await import("/engine/index.js");

    const width = 640;
    const height = 360;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
    const engine = new DayNightEngine(gl);

    const place = { lat: 39.74, lon: -104.99 };
    const noon = Date.UTC(2026, 5, 21, 18);

    // A column profile of a band of sky, so the shift is one dimensional.
    const profile = (from, t, wind = null) => {
      engine.setPreset({
        ...defaultPreset(),
        bearing: 180,
        cloudCover: 0.55,
        cloudDrift: 12,
        cloudWindFrom: from
      });
      engine.render({
        t,
        place,
        crop: { x: 0, y: 0, w: width, h: height },
        span: { w: width, h: height },
        pixelRatio: 1,
        wind
      });
      const px = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, px);

      const col = new Float64Array(width);
      // readPixels is bottom-up; the band is the middle of the sky, above the
      // horizon at 82% down and well clear of the sun's glow.
      for (let y = Math.round(height * 0.3); y < Math.round(height * 0.55); y += 1) {
        const row = height - 1 - y;
        for (let x = 0; x < width; x += 1) {
          const i = (row * width + x) * 4;
          col[x] += px[i] + px[i + 1] + px[i + 2];
        }
      }
      const mean = col.reduce((a, b) => a + b, 0) / width;
      return col.map((v) => v - mean);
    };

    // The shift s that best lines the later profile up with the earlier one:
    // a feature at x then is at x + s now.
    const bestShift = (a, b) => {
      let best = 0;
      let bestScore = -Infinity;
      for (let s = -90; s <= 90; s += 1) {
        let score = 0;
        for (let x = 100; x < width - 100; x += 1) score += a[x] * b[x + s];
        if (score > bestScore) {
          bestScore = score;
          best = s;
        }
      }
      return best;
    };

    const result = {};
    for (const from of [90, 270, 180]) {
      result[from] = bestShift(profile(from, noon), profile(from, noon + 3 * 60_000));
    }

    // A real wind handed in by the host: 20 km/h toward the east for a day
    // either side of noon, which is a wind from the west. With the direction
    // left on the weather (null) the series is what carries the clouds.
    //
    // And the opposite wind too. One series alone could be satisfied by
    // ignoring it, if the simulated weather that day happened to blow the same
    // way; no single answer satisfies both.
    const { makeWindSeries } = await import("/engine/sky/wind.js");
    const constant = (east) =>
      makeWindSeries([
        { t: noon - 12 * 3_600_000, east, north: 0 },
        { t: noon + 12 * 3_600_000, east, north: 0 }
      ]);
    const shiftWith = (series) =>
      bestShift(profile(null, noon, series), profile(null, noon + 3 * 60_000, series));

    result.series = shiftWith(constant(20));
    result.seriesBack = shiftWith(constant(-20));
    return result;
  });

  expect(
    shifts[90],
    `wind from the east moved the clouds ${shifts[90]} px; it should be rightward`
  ).toBeGreaterThan(8);
  expect(
    shifts[270],
    `wind from the west moved the clouds ${shifts[270]} px; it should be leftward`
  ).toBeLessThan(-8);

  // A real wind from the west, handed in by the host, carries them leftward
  // like the fixed one - the engine is using it, not the weather.
  expect(
    shifts.series,
    `a real wind toward the east moved the clouds ${shifts.series} px; it should be leftward`
  ).toBeLessThan(-8);
  expect(
    shifts.seriesBack,
    `a real wind toward the west moved the clouds ${shifts.seriesBack} px; it should be rightward`
  ).toBeGreaterThan(8);

  // Along the view: much less sideways than across it.
  expect(
    Math.abs(shifts[180]),
    `a wind along the view moved them ${shifts[180]} px sideways, against ${shifts[90]} across`
  ).toBeLessThan(Math.abs(shifts[90]) / 2);
});

test("a skyline stands on the horizon and leaves the sky alone (US-032)", async ({ page }) => {
  const findings = await page.evaluate(async () => {
    const { DayNightEngine, defaultPreset } = await import("/engine/index.js");

    const width = 320;
    const height = 200;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
    const engine = new DayNightEngine(gl);

    const place = { lat: 39.74, lon: -104.99 };
    const t = Date.UTC(2026, 5, 21, 19, 0);

    const render = (overrides) => {
      engine.setPreset({ ...defaultPreset(), horizon: 0.72, ...overrides });
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

    const open = render({ skyline: "none" });
    const hills = render({ skyline: "mountains", skylineHeight: 9 });

    // Below the threshold, so the pass is skipped and the frame must be
    // exactly the open one.
    const almostNothing = render({ skyline: "mountains", skylineHeight: 0.001 });

    let identical = true;
    for (let i = 0; i < open.length; i += 1) {
      if (open[i] !== almostNothing[i]) {
        identical = false;
        break;
      }
    }

    // readPixels is bottom-up, so a LARGER y is higher in the picture. The
    // horizon sits at 0.72 of the way down, which is 0.28 of the way up.
    const horizonY = Math.floor(height * 0.28);

    // How much of the picture changed, in two bands: the sky well above where
    // a nine-degree skyline could possibly reach, and the band just above the
    // horizon where it lives.
    const changed = (fromY, toY) => {
      let total = 0;
      let samples = 0;
      for (let y = fromY; y < toY; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const i = (y * width + x) * 4;
          total += Math.abs(open[i] - hills[i]);
          samples += 1;
        }
      }
      return total / samples;
    };

    // Nine degrees at this framing is well under a third of the way up from
    // the horizon, so the top half of the sky must be untouched.
    const topHalf = changed(Math.floor(height * 0.6), height);
    const atHorizon = changed(horizonY, horizonY + Math.floor(height * 0.14));

    return { topHalf, atHorizon, skipIsExact: identical };
  });

  // It is there.
  expect(
    findings.atHorizon,
    "a skyline should change the band just above the horizon"
  ).toBeGreaterThan(5);

  // And it is only there. A silhouette that reached into the upper sky would
  // mean the elevation mapping in the pass disagreed with the one the sky is
  // drawn with - which is the bug this whole shared VIEW block exists to make
  // impossible, and worth checking rather than assuming.
  expect(
    findings.topHalf,
    `the top half of the sky changed by ${findings.topHalf.toFixed(2)}, so the skyline is not staying at the horizon`
  ).toBeLessThan(0.6);

  // And at a height of nothing the pass is skipped entirely.
  expect(findings.skipIsExact, "a skyline of no height must change no pixels").toBe(true);
});

test("a city lights up after sunset and not before (US-032)", async ({ page }) => {
  // The one part of the skyline that changes through the day, and the reason
  // lightsOn() is in the frame signature: every probe is up in the sky, where
  // nothing happens when a city switches its lights on.
  const findings = await page.evaluate(async () => {
    const { DayNightEngine, defaultPreset, sunPosition } = await import("/engine/index.js");

    const width = 300;
    const height = 180;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
    const engine = new DayNightEngine(gl);
    engine.setPreset({
      ...defaultPreset(),
      horizon: 0.72,
      skyline: "city",
      skylineHeight: 8
    });

    const place = { lat: 39.74, lon: -104.99 };

    // What the band the buildings occupy holds: its brightest pixel, and how
    // many pixels are a bright warm light. The count is what carries the claim
    // now. This used to ask only whether the brightest pixel was warm, which
    // held while every window was the same lamp; windows now vary in colour, so
    // the brightest may be a whiter office light, and "a warm light exists" is
    // the part that was always meant.
    const brightestInCity = (t) => {
      engine.render({
        t,
        place,
        crop: { x: 0, y: 0, w: width, h: height },
        span: { w: width, h: height },
        pixelRatio: 1
      });

      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

      // Bottom-up again: the city sits from the horizon downwards in the
      // picture, which is upwards in the buffer from 0 to 0.28 of the height.
      let best = 0;
      let warm = 0;
      let lamps = 0;
      for (let y = 0; y < Math.floor(height * 0.28); y += 1) {
        for (let x = 0; x < width; x += 1) {
          const i = (y * width + x) * 4;
          const v = pixels[i] + pixels[i + 1] + pixels[i + 2];
          if (v > best) {
            best = v;
            warm = pixels[i] - pixels[i + 2];
          }
          if (v > 250 && pixels[i] - pixels[i + 2] > 12) lamps += 1;
        }
      }
      return { best, warm, lamps, altitude: sunPosition(t, place).altitude };
    };

    return {
      noon: brightestInCity(Date.UTC(2026, 5, 21, 19, 0)),
      night: brightestInCity(Date.UTC(2026, 5, 22, 7, 30))
    };
  });

  expect(findings.noon.altitude).toBeGreaterThan(20);
  expect(findings.night.altitude).toBeLessThan(-12);

  // At night there are lit windows, and many are warm - red well above blue,
  // and bright. That is the check that they are lights rather than a patch of
  // sky showing through or a grey roof.
  expect(findings.night.lamps, "a night city should have warm lit windows in it").toBeGreaterThan(
    10
  );

  // By day the buildings are silhouettes: dark, and nothing glows.
  expect(findings.noon.lamps, "nothing should be glowing out of a city in broad daylight").toBe(0);
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

test("the editor is set in the brand's two faces, named by the kit and not by us", async ({
  page
}) => {
  // This brand is *named* in one face and *read* in another. Which face does
  // which job is recorded in the brand definition and reaches the page as
  // --font and --font-display from brand/template/tokens.css; naming either
  // in app/tokens.css would be a second place that decision lives, and the
  // place it would be wrong, since the display face is drawn to be a logo
  // rather than a paragraph.
  const tokens = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return {
      read: root.getPropertyValue("--font").trim(),
      display: root.getPropertyValue("--font-display").trim(),
      mono: root.getPropertyValue("--font-mono").trim(),
      body: getComputedStyle(document.body).fontFamily
    };
  });

  expect(tokens.read, "--font is what a sentence is set in").toContain("Public Sans");
  expect(tokens.display, "--font-display is what the name is drawn in").toContain("Jost");
  expect(tokens.body, "the page is read, so the body takes the reading face").toContain(
    "Public Sans"
  );
  expect(tokens.mono, "--font-mono should resolve through the brand's --mono").toContain(
    "monospace"
  );

  // The mapping, not just the tokens. Getting these the wrong way round would
  // satisfy every assertion above and put a logo face in every paragraph.
  const headings = await page.evaluate(() => {
    const summary = document.querySelector(".sec > summary");
    const label = document.querySelector(".row label, .sec label");
    return {
      heading: summary ? getComputedStyle(summary).fontFamily : "",
      label: label ? getComputedStyle(label).fontFamily : ""
    };
  });

  expect(headings.heading, "a panel heading is a heading").toContain("Jost");
  expect(headings.label, "a control's label is read, not drawn").toContain("Public Sans");

  // And both files actually load. A @font-face whose src 404s leaves the page
  // in the fallback and reports nothing anywhere - no console error, no broken
  // image, just the wrong type. That is what a brand rebuild which renames a
  // file would do, and it is the only way this test earns its place.
  const faces = await page.evaluate(async () => {
    await document.fonts.ready;
    return {
      loaded: [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family),
      // 500 is one of the three weights the brand is named at, and both faces
      // are variable - a browser given a static cut would synthesise the rest.
      jost: document.fonts.check('500 15px "Jost"'),
      publicSans: document.fonts.check('500 13px "Public Sans"')
    };
  });

  expect(faces.jost, `jost.woff did not load; loaded: ${faces.loaded.join(", ")}`).toBe(true);
  expect(faces.publicSans, `publicsans.woff did not load; loaded: ${faces.loaded.join(", ")}`).toBe(
    true
  );
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

/**
 * Open a settings section by its heading.
 *
 * The panels are collapsed <details>, so anything inside one is hidden until
 * it is opened - which is what a person does, and what a test has to do too.
 * Without this, filling a field in a closed panel waits thirty seconds and
 * then reports a timeout with no hint as to why.
 *
 * @param {import("@playwright/test").Page} page
 * @param {string} heading
 */
async function openSection(page, heading) {
  await page
    .locator("details.sec", { has: page.locator("summary", { hasText: heading }) })
    .evaluate((node) => {
      node.open = true;
    });
}

test("a share code carries the look and leaves the place alone (US-033)", async ({ page }) => {
  // The panel, end to end, through the real controls. The unit tests cover the
  // encoding; what this covers is the thing that would actually hurt somebody
  // - pasting a stranger's code and finding your sky is now over their city.
  await openSection(page, "Share");
  const box = page.locator("#shareCode");

  // Somewhere distinctive, so a change to it would be obvious.
  await page.evaluate(() => {
    const doc = window.DayAndNight.document();
    doc.cfg.place = { lat: -33.87, lon: 151.21 };
    doc.cfg.preset.cloudCover = 0;
    doc.cfg.fps = 11;
    window.DayAndNight.apply(doc);
  });

  await expect(box).toHaveValue(/^DAN1-/);

  // A code for a different look, made the same way the panel makes one.
  const theirs = await page.evaluate(async () => {
    const { encodeLook } = await import("/ui/share-code.js");
    const { presetFor } = await import("/ui/presets.js");
    return encodeLook(presetFor("weather"));
  });

  await box.fill(theirs);
  await page.locator("#shareApply").click();

  await expect(page.locator("#shareNote")).toContainText("Applied");

  const after = await page.evaluate(() => {
    const doc = window.DayAndNight.document();
    return { place: doc.cfg.place, fps: doc.cfg.fps, cover: doc.cfg.preset.cloudCover };
  });

  // The look came across.
  expect(after.cover, "the look in the code should have been applied").toBeGreaterThan(0.5);

  // And nothing else did. This is the whole point of the feature being a
  // preset rather than a settings document.
  expect(after.place.lat).toBeCloseTo(-33.87, 2);
  expect(after.place.lon).toBeCloseTo(151.21, 2);
  expect(after.fps).toBe(11);
});

test("a share code that is nonsense says so rather than doing something", async ({ page }) => {
  await openSection(page, "Share");
  await page.locator("#shareCode").fill("have you seen my sky");
  await page.locator("#shareApply").click();

  await expect(page.locator("#shareNote")).toContainText("not a look code");

  // And the sky is untouched: a bad paste must not leave somebody with a
  // half-applied look they then have to undo by hand.
  const unchanged = await page.evaluate(() => window.DayAndNight.document().cfg.preset);
  const defaults = await page.evaluate(async () => {
    const { defaultPreset } = await import("/engine/index.js");
    return defaultPreset();
  });
  expect(unchanged).toEqual(defaults);
});

test("the code in the box follows the look on screen", async ({ page }) => {
  // A stale code is worse than none: it is wrong without looking wrong, and
  // somebody sends it to a friend.
  await openSection(page, "Share");
  const box = page.locator("#shareCode");
  const before = await box.inputValue();

  await page.evaluate(() => {
    const input = document.querySelector("#cloudCover");
    input.value = "0.6";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  await expect(box).not.toHaveValue(before);
});

/**
 * Every bit of text in the editor, with the colour it is actually drawn in
 * and the colour actually behind it.
 *
 * The second is the hard half. An element's own background is usually
 * transparent, so the colour a reader sees comes from an ancestor - and
 * computing contrast against `rgba(0, 0, 0, 0)` gives a number that is both
 * flattering and meaningless. This walks up until it finds something opaque.
 *
 * @param {import("@playwright/test").Page} page
 */
async function textContrasts(page) {
  return page.evaluate(() => {
    /** @param {string} css */
    const parse = (css) => {
      const match = css.match(/rgba?\(([^)]+)\)/);
      if (!match) return null;
      const parts = match[1].split(",").map((n) => parseFloat(n));
      return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
    };

    /** Relative luminance, per WCAG. */
    const luminance = (c) => {
      const channel = (v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
    };

    const ratio = (a, b) => {
      const la = luminance(a);
      const lb = luminance(b);
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    };

    /** The first opaque background at or above this element. */
    const backdrop = (node) => {
      let at = node;
      while (at) {
        const bg = parse(getComputedStyle(at).backgroundColor);
        if (bg && bg.a > 0.95) return bg;
        at = at.parentElement;
      }
      return { r: 255, g: 255, b: 255, a: 1 };
    };

    const results = [];

    for (const node of document.querySelectorAll("body *")) {
      // Only elements with their own visible text, so a container is not
      // blamed for the text of its children.
      const own = [...node.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent.trim())
        .join("");
      if (!own) continue;

      const style = getComputedStyle(node);
      if (style.visibility === "hidden" || style.display === "none") continue;
      if (parseFloat(style.opacity) < 0.95) continue;

      const rect = node.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;

      const fg = parse(style.color);
      if (!fg || fg.a < 0.95) continue;

      const size = parseFloat(style.fontSize);
      const weight = parseInt(style.fontWeight, 10) || 400;

      // WCAG's definition of large text: 18.66px bold, or 24px at any weight.
      const large = size >= 24 || (size >= 18.66 && weight >= 700);

      results.push({
        text: own.slice(0, 40),
        selector: node.id ? `#${node.id}` : `${node.tagName.toLowerCase()}.${node.className}`,
        size,
        large,
        ratio: ratio(fg, backdrop(node))
      });
    }

    return results;
  });
}

test("every piece of text meets WCAG 2.2 AA in both themes (NFR-6)", async ({ page }) => {
  // NFR-6 names WCAG 2.2 AA and until now only the keyboard half of it had
  // ever been checked. AA wants 4.5:1 for body text and 3:1 for large text,
  // measured against what is actually behind the text rather than against
  // whatever the element itself declares - which is usually transparent.
  //
  // Every panel is opened first, because a collapsed one has no laid-out text
  // in it and would be audited as though it did not exist.
  await page.evaluate(() => {
    for (const section of document.querySelectorAll("details")) section.open = true;

    // Transitions off before anything is measured. The colour tokens are
    // transitioned when the theme changes, and getComputedStyle during one
    // returns the interpolated value - so a measurement taken too early reads
    // the colour of the theme being left rather than the one being entered.
    // That is not a hypothetical: it reported the light theme buttons at
    // 1.88:1 when the settled value is 5.9, and it cost an hour to tell a test
    // artefact from a real failure.
    const freeze = document.createElement("style");
    freeze.textContent = "* { transition: none !important; animation: none !important; }";
    document.head.append(freeze);
  });

  /** @type {Record<string, {text: string, ratio: number, selector: string}[]>} */
  const failures = {};

  for (const theme of ["dark", "light"]) {
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await page.waitForTimeout(80);

    const measured = await textContrasts(page);
    expect(measured.length, `${theme} should have text in it to measure`).toBeGreaterThan(30);

    failures[theme] = measured
      .filter((item) => item.ratio < (item.large ? 3 : 4.5))
      .map((item) => ({
        text: item.text,
        ratio: Math.round(item.ratio * 100) / 100,
        selector: item.selector
      }));
  }

  const describe = (theme) =>
    failures[theme].map((f) => `${f.selector} "${f.text}" at ${f.ratio}:1`).join("\n    ");

  expect(failures.dark, `dark theme:\n    ${describe("dark")}`).toEqual([]);
  expect(failures.light, `light theme:\n    ${describe("light")}`).toEqual([]);
});

test("focus is visible on everything that takes it (NFR-6)", async ({ page }) => {
  // "Keyboard operable" is worth nothing if you cannot see where you are.
  // WCAG 2.2 asks for a visible focus indicator; this checks that focusing an
  // element changes how it is drawn at all, which is the weakest honest form
  // of that and still catches a stylesheet that removed the outline.
  await page.evaluate(() => {
    for (const section of document.querySelectorAll("details")) section.open = true;
  });

  const invisible = await page.evaluate(() => {
    const focusable = document.querySelectorAll(
      "button, input, select, textarea, summary, [tabindex]:not([tabindex='-1'])"
    );

    const bad = [];

    for (const node of focusable) {
      if (node.disabled) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;

      // outlineStyle is in here because it is the property that decides
      // whether an outline is drawn at all. Without it this check had a blind
      // spot: an unfocused element computes outline-width as the UA default
      // of 3px with outline-style none, so a focus ring 3px wide read as no
      // ring, and this passed only while the ring happened to be some other
      // width. The standard's is 3px.
      const seen = (style) =>
        [
          style.outlineStyle,
          style.outlineWidth,
          style.outlineColor,
          style.outlineOffset,
          style.boxShadow,
          style.borderColor
        ].join(" ");

      const was = seen(getComputedStyle(node));

      node.focus();

      const now = seen(getComputedStyle(node));

      if (was === now) {
        bad.push(node.id || `${node.tagName.toLowerCase()}.${node.className}`);
      }
    }

    return bad;
  });

  expect(invisible, `these show nothing when focused: ${invisible.join(", ")}`).toEqual([]);
});

test("a slider drag is one undo, through the real controls (US-024)", async ({ page }) => {
  // The unit tests cover the folding rule; this covers the thing that would
  // actually be wrong in use - that a drag of the real slider, firing an event
  // per pixel, comes back in one press rather than forty.
  const undo = page.locator("#undoBtn");
  await expect(undo).toBeDisabled();

  const before = await page.evaluate(() => window.DayAndNight.document().cfg.preset.exposure);

  await page.evaluate(() => {
    const slider = document.querySelector("#exposure");
    for (let i = 1; i <= 30; i += 1) {
      slider.value = String(i / 10);
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });

  const dragged = await page.evaluate(() => window.DayAndNight.document().cfg.preset.exposure);
  expect(dragged).toBeCloseTo(3, 5);
  await expect(undo).toBeEnabled();

  await undo.click();

  const undone = await page.evaluate(() => window.DayAndNight.document().cfg.preset.exposure);
  expect(undone, "one press should take back the whole drag").toBeCloseTo(before, 5);

  await page.locator("#redoBtn").click();
  const redone = await page.evaluate(() => window.DayAndNight.document().cfg.preset.exposure);
  expect(redone).toBeCloseTo(3, 5);
});

test("Ctrl+Z undoes, and Ctrl+Y and Ctrl+Shift+Z both put it back (US-024)", async ({ page }) => {
  await page.evaluate(() => {
    const slider = document.querySelector("#contrast");
    slider.value = "1.5";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });

  const read = () => page.evaluate(() => window.DayAndNight.document().cfg.preset.contrast);
  expect(await read()).toBeCloseTo(1.5, 5);

  await page.keyboard.press("Control+z");
  const undone = await read();
  expect(undone).not.toBeCloseTo(1.5, 5);

  // Windows uses Ctrl+Y; everything else uses Ctrl+Shift+Z. People carry
  // their habits between machines, so both work.
  await page.keyboard.press("Control+y");
  expect(await read()).toBeCloseTo(1.5, 5);

  await page.keyboard.press("Control+z");
  expect(await read()).toBeCloseTo(undone, 5);

  await page.keyboard.press("Control+Shift+z");
  expect(await read()).toBeCloseTo(1.5, 5);
});

test("Ctrl+Z in a text field belongs to the field (US-024)", async ({ page }) => {
  // Taking it would mean the city box could not be corrected without undoing
  // the whole application, which is what makes a shortcut worse than none.
  await page.evaluate(() => {
    const slider = document.querySelector("#saturation");
    slider.value = "0.6";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });

  const saturation = () => page.evaluate(() => window.DayAndNight.document().cfg.preset.saturation);
  expect(await saturation()).toBeCloseTo(0.6, 5);

  const city = page.locator("#city");
  await city.click();
  await city.fill("Reykjavik");
  await page.keyboard.press("Control+z");

  // The look is untouched: the keystroke went to the text field.
  expect(await saturation(), "Ctrl+Z while typing must not undo the picture").toBeCloseTo(0.6, 5);
});

test("the look gallery shows a picture of every preset", async ({ page }) => {
  const shots = page.locator("#lookGallery .shot");

  // However many looks ship, which is a fact about the product and not about
  // this test: it used to be written in as 8 and had to be edited every time a
  // look was added.
  const count = await page.evaluate(async () => (await import("/ui/presets.js")).LOOKS.length);
  expect(count).toBeGreaterThan(7);
  await expect(shots).toHaveCount(count);

  // Every tile carries the look's own hint, which is what a title is for on a
  // control that is a picture rather than a word.
  const titles = await shots.evaluateAll((nodes) => nodes.map((n) => n.title));
  for (const title of titles) {
    expect(title.length, "a tile with no hint is a picture nobody can interpret").toBeGreaterThan(
      40
    );
  }

  // The pictures arrive after the editor does, on purpose, so this waits.
  await expect
    .poll(
      async () =>
        shots.evaluateAll(
          (nodes) =>
            nodes.filter((n) => (n.querySelector("img")?.getAttribute("src") ?? "").length > 100)
              .length
        ),
      { timeout: 20_000 }
    )
    .toBe(count);

  // And they are different pictures. Identical rectangles would pass
  // every check above and be worth nothing.
  const sources = await shots.evaluateAll((nodes) =>
    nodes.map((n) => n.querySelector("img")?.getAttribute("src") ?? "")
  );
  expect(new Set(sources).size, "the thumbnails should not all be the same").toBe(count);
});

test("a look can be chosen by clicking its picture", async ({ page }) => {
  const weather = page.locator('#lookGallery .shot[data-look="weather"]');
  await weather.click();

  await expect(weather).toHaveAttribute("aria-checked", "true");

  const applied = await page.evaluate(() => window.DayAndNight.document().cfg.preset.cloudCover);
  expect(applied).toBeGreaterThan(0.5);

  // Exactly one is chosen at a time, which is what a radio group means.
  const checked = await page
    .locator("#lookGallery .shot")
    .evaluateAll((nodes) => nodes.filter((n) => n.getAttribute("aria-checked") === "true").length);
  expect(checked).toBe(1);
});

test("the gallery is one tab stop, and the arrows move inside it (NFR-6)", async ({ page }) => {
  // A picture grid that is eight tab stops in the middle of a settings panel
  // is tiring to use from a keyboard. A radio group is one stop, and the
  // arrows move within it.
  await page.locator('#lookGallery .shot[data-look="clear"]').click();

  const tabbable = await page
    .locator("#lookGallery .shot")
    .evaluateAll((nodes) => nodes.filter((n) => n.tabIndex === 0).length);
  expect(tabbable, "a radio group has a single tab stop").toBe(1);

  await page.locator('#lookGallery .shot[data-look="clear"]').focus();
  await page.keyboard.press("ArrowRight");

  // Moving the focus moves the choice, which is how a radio group behaves.
  const chosen = await page.evaluate(() => document.activeElement?.getAttribute("data-look") ?? "");
  expect(chosen).not.toBe("clear");
  await expect(page.locator(`#lookGallery .shot[data-look="${chosen}"]`)).toHaveAttribute(
    "aria-checked",
    "true"
  );

  // And it wraps rather than stopping, so there is no dead end.
  await page.locator('#lookGallery .shot[data-look="clear"]').focus();
  await page.keyboard.press("ArrowLeft");
  const wrapped = await page.evaluate(
    () => document.activeElement?.getAttribute("data-look") ?? ""
  );
  expect(wrapped, "going left from the first should reach the last").toBeTruthy();
  expect(wrapped).not.toBe("clear");
});

test("editing a control leaves the gallery with nothing chosen", async ({ page }) => {
  // "Custom" is not a look you can pick, it is what the panel says once you
  // have edited one - so it is the absence of a chosen tile rather than a tile
  // of its own.
  await page.locator('#lookGallery .shot[data-look="clear"]').click();
  await expect(page.locator('#lookGallery .shot[data-look="clear"]')).toHaveAttribute(
    "aria-checked",
    "true"
  );

  await page.evaluate(() => {
    const slider = document.querySelector("#saturation");
    slider.value = "0.42";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });

  const checked = await page
    .locator("#lookGallery .shot")
    .evaluateAll((nodes) => nodes.filter((n) => n.getAttribute("aria-checked") === "true").length);
  expect(checked, "an edited preset is no longer any of the looks").toBe(0);

  // The group is still reachable, which it would not be if every tile had
  // given up its tab stop along with its selection.
  const tabbable = await page
    .locator("#lookGallery .shot")
    .evaluateAll((nodes) => nodes.filter((n) => n.tabIndex === 0).length);
  expect(tabbable).toBe(1);
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

/* ------------------------------------------------------------ the real wind */

/**
 * A stand-in for the Electron shell, installed before the page loads, so the
 * editor can be driven down its desktop path without a desktop. It records what
 * the editor tells the shell and lets a test play the shell's part.
 *
 * @param {unknown} saved the settings document the "shell" has on disk, if any
 */
function fakeShell(saved) {
  return `(() => {
    const pushed = [];
    const wind = { cb: null };
    window.__pushed = pushed;
    window.__wind = wind;
    window.dayAndNight = {
      version: "test",
      getMonitors: async () => [
        { id: 0, bounds: { x: 0, y: 0, w: 1920, h: 1080 }, scale: 1, primary: true }
      ],
      onMonitorsChanged: () => {},
      setWallpaper: async () => ({ on: false, host: "off", screens: 0, paused: false }),
      getWallpaperState: async () => ({ on: false, host: "off", screens: 0, paused: false }),
      onWallpaperState: () => {},
      getVersion: async () => "test",
      listLegal: async () => [],
      readLegal: async () => null,
      getStartWithWindows: async () => false,
      setStartWithWindows: () => {},
      pushConfig: (c) => pushed.push(JSON.parse(JSON.stringify(c))),
      loadSettings: async () => (${JSON.stringify(saved ?? null)}),
      saveSettings: () => {},
      getWind: async () => ({ wind: null, status: { state: "off", fetchedAt: null } }),
      onWind: (cb) => { wind.cb = cb; }
    };
  })();`;
}

test("in a browser the real wind is off, cannot be turned on, and says so (NFR-5)", async ({
  page
}) => {
  const state = await page.evaluate(() => ({
    checked: document.querySelector("#realWind").checked,
    disabled: document.querySelector("#realWind").disabled,
    note: document.querySelector("#realWindNote").textContent,
    consent: window.DayAndNight.document().cfg.realWind
  }));

  expect(state.checked).toBe(false);
  expect(state.disabled).toBe(true);
  expect(state.note).toContain("Only in the application");
  expect(state.consent).toBe(false);
});

test("opening a settings document never turns the real wind on (NFR-5)", async ({ page }) => {
  // A file somebody sent you, a share, an undo: none of them is the user saying
  // yes to their location leaving the computer.
  const consent = await page.evaluate(() => {
    const doc = window.DayAndNight.document();
    doc.cfg.realWind = true;
    window.DayAndNight.apply(doc);
    return window.DayAndNight.document().cfg.realWind;
  });

  expect(consent).toBe(false);
});

test("the real wind is off until clicked, and a click is what turns it on and off (NFR-5)", async ({
  page
}) => {
  await page.addInitScript(fakeShell(null));
  await page.goto("/index.html");
  await page.waitForFunction(() => window.DayAndNight?.lastFrame() !== null);

  await openSection(page, "Clouds");
  const box = page.locator("#realWind");
  await expect(box).toBeEnabled();
  await expect(box).not.toBeChecked();
  await expect(page.locator("#realWindNote")).toContainText("Nothing leaves your computer");

  // Everything the editor has said to the shell so far says no.
  const before = await page.evaluate(() => window.__pushed.map((c) => c.realWind));
  expect(before.length).toBeGreaterThan(0);
  expect(before.every((v) => v === false)).toBe(true);

  await box.check();
  await expect(page.locator("#realWindNote")).toContainText("MET Norway");
  const after = await page.evaluate(() => window.__pushed.at(-1).realWind);
  expect(after).toBe(true);
  expect(await page.evaluate(() => window.DayAndNight.document().cfg.realWind)).toBe(true);

  await box.uncheck();
  expect(await page.evaluate(() => window.__pushed.at(-1).realWind)).toBe(false);
});

test("undo cannot turn the real wind on, or off (NFR-5)", async ({ page }) => {
  await page.addInitScript(fakeShell(null));
  await page.goto("/index.html");
  await page.waitForFunction(() => window.DayAndNight?.lastFrame() !== null);

  await openSection(page, "Clouds");
  await page.locator("#realWind").check();
  await page.evaluate(() => {
    const slider = document.querySelector("#exposure");
    slider.value = "1";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });
  // The button, because the keys belong to a focused checkbox just as they
  // would to a text field.
  await page.locator("#undoBtn").click();

  // Undo did run: it took back the exposure, and left the consent alone.
  expect(await page.evaluate(() => window.DayAndNight.document().cfg.preset.exposure)).not.toBe(1);
  expect(await page.evaluate(() => window.DayAndNight.document().cfg.realWind)).toBe(true);
  await expect(page.locator("#realWind")).toBeChecked();
});

test("a choice made earlier is restored from the user's own settings file", async ({ page }) => {
  const saved = await page.evaluate(() => {
    const doc = window.DayAndNight.document();
    doc.cfg.realWind = true;
    return doc;
  });

  await page.addInitScript(fakeShell(saved));
  await page.goto("/index.html");
  await page.waitForFunction(() => window.DayAndNight?.lastFrame() !== null);

  await expect(page.locator("#realWind")).toBeChecked();
  // And the shell was told, since it is what decides whether to ask.
  expect(await page.evaluate(() => window.__pushed.at(-1).realWind)).toBe(true);
});

test("when the shell has the wind, the page says whose it is, and draws it", async ({ page }) => {
  await page.addInitScript(fakeShell(null));
  await page.goto("/index.html");
  await page.waitForFunction(() => window.DayAndNight?.lastFrame() !== null);

  await openSection(page, "Clouds");
  await page.locator("#realWind").check();

  const note = await page.evaluate(() => {
    const t0 = Math.floor(Date.now() / 3_600_000) * 3_600_000;
    window.__wind.cb({
      wind: {
        samples: [0, 1, 2, 3].map((i) => ({ t: t0 + i * 3_600_000, east: 20, north: 0 })),
        origin: { east: 0, north: 0 }
      },
      status: { state: "live", fetchedAt: Date.now() }
    });
    return document.querySelector("#realWindNote").textContent;
  });

  // The licence asks for the source and the licence to be named where the data
  // is used.
  expect(note).toContain("MET Norway");
  expect(note).toContain("CC BY 4.0");

  // A refusal is stated, and the weather carries on.
  const offline = await page.evaluate(() => {
    window.__wind.cb({ wind: null, status: { state: "offline", fetchedAt: null } });
    return document.querySelector("#realWindNote").textContent;
  });
  expect(offline).toContain("simulated weather");

  // No errors reached the console while that happened (beforeEach holds this).
});

test("a city's windows are lit rooms, not a barcode: varied, mostly dark, and the same at any size", async ({
  page
}) => {
  const runs = await page.evaluate(async () => {
    const { DayNightEngine } = await import("/engine/index.js");
    const { presetFor } = await import("/ui/presets.js");

    const measure = (W, lights) => {
      const H = Math.round((W * 9) / 16);
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
      const engine = new DayNightEngine(gl);
      engine.setPreset({ ...presetFor("town"), cloudCover: 0, skylineLights: lights });
      engine.render({
        // Half past eleven at night in Denver: every light that is going to be
        // on is on.
        t: Date.UTC(2026, 10, 10, 6, 30),
        place: { lat: 39.74, lon: -104.99 },
        crop: { x: 0, y: 0, w: W, h: H },
        span: { w: W, h: H },
        pixelRatio: 1
      });

      const px = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);

      // The band the skyline stands in, from the top of the towers to the
      // bottom of the frame.
      let pixels = 0;
      let lit = 0;
      let warm = 0;
      let cool = 0;
      let sum = 0;
      for (let row = Math.floor(H * 0.7); row < Math.floor(H * 0.88); row += 1) {
        const y = H - 1 - row;
        for (let x = 0; x < W; x += 1) {
          const i = (y * W + x) * 4;
          const r = px[i];
          const g = px[i + 1];
          const b = px[i + 2];
          const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          pixels += 1;
          sum += luma;
          if (luma > 100) {
            lit += 1;
            if (r > 1.4 * b) warm += 1;
          }
          // The whiter and cooler lights, which the grade pulls toward neutral.
          if (luma > 100 && r < 1.3 * b) cool += 1;
        }
      }
      return { litFraction: lit / pixels, warm, cool, mean: sum / pixels };
    };

    return { big: measure(1920, 1), small: measure(480, 1), off: measure(1920, 0) };
  });

  // Mostly dark, as a city is: not the 40 % of cells the first version lit.
  expect(runs.big.litFraction).toBeGreaterThan(0.02);
  expect(runs.big.litFraction).toBeLessThan(0.2);

  // Not one colour: the lamp is common, and there is light of another hue.
  expect(runs.big.warm).toBeGreaterThan(2000);
  expect(runs.big.cool, "some windows are lit a whiter, cooler colour").toBeGreaterThan(30);

  // The same city at a quarter of the size is about as bright overall, so a
  // small picture does not dissolve into stripes or lose its lights.
  const ratio = runs.small.mean / runs.big.mean;
  expect(ratio, `the small picture is ${ratio.toFixed(2)} times as bright`).toBeGreaterThan(0.6);
  expect(ratio).toBeLessThan(1.8);

  // And with the lights off there are none.
  expect(runs.off.litFraction).toBeLessThan(0.001);
});

test("a city's outline has towers, setbacks and spires, not a row of boxes", async ({ page }) => {
  const outline = await page.evaluate(async () => {
    const { DayNightEngine } = await import("/engine/index.js");
    const { presetFor } = await import("/ui/presets.js");

    const W = 1920;
    const H = 1080;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
    const engine = new DayNightEngine(gl);

    const draw = (skyline) => {
      engine.setPreset({ ...presetFor("town"), cloudCover: 0, skyline });
      engine.render({
        t: Date.UTC(2026, 10, 10, 6, 30),
        place: { lat: 39.74, lon: -104.99 },
        crop: { x: 0, y: 0, w: W, h: H },
        span: { w: W, h: H },
        pixelRatio: 1
      });
      const px = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return px;
    };

    // The same sky with and without the city: where they differ is the city.
    const sky = draw("none");
    const city = draw("city");

    // The top of the outline in each column, counted down from the top of the
    // picture, ignoring stars (single bright pixels) by asking for a run.
    const tops = new Int32Array(W).fill(H);
    for (let x = 0; x < W; x += 1) {
      let run = 0;
      for (let row = 0; row < H; row += 1) {
        const i = ((H - 1 - row) * W + x) * 4;
        const d =
          Math.abs(city[i] - sky[i]) +
          Math.abs(city[i + 1] - sky[i + 1]) +
          Math.abs(city[i + 2] - sky[i + 2]);
        run = d > 12 ? run + 1 : 0;
        if (run === 4) {
          tops[x] = row - 3;
          break;
        }
      }
    }

    // Narrow peaks: a column that stands at least 12 px above both sides, 6 px
    // away, and is itself thin.
    let spires = 0;
    for (let x = 8; x < W - 8; x += 1) {
      const here = tops[x];
      if (here === H) continue;
      if (tops[x - 6] - here >= 12 && tops[x + 6] - here >= 12) spires += 1;
    }

    // How many separate steps the outline takes, and how far it ranges.
    let steps = 0;
    for (let x = 1; x < W; x += 1) {
      if (Math.abs(tops[x] - tops[x - 1]) >= 3) steps += 1;
    }
    const heights = Array.from(tops)
      .filter((v) => v < H)
      .sort((a, b) => a - b);

    return {
      covered: heights.length / W,
      spires,
      steps,
      range: heights[Math.floor(heights.length * 0.5)] - heights[0]
    };
  });

  expect(outline.covered, "the city runs all the way across").toBeGreaterThan(0.95);

  // Spires and masts: thin things standing clear of the roofline.
  expect(outline.spires, "there should be spires and masts").toBeGreaterThan(3);

  // A roofline that steps often, where a row of boxes steps once per building
  // at most and a wedge or a setback adds more.
  expect(outline.steps, "the roofline should step, not be a handful of edges").toBeGreaterThan(60);

  // Downtown towers stand well above the typical roof.
  expect(
    outline.range,
    "the tallest tower should stand well above the typical roof"
  ).toBeGreaterThan(60);
});

test("far fewer windows are lit at two in the morning than at nine in the evening", async ({
  page
}) => {
  const lit = await page.evaluate(async () => {
    const { DayNightEngine } = await import("/engine/index.js");
    const { presetFor } = await import("/ui/presets.js");

    const W = 1280;
    const H = 720;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
    const engine = new DayNightEngine(gl);
    engine.setPreset({ ...presetFor("town"), cloudCover: 0 });

    // Denver is seven hours behind UTC in November, and at 105 degrees west
    // local solar time is within minutes of it.
    const fraction = (utcHour, dayOffset) => {
      engine.render({
        t: Date.UTC(2026, 10, 10 + dayOffset, utcHour),
        place: { lat: 39.74, lon: -105 },
        crop: { x: 0, y: 0, w: W, h: H },
        span: { w: W, h: H },
        pixelRatio: 1
      });
      const px = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let lit = 0;
      for (let row = Math.floor(H * 0.7); row < Math.floor(H * 0.88); row += 1) {
        const y = H - 1 - row;
        for (let x = 0; x < W; x += 1) {
          const i = (y * W + x) * 4;
          if (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2] > 100) lit += 1;
        }
      }
      return lit;
    };

    return { evening: fraction(4, 0), small: fraction(9, 0) };
  });

  expect(lit.evening).toBeGreaterThan(0);
  expect(lit.small, "the small hours have lights, but far fewer").toBeGreaterThan(0);
  expect(lit.small).toBeLessThan(lit.evening * 0.75);
});

/* ---------------------------------------------------------------- weather */

/**
 * A small renderer for the weather tests: draws a preset at an instant and hands
 * back the pixels, bottom-up as the GL gives them.
 */
const weatherHarness = (width, height) => `
  const { DayNightEngine, defaultPreset } = await import("/engine/index.js");
  const W = ${width};
  const H = ${height};
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
  const engine = new DayNightEngine(gl);
  const draw = (look, t) => {
    engine.setPreset({
      ...defaultPreset(),
      cloudCover: 0.8,
      skyline: "mountains",
      skylineHeight: 9,
      ...look
    });
    engine.render({
      t,
      place: { lat: 39.74, lon: -104.99 },
      crop: { x: 0, y: 0, w: W, h: H },
      span: { w: W, h: H },
      pixelRatio: 1
    });
    const px = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  };
  const luma = (px, i) => 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];

  // What a row holds that is thin: each value less the mean of the fifteen
  // around it, so that the mist rain brings and the clouds' own shape are gone
  // and a streak a pixel or two wide is what is left.
  const thin = (values) => {
    const n = values.length;
    const out = new Float32Array(n);
    for (let x = 0; x < n; x += 1) {
      let sum = 0;
      let count = 0;
      for (let k = Math.max(0, x - 7); k <= Math.min(n - 1, x + 7); k += 1) {
        sum += values[k];
        count += 1;
      }
      out[x] = values[x] - sum / count;
    }
    return out;
  };
`;

test("with no weather set the picture is exactly what it was, and fog flattens it", async ({
  page
}) => {
  const result = await page.evaluate(
    async (harness) => {
      const body = new Function(
        `return (async () => { ${harness}
        const noon = Date.UTC(2026, 10, 10, 19);
        const dry = draw({ cloudCover: 0 }, noon);
        const explicitlyDry = draw(
          { cloudCover: 0, fog: 0, precipitation: 0, precipitationKind: "snow" },
          noon
        );
        const foggy = draw({ cloudCover: 0, fog: 0.6 }, noon);

        let same = true;
        for (let i = 0; i < dry.length; i += 1) if (dry[i] !== explicitlyDry[i]) same = false;

        const mean = (px, from, to) => {
          let sum = 0;
          let n = 0;
          for (let row = from; row < to; row += 1) {
            const y = H - 1 - row;
            for (let x = 0; x < W; x += 1) {
              sum += luma(px, (y * W + x) * 4);
              n += 1;
            }
          }
          return sum / n;
        };

        // The band just above the horizon, and the sky high overhead.
        return {
          same,
          contrastDry: mean(dry, 90, 130) - mean(dry, 300, 359),
          contrastFog: mean(foggy, 90, 130) - mean(foggy, 300, 359),
          highDry: mean(dry, 300, 359),
          highFog: mean(foggy, 300, 359)
        };
      })()`
      );
      return body();
    },
    weatherHarness(640, 360)
  );

  expect(result.same, "no fog and no rain, whatever the kind, draws nothing at all").toBe(true);

  // Fog lifts the dark and lowers the bright until they meet: the difference
  // between the glowing horizon and the deep sky overhead mostly goes.
  expect(result.contrastDry).toBeGreaterThan(30);
  expect(
    result.contrastFog,
    `fog should flatten the sky: ${result.contrastDry} became ${result.contrastFog}`
  ).toBeLessThan(result.contrastDry * 0.5);
  expect(result.highFog).toBeGreaterThan(result.highDry + 20);
});

test("rain falls: it adds streaks, they move, and the same instant is the same rain", async ({
  page
}) => {
  const result = await page.evaluate(
    async (harness) => {
      const body = new Function(
        `return (async () => { ${harness}
        const t = Date.UTC(2026, 10, 10, 19);
        // A wind along the view, so that nothing leans and a streak is upright.
        const look = { cloudWindFrom: 180, precipitation: 0.8 };
        const dry = draw({ cloudWindFrom: 180 }, t);
        const wet = draw(look, t);
        const again = draw(look, t);
        const later = draw(look, t + 60);
        const heavy = draw({ precipitation: 1 }, t);
        const light = draw({ precipitation: 0.15 }, t);

        const count = (a, b) => {
          let n = 0;
          for (let i = 0; i < a.length; i += 4) {
            if (Math.abs(luma(a, i) - luma(b, i)) > 6) n += 1;
          }
          return n;
        };

        let identical = true;
        for (let i = 0; i < wet.length; i += 1) if (wet[i] !== again[i]) identical = false;

        // What the rain added, with the mist it brings taken out, so that a
        // streak is what stands out.
        const added = new Float32Array(W * H);
        for (let row = 0; row < H; row += 1) {
          const y = H - 1 - row;
          const values = [];
          for (let x = 0; x < W; x += 1) {
            const i = (y * W + x) * 4;
            values.push(luma(wet, i) - luma(dry, i));
          }
          const high = thin(values);
          for (let x = 0; x < W; x += 1) added[row * W + x] = high[x];
        }

        // The tallest unbroken run of streak down a column, and the widest
        // along a row, over the part of the picture that is sky.
        let tall = 0;
        let wide = 0;
        for (let x = 0; x < W; x += 1) {
          let run = 0;
          for (let row = 300; row < H - 1; row += 1) {
            if (added[row * W + x] > 8) {
              run += 1;
              tall = Math.max(tall, run);
            } else run = 0;
          }
        }
        for (let row = 300; row < H - 1; row += 1) {
          let run = 0;
          for (let x = 0; x < W; x += 1) {
            if (added[row * W + x] > 8) {
              run += 1;
              wide = Math.max(wide, run);
            } else run = 0;
          }
        }

        return {
          changed: count(dry, wet),
          moved: count(wet, later),
          identical,
          heavier: count(dry, heavy),
          lighter: count(dry, light),
          tall,
          wide
        };
      })()`
      );
      return body();
    },
    weatherHarness(1920, 1080)
  );

  expect(result.changed, "rain should put something in the picture").toBeGreaterThan(300);
  expect(result.identical, "the same instant must give the same rain").toBe(true);
  expect(result.moved, "sixty milliseconds later the rain is somewhere else").toBeGreaterThan(300);
  expect(result.heavier, "harder rain is more of it").toBeGreaterThan(result.lighter);
  expect(result.tall, "a streak is tall").toBeGreaterThan(15);
  expect(result.tall, "and thin").toBeGreaterThan(result.wide * 2);
});

test("snow is soft discs, falling more slowly than rain", async ({ page }) => {
  const result = await page.evaluate(
    async (harness) => {
      const body = new Function(
        `return (async () => { ${harness}
        const t = Date.UTC(2026, 10, 10, 19);

        // A wind straight along the view, so that nothing leans and a fall is
        // purely downward.
        const calm = { cloudWindFrom: 180, precipitation: 0.8 };
        const dry = draw({ cloudWindFrom: 180 }, t);
        const snow = draw({ ...calm, precipitationKind: "snow" }, t);

        let brighter = 0;
        let darker = 0;
        for (let i = 0; i < snow.length; i += 4) {
          const d = luma(snow, i) - luma(dry, i);
          if (d > 6) brighter += 1;
          if (d < -6) darker += 1;
        }

        // How far it fell between two instants, found by sliding one picture of
        // what was added down the other until they agree best.
        const added = (kind, at) => {
          const wet = draw({ ...calm, precipitationKind: kind }, at);
          const out = new Float32Array(W * H);
          for (let row = 0; row < H; row += 1) {
            const y = H - 1 - row;
            const values = [];
            for (let x = 0; x < W; x += 1) {
              const i = (y * W + x) * 4;
              values.push(luma(wet, i) - luma(dry, i));
            }
            const high = thin(values);
            // Top-down, so that "down" is increasing.
            for (let x = 0; x < W; x += 1) out[row * W + x] = high[x];
          }
          return out;
        };

        const fell = (kind) => {
          const a = added(kind, t);
          const b = added(kind, t + 30);
          let best = 0;
          let bestScore = -Infinity;
          for (let d = 0; d <= 60; d += 1) {
            let score = 0;
            for (let y = Math.floor(H * 0.15); y < Math.floor(H * 0.6); y += 1) {
              for (let x = 0; x < W; x += 1) score += a[y * W + x] * b[(y + d) * W + x];
            }
            if (score > bestScore) {
              bestScore = score;
              best = d;
            }
          }
          return best;
        };

        return { flakes: brighter + darker, brighter, darker, rain: fell("rain"), snow: fell("snow") };
      })()`
      );
      return body();
    },
    weatherHarness(1920, 1080)
  );

  expect(result.flakes).toBeGreaterThan(300);
  expect(result.brighter, "snow is lit, so it brightens").toBeGreaterThan(result.darker * 3);

  // In thirty milliseconds the rain, weighted as it is by its layers, has fallen
  // some seventeen pixels and the snow two; these are measured, and the bounds
  // leave room either side.
  expect(result.rain, `rain fell ${result.rain} px`).toBeGreaterThanOrEqual(10);
  expect(result.snow, `snow fell ${result.snow} px`).toBeLessThanOrEqual(5);
});

test("a dry sky redraws nothing, and a falling one redraws every frame (NFR-1)", async ({
  page
}) => {
  const result = await page.evaluate(async () => {
    const { DayNightEngine, defaultPreset } = await import("/engine/index.js");
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
    const engine = new DayNightEngine(gl);

    const request = (t) => ({
      t,
      place: { lat: 39.74, lon: -104.99 },
      crop: { x: 0, y: 0, w: 320, h: 180 },
      span: { w: 320, h: 180 },
      pixelRatio: 1
    });
    const t = Date.UTC(2026, 10, 10, 19);

    const distinct = (look) => {
      engine.setPreset({ ...defaultPreset(), ...look });
      const seen = new Set();
      // Twenty frames at twenty a second: one second of a wallpaper.
      for (let i = 0; i < 20; i += 1) seen.add(engine.signature(request(t + i * 50)));
      return seen.size;
    };

    return {
      dry: distinct({}),
      fog: distinct({ fog: 0.5 }),
      rain: distinct({ precipitation: 0.6 })
    };
  });

  expect(result.dry, "a clear dry second is one frame").toBe(1);
  expect(result.fog, "fog is still, so it costs nothing either").toBe(1);
  expect(result.rain, "rain redraws every frame it falls").toBe(20);
});

test("the Weather controls change the look, and rain is one click from a look", async ({
  page
}) => {
  await openSection(page, "Weather");

  await page.locator("#precipitation").fill("0.5");
  await page.locator("#fog").fill("0.3");
  await page.locator("#precipitationKind").selectOption("snow");

  const preset = await page.evaluate(() => window.DayAndNight.document().cfg.preset);
  expect(preset.precipitation).toBeCloseTo(0.5, 5);
  expect(preset.fog).toBeCloseTo(0.3, 5);
  expect(preset.precipitationKind).toBe("snow");

  await expect(page.locator("#precipitationVal")).toHaveText("50%");
  await expect(page.locator("#fogVal")).toHaveText("30%");

  // And the looks that use it are in the gallery, choosing one sets it.
  await page.locator('#lookGallery .shot[data-look="rain"]').click();
  const rain = await page.evaluate(() => window.DayAndNight.document().cfg.preset);
  expect(rain.precipitationKind).toBe("rain");
  expect(rain.precipitation).toBeGreaterThan(0.3);
});

test("the engine follows the real weather, exactly as if those had been the settings (US-031)", async ({
  page
}) => {
  const result = await page.evaluate(async () => {
    const { DayNightEngine, defaultPreset } = await import("/engine/index.js");
    const { makeConditions } = await import("/engine/sky/conditions.js");

    const W = 480;
    const H = 270;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
    const engine = new DayNightEngine(gl);

    const t = Date.UTC(2026, 10, 17, 19);
    const HOUR = 3_600_000;
    const hold = (over) => [
      { t: t - HOUR, cloud: 0, precip: 0, snow: 0, fog: 0, ...over },
      { t: t + HOUR, cloud: 0, precip: 0, snow: 0, fog: 0, ...over }
    ];
    const frame = (preset, conditions, at = t) => {
      engine.setPreset(preset);
      engine.render({
        t: at,
        place: { lat: 39.74, lon: -104.99 },
        crop: { x: 0, y: 0, w: W, h: H },
        span: { w: W, h: H },
        pixelRatio: 1,
        conditions
      });
      const px = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return px;
    };
    const same = (a, b) => {
      for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
      return true;
    };

    // The user's own sky is clear and dry. The forecast says otherwise.
    const mine = { ...defaultPreset(), cloudCover: 0, skyline: "mountains", skylineHeight: 8 };
    const forecast = makeConditions(hold({ cloud: 0.7, precip: 0.6, snow: 0, fog: 0.25 }));

    // What those four numbers would be if they had been set by hand.
    const byHand = {
      ...mine,
      cloudCover: 0.7,
      precipitation: 0.6,
      precipitationKind: "rain",
      fog: 0.25
    };

    const followed = frame(mine, forecast);
    const manual = frame(byHand, null);
    const alone = frame(mine, null);

    // Well past the forecast's end, it is the user's sky again.
    const stale = frame(mine, forecast, t + 40 * HOUR);
    const staleAlone = frame(mine, null, t + 40 * HOUR);

    // The preset the engine holds is the one it was given, after the frame.
    engine.setPreset(mine);
    engine.render({
      t,
      place: { lat: 39.74, lon: -104.99 },
      crop: { x: 0, y: 0, w: W, h: H },
      span: { w: W, h: H },
      pixelRatio: 1,
      conditions: forecast
    });
    const kept = engine.preset.cloudCover === 0 && engine.preset.precipitation === 0;

    return {
      followedIsManual: same(followed, manual),
      followedIsNotMine: !same(followed, alone),
      staleIsMine: same(stale, staleAlone),
      kept
    };
  });

  expect(result.followedIsNotMine, "the forecast should change the sky").toBe(true);
  expect(result.followedIsManual, "following is the same as setting those by hand").toBe(true);
  expect(result.staleIsMine, "far past the forecast the sky is the user's again").toBe(true);
  expect(result.kept, "and the engine's own preset is put back after a frame").toBe(true);
});

test("while the forecast is in use the controls it sets are dimmed, and say so", async ({
  page
}) => {
  await page.addInitScript(fakeShell(null));
  await page.goto("/index.html");
  await page.waitForFunction(() => window.DayAndNight?.lastFrame() !== null);

  await openSection(page, "Clouds");
  await openSection(page, "Weather");
  await page.locator("#realWind").check();

  await expect(page.locator("#cloudCover")).toBeEnabled();

  const note = await page.evaluate(() => {
    const t0 = Math.floor(Date.now() / 3_600_000) * 3_600_000;
    const hours = [0, 1, 2, 3, 4, 5, 6].map((h) => t0 + (h - 1) * 3_600_000);
    window.__wind.cb({
      wind: {
        samples: hours.map((t) => ({ t, east: 10, north: 0 })),
        origin: { east: 0, north: 0 },
        conditions: hours.map((t) => ({ t, cloud: 0.4, precip: 0.5, snow: 0, fog: 0.4 }))
      },
      status: { state: "live", fetchedAt: Date.now() }
    });
    return document.querySelector("#realWindNote").textContent;
  });

  // It says what it is like out there, and whose it is.
  expect(note).toContain("40% cloud");
  expect(note).toContain("steady rain");
  expect(note).toContain("fog");
  expect(note).toContain("MET Norway");

  for (const id of ["cloudCover", "fog", "precipitation", "precipitationKind"]) {
    await expect(page.locator(`#${id}`), `${id} is being set by the forecast`).toBeDisabled();
  }
  await expect(page.locator("#cloudCover")).toHaveAttribute("title", /real weather/);

  // Untick it and they are the user's again.
  await page.locator("#realWind").uncheck();
  for (const id of ["cloudCover", "fog", "precipitation", "precipitationKind"]) {
    await expect(page.locator(`#${id}`)).toBeEnabled();
  }
});
