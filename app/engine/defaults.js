// @ts-check
/**
 * Every setting and its default, in one place.
 *
 * A new setting is a default here with a comment saying what it is for, a
 * schema row with a hint, and a migration entry if it renames or changes the
 * meaning of an existing key (architecture invariant 6).
 *
 * @module engine/defaults
 */

/** @typedef {import("./types.js").Preset} Preset */
/** @typedef {import("./types.js").Place} Place */

/**
 * A fresh preset.
 *
 * Returns a new object every call, never a shared one: a caller that mutated
 * the defaults would poison every later reset, which is a bug that takes an
 * afternoon to find.
 *
 * @returns {Preset}
 */
export function defaultPreset() {
  return {
    // Exposure in stops, on top of the automatic exposure. Negative is
    // darker. The automatic part follows the sun across the day's enormous
    // range of brightness; this is the user's opinion about the result.
    exposure: 0,

    // Which way the camera faces, in degrees clockwise from north, or null
    // for "wherever the sun is". Null is the default because a fixed bearing
    // that happens to face away from the sun gives a wallpaper where nothing
    // ever happens - and the right answer differs by hemisphere.
    bearing: null,

    // Where the horizon sits down the span, 0 at the top and 1 at the bottom.
    // Low, so that most of the picture is sky.
    horizon: 0.82,

    // How many degrees of sky the whole span covers, horizontally.
    //
    // Wide, and deliberately so. The sun swings through about 180 degrees of
    // azimuth between rising and setting, so a narrow view facing one way
    // misses it entirely for most of the day - at Denver in June a 90 degree
    // view facing south never sees the sunrise at all, which rather defeats
    // the product. At 150 the sun is in frame from mid-morning to
    // mid-afternoon in midsummer, and from close to sunrise to close to
    // sunset around the equinoxes.
    //
    // The projection is cylindrical rather than rectilinear - azimuth runs
    // linearly across the span - so a wide angle costs none of the corner
    // stretching a perspective projection would suffer.
    fieldOfView: 150,

    // How much light the ground below the horizon returns. ADR 0004 lists
    // this as part of the grade, and it is the first piece of it: the model
    // has no ground, so without this the bottom of the picture is black.
    // About a tenth is right for grass, soil and asphalt; snow is far higher.
    groundAlbedo: 0.12,

    // The tone curve's white point: how bright something has to be before it
    // is allowed to reach pure white. Higher keeps more detail in the sun's
    // glow at the cost of overall contrast.
    whitePoint: 4
  };
}

/**
 * The bearing to actually use, resolving "auto".
 *
 * Auto faces the equator - south from the northern hemisphere, north from the
 * southern - because that is the half of the sky the sun crosses. Pointing a
 * northern-hemisphere camera north by default would be technically a choice
 * and practically a blank wall.
 *
 * @param {Preset} preset
 * @param {Place} place
 * @returns {number} degrees clockwise from north
 */
export function resolveBearing(preset, place) {
  if (preset.bearing !== null) return preset.bearing;
  return place.lat >= 0 ? 180 : 0;
}

/**
 * Keys whose change only affects what is drawn, never what is computed.
 *
 * Nothing in the engine is expensive to recompute per frame any more - the
 * scattering table is built once and is not a function of any setting - so
 * every key is here. The distinction is kept because the grade (ADR 0004)
 * will reintroduce it.
 *
 * @type {ReadonlySet<keyof Preset>}
 */
export const DRAW_KEYS = new Set(
  /** @type {(keyof Preset)[]} */ (["exposure", "bearing", "horizon", "fieldOfView", "whitePoint"])
);
