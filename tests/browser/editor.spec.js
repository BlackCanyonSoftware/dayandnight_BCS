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
        samples.push(count(Date.UTC(2026, 11, 21, 0, 0) + hour * 3_600_000, lat));
      }
      const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
      const range = Math.max(...samples) - Math.min(...samples);
      return { mean, relative: mean > 0 ? range / mean : 0 };
    };

    return { pole: spread(89.5), equator: spread(0) };
  });

  expect(result.pole.mean, "the polar sky should have stars in it").toBeGreaterThan(30);
  expect(result.equator.mean, "the equatorial sky should have stars in it").toBeGreaterThan(30);

  expect(
    result.pole.relative,
    `at the pole the number of stars up should barely change, varied by ${(result.pole.relative * 100).toFixed(0)} per cent`
  ).toBeLessThan(0.2);

  expect(
    result.equator.relative,
    `at the equator the sky should roll through, varied by only ${(result.equator.relative * 100).toFixed(0)} per cent`
  ).toBeGreaterThan(result.pole.relative * 1.5);
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
