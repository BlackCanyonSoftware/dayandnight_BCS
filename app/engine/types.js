// @ts-check
/**
 * The shapes that cross a seam.
 *
 * Typedefs only - this module emits nothing at run time. Anything passed
 * between the engine and a host, or between engine modules, is declared here so
 * the contract is in one place and `npm run typecheck` holds every caller to it.
 *
 * @module engine/types
 */

/**
 * A point on the Earth.
 *
 * @typedef {object} Place
 * @property {number} lat degrees north, -90..90
 * @property {number} lon degrees east, -180..180
 */

/**
 * A rectangle in span pixels, with the origin at the top-left of the span.
 *
 * One of these describes which part of the sky a surface is showing. The
 * editor's preview passes the whole span; each wallpaper window passes the
 * rectangle its monitor occupies. This is the mechanism behind US-012: one sky
 * across every screen rather than one sky per screen.
 *
 * @typedef {object} Rect
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 */

/**
 * The bounding box of every enabled monitor, in virtual-desktop pixels.
 *
 * @typedef {object} Span
 * @property {number} w
 * @property {number} h
 */

/**
 * An authored look.
 *
 * The rest of the grade decided in ADR 0004 - a three-band lift/gamma/gain in
 * Oklab, an altitude-keyed tint ramp, turbidity and ground albedo - is the
 * next slice and extends this.
 *
 * A preset describes appearance only, including where the camera points. It
 * can never describe geometry in the astronomical sense, because architecture
 * invariant 5 says no setting may put the sun in the wrong place: turning the
 * camera changes what you see, never where the sun is.
 *
 * @typedef {object} Preset
 * @property {number} exposure stops on top of the automatic exposure
 * @property {number | null} bearing degrees clockwise from north, or null for
 *   "face the side of the sky the sun crosses"
 * @property {number} horizon where the horizon sits down the span, 0..1
 * @property {number} fieldOfView degrees of sky across the whole span
 * @property {number} groundAlbedo how much light the ground returns, 0..1
 * @property {number} starBrightness a multiplier on the stars' real brightnesses
 * @property {number} starSize base point size in device pixels
 * @property {number} twinkle how much the stars shimmer, 0..1
 * @property {number} airglow the night sky's own faint radiance
 * @property {number} glare how much the sun and moon flare
 * @property {number} bodyScale how much larger than life the discs are drawn
 * @property {number} turbidity how much haze the air holds; 1 is a clear day
 * @property {string} dayTint colour cast in full daylight, as hex
 * @property {string} twilightTint colour cast around the horizon, as hex
 * @property {string} nightTint colour cast at night, as hex
 * @property {number} saturation chroma multiplier in Oklab; 1 is unchanged
 * @property {number} contrast lightness contrast in Oklab; 1 is unchanged
 * @property {number} whitePoint how bright something must be to reach white
 */

/**
 * Everything needed to draw one frame.
 *
 * `t` is supplied by the caller and never read from the clock inside the
 * engine, which is what makes the editor's scrubber and the live wallpaper the
 * same code path (architecture invariant 1).
 *
 * @typedef {object} FrameRequest
 * @property {number} t milliseconds since the Unix epoch, UTC
 * @property {Place} place
 * @property {Rect} crop this surface's rectangle within the span
 * @property {Span} span
 * @property {number} pixelRatio this monitor's device-pixel ratio
 */

/**
 * What a frame turned out to be, for the editor's readout and for tests.
 * Returned rather than logged, so nothing in the engine needs a console.
 *
 * @typedef {object} FrameInfo
 * @property {number} sunAltitude degrees
 * @property {number} sunAzimuth degrees clockwise from north
 * @property {"day" | "civil" | "nautical" | "astronomical" | "night"} band
 * @property {number} exposure the gain the sky was drawn with, for the readout
 */

export {};
