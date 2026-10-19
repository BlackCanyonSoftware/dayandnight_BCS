// @ts-check
/**
 * WebGL2 context creation, and surviving its loss.
 *
 * A process that renders for weeks will see its context lost - a driver
 * update, a GPU reset, the compositor reclaiming resources from a window that
 * was hidden too long. That is routine here rather than catastrophic, because
 * architecture invariant 1 means there is no scene state to lose: recreate the
 * context, rebuild the GPU objects, render the same timestamp again, and the
 * frame is identical to the one that was interrupted.
 *
 * @module engine/gl/context
 */

/**
 * @typedef {object} ContextOptions
 * @property {() => void} [onLost] called when the context goes away
 * @property {() => void} [onRestored] called when it comes back; rebuild GPU objects here
 */

/**
 * @typedef {object} ManagedContext
 * @property {WebGL2RenderingContext} gl
 * @property {() => void} dispose
 */

/**
 * Create a WebGL2 context tuned for a wallpaper.
 *
 * The attribute choices are all deliberate:
 *
 * - `alpha: false` - the wallpaper is opaque; an alpha channel would cost
 *   bandwidth and invite the compositor to blend every frame.
 * - `antialias: false` - there is no geometry to alias. The sky is a gradient
 *   and the stars are points with their own falloff. MSAA here would cost a
 *   multisampled buffer for nothing.
 * - `depth: false`, `stencil: false` - the passes are ordered by hand.
 * - `powerPreference: "low-power"` - this is the single most important line in
 *   the file on a laptop. The default lets the browser pick the discrete GPU,
 *   which for a 24/7 wallpaper is how you cost someone their battery and spin
 *   their fans. NFR-1 is not reachable without it.
 * - `preserveDrawingBuffer: false` - nothing reads the buffer back.
 * - `desynchronized: true` - lets the driver skip a frame of latency. A
 *   wallpaper has no input to be responsive to, so there is nothing to lose.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {ContextOptions} [options]
 * @returns {ManagedContext}
 * @throws {Error} if WebGL2 is unavailable, with a message meant for a user
 */
export function createContext(canvas, options = {}) {
  /** @type {WebGLContextAttributes} */
  const attrs = {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: "low-power",
    failIfMajorPerformanceCaveat: false,
    desynchronized: true
  };

  const gl = canvas.getContext("webgl2", attrs);
  if (!gl) {
    throw new Error(
      "This computer's graphics driver does not support WebGL2, which Day and Night needs to draw the sky. Updating the graphics driver usually fixes it."
    );
  }

  /** @param {Event} e */
  const lost = (e) => {
    // Without preventDefault the context is never restored.
    e.preventDefault();
    options.onLost?.();
  };
  const restored = () => options.onRestored?.();

  canvas.addEventListener("webglcontextlost", lost, false);
  canvas.addEventListener("webglcontextrestored", restored, false);

  return {
    gl,
    dispose() {
      canvas.removeEventListener("webglcontextlost", lost);
      canvas.removeEventListener("webglcontextrestored", restored);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  };
}

/**
 * Size the drawing buffer to the surface, accounting for display scaling.
 *
 * Returns whether the size changed, so a caller can skip reallocating render
 * targets on the overwhelming majority of frames where it did not.
 *
 * @param {WebGL2RenderingContext} gl
 * @param {number} cssWidth
 * @param {number} cssHeight
 * @param {number} pixelRatio
 * @returns {boolean} true if the buffer was resized
 */
export function resizeToSurface(gl, cssWidth, cssHeight, pixelRatio) {
  const canvas = gl.canvas;
  const want = {
    w: Math.max(1, Math.round(cssWidth * pixelRatio)),
    h: Math.max(1, Math.round(cssHeight * pixelRatio))
  };

  // Never ask for more than the driver will give, or everything silently fails.
  const max = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
  const maxW = Array.isArray(max) || max instanceof Int32Array ? (max[0] ?? want.w) : want.w;
  const maxH = Array.isArray(max) || max instanceof Int32Array ? (max[1] ?? want.h) : want.h;
  const w = Math.min(want.w, maxW);
  const h = Math.min(want.h, maxH);

  if (canvas.width === w && canvas.height === h) return false;
  canvas.width = w;
  canvas.height = h;
  return true;
}
