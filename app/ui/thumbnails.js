// @ts-check
/**
 * A small picture of each look, so a preset can be chosen by looking at it.
 *
 * ## One instant for all of them
 *
 * The thumbnails are rendered at a fixed time and place rather than at the
 * user's own. That is a deliberate loss of honesty in exchange for the thing
 * the gallery is for.
 *
 * Rendered at the current moment, all eight would be the same near-black
 * rectangle for half of every day, and the gallery would be useless exactly
 * when somebody is most likely to be fiddling with their wallpaper. Rendered
 * at one low sun, the looks differ as much as they ever do - the colour cast,
 * the cloud, the haze and the horizon are all visible at once - so the
 * pictures are comparable with each other, which is the only comparison a
 * gallery is making.
 *
 * The hint on the panel says so, because a thumbnail that does not match the
 * sky on screen would otherwise look like a bug.
 *
 * ## One engine, thrown away
 *
 * A second `DayNightEngine` on its own small canvas, used once and released.
 * It is cheaper than it looks: the scattering table is baked at module level
 * in `sky/lut.js` and cached, so the second engine pays for a texture upload
 * rather than the 780 ms bake. Releasing it afterwards matters more than the
 * cost - a browser allows only a handful of WebGL contexts, and the editor
 * already holds one for the preview that it needs for the rest of the session.
 *
 * @module ui/thumbnails
 */

import { DayNightEngine } from "../engine/index.js";
import { LOOKS, presetFor } from "./presets.js";

/**
 * When the thumbnails are taken.
 *
 * A June morning at Denver, with the sun about eight degrees up: low enough
 * that the warm looks are warm and the horizon is lit from the side, high
 * enough that the sky is not yet night and the stars have not arrived. The
 * same instant for every look, because the point is to compare them.
 */
const SHOWCASE_AT = Date.UTC(2026, 5, 21, 13, 30);

/** Where from. Fixed for the same reason as the time. */
const SHOWCASE_PLACE = { lat: 39.74, lon: -104.99 };

/**
 * A picture of every look, as data URLs keyed by look id.
 *
 * Never throws. A machine without WebGL2 gets an empty map and a gallery of
 * names, which is what the editor had before thumbnails existed - a degraded
 * gallery is better than a broken editor, and the engine's own error about
 * WebGL has already been shown by the preview.
 *
 * @param {number} width
 * @param {number} height
 * @returns {Promise<Map<string, string>>}
 */
export async function renderLookThumbnails(width, height) {
  /** @type {Map<string, string>} */
  const shots = new Map();

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const gl = canvas.getContext("webgl2", {
    antialias: false,
    // Kept, because toDataURL reads the drawing buffer after the draw has
    // finished and without this the buffer is allowed to be empty by then.
    preserveDrawingBuffer: true
  });

  if (!gl) return shots;

  /** @type {DayNightEngine | null} */
  let engine = null;

  try {
    engine = new DayNightEngine(gl);

    for (const look of LOOKS) {
      const preset = presetFor(look.id);
      if (!preset) continue;

      engine.setPreset(preset);
      engine.render({
        t: SHOWCASE_AT,
        place: SHOWCASE_PLACE,
        crop: { x: 0, y: 0, w: width, h: height },
        span: { w: width, h: height },
        pixelRatio: 1
      });

      shots.set(look.id, canvas.toDataURL("image/webp", 0.82));

      // Between looks, so a long gallery does not hold the main thread for the
      // whole of its rendering.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } catch {
    // A thumbnail is a convenience. Whatever went wrong here, the editor still
    // works without it, and the preview has already reported anything that
    // would stop the engine running at all.
    return shots;
  } finally {
    engine?.release();

    // Hand the context back rather than waiting for the collector, because the
    // limit a browser enforces is on live contexts rather than on memory.
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  return shots;
}
