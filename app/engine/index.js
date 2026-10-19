// @ts-check
/**
 * The engine's whole public surface.
 *
 * Deliberately tiny, and deliberately ignorant. It does not know whether it is
 * drawing the editor's preview or a window pinned behind the desktop icons; it
 * does not know what time it is; it has no opinion about when a frame is
 * wanted:
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

import { moonPosition } from "./astro/lunar.js";
import { sunPosition, twilightBand } from "./astro/solar.js";
import { createFullScreenTriangle, createProgram } from "./gl/program.js";
import { createSkyTexture } from "./gl/texture.js";
import { SKY_FRAG, SKY_VERT } from "./shaders.js";
import { LUT_AZIMUTH, LUT_SUN, LUT_VIEW } from "./sky/atmosphere.js";
import { autoExposure, skyLut } from "./sky/lut.js";
import { defaultPreset, resolveBearing } from "./defaults.js";
import { frameSignature } from "./signature.js";

/** @typedef {import("./types.js").FrameInfo} FrameInfo */
/** @typedef {import("./types.js").FrameRequest} FrameRequest */
/** @typedef {import("./types.js").Preset} Preset */

export { moonPosition, sunPosition, twilightBand };
export { defaultPreset, resolveBearing };
export { frameSignature };

/**
 * The mid-grey the sky is exposed towards, and the most the exposure is
 * allowed to push.
 *
 * The cap is what stops the night turning into grey fog: below nautical
 * twilight there is essentially nothing left to expose for, and an uncapped
 * gain would happily amplify the floor of the model until it was visible.
 */
const EXPOSURE_TARGET = 0.12;
const EXPOSURE_MAX = 4000;

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

    /** @type {ReturnType<typeof createSkyTexture> | null} */
    this.skyTexture = null;
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
   * Build the GPU objects, and the scattering table if this is the first
   * engine in the process to need it.
   *
   * The table takes a few hundred milliseconds and is then shared for the
   * life of the process, which is why it lives in `sky/lut.js` rather than
   * on the instance.
   */
  build() {
    if (this.sky && this.quad && this.skyTexture) return;
    this.release();

    this.sky = createProgram(this.gl, SKY_VERT, SKY_FRAG, "sky");
    this.quad = createFullScreenTriangle(this.gl);
    this.skyTexture = createSkyTexture(this.gl, skyLut().data, LUT_SUN, LUT_VIEW, LUT_AZIMUTH);
  }

  /**
   * Throw away the GPU objects. Safe to call twice, and safe to call on a
   * context that has already gone.
   */
  release() {
    this.sky?.dispose();
    this.quad?.dispose();
    this.skyTexture?.dispose();
    this.sky = null;
    this.quad = null;
    this.skyTexture = null;
  }

  /**
   * What a frame at this instant *would* be, without drawing it.
   *
   * Cheap and GPU-free. The host needs this every tick even when it is
   * skipping the draw, because the clock keeps moving and the readout must
   * follow it - a time and a sun altitude that froze whenever the colour
   * stopped changing would be a worse bug than the cost they save.
   *
   * @param {FrameRequest} request
   * @returns {FrameInfo}
   */
  describe(request) {
    const sun = sunPosition(request.t, request.place);
    return {
      sunAltitude: sun.altitude,
      sunAzimuth: sun.azimuth,
      band: twilightBand(sun.altitude),
      exposure: this.exposureFor(sun.altitude)
    };
  }

  /**
   * Would a frame drawn now differ from one drawn at the last signature?
   *
   * Pure, and cheap against a full present. The host keeps the previous value
   * and skips the frame when it matches; the engine remembers nothing
   * (architecture invariants 1 and 2).
   *
   * @param {FrameRequest} request
   * @returns {string}
   */
  signature(request) {
    return frameSignature(
      this.preset,
      request,
      this.gl.drawingBufferWidth,
      this.gl.drawingBufferHeight
    );
  }

  /**
   * The total gain the sky is drawn with: the automatic part, which follows
   * the sun across the day's enormous range of brightness, times the user's
   * own offset in stops.
   *
   * @param {number} sunAltitude degrees
   * @returns {number}
   */
  exposureFor(sunAltitude) {
    return (
      autoExposure(sunAltitude, EXPOSURE_TARGET, EXPOSURE_MAX) * Math.pow(2, this.preset.exposure)
    );
  }

  /**
   * Draw one frame, and say what it was.
   *
   * Pure in the sense that matters: identical arguments produce identical
   * pixels. Nothing is remembered between calls except the GPU objects and
   * the scattering table, which are caches rather than state - throw them
   * away and the next frame is the same.
   *
   * @param {FrameRequest} request
   * @returns {FrameInfo}
   */
  render(request) {
    const { t, place, crop, span } = request;
    const gl = this.gl;

    this.build();
    const sky = this.sky;
    const quad = this.quad;
    const skyTexture = this.skyTexture;
    if (!sky || !quad || !skyTexture) throw new Error("The sky program could not be built.");

    const sun = sunPosition(t, place);

    /** @type {FrameInfo} */
    const info = {
      sunAltitude: sun.altitude,
      sunAzimuth: sun.azimuth,
      band: twilightBand(sun.altitude),
      exposure: this.exposureFor(sun.altitude)
    };

    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;

    gl.viewport(0, 0, width, height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    sky.use();
    skyTexture.bind(0);
    gl.uniform1i(sky.uniform("uSky"), 0);

    gl.uniform2f(sky.uniform("uResolution"), width, height);
    gl.uniform4f(sky.uniform("uCrop"), crop.x, crop.y, crop.w, crop.h);
    gl.uniform2f(sky.uniform("uSpan"), span.w, span.h);

    gl.uniform1f(sky.uniform("uSunAltitude"), sun.altitude);
    gl.uniform1f(sky.uniform("uSunAzimuth"), sun.azimuth);

    gl.uniform1f(sky.uniform("uBearing"), resolveBearing(this.preset, place));
    gl.uniform1f(sky.uniform("uHorizon"), this.preset.horizon);
    gl.uniform1f(sky.uniform("uFieldOfView"), this.preset.fieldOfView);

    gl.uniform1f(sky.uniform("uExposure"), info.exposure);
    gl.uniform1f(sky.uniform("uWhite"), this.preset.whitePoint);
    gl.uniform1f(sky.uniform("uGroundAlbedo"), this.preset.groundAlbedo);

    quad.bind();
    quad.draw();

    return info;
  }
}
