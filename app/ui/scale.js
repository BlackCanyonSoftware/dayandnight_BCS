// @ts-check
/**
 * How big a picture is drawn, against how big the desktop it stands for is.
 *
 * A star is a point, and its size is set in pixels of the *desktop* - the
 * `starSize` setting is in CSS pixels of the span, scaled by the monitor's
 * device-pixel ratio on the real wallpaper. Anything that draws the sky
 * smaller than the span it stands for has to say so through `pixelRatio`, or
 * the stars keep their pixel size while the sky shrinks around them: a star
 * that is a third of a degree across on a two-screen wallpaper becomes three
 * degrees across in a 400-pixel picture, which is six moons.
 *
 * Until 2026-11-12 the preview, the gallery thumbnails and every picture of the
 * sky anyone made for the README passed a ratio of 1 and did exactly that.
 *
 * @module ui/scale
 */

/** How wide the preview buffer gets, regardless of how wide the span is. */
export const MAX_PREVIEW_WIDTH = 1600;

/**
 * What a typical single desktop is wide. The gallery's thumbnails have no
 * span of their own, so they stand in for this one.
 */
export const REFERENCE_SPAN_WIDTH = 1920;

/**
 * The pixel ratio for a picture `drawnWidth` wide that stands for a span
 * `spanWidth` wide: below 1 when it is smaller, so a star keeps its size in the
 * sky and not in pixels.
 *
 * @param {number} drawnWidth
 * @param {number} spanWidth
 * @returns {number}
 */
export function starScale(drawnWidth, spanWidth) {
  if (!(spanWidth > 0) || !(drawnWidth > 0)) return 1;
  return drawnWidth / spanWidth;
}
