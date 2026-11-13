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

    // How bright the stars are. A multiplier on their real relative
    // brightnesses, not a replacement for them: turning it up brings fainter
    // stars out without flattening the difference between them.
    starBrightness: 1,

    // The base size a star is drawn at, in device pixels, before the extra
    // size the brightest ones get. Below about two, a star's peak keeps
    // falling between pixel centres and the sky both dims and shimmers as
    // the stars drift across the grid.
    starSize: 2.6,

    // How much the stars twinkle, 0 to 1. Real twinkling is refraction in
    // moving air, so the shader concentrates it near the horizon whatever
    // this is set to.
    twinkle: 0.6,

    // The faint light the night sky has of its own - airglow high in the
    // atmosphere, plus the combined glow of stars too faint to resolve. The
    // scattering model reaches exactly zero once the sun is more than about
    // eight degrees down, so without this nautical twilight is a dead black
    // rectangle. Raising it also stands in for light pollution.
    airglow: 1.1e-6,

    // How much the sun and moon glare. The disc itself is only about half a
    // degree across - seven pixels at a wide field of view - so the glare is
    // most of what makes the sun read as the sun.
    glare: 1,

    // How much larger than life to draw the discs. One is the truth. People
    // consistently remember the sun as bigger than it is, so this exists -
    // but it is the one control here that is honestly a lie, and the hint
    // says so.
    bodyScale: 1,

    // How much haze the air holds. One is an ordinary clear day; higher is
    // hazier, which whitens the sky, widens the glare around the sun and
    // mutes the blue. A deep red sunset is largely a dusty one.
    //
    // Strictly a model parameter rather than a grade, but it sits with the
    // grade because that is where a user looks for it.
    turbidity: 1,

    /**
     * How much of the sky has cloud in it, from nothing to overcast.
     *
     * Zero by default, and that is a performance decision as much as a taste
     * one. The cloud pass is skipped entirely at zero, so a sky without them
     * costs exactly what it cost before they existed - which is the difference
     * between a feature somebody can decline and a tax everybody pays. It is
     * also the first thing in this product that moves, and moving is what
     * stops frames being skipped.
     */
    cloudCover: 0,

    /**
     * The wind's typical speed, in kilometres an hour.
     *
     * Kilometres rather than degrees, because the clouds are sampled where the
     * view ray meets a plane and so move with the wind across that plane. The
     * layers multiply it: the highest moves at 1.5 times this and the lowest
     * at 0.75, because the wind strengthens with height. What makes them slide
     * past each other is their distance, not a difference in the weather - see
     * `LAYERS` in `sky/clouds.js`.
     *
     * *Typical*, because by default the wind wanders: see `cloudWindFrom`. With
     * a fixed direction it is exactly this speed, always.
     *
     * Twelve is a light breeze, and a cloud feature then takes about five
     * minutes to pass a point - which is what a real one does. It is also
     * what sets the redraw rate: see the note in `sky/clouds.js`.
     */
    cloudDrift: 12,

    /**
     * Where the wind blows from, as a compass bearing in degrees clockwise from
     * north - the weather forecaster's convention, in which a westerly is 270.
     *
     * Null is the default, and means a *simulated* weather: the direction and
     * the speed wander from day to day around the prevailing wind for the
     * place, deterministically, so every screen agrees. See `sky/wind.js`. It
     * is a simulation and not a forecast, and the room is left in that module
     * for something that knows the real wind to replace it.
     *
     * A number fixes it: the wind then blows from that bearing at exactly the
     * typical speed, for good. Which way that looks on screen depends on which
     * way the view faces - a wind from the bearing the camera points at brings
     * the clouds toward you; one from your left or right sends them across.
     */
    cloudWindFrom: null,

    /**
     * The size of the features, in kilometres on the sampling plane.
     *
     * Larger is fewer, bigger clouds. Below about half a kilometre the field
     * turns to grain, because the pixels run out before the octaves do.
     */
    cloudScale: 1.6,

    /**
     * How sharply a cloud ends.
     *
     * Small is cumulus with a hard edge; large is stratus that fades into the
     * sky. It is the width of the threshold the density is cut at, so it also
     * decides how much of the field survives the cut at a given cover.
     */
    cloudSoftness: 0.22,

    /**
     * What stands between you and the horizon: nothing, mountains, a city or
     * a treeline.
     *
     * Nothing by default. An open horizon is what the sky model actually
     * computes, and a silhouette is the one thing in this picture that is
     * invented rather than derived - so it is offered rather than assumed.
     * Nothing also skips the pass, which is the same bargain the clouds make.
     */
    skyline: "none",

    /**
     * How tall it stands, in degrees of elevation.
     *
     * Eight degrees is about what a range of hills twenty miles off subtends,
     * and about what a city looks like from across its own river. Much more
     * than fifteen and it stops being a horizon and starts being a wall.
     */
    skylineHeight: 8,

    /**
     * Which skyline. Any whole number gives a different one.
     *
     * The whole argument for computing these rather than shipping drawings:
     * there is not a library of six, there is a library of all of them, and
     * this is how you walk through it.
     */
    skylineSeed: 1,

    /**
     * How brightly a city lights up at night.
     *
     * Zero leaves it a flat silhouette after dark, which is what a city looks
     * like in a power cut and nowhere else. It does nothing for the other
     * styles, because mountains do not have windows.
     */
    skylineLights: 1,

    // A colour cast keyed to the sun's altitude, in three stops: full day,
    // the hour either side of the horizon, and night. Neutral greys leave the
    // physical sky exactly as it is, which is the default.
    //
    // This is the piece of authored expressiveness ADR 0004 kept when it
    // chose a physical sky over a painted one.
    dayTint: "#808080",
    twilightTint: "#808080",
    nightTint: "#808080",

    // Chroma, in Oklab. One leaves the sky as the physics drew it.
    saturation: 1,

    // Lightness contrast, in Oklab. One is unchanged.
    contrast: 1,

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
