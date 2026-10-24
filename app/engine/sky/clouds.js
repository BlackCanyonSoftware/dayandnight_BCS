// @ts-check
/**
 * Where the clouds are, as a pure function of the clock.
 *
 * The shapes are made on the GPU - domain-warped fBm, a few hundred hashes a
 * pixel, which is not arithmetic to do twice. What lives here is everything
 * the CPU has to agree with the shader about: how far the field has drifted,
 * how far it has evolved, and how much of either counts as a visible change.
 *
 * ## Why this file is mostly about not drawing
 *
 * Clouds are the first thing in this product that moves. Everything until now
 * has been nearly still, which is what lets the host skip identical frames and
 * is the whole reason the wallpaper costs 0.15 % of a core instead of 1.97 %
 * (`ARCHITECTURE.md`, Measurement, Milestone 1). A moving layer could have
 * ended that outright: a field that is never twice the same is a frame that
 * can never be skipped, and the budget goes back to what it was before
 * frame-skipping existed.
 *
 * It does not, because of how slowly clouds actually move. The field is rigid
 * under drift and slow under evolution, so the question "would this frame
 * differ from the last" reduces to two scalars rather than to the noise field
 * itself - and the frame signature can ask it without evaluating a single
 * octave. That is why drift and evolution are quantised here rather than
 * compared downstream: the quantum IS the redraw rate, stated in one place
 * and in units anybody can argue with.
 *
 * What it comes to, at the default twelve kilometres an hour: the fastest
 * layer moves about six metres a second, a pixel covers about one and a half
 * metres of it on a two-screen span, so the sky redraws roughly **four times
 * a second**. A clear sky redraws once every sixteen seconds, so clouds are
 * sixty times more expensive than nothing - and five times cheaper than the
 * twenty frames a second it would have cost to animate them honestly.
 *
 * Against the measured cost of drawing, about 0.09 % of a core per frame per
 * second, four a second comes to roughly 0.4 % against a budget of 2. Clouds
 * are affordable; they are not free; and `cloudCover` of zero skips the pass
 * entirely, so nobody pays for them who does not want them.
 *
 * ## Why everything here is bounded
 *
 * The first version of this file let the drift grow without limit, on the
 * reasoning that a number that increases by a little each minute takes
 * millennia to lose precision. That is true in double precision and wrong
 * where it matters: the value reaches the shader through a `float` uniform,
 * and single precision at the magnitude the Unix epoch produces - about three
 * times ten to the seventh - resolves in steps of four. The noise lattice is
 * sampled in units of about one, so the field quantised into rectangular
 * slabs and the sky came out looking tiled.
 *
 * So the drift is wrapped, and the field is built to be periodic so that the
 * wrap is invisible: the lacunarity is exactly two, every octave offset is a
 * whole number, and the lattice index is taken modulo a period that doubles
 * with each octave. The whole fBm then repeats exactly, and a drift taken
 * modulo that period is seamless rather than a jump every few days.
 *
 * @module engine/sky/clouds
 */

/**
 * The lattice period, in cells, for the first octave.
 *
 * The field repeats after this many cells. The shader doubles it with every
 * octave so that each one lines up with the period, which is what makes the
 * whole sum periodic rather than only its first term.
 *
 * 256 cells at the default scale is about 400 kilometres, against a visible
 * radius of roughly 70 - so the repeat is well outside the picture, and in
 * time it comes round about once a fortnight at a walking-pace wind.
 */
export const PERIOD = 256;

/**
 * The layers, from the highest and slowest to the lowest and fastest.
 *
 * Three, because two read as a pattern and four cost more than they show.
 * `scale` is the size of the features in kilometres, `drift` multiplies the
 * preset's wind speed, `height` is where the plane sits in metres, and
 * `weight` is how much of the sky that layer can take away.
 *
 * Different heights are what makes the parallax: a low sheet sweeps past
 * faster and converges to the horizon sooner than a high one, which is the
 * whole of what makes a sky look deep rather than painted.
 */
export const LAYERS = [
  { scale: 1.0, drift: 0.55, height: 7000, weight: 0.45 },
  { scale: 2.1, drift: 1.0, height: 2600, weight: 0.85 },
  { scale: 4.4, drift: 1.9, height: 1200, weight: 1.0 }
];

/**
 * How bright the sun makes a cloud, in the same units as the sky's radiance.
 *
 * Not a physical constant and not pretending to be one: the sun's disc has a
 * radiance of 26 in these units, and a cloud lit by it is nothing like that,
 * because a cloud is lit by the sun's *irradiance* and re-emits a fraction of
 * it over a hemisphere. Rather than model that, this is calibrated against the
 * only thing that matters - how a cloud sits against the sky beside it.
 *
 * Measured to pick it: at a sun altitude of 60 degrees the zenith sky is
 * 0.006, 0.011, 0.022 and the ambient is about 0.02. Through the rest of the
 * shading - a phase term of about 0.24 away from the sun, halved again by
 * self-shadowing - 0.9 puts a sunlit cloud at roughly 0.10 in every channel.
 * That is five to eighteen times the sky it sits against and very slightly
 * warm, which is what a white cloud lit by a sun yellower than the sky is.
 *
 * Towards the sun the phase term rises to about 1.7 and the same cloud reaches
 * 0.7, which is the silver lining. The tone map keeps that from clipping.
 */
export const CLOUD_SUNLIGHT = 0.9;

/**
 * How long the field takes to become a different sky, in seconds.
 *
 * Twenty minutes. Clouds form and dissolve on roughly that timescale, and it
 * is slow enough that evolution costs far fewer redraws than drift does -
 * which matters, because evolution is the part that cannot be made cheap by
 * moving a sample point.
 */
export const EVOLUTION_SECONDS = 1200;

/**
 * How far one layer has drifted, in **lattice cells**.
 *
 * Cells rather than kilometres, and that is the whole subtlety. The wind is a
 * speed over the ground, so the natural thing is to wrap the distance at the
 * period expressed in kilometres - which is what the first version did. It
 * does not work. The shader divides the sampled position by the layer's scale
 * *and* by the preset's `cloudScale`, so a wrap at `PERIOD * scale` kilometres
 * arrives at the noise as `PERIOD / cloudScale` cells; at the default scale
 * that is 160 against a period of 256, so the field wrapped a third of the way
 * through itself and the sky jumped. Measured at the time: one step of 8.2
 * levels where its neighbours moved 0.45.
 *
 * So the conversion happens here, before the wrap, and the shader is handed an
 * offset already counted in the units its lattice uses. Then the wrap is
 * exactly one period and the repeat is invisible.
 *
 * A pure function of the clock and nothing else, which is architecture
 * invariant 1: the same instant gives the same sky on every screen and in
 * every process, with no shared state and no synchronisation. Two monitors
 * agree about where a cloud is for the same reason they agree about the sun.
 *
 * @param {number} t milliseconds since the epoch
 * @param {number} kmPerHour the preset's wind speed
 * @param {number} layerIndex which of LAYERS
 * @param {number} cloudScale the preset's feature size
 * @returns {number} lattice cells, in [0, PERIOD)
 */
export function driftCells(t, kmPerHour, layerIndex, cloudScale) {
  const layer = LAYERS[layerIndex];
  if (!layer) throw new Error(`no cloud layer ${layerIndex}`);

  const km = (t / 3_600_000) * kmPerHour * layer.drift;
  const cellKm = Math.max(layer.scale * cloudScale, 0.05);

  // Positive remainder. A negative one is just as valid to the noise but makes
  // the quantised steps run backwards through zero.
  return (((km / cellKm) % PERIOD) + PERIOD) % PERIOD;
}

/**
 * How far the field has evolved, as a dimensionless coordinate.
 *
 * The third axis of the noise. One unit is one EVOLUTION_SECONDS, wrapped to
 * the period for the same reason the drift is.
 *
 * @param {number} t milliseconds since the epoch
 * @returns {number}
 */
export function evolution(t) {
  const advanced = t / (EVOLUTION_SECONDS * 1000);
  return ((advanced % PERIOD) + PERIOD) % PERIOD;
}

/**
 * Whether two instants would draw the same clouds.
 *
 * This is the frame signature's question, and it is answered without touching
 * the noise field - which is the point. The field translates and evolves; it
 * does not do anything else. So a change is visible exactly when the fastest
 * layer has moved by a pixel, or when the evolution has advanced by a step too
 * small to see.
 *
 * The drift is taken unwrapped here. The wrap exists to keep a single
 * precision uniform honest, and wrapping the *step count* as well would make
 * two instants a period apart share a signature - which they do visually, but
 * only because every other term agrees too, and relying on that is how a
 * frame gets skipped that should not have been.
 *
 * @param {number} t milliseconds since the epoch
 * @param {number} kmPerHour
 * @param {number} kmPerPixel how much ground one pixel covers, near the zenith
 * @returns {[number, number]} the drift and evolution steps
 */
export function cloudSteps(t, kmPerHour, kmPerPixel) {
  const fastest = LAYERS.reduce((most, layer) => Math.max(most, layer.drift), 0);
  const travelled = (t / 3_600_000) * kmPerHour * fastest;

  // One pixel. Below that the picture is identical to the one before it by
  // definition, and the output dither turns what is left into noise.
  const drift = Math.round(travelled / Math.max(kmPerPixel, 1e-9));

  // A thousand steps across the twenty minutes it takes the field to become a
  // different sky: about one a second, the same order as the drift, so it adds
  // nothing to the redraw rate on its own.
  const evolved = Math.round((t / (EVOLUTION_SECONDS * 1000)) * 1000);

  return [drift, evolved];
}

/**
 * How much ground one pixel covers, as a rough scale for the quantiser.
 *
 * Deliberately rough. The honest answer varies across the picture - a pixel
 * near the horizon covers kilometres and one near the zenith covers metres -
 * so there is no single number. This takes the middle layer at forty-five
 * degrees of elevation, which is about where the eye goes, and is therefore a
 * tuning constant with a derivation rather than a measurement.
 *
 * Being wrong here costs redraws in one direction and smoothness in the
 * other; it cannot make the picture incorrect.
 *
 * @param {number} fieldOfView degrees across the span
 * @param {number} spanWidth pixels
 * @returns {number} kilometres per pixel
 */
export function kmPerPixel(fieldOfView, spanWidth) {
  const layer = LAYERS[1];
  if (!layer) throw new Error("the middle cloud layer is missing");

  const pixelsPerDegree = spanWidth / Math.max(fieldOfView, 1e-6);

  // At 45 degrees the plane is sqrt(2) times its height away, and a degree
  // there subtends that distance times one degree in radians.
  const distanceKm = (layer.height * Math.SQRT2) / 1000;
  return (distanceKm * (Math.PI / 180)) / Math.max(pixelsPerDegree, 1e-6);
}

/**
 * Whether the cloud pass is worth running at all.
 *
 * At zero coverage the layer draws nothing, and skipping it keeps a clear sky
 * at exactly the cost it had before clouds existed - which is the difference
 * between a feature somebody can decline and a tax everybody pays.
 *
 * @param {number} cover
 * @returns {boolean}
 */
export function cloudsVisible(cover) {
  return cover > 0.001;
}
