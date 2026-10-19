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
