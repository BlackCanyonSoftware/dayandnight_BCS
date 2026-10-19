// @ts-check
/**
 * The editor's preview loop.
 *
 * The preview shows the whole span, so what the editor draws is exactly what
 * the desktop draws, through the same engine and the same crop arithmetic. The
 * only difference is the timestamp, which the editor may choose and the
 * wallpaper never does.
 *
 * The loop lives here rather than in the engine because the engine never
 * decides when to draw (architecture invariant 2), and stopping it means
 * tearing it down rather than letting it run and return early (invariant 7).
 *
 * @module ui/preview
 */

import { DayNightEngine } from "../engine/index.js";
import { createContext, resizeToSurface } from "../engine/gl/context.js";
import { advance, currentT } from "./clock.js";
import { fps, place, preset, span } from "./state.js";

/** @typedef {import("../engine/types.js").FrameInfo} FrameInfo */

/** How wide the preview buffer gets, regardless of how wide the span is. */
const MAX_PREVIEW_WIDTH = 1600;

/**
 * @typedef {object} Preview
 * @property {() => void} start
 * @property {() => void} stop
 * @property {() => void} resize
 * @property {() => FrameInfo | null} lastFrame
 */

/**
 * @param {HTMLCanvasElement} canvas
 * @param {(info: FrameInfo, t: number) => void} onFrame called after each frame
 * @returns {Preview}
 */
export function createPreview(canvas, onFrame) {
  const managed = createContext(canvas, {
    onLost: () => {
      // Nothing to save. The engine's GPU objects are gone, so drop our
      // handles on them and let the next frame rebuild (ADR 0005).
      engine.release();
    },
    onRestored: () => {
      engine.build();
    }
  });

  const engine = new DayNightEngine(managed.gl);

  /** @type {number | null} */
  let timer = null;
  /** @type {FrameInfo | null} */
  let last = null;
  let lastRealNow = 0;

  function sizeCanvas() {
    const s = span();
    const aspect = s.h === 0 ? 16 / 9 : s.w / s.h;
    const w = Math.min(MAX_PREVIEW_WIDTH, s.w);
    const h = Math.max(1, Math.round(w / aspect));
    canvas.style.aspectRatio = `${s.w} / ${s.h}`;
    resizeToSurface(managed.gl, w, h, 1);
  }

  function frame() {
    const realNow = Date.now();
    const elapsed = lastRealNow === 0 ? 0 : realNow - lastRealNow;
    lastRealNow = realNow;

    advance(elapsed);

    const t = currentT(realNow);
    const s = span();

    engine.setPreset(preset);
    last = engine.render({
      t,
      place,
      // The preview is the whole span, so its crop is the span itself.
      crop: { x: 0, y: 0, w: s.w, h: s.h },
      span: s,
      pixelRatio: 1
    });

    onFrame(last, t);
  }

  function tick() {
    frame();
    // setTimeout rather than requestAnimationFrame: rAF is tied to the
    // display's refresh rate, and this wants 20 frames a second, not 144.
    // Asking for 144 and throwing six sevenths of them away is how a
    // wallpaper costs a laptop its battery (NFR-1).
    timer = window.setTimeout(tick, Math.max(1, Math.round(1000 / fps)));
  }

  return {
    start() {
      if (timer !== null) return;
      lastRealNow = 0;
      sizeCanvas();
      tick();
    },

    stop() {
      if (timer === null) return;
      window.clearTimeout(timer);
      timer = null;
    },

    resize() {
      sizeCanvas();
      // Redraw at once rather than waiting up to a frame: a resize that
      // leaves a stale buffer on screen reads as a stutter.
      if (timer !== null) frame();
    },

    lastFrame() {
      return last;
    }
  };
}
