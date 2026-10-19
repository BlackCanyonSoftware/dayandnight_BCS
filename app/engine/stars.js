// @ts-check
/**
 * The stars.
 *
 * ## What is real here and what is not
 *
 * The **geometry is real**. Each star has a right ascension and a declination
 * on the actual celestial sphere, and the shader turns those into an altitude
 * and an azimuth using the observer's latitude and the local sidereal time -
 * the same arithmetic in `astro/` that puts the sun where it belongs. So the
 * field rises in the east, sets in the west, turns about the celestial pole at
 * the sidereal rate of just over 15 degrees an hour, and tilts by the
 * observer's latitude. At the equator the stars rise vertically; in Norway
 * they skim the horizon at a shallow angle; at the pole they wheel around a
 * point overhead and never set. None of that is faked, and US-005 is about
 * exactly that behaviour.
 *
 * The **catalogue is not real**. The positions are generated from a seeded
 * hash, with a realistic distribution of brightness and colour but no actual
 * stars in it: there is no Orion, no Plough, no Southern Cross. Shipping a
 * real catalogue is a data problem rather than a rendering one and is on the
 * roadmap. Until then this file does not pretend otherwise, and neither does
 * the documentation.
 *
 * ## Brightness
 *
 * Stars are emitted into the same linear radiance buffer as the sky, in the
 * same units, and the whole sum is tone mapped once. That is what makes them
 * appear and disappear at the right times without anybody writing a rule for
 * it: at noon the sky is some six thousand times brighter than the brightest
 * star, so they are invisible; through twilight the sky falls away and they
 * emerge in order of brightness, the way they actually do.
 *
 * Magnitudes are the astronomer's backwards logarithmic scale: five
 * magnitudes is a factor of a hundred in brightness, and larger numbers are
 * fainter. Magnitude 6 is roughly what an unaided eye can find on a dark
 * night.
 *
 * @module engine/stars
 */

/** How many stars. About what a very dark sky shows to the unaided eye. */
export const STAR_COUNT = 4000;

/** The faintest magnitude generated. */
const FAINTEST_MAGNITUDE = 6.5;

/**
 * The radiance of a magnitude-zero star, in the same units as the sky.
 *
 * Tuned rather than derived: the sky model's units are radiance from its own
 * integration, and matching a real stellar flux to them would mean calibrating
 * the whole model against absolute photometry, which buys nothing a wallpaper
 * can show. What matters is the ratio - that the brightest stars appear in
 * late civil twilight and the faintest only in full darkness - and that is
 * what this is set by.
 */
const MAGNITUDE_ZERO_RADIANCE = 7.2e-4;

/**
 * @typedef {object} StarCatalogue
 * @property {Float32Array} data four values per star: right ascension and
 *   declination in degrees, radiance, and a per-star hash used for colour and
 *   twinkling
 * @property {number} count
 */

/**
 * Build the catalogue.
 *
 * Deterministic: the same seed gives the same sky, every process, every run.
 * Architecture invariant 1 forbids unseeded randomness inside the engine, and
 * this is why - two monitors generating different stars would be instantly
 * obvious, and a wallpaper whose constellations changed on every restart would
 * be worse.
 *
 * @param {number} [seed]
 * @returns {StarCatalogue}
 */
export function buildStarCatalogue(seed = 0x5eed1e) {
  const random = mulberry32(seed);
  const data = new Float32Array(STAR_COUNT * 4);

  for (let i = 0; i < STAR_COUNT; i += 1) {
    // Uniform over the sphere's *area*. Drawing declination uniformly in
    // degrees instead would crowd the poles, which is the classic way to make
    // a star field that looks subtly wrong without anyone being able to say
    // why.
    const rightAscension = random() * 360;
    const declination = (Math.asin(2 * random() - 1) * 180) / Math.PI;

    // Real skies hold far more faint stars than bright ones - roughly four
    // times as many with each magnitude step. Inverting that distribution
    // gives a handful of brilliant stars among thousands of faint ones, which
    // is what makes a sky read as a sky rather than as scattered dots.
    const magnitude = FAINTEST_MAGNITUDE + Math.log10(Math.max(random(), 1e-6)) / 0.6;
    const radiance = MAGNITUDE_ZERO_RADIANCE * Math.pow(10, -0.4 * magnitude);

    const i4 = i * 4;
    data[i4] = rightAscension;
    data[i4 + 1] = declination;
    data[i4 + 2] = radiance;
    data[i4 + 3] = random();
  }

  return { data, count: STAR_COUNT };
}

/**
 * A small, fast, seeded generator.
 *
 * `Math.random` is banned inside the engine by a lint rule, for the reason in
 * the doc comment above.
 *
 * @param {number} seed
 * @returns {() => number} values in [0, 1)
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Upload the catalogue, ready to draw as points.
 *
 * One static buffer, uploaded once. Everything that moves - the rotation of
 * the sky, the twinkling, the way stars brighten as the sun sets - is a
 * function of uniforms and of each star's own hash, computed in the vertex
 * shader. Nothing about a star is touched on the CPU after this, which is why
 * four thousand of them cost nothing per frame.
 *
 * @param {WebGL2RenderingContext} gl
 * @param {StarCatalogue} catalogue
 * @returns {{ bind: () => void, draw: () => void, dispose: () => void }}
 */
export function createStarBuffer(gl, catalogue) {
  const vao = gl.createVertexArray();
  const buffer = gl.createBuffer();

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, catalogue.data, gl.STATIC_DRAW);

  // One attribute of four: right ascension, declination, radiance, hash.
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  return {
    bind() {
      gl.bindVertexArray(vao);
    },
    draw() {
      gl.drawArrays(gl.POINTS, 0, catalogue.count);
    },
    dispose() {
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
    }
  };
}
