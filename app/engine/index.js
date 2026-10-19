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
import { createRenderTarget } from "./gl/target.js";
import { createSkyTexture } from "./gl/texture.js";
import { localSiderealTime } from "./astro/sidereal.js";
import { toJulianDay } from "./astro/julian.js";
import {
  BODY_FRAG,
  BODY_VERT,
  COMPOSITE_FRAG,
  FULLSCREEN_VERT,
  SKY_FRAG,
  STAR_FRAG,
  STAR_VERT
} from "./shaders.js";
import { moonBody, sunBody } from "./bodies.js";
import { buildStarCatalogue, createStarBuffer } from "./stars.js";
import { LUT_AZIMUTH, LUT_SUN, LUT_VIEW } from "./sky/atmosphere.js";
import { autoExposure, skyLut, transmittanceFor } from "./sky/lut.js";
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

/**
 * Airglow's colour.
 *
 * Real airglow is dominated by a green oxygen line, but a night sky does not
 * look green to a person: adapted eyes see it as a cool grey-blue, and that
 * is what a photograph of one shows too. This is the perceived colour rather
 * than the spectroscopic one, because the product is a picture.
 */
const AIRGLOW_TINT = [0.45, 0.62, 1.0];

/** How long one twinkle cycle takes, in seconds. */
const TWINKLE_PERIOD = 9;

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

    /** @type {ReturnType<typeof createProgram> | null} */
    this.stars = null;

    /** @type {ReturnType<typeof createStarBuffer> | null} */
    this.starBuffer = null;

    /** @type {ReturnType<typeof createProgram> | null} */
    this.bodies = null;

    /**
     * An empty vertex array for the body pass.
     *
     * The sun and the moon are one point each, positioned entirely from
     * uniforms, so there is nothing to put in a buffer - but a vertex array
     * still has to be bound for the draw to be legal.
     * @type {WebGLVertexArrayObject | null}
     */
    this.emptyVao = null;

    /** @type {ReturnType<typeof createProgram> | null} */
    this.composite = null;

    /**
     * Where the passes add their light up before any of it is tone mapped.
     * @type {ReturnType<typeof createRenderTarget> | null}
     */
    this.scene = null;
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
    if (
      this.sky &&
      this.quad &&
      this.skyTexture &&
      this.stars &&
      this.bodies &&
      this.composite &&
      this.scene
    ) {
      return;
    }
    this.release();

    const gl = this.gl;

    this.sky = createProgram(gl, FULLSCREEN_VERT, SKY_FRAG, "sky");
    this.stars = createProgram(gl, STAR_VERT, STAR_FRAG, "stars");
    this.bodies = createProgram(gl, BODY_VERT, BODY_FRAG, "bodies");
    this.composite = createProgram(gl, FULLSCREEN_VERT, COMPOSITE_FRAG, "composite");
    this.emptyVao = gl.createVertexArray();

    this.quad = createFullScreenTriangle(gl);
    this.skyTexture = createSkyTexture(gl, skyLut().data, LUT_SUN, LUT_VIEW, LUT_AZIMUTH);
    this.starBuffer = createStarBuffer(gl, buildStarCatalogue());

    this.scene = createRenderTarget(
      gl,
      Math.max(1, gl.drawingBufferWidth),
      Math.max(1, gl.drawingBufferHeight)
    );
  }

  /**
   * Throw away the GPU objects. Safe to call twice, and safe to call on a
   * context that has already gone.
   */
  release() {
    this.sky?.dispose();
    this.stars?.dispose();
    this.bodies?.dispose();
    this.composite?.dispose();
    if (this.emptyVao) this.gl.deleteVertexArray(this.emptyVao);
    this.quad?.dispose();
    this.skyTexture?.dispose();
    this.starBuffer?.dispose();
    this.scene?.dispose();

    this.sky = null;
    this.stars = null;
    this.bodies = null;
    this.composite = null;
    this.emptyVao = null;
    this.quad = null;
    this.skyTexture = null;
    this.starBuffer = null;
    this.scene = null;
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
    const stars = this.stars;
    const bodies = this.bodies;
    const composite = this.composite;
    const quad = this.quad;
    const skyTexture = this.skyTexture;
    const starBuffer = this.starBuffer;
    const scene = this.scene;
    const emptyVao = this.emptyVao;

    if (
      !sky ||
      !stars ||
      !bodies ||
      !composite ||
      !quad ||
      !skyTexture ||
      !starBuffer ||
      !scene ||
      !emptyVao
    ) {
      throw new Error("The sky program could not be built.");
    }

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
    scene.resize(width, height);

    const bearing = resolveBearing(this.preset, place);

    gl.disable(gl.DEPTH_TEST);

    /* ------------------------------------------------- 1. the sky, as light */

    scene.bindForDrawing();
    gl.disable(gl.BLEND);

    sky.use();
    skyTexture.bind(0);
    gl.uniform1i(sky.uniform("uSky"), 0);

    gl.uniform2f(sky.uniform("uResolution"), width, height);
    gl.uniform4f(sky.uniform("uCrop"), crop.x, crop.y, crop.w, crop.h);
    gl.uniform2f(sky.uniform("uSpan"), span.w, span.h);

    gl.uniform1f(sky.uniform("uSunAltitude"), sun.altitude);
    gl.uniform1f(sky.uniform("uSunAzimuth"), sun.azimuth);

    gl.uniform1f(sky.uniform("uBearing"), bearing);
    gl.uniform1f(sky.uniform("uHorizon"), this.preset.horizon);
    gl.uniform1f(sky.uniform("uFieldOfView"), this.preset.fieldOfView);

    gl.uniform1f(sky.uniform("uGroundAlbedo"), this.preset.groundAlbedo);
    gl.uniform3f(
      sky.uniform("uAirglow"),
      this.preset.airglow * AIRGLOW_TINT[0],
      this.preset.airglow * AIRGLOW_TINT[1],
      this.preset.airglow * AIRGLOW_TINT[2]
    );

    quad.bind();
    quad.draw();

    /* --------------------------------------- 2. the stars, added as more light */

    // Additive, into the same linear buffer. This is the whole reason stars
    // vanish at noon without anybody writing a rule for it: they are simply
    // outshone.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);

    stars.use();
    gl.uniform4f(stars.uniform("uCrop"), crop.x, crop.y, crop.w, crop.h);
    gl.uniform2f(stars.uniform("uSpan"), span.w, span.h);

    gl.uniform1f(stars.uniform("uLatitude"), place.lat);
    gl.uniform1f(stars.uniform("uSiderealTime"), localSiderealTime(toJulianDay(t), place.lon));

    gl.uniform1f(stars.uniform("uBearing"), bearing);
    gl.uniform1f(stars.uniform("uHorizon"), this.preset.horizon);
    gl.uniform1f(stars.uniform("uFieldOfView"), this.preset.fieldOfView);

    gl.uniform1f(stars.uniform("uBrightness"), this.preset.starBrightness);
    // Point size is in device pixels, so it has to follow the display's
    // density or stars are half the size they should be on a 4K screen.
    gl.uniform1f(stars.uniform("uSize"), this.preset.starSize * (request.pixelRatio || 1));
    gl.uniform1f(stars.uniform("uTwinkle"), this.preset.twinkle);
    // A phase in 0..1 rather than a raw time: sine is periodic, so the wrap
    // from 1 back to 0 is continuous, and no float has to hold a timestamp in
    // milliseconds at single precision.
    gl.uniform1f(stars.uniform("uTwinklePhase"), twinklePhase(t));

    starBuffer.bind();
    starBuffer.draw();

    /* ------------------------- 3. the sun and the moon, added as more light */

    bodies.use();
    gl.bindVertexArray(emptyVao);

    gl.uniform4f(bodies.uniform("uCrop"), crop.x, crop.y, crop.w, crop.h);
    gl.uniform2f(bodies.uniform("uSpan"), span.w, span.h);
    gl.uniform1f(bodies.uniform("uBearing"), bearing);
    gl.uniform1f(bodies.uniform("uHorizon"), this.preset.horizon);
    gl.uniform1f(bodies.uniform("uFieldOfView"), this.preset.fieldOfView);
    gl.uniform1f(bodies.uniform("uGlare"), this.preset.glare);

    // The moon first, so that on the rare occasions they overlap the sun is
    // in front - which, for an eclipse, is the right way round.
    for (const body of [
      moonBody(t, place, transmittanceFor(moonPosition(t, place).altitude)),
      sunBody(t, place, transmittanceFor(sun.altitude))
    ]) {
      // Nothing to draw once a body is far enough down that even its glare
      // is below the horizon.
      if (body.altitude < -3) continue;

      const discRadius = body.angularRadius * this.preset.bodyScale;

      gl.uniform1f(bodies.uniform("uAltitude"), body.altitude);
      gl.uniform1f(bodies.uniform("uAzimuth"), body.azimuth);
      gl.uniform1f(bodies.uniform("uAngularRadius"), discRadius);
      // The sprite has to be far wider than the disc or the glare has
      // nowhere to go.
      gl.uniform1f(bodies.uniform("uSpriteRadius"), discRadius * 14);
      gl.uniform3f(
        bodies.uniform("uRadiance"),
        body.radiance[0],
        body.radiance[1],
        body.radiance[2]
      );
      gl.uniform1f(bodies.uniform("uPhase"), body.phase);
      gl.uniform1f(bodies.uniform("uPixelsPerDegree"), span.w / this.preset.fieldOfView);
      gl.uniform1f(bodies.uniform("uLimbAngle"), body.limbAngle);

      gl.drawArrays(gl.POINTS, 0, 1);
    }

    gl.bindVertexArray(null);

    /* ------------------------------- 4. expose and tone map the sum, once */

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.BLEND);

    composite.use();
    scene.bindAsTexture(0);
    gl.uniform1i(composite.uniform("uScene"), 0);
    gl.uniform2f(composite.uniform("uResolution"), width, height);
    gl.uniform1f(composite.uniform("uExposure"), info.exposure);
    gl.uniform1f(composite.uniform("uWhite"), this.preset.whitePoint);

    quad.bind();
    quad.draw();

    return info;
  }
}

/**
 * Where the twinkle is in its cycle, as a fraction.
 *
 * A fraction rather than a time because `sin` is periodic: the wrap from 1
 * back to 0 is continuous, so there is no jump, and a single-precision
 * uniform never has to hold a Unix timestamp in milliseconds - which it
 * cannot, to anything like the resolution a flicker needs.
 *
 * @param {number} t
 * @returns {number} 0..1
 */
function twinklePhase(t) {
  const seconds = t / 1000 / TWINKLE_PERIOD;
  return seconds - Math.floor(seconds);
}
