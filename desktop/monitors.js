"use strict";

/**
 * Which screens exist, and what the span is.
 *
 * Electron's `screen` module reports everything needed, in virtual-desktop
 * coordinates where the primary screen's top-left is 0,0 and anything to the
 * left or above it is negative. The span is the bounding box of the lot, and
 * every crop rectangle is relative to the span rather than to the desktop, so
 * that the scene is composed once for the whole arrangement (US-012).
 *
 * @module desktop/monitors
 */

const { screen } = require("electron");

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
 * @property {Rect} bounds
 * @property {number} scale
 * @property {boolean} primary
 */

/**
 * Every screen Windows reports.
 *
 * `bounds` is used rather than `workArea` deliberately: the work area excludes
 * the taskbar, and a wallpaper goes behind the taskbar, not beside it.
 *
 * @returns {Monitor[]}
 */
function list() {
  const primaryId = screen.getPrimaryDisplay().id;

  return screen.getAllDisplays().map((display) => ({
    id: display.id,
    bounds: {
      x: display.bounds.x,
      y: display.bounds.y,
      w: display.bounds.width,
      h: display.bounds.height
    },
    scale: display.scaleFactor,
    primary: display.id === primaryId
  }));
}

/**
 * The bounding box of every screen.
 * @param {Monitor[]} monitors
 * @returns {{ x: number, y: number, w: number, h: number }}
 */
function span(monitors) {
  if (monitors.length === 0) return { x: 0, y: 0, w: 1920, h: 1080 };

  const minX = Math.min(...monitors.map((m) => m.bounds.x));
  const minY = Math.min(...monitors.map((m) => m.bounds.y));
  const maxX = Math.max(...monitors.map((m) => m.bounds.x + m.bounds.w));
  const maxY = Math.max(...monitors.map((m) => m.bounds.y + m.bounds.h));

  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * One monitor's rectangle within the span, plus what it needs to render.
 *
 * @param {Monitor} monitor
 * @param {Monitor[]} all
 * @returns {{ crop: Rect, span: { w: number, h: number }, pixelRatio: number }}
 */
function geometryFor(monitor, all) {
  const s = span(all);
  return {
    crop: {
      x: monitor.bounds.x - s.x,
      y: monitor.bounds.y - s.y,
      w: monitor.bounds.w,
      h: monitor.bounds.h
    },
    span: { w: s.w, h: s.h },
    pixelRatio: monitor.scale
  };
}

/**
 * One monitor's rectangle in *physical* pixels, relative to the top-left of
 * the virtual screen.
 *
 * Two coordinate systems are in play and conflating them is the classic
 * multi-monitor bug. Electron reports display bounds in device-independent
 * pixels, where a 4K screen at 200% scaling is 1920 wide. Win32 wants physical
 * pixels, where it is 3840. On a single-scale setup the two agree and the
 * distinction is invisible, which is exactly why it gets missed.
 *
 * `dipToScreenRect` is Electron's own conversion and handles a mixed-DPI
 * arrangement correctly, which hand-multiplying by `scaleFactor` does not:
 * with screens at different scales the virtual screen's physical geometry is
 * not any one screen's DIP geometry times any one scale factor.
 *
 * Milestone 2 tests this against the four arrangements that break it
 * (docs/ROADMAP.md); Milestone 0 only ever sees it on one.
 *
 * @param {Monitor} monitor
 * @param {Monitor[]} all
 * @returns {{ x: number, y: number, w: number, h: number }}
 */
function physicalRectFor(monitor, all) {
  const mine = toPhysical(monitor.bounds);
  const origin = all
    .map((m) => toPhysical(m.bounds))
    .reduce((acc, r) => ({ x: Math.min(acc.x, r.x), y: Math.min(acc.y, r.y) }), {
      x: Infinity,
      y: Infinity
    });

  return {
    x: mine.x - origin.x,
    y: mine.y - origin.y,
    w: mine.w,
    h: mine.h
  };
}

/**
 * The virtual screen's size in physical pixels.
 * @param {Monitor[]} monitors
 * @returns {{ w: number, h: number }}
 */
function physicalSpan(monitors) {
  if (monitors.length === 0) return { w: 1920, h: 1080 };

  const rects = monitors.map((m) => toPhysical(m.bounds));
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));

  return { w: maxX - minX, h: maxY - minY };
}

/**
 * @param {Rect} bounds in DIP
 * @returns {Rect} in physical pixels, virtual-screen coordinates
 */
function toPhysical(bounds) {
  const r = screen.dipToScreenRect(null, {
    x: bounds.x,
    y: bounds.y,
    width: bounds.w,
    height: bounds.h
  });
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}

/**
 * Call back whenever the arrangement changes.
 *
 * All three events matter: a screen arriving, a screen leaving, and a screen
 * changing resolution, scaling or position. The last one is the easiest to
 * forget and the most common in practice, because it fires when a user drags a
 * monitor in Display Settings.
 *
 * @param {() => void} onChange
 * @returns {() => void} stop listening
 */
function watch(onChange) {
  screen.on("display-added", onChange);
  screen.on("display-removed", onChange);
  screen.on("display-metrics-changed", onChange);

  return () => {
    screen.off("display-added", onChange);
    screen.off("display-removed", onChange);
    screen.off("display-metrics-changed", onChange);
  };
}

module.exports = { list, span, geometryFor, physicalRectFor, physicalSpan, watch };
