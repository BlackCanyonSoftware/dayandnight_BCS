// @ts-check
/**
 * The arithmetic of several screens, with no Electron in it.
 *
 * This is split out of `monitors.js` for one reason: it is the part that can
 * be wrong, and until it was pure it could only be tested on whatever screens
 * the developer happened to own. The roadmap's exit criteria for Milestone 2
 * name four arrangements that break naive span code - mixed DPI, a rotated
 * screen, a vertical stack, and an L-shape with a gap - and nobody is going to
 * plug those in. Given a list of rectangles, every one of them is a unit test.
 *
 * `desktop/monitors.js` keeps everything that needs Electron's `screen`
 * module: asking Windows what exists, watching for changes, and converting
 * device-independent pixels to physical ones. This module takes the answers as
 * arguments.
 *
 * It lives in the engine because `crop` and `span` are the engine's own inputs
 * - they are two fields of a `FrameRequest` - and because it has to be the
 * SAME arithmetic on both sides of the application. The editor draws a preview
 * of the span and the shell places a window on each screen; when those two
 * disagreed, the preview framed the sky differently from the wallpaper it was
 * previewing. The shell reaches it through `require()`, which Node allows for
 * an ES module.
 *
 * Two conventions, both of which are the source of a classic bug if forgotten:
 *
 * - Windows reports screens in **virtual-desktop coordinates**, where the
 *   primary screen's top-left is 0,0 and anything above or to the left of it
 *   is **negative**. A second monitor placed to the left of the primary has
 *   `x = -1920`.
 * - A crop is relative to the **span**, not to the desktop, and so is always
 *   non-negative. Getting this wrong shows up only on the arrangements where
 *   the primary screen is not the leftmost one, which is why it survives.
 *
 * @module engine/span
 */

/**
 * @typedef {object} Rect
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 */

/**
 * @typedef {object} Monitor
 * @property {number} id
 * @property {Rect} bounds device-independent pixels, virtual-desktop origin
 * @property {number} scale
 * @property {boolean} primary
 */

/** What to assume when Windows reports nothing, which happens in a headless test run. */
const NO_SCREENS = { x: 0, y: 0, w: 1920, h: 1080 };

/**
 * The bounding box of every screen, in device-independent pixels.
 *
 * The bounding box, not a packing: a gap between two screens stays a gap, and
 * the sky that falls in it is simply never shown. Closing the gap would be the
 * bug - it would move the sun off its true azimuth on one of the screens,
 * which architecture invariant 5 forbids and which is the whole point of
 * US-012.
 *
 * @param {readonly Monitor[]} monitors
 * @returns {Rect}
 */
export function boundingBox(monitors) {
  if (monitors.length === 0) return { ...NO_SCREENS };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const monitor of monitors) {
    minX = Math.min(minX, monitor.bounds.x);
    minY = Math.min(minY, monitor.bounds.y);
    maxX = Math.max(maxX, monitor.bounds.x + monitor.bounds.w);
    maxY = Math.max(maxY, monitor.bounds.y + monitor.bounds.h);
  }

  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * One screen's slice of the span, in device-independent pixels.
 *
 * @param {Monitor} monitor
 * @param {readonly Monitor[]} all
 * @returns {Rect}
 */
export function cropFor(monitor, all) {
  const box = boundingBox(all);
  return {
    x: monitor.bounds.x - box.x,
    y: monitor.bounds.y - box.y,
    w: monitor.bounds.w,
    h: monitor.bounds.h
  };
}

/**
 * Everything one surface needs in order to draw its share of the sky.
 *
 * The sky is composed in device-independent pixels on purpose. A screen at
 * 200% scaling therefore shows the same *angular* slice as its neighbour, at
 * twice the pixel density, rather than half the slice at the same density -
 * which is what makes a mixed-DPI arrangement look like one sky instead of a
 * join. `pixelRatio` is what tells the renderer to put more pixels into the
 * same angle.
 *
 * @param {Monitor} monitor
 * @param {readonly Monitor[]} all
 * @returns {{ crop: Rect, span: { w: number, h: number }, pixelRatio: number }}
 */
export function geometryFor(monitor, all) {
  const box = boundingBox(all);
  return {
    crop: cropFor(monitor, all),
    span: { w: box.w, h: box.h },
    pixelRatio: monitor.scale
  };
}

/**
 * One screen's rectangle in **physical** pixels, relative to the top-left of
 * the virtual screen - which is what Win32 wants when the window is moved
 * inside the desktop.
 *
 * Two coordinate systems are in play and conflating them is the classic
 * multi-monitor bug. Electron reports bounds in device-independent pixels,
 * where a 4K screen at 200% scaling is 1920 wide; Win32 wants physical pixels,
 * where it is 3840. On a single-scale setup the two agree, which is exactly
 * why the distinction gets missed.
 *
 * The conversion is injected rather than computed, because it cannot be
 * computed: multiplying bounds by `scaleFactor` is wrong the moment two
 * screens have different scales, since the virtual screen's physical geometry
 * is not any one screen's DIP geometry times any one scale. Only the OS knows
 * the answer. `monitors.js` passes Electron's `dipToScreenRect`; a test passes
 * a stub that models the arrangement it is checking.
 *
 * @param {Monitor} monitor
 * @param {readonly Monitor[]} all
 * @param {(bounds: Rect) => Rect} toPhysical DIP to physical, same origin
 * @returns {Rect}
 */
export function physicalRectFor(monitor, all, toPhysical) {
  const mine = toPhysical(monitor.bounds);

  let originX = Infinity;
  let originY = Infinity;
  for (const other of all) {
    const rect = toPhysical(other.bounds);
    originX = Math.min(originX, rect.x);
    originY = Math.min(originY, rect.y);
  }

  return { x: mine.x - originX, y: mine.y - originY, w: mine.w, h: mine.h };
}

/**
 * What is wrong with an arrangement, if anything.
 *
 * Not a validator that rejects anything - Windows allows arrangements that
 * look like mistakes, and a wallpaper is in no position to argue. It exists so
 * that the editor can say "the sky covers more than your screens do" rather
 * than leaving somebody to wonder why the sun spent an hour somewhere they
 * could not see, and so that the tests have one place to ask whether the
 * geometry still holds together.
 *
 * @param {readonly Monitor[]} monitors
 * @returns {{ box: Rect, covered: number, area: number, gapFraction: number, overlaps: boolean }}
 */
export function describe(monitors) {
  const box = boundingBox(monitors);
  const area = box.w * box.h;

  let covered = 0;
  let overlaps = false;

  for (let i = 0; i < monitors.length; i += 1) {
    const mine = monitors[i];
    if (!mine) continue;
    covered += mine.bounds.w * mine.bounds.h;

    for (let j = i + 1; j < monitors.length; j += 1) {
      const other = monitors[j];
      if (!other) continue;
      if (intersects(mine.bounds, other.bounds)) overlaps = true;
    }
  }

  return {
    box,
    covered,
    area,
    // Clamped at zero: overlapping screens can cover more than the box, and a
    // negative gap is not a thing anyone wants to read.
    gapFraction: area === 0 ? 0 : Math.max(0, (area - covered) / area),
    overlaps
  };
}

/**
 * @param {Rect} a
 * @param {Rect} b
 * @returns {boolean}
 */
export function intersects(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
