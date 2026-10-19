// @ts-check
/**
 * An off-screen buffer that holds light rather than colour.
 *
 * Everything in the scene has to be added up before any of it is tone mapped:
 * the sky, the stars, and soon the sun, the moon and their bloom. Summing
 * them on an 8-bit surface would mean tone mapping each layer separately,
 * which is not the same picture and is visibly not the same picture - a star
 * drawn over a tone-mapped sky cannot be dimmer than the sky it sits on, so
 * stars would stay visible at noon.
 *
 * So the passes draw into a half-float target in linear radiance, where a
 * value may be 1e-7 for airglow or 10 for the sun, and the whole sum is tone
 * mapped once on the way to the screen.
 *
 * @module engine/gl/target
 */

/**
 * @typedef {object} RenderTarget
 * @property {() => void} bindForDrawing
 * @property {(unit: number) => void} bindAsTexture
 * @property {(width: number, height: number) => boolean} resize
 * @property {() => void} dispose
 */

/**
 * Create a half-float render target.
 *
 * `RGBA16F` rather than `RGBA32F`: half a float is plenty for radiance that
 * will be tone mapped anyway, it halves the bandwidth, and it is the format
 * that is filterable and blendable without reaching for more extensions.
 *
 * @param {WebGL2RenderingContext} gl
 * @param {number} width
 * @param {number} height
 * @returns {RenderTarget}
 * @throws {Error} with a message meant for a user if the driver cannot do it
 */
export function createRenderTarget(gl, width, height) {
  // Rendering *to* a float texture is an extension even in WebGL2, and
  // blending into one is a second. Both are near-universal, but a missing one
  // is better said plainly than discovered as a black screen.
  if (!gl.getExtension("EXT_color_buffer_float")) {
    throw new Error(
      "This computer's graphics driver cannot draw into high-precision buffers, which Day and Night needs to add up the sky and the stars before showing them. Updating the graphics driver usually fixes it."
    );
  }
  gl.getExtension("EXT_float_blend");

  const texture = gl.createTexture();
  const framebuffer = gl.createFramebuffer();

  let currentWidth = 0;
  let currentHeight = 0;

  /**
   * @param {number} w
   * @param {number} h
   */
  function allocate(w, h) {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(
        `This computer's graphics driver would not accept the buffer Day and Night draws the sky into (status ${status}).`
      );
    }

    currentWidth = w;
    currentHeight = h;
  }

  allocate(width, height);

  return {
    bindForDrawing() {
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.viewport(0, 0, currentWidth, currentHeight);
    },

    bindAsTexture(unit) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
    },

    /** @returns {boolean} true if it was reallocated */
    resize(w, h) {
      if (w === currentWidth && h === currentHeight) return false;
      allocate(w, h);
      return true;
    },

    dispose() {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
    }
  };
}
