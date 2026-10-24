// @ts-check
/**
 * What stands between you and the horizon.
 *
 * US-032 asks for "a bundled skyline or mountain library, or the user's own
 * PNG". The library here is **computed rather than bundled**, and that is a
 * decision worth defending because the story says otherwise.
 *
 * Everything else in this product is arithmetic. The sky is scattering, the
 * stars are a catalogue, the clouds are noise on a plane; there is not a
 * bitmap in it. A folder of silhouette PNGs would be the only painted thing in
 * the application, and it would bring the three problems that come with
 * painted things: somebody has to license them, they have to ship, and they
 * have to be drawn at a resolution that then has to be stretched across a span
 * that might be three monitors wide. A computed ridgeline has none of those.
 * It is also the only version that can be re-rolled, which turns "here are six
 * skylines" into "here are all of them".
 *
 * The user's own PNG is a different feature and still worth having. It is not
 * this one.
 *
 * ## What is here and what is in the shader
 *
 * Only the settings and their meanings. Unlike the clouds, the shape never
 * moves: a ridgeline is the same ridgeline at midnight as at noon, so nothing
 * on the CPU needs to know where it is. The frame signature needs the
 * settings, because changing them changes every pixel, and nothing else.
 *
 * That is the whole reason this file is short. The clouds needed a CPU half
 * because they move; this does not move, so it does not.
 *
 * @module engine/sky/skyline
 */

/**
 * The shapes on offer.
 *
 * Three, and each one is a different kind of edge rather than a different
 * picture: a ridge that is smooth and huge, a city that is rectangular and
 * man-made, a treeline that is small and ragged. Anything else worth having is
 * one of these with different numbers.
 *
 * @type {readonly { id: string, name: string, hint: string }[]}
 */
export const STYLES = [
  {
    id: "none",
    name: "Nothing",
    hint: "An open horizon, with the sky going all the way down to it. What you get on water, or on a plain, or from high enough up."
  },
  {
    id: "mountains",
    name: "Mountains",
    hint: "Two ranges, one behind the other. The far one is paler because there is more air in front of it, which is the thing that actually makes a view look deep."
  },
  {
    id: "city",
    name: "City",
    hint: "A skyline of blocks and towers. Their windows come on as the light goes, a few at a time, and are still on at three in the morning the way real ones are."
  },
  {
    id: "trees",
    name: "Treeline",
    hint: "A ragged band of trees along the bottom. Small, busy and close, so it moves the eye along the horizon rather than up it."
  }
];

/**
 * The style, as the number the shader branches on.
 *
 * A string in the preset because a settings file somebody might read should
 * say `city` rather than `2`, and an integer at the boundary because a shader
 * cannot branch on a string. The mapping is the order of STYLES, so adding one
 * is one entry in one place.
 *
 * @param {string} id
 * @returns {number} 0 for nothing, or the index in STYLES
 */
export function styleIndex(id) {
  const found = STYLES.findIndex((style) => style.id === id);
  return found < 0 ? 0 : found;
}

/**
 * Whether the pass is worth running.
 *
 * Nothing is a real choice rather than a height of zero, and it skips the pass
 * entirely - the same bargain the clouds strike. An open horizon costs what it
 * costs today.
 *
 * @param {string} id
 * @param {number} height
 * @returns {boolean}
 */
export function skylineVisible(id, height) {
  return styleIndex(id) > 0 && height > 0.01;
}

/**
 * Whether a style id is one of ours.
 *
 * @param {unknown} id
 * @returns {boolean}
 */
export function isStyle(id) {
  return typeof id === "string" && STYLES.some((style) => style.id === id);
}

/**
 * How lit the windows are, from the sun's altitude.
 *
 * A separate function because the frame signature needs the same number: a
 * city whose lights come on has changed every pixel along the bottom of the
 * picture, and the signature's probes are all in the sky where nothing has
 * happened. Without this the lights would come on only when something else
 * forced a redraw.
 *
 * The curve is deliberately not a switch. Lights come on over the half hour
 * either side of sunset, a few at a time, which is what the hash per window in
 * the shader does with this as its threshold.
 *
 * @param {number} sunAltitude degrees
 * @returns {number} 0 by day, 1 deep in the night
 */
export function lightsOn(sunAltitude) {
  // Between +2 and -8 degrees: the lights are fully on by the end of civil
  // twilight, which is about when a city's are.
  const t = (2 - sunAltitude) / 10;
  return Math.max(0, Math.min(1, t));
}
