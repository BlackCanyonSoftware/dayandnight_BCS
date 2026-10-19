// @ts-check
/**
 * The engine's whole public surface.
 *
 * Deliberately tiny, and deliberately ignorant. It does not know whether it is
 * drawing the editor's preview or a window pinned behind the desktop icons; it
 * does not know what time it is; it has no opinion about when a frame is
 * wanted. Three methods and a constructor:
 *
 *     const engine = new DayNightEngine(gl);
 *     engine.setPreset(preset);
 *     engine.render({ t, place, crop, span, pixelRatio });
 *
 * There is no `start`, no `stop` and no `tick`, because the engine never
 * decides when to draw (architecture invariant 2). The host owns the loop, and
 * "pausing" means the host tears its loop down rather than calling a method
 * here (invariant 7).
 *
 * @module engine/index
 */

import { sunPosition, twilightBand } from "./astro/solar.js";
import { createFullScreenTriangle, createProgram } from "./gl/program.js";
import { SKY_FRAG, SKY_VERT } from "./shaders.js";
import { skyColors } from "./sky/palette.js";
import { defaultPreset } from "./defaults.js";

/** @typedef {import("./types.js").FrameInfo} FrameInfo */
/** @typedef {import("./types.js").FrameRequest} FrameRequest */
/** @typedef {import("./types.js").Preset} Preset */

export { sunPosition, twilightBand };
export { defaultPreset };

export class DayNightEngine {
  /** @param {WebGL2RenderingContext} gl */
  constructor(gl) {
    /** @type {WebGL2RenderingContext} */
    this.gl = gl;

    /** @type {Preset} */
    this.preset = defaultPreset();

    /**
     * GPU objects. Null when they have not been built, or after a context
     * loss has thrown them away.
     * @type {ReturnType<typeof createProgram> | null}
     */
    this.sky = null;

    /** @type {ReturnType<typeof createFullScreenTriangle> | null} */
    this.quad = null;
  }

  /**
   * Replace the authored look.
   *
   * The preset is copied, not referenced: a caller that keeps editing its own
   * object must not change what the engine is drawing without saying so.
   *
   * @param {Partial<Preset>} preset
   */
  setPreset(preset) {
    this.preset = { ...defaultPreset(), ...preset };
  }

  /**
   * Build the GPU objects. Called on the first frame, and again after a
   * context loss. Cheap enough not to need its own scheduling.
   */
  build() {
    if (this.sky && this.quad) return;
    this.release();
    this.sky = createProgram(this.gl, SKY_VERT, SKY_FRAG, "sky");
    this.quad = createFullScreenTriangle(this.gl);
  }

  /**
   * Throw away the GPU objects. Safe to call twice, and safe to call on a
   * context that has already gone.
   */
  release() {
    this.sky?.dispose();
    this.quad?.dispose();
    this.sky = null;
    this.quad = null;
  }

  /**
   * Draw one frame, and say what it was.
   *
   * Pure in the sense that matters: identical arguments produce identical
   * pixels. Nothing is remembered between calls except the GPU objects, which
   * are a cache rather than state - throw them away and the next frame is the
   * same.
   *
   * @param {FrameRequest} request
   * @returns {FrameInfo}
   */
  render(request) {
    // pixelRatio is part of the request and is not read yet: Milestone 1 needs
    // it to keep a star the same apparent size on screens of different
    // density. It is in the type rather than destructured here so that the
    // contract is honest without leaving an unused binding.
    const { t, place, crop, span } = request;
    const gl = this.gl;

    this.build();
    const sky = this.sky;
    const quad = this.quad;
    if (!sky || !quad) throw new Error("The sky program could not be built.");

    const sun = sunPosition(t, place);
    const colors = skyColors(sun.altitude);

    // Exposure is in stops, so it is a power of two on linear light. Doing it
    // on the CPU for two colours is free; in Milestone 1 it moves into the
    // grade, where it has a whole ramp to apply to.
    const gain = Math.pow(2, this.preset.exposure);

    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;

    gl.viewport(0, 0, width, height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    sky.use();
    gl.uniform2f(sky.uniform("uResolution"), width, height);
    gl.uniform4f(sky.uniform("uCrop"), crop.x, crop.y, crop.w, crop.h);
    gl.uniform2f(sky.uniform("uSpan"), span.w, span.h);
    gl.uniform3f(
      sky.uniform("uZenith"),
      colors.zenith[0] * gain,
      colors.zenith[1] * gain,
      colors.zenith[2] * gain
    );
    gl.uniform3f(
      sky.uniform("uHorizon"),
      colors.horizon[0] * gain,
      colors.horizon[1] * gain,
      colors.horizon[2] * gain
    );
    gl.uniform1f(sky.uniform("uCurve"), colors.curve);
    gl.uniform1f(sky.uniform("uSunAltitude"), sun.altitude);
    gl.uniform1f(sky.uniform("uSunAzimuth"), sun.azimuth);

    quad.bind();
    quad.draw();

    return {
      sunAltitude: sun.altitude,
      sunAzimuth: sun.azimuth,
      band: twilightBand(sun.altitude)
    };
  }
}
