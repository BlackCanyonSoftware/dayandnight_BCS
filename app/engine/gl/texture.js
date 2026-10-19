// @ts-check
/**
 * Textures. At present there is one: the sky table.
 *
 * Part of the layer a WebGPU backend would replace (ADR 0003), so nothing
 * above it should know what a `WebGLTexture` is.
 *
 * @module engine/gl/texture
 */

/**
 * @typedef {object} Texture
 * @property {(unit: number) => void} bind
 * @property {() => void} dispose
 */

/**
 * Upload the sky table as a 3D texture.
 *
 * `RGBA16F` with `FLOAT` data: WebGL2 converts on upload, which saves writing
 * a float-to-half converter, and half-float textures are filterable in core
 * WebGL2 where 32-bit ones would need an extension. The table holds radiance,
 * which runs from about 1e-2 down to 1e-10, so an 8-bit texture is not an
 * option - the quantisation alone would band the entire twilight.
 *
 * Linear filtering and clamped edges, so the shader can read it with plain
 * interpolation and the CPU-side reader in `sky/lut.js` can match it exactly.
 *
 * @param {WebGL2RenderingContext} gl
 * @param {Float32Array} data
 * @param {number} width sun elevation
 * @param {number} height view elevation
 * @param {number} depth azimuth from the sun
 * @returns {Texture}
 */
export function createSkyTexture(gl, data, width, height, depth) {
  const texture = gl.createTexture();

  gl.bindTexture(gl.TEXTURE_3D, texture);
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, width, height, depth, 0, gl.RGBA, gl.FLOAT, data);

  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  // Clamping matters at the azimuth edges: the sky is mirror-symmetric about
  // the sun's meridian, so 0 and 180 degrees are genuine boundaries rather
  // than a seam to wrap around.
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);

  gl.bindTexture(gl.TEXTURE_3D, null);

  return {
    bind(unit) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_3D, texture);
    },
    dispose() {
      gl.deleteTexture(texture);
    }
  };
}
