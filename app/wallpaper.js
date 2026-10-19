// @ts-check
/**
 * One monitor's wallpaper surface.
 *
 * The whole of a wallpaper window's code. It is short because of architecture
 * invariant 1: there is nothing to synchronise and nothing to restore. The
 * window is told which rectangle of the span it occupies, and every frame it
 * renders the real now for that rectangle.
 *
 * Note what is *not* here. No channel to the other wallpaper windows, no
 * clock correction, no state carried between frames, no resynchronisation
 * after a pause. Three screens stay in lockstep because each one computes the
 * same pure function of the same wall clock (invariant 3), and a window
 * created at dusk is immediately correct for dusk.
 *
 * @module wallpaper
 */

import { DayNightEngine, defaultPreset } from "./engine/index.js";
import { createContext, resizeToSurface } from "./engine/gl/context.js";

/** @typedef {import("./engine/types.js").Place} Place */
/** @typedef {import("./engine/types.js").Preset} Preset */
/** @typedef {import("./engine/types.js").Rect} Rect */
/** @typedef {import("./engine/types.js").Span} Span */

/**
 * What the shell gives a wallpaper window, through desktop/preload.js.
 *
 * @typedef {object} Geometry
 * @property {Rect} crop this monitor's rectangle within the span
 * @property {Span} span
 * @property {number} pixelRatio
 */

/**
 * @typedef {object} WallpaperApi
 * @property {() => Promise<{ geometry: Geometry, preset: Preset, place: Place, fps: number }>} getInitial
 * @property {(cb: (c: { preset: Preset, place: Place, fps: number }) => void) => void} onConfig
 * @property {(cb: (g: Geometry) => void) => void} onGeometry
 * @property {(cb: (paused: boolean) => void) => void} onPause
 */

const api = /** @type {{ wallpaper?: WallpaperApi }} */ (/** @type {unknown} */ (globalThis))
  .wallpaper;

const found = /** @type {HTMLCanvasElement | null} */ (document.getElementById("surface"));
if (!found) throw new Error("The wallpaper surface canvas is missing.");

/** @type {HTMLCanvasElement} */
const canvas = found;

/** @type {Geometry} */
let geometry = {
  crop: { x: 0, y: 0, w: 1920, h: 1080 },
  span: { w: 1920, h: 1080 },
  pixelRatio: 1
};

/** @type {Preset} */
let preset = defaultPreset();

/** @type {Place} */
let place = { lat: 39.7, lon: -105 };

let fps = 20;

/** @type {number | null} */
let timer = null;

const managed = createContext(canvas, {
  onLost: () => engine.release(),
  onRestored: () => engine.build()
});

const engine = new DayNightEngine(managed.gl);

function frame() {
  resizeToSurface(
    managed.gl,
    canvas.clientWidth || geometry.crop.w,
    canvas.clientHeight || geometry.crop.h,
    geometry.pixelRatio
  );

  engine.setPreset(preset);
  engine.render({
    // The live wallpaper always renders the real now. Only the editor ever
    // chooses a different timestamp.
    t: Date.now(),
    place,
    crop: geometry.crop,
    span: geometry.span,
    pixelRatio: geometry.pixelRatio
  });
}

function tick() {
  frame();
  // setTimeout rather than requestAnimationFrame, deliberately: rAF follows
  // the display's refresh rate, so on a 144 Hz panel it would wake seven
  // times for every frame this actually wants. NFR-1.
  timer = window.setTimeout(tick, Math.max(1, Math.round(1000 / fps)));
}

/**
 * Start or stop the loop.
 *
 * Stopping tears the loop down rather than letting it run and return early
 * (invariant 7). That distinction is the entire point of the pause policy: a
 * loop that wakes twenty times a second to decide to do nothing still keeps
 * the CPU out of its deeper idle states, which is most of what a wallpaper
 * costs a laptop.
 *
 * @param {boolean} running
 */
function setRunning(running) {
  if (running) {
    if (timer === null) tick();
    return;
  }
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
}

async function boot() {
  if (api) {
    const initial = await api.getInitial();
    geometry = initial.geometry;
    preset = initial.preset;
    place = initial.place;
    fps = initial.fps;

    api.onConfig((config) => {
      preset = config.preset;
      place = config.place;
      const changed = fps !== config.fps;
      fps = config.fps;
      // A frame-rate change takes effect on the next tick anyway; redraw now
      // so a preset change is visible immediately rather than up to a frame
      // later, which at 5 fps is a fifth of a second of staleness.
      if (!changed && timer !== null) frame();
    });

    api.onGeometry((next) => {
      geometry = next;
      if (timer !== null) frame();
    });

    api.onPause((paused) => setRunning(!paused));
  }

  setRunning(true);
}

void boot();
