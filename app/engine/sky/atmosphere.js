// @ts-check
/**
 * The sky, from physics rather than from a palette.
 *
 * Single scattering through a spherical atmosphere: light from the sun is
 * scattered towards the viewer by air molecules (Rayleigh), by the larger
 * particles of haze and dust (Mie), and absorbed on the way by ozone. That is
 * the whole model, and between them those three terms account for almost
 * everything a sky does - why it is blue overhead, why it reddens at the
 * horizon, why haze whitens it, and why deep twilight is a particular blue
 * rather than grey.
 *
 * **Why not Preetham or Hosek-Wilkie.** They are the usual choices and both
 * are fitted to a sun at or above the horizon, which is precisely where this
 * product does not live: a wallpaper about sunrise spends its most interesting
 * hour with the sun *below* the horizon, where those models are extrapolating.
 * Integrating the scattering directly costs more per sample and costs nothing
 * here, because of the lookup table below. It also needs no fitted coefficient
 * table - every input is a physical constant.
 *
 * **Why ozone is not optional.** Leave it out and twilight comes out grey-brown
 * instead of blue. By the time the sun is a few degrees down, the light
 * reaching the viewer has travelled a long horizontal path through the ozone
 * layer, which absorbs in the orange and leaves the blue behind. This is the
 * Chappuis band, and it is the single reason a clear twilight sky is the
 * colour it is. For a product whose whole subject is the hour either side of
 * the horizon, it is the most important term in the model.
 *
 * ## The lookup table, and why it has to be three-dimensional
 *
 * The scattering integral is:
 *
 *     L = integral along the view ray of
 *           (betaR * densityR(h) * phaseR(theta) +
 *            betaM * densityM(h) * phaseM(theta)) * T(camera->P) * T(P->sun)
 *
 * The phase functions do factor out, and that part is worth having: `theta`,
 * the angle between the view direction and the sun, is the same at every point
 * along a straight view ray, because the sun is effectively infinitely far
 * away. So both phases come out of the integral and are applied per pixel in
 * the shader instead - which is where the bright glow around the sun comes
 * from, at no cost in table size.
 *
 * What is left inside, though, is **not** a function of the two elevations
 * alone. That is the tempting simplification, and it is wrong. As a sample
 * point travels along the view ray it moves over the curve of the planet, so
 * its local vertical tilts, and with it the sun's zenith angle *at that point*.
 * Which way it tilts depends on whether the ray is heading towards the sun or
 * away from it. Azimuth is inside the integral after all.
 *
 * This was measured rather than argued about, because it looked ignorable.
 * With the sun high it very nearly is - at 30 degrees elevation the integrals
 * vary by under half a per cent across the whole range of azimuth. But at
 * sunset the sky opposite the sun is half as bright as the sky above it, and
 * four degrees further down, at ordinary civil twilight, it is **five hundred
 * times** dimmer. A two-dimensional table would light the whole sky evenly at
 * dusk and erase the one structure that makes a sunset a sunset.
 *
 * So the table is indexed by `(sun elevation, view elevation, azimuth from the
 * sun)`. Only half a turn of azimuth is stored, because the sky is mirror
 * symmetric about the sun's own meridian.
 *
 * And because sun elevation is an *axis* of the table rather than an input to
 * it, the table is the same forever. It is built once and never again, which
 * is what makes a model this expensive affordable in a wallpaper.
 *
 * @module engine/sky/atmosphere
 */

/** Earth's radius, metres. The usual value for atmospheric work. */
const EARTH_RADIUS = 6_360_000;

/** Top of the modelled atmosphere, metres from the centre. */
const ATMOSPHERE_RADIUS = 6_420_000;

/** The viewer stands here: two metres up, which is eye height. */
const VIEW_HEIGHT = 2;

/**
 * Rayleigh scattering coefficient at sea level, per metre, for red, green and
 * blue. The steep rise towards blue - nearly six times red - is the whole
 * reason the sky is blue and sunsets are red.
 */
const RAYLEIGH_SCATTERING = [5.802e-6, 13.558e-6, 33.1e-6];

/** Rayleigh density falls off with this scale height, metres. */
const RAYLEIGH_SCALE_HEIGHT = 8000;

/** Mie scattering at sea level, per metre. Haze and dust; colour-neutral. */
const MIE_SCATTERING = 3.996e-6;

/**
 * Mie extinction, larger than the scattering coefficient because aerosols
 * absorb as well as scatter.
 */
const MIE_EXTINCTION = 4.44e-6;

/** Mie density scale height, metres. Haze sits much lower than air. */
const MIE_SCALE_HEIGHT = 1200;

/**
 * Ozone absorption, per metre. Note the shape: it absorbs in the green and
 * red and barely touches the blue, which is what keeps twilight blue.
 */
const OZONE_ABSORPTION = [0.65e-6, 1.881e-6, 0.085e-6];

/** The ozone layer's centre and half-width, metres. */
const OZONE_CENTRE = 25_000;
const OZONE_WIDTH = 15_000;

/** Samples along a view ray, and along each ray back to the sun. */
const VIEW_SAMPLES = 32;
const SUN_SAMPLES = 8;

/**
 * The table's shape.
 *
 * Chosen against bake time, which is paid once: resolution is concentrated
 * where the sky actually changes (see {@link encodeElevation}), and azimuth is
 * smooth enough not to need much.
 */
export const LUT_SUN = 48;
export const LUT_VIEW = 48;
export const LUT_AZIMUTH = 16;

/** The elevation range the table covers, in degrees. */
export const SUN_MIN = -20;
export const SUN_MAX = 90;
export const VIEW_MIN = -10;
export const VIEW_MAX = 90;

/** Mie asymmetry: how strongly haze scatters forwards. */
export const MIE_G = 0.76;

/**
 * How many times light is allowed to bounce, and how strongly.
 *
 * Single scattering alone gets twilight badly wrong, and it is worth being
 * precise about how. Measured from this model before the term below existed:
 * by six degrees below the horizon the zenith had a blue-to-red ratio of 0.59
 * - a *red* zenith, where a real civil twilight is distinctly blue - and below
 * about eight degrees it produced exactly zero light, so nautical twilight did
 * not exist at all. Both are the same omission. Once the sun is down, most of
 * the light that reaches the ground has bounced more than once, and a model
 * that stops at one bounce simply runs out of sky.
 *
 * The fix restores the colour as well as the brightness, and for a reason
 * worth knowing: Rayleigh scattering favours blue at every bounce, so light
 * that has scattered twice is bluer than light that has scattered once,
 * whatever colour it started. That is why a deep twilight is blue even though
 * the light feeding it came off a red horizon.
 *
 * This is an approximation, not the real thing. Each order is treated as an
 * isotropic ambient computed by averaging the previous order over the sky,
 * which is Hillaire's idea in its cheapest possible form: it ignores that the
 * ambient differs with height and direction. It is a great deal better than
 * nothing and a great deal cheaper than the real calculation. Replacing it
 * with a proper multiple-scattering table is on the roadmap.
 */
const SCATTERING_ORDERS = 3;

/** Directions sampled when averaging a scattering order over the sky. */
const AMBIENT_ELEVATIONS = 12;
const AMBIENT_AZIMUTHS = 8;

/**
 * Where an elevation sits in 0..1, with resolution concentrated near the
 * horizon.
 *
 * Everything interesting happens in the few degrees either side of zero: the
 * sky changes more between -2 and +2 degrees than between +20 and +90. A
 * linear axis would spend most of its samples on the part that barely moves,
 * and then band through sunrise. The square root pulls samples towards zero
 * from both directions.
 *
 * @param {number} degrees
 * @param {number} min
 * @param {number} max
 * @returns {number} 0..1
 */
export function encodeElevation(degrees, min, max) {
  const clamped = Math.min(max, Math.max(min, degrees));
  if (clamped >= 0) return 0.5 + 0.5 * Math.sqrt(clamped / max);
  return 0.5 - 0.5 * Math.sqrt(clamped / min);
}

/**
 * The inverse of {@link encodeElevation}.
 *
 * @param {number} u 0..1
 * @param {number} min
 * @param {number} max
 * @returns {number} degrees
 */
export function decodeElevation(u, min, max) {
  if (u >= 0.5) {
    const t = (u - 0.5) * 2;
    return t * t * max;
  }
  const t = (0.5 - u) * 2;
  return t * t * min;
}

/**
 * Build the table.
 *
 * `data` holds RGBA entries of `(IR.r, IR.g, IR.b, IM)` laid out for a 3D
 * texture: x is sun elevation, y is view elevation, z is azimuth from the sun.
 *
 * `reference` is one brightness per sun elevation, for auto-exposure. The
 * scene spans six thousand to one between noon and civil twilight and several
 * more orders of magnitude below that, so no fixed exposure can show both
 * ends. A real eye adapts; this lets the renderer do the same, as a pure
 * function of the sun's position rather than of anything remembered between
 * frames.
 *
 * `transmittance` is what survives of the sun's own light at each elevation,
 * which is what colours its disc - white overhead, orange at the horizon,
 * from the same extinction the sky uses rather than from a painted ramp.
 *
 * @returns {{ data: Float32Array, reference: Float32Array, transmittance: Float32Array }}
 */
export function bakeScatteringLut() {
  const data = new Float32Array(LUT_SUN * LUT_VIEW * LUT_AZIMUTH * 4);

  /** The reference brightness of each sun elevation, for auto-exposure. */
  const reference = new Float32Array(LUT_SUN);

  /**
   * What is left of the sun's own light at each elevation, and how much haze
   * it crossed: four values per entry, the last being the Mie optical depth.
   *
   * The depth is kept so that turbidity can change the sun's colour without
   * rebuilding the table. Haze is the one model parameter a user will want to
   * drag a slider for, and a rebuild is the better part of a second.
   */
  const transmittance = new Float32Array(LUT_SUN * 4);

  for (let x = 0; x < LUT_SUN; x += 1) {
    const sunElevation = decodeElevation((x + 0.5) / LUT_SUN, SUN_MIN, SUN_MAX);

    // Build up the bounces: each order is the previous one averaged over the
    // sky and fed back in as an isotropic source.
    const ambient = ambientFor(sunElevation);

    for (let z = 0; z < LUT_AZIMUTH; z += 1) {
      const azimuth = (z / (LUT_AZIMUTH - 1)) * 180;

      for (let y = 0; y < LUT_VIEW; y += 1) {
        const viewElevation = decodeElevation((y + 0.5) / LUT_VIEW, VIEW_MIN, VIEW_MAX);
        const { rayleigh, mie } = scatter(viewElevation, sunElevation, azimuth, ambient);

        const i = ((z * LUT_VIEW + y) * LUT_SUN + x) * 4;
        data[i] = rayleigh[0];
        data[i + 1] = rayleigh[1];
        data[i + 2] = rayleigh[2];
        data[i + 3] = mie;
      }
    }

    // The exposure reference is the average radiance of the whole sky, which
    // is the same quantity the ambient feedback uses. Sampling a handful of
    // directions instead was tried and is not monotonic: with the sun low,
    // the directions nearest it brighten even as the sky as a whole darkens,
    // so exposure would have crept the wrong way through the afternoon.
    const skyAverage = averageOverSky(sunElevation, ambient);
    reference[x] = 0.2126 * skyAverage[0] + 0.7152 * skyAverage[1] + 0.0722 * skyAverage[2];

    const survives = sunTransmittance(sunElevation);
    transmittance[x * 4] = survives[0];
    transmittance[x * 4 + 1] = survives[1];
    transmittance[x * 4 + 2] = survives[2];
    transmittance[x * 4 + 3] = mieDepthTowardsSun(sunElevation);
  }

  return { data, reference, transmittance };
}

/**
 * The isotropic ambient for one sun elevation, after every bounce.
 *
 * Exported so that a test or a preview can evaluate the sky the same way the
 * bake does, rather than re-deriving it and quietly disagreeing.
 *
 * @param {number} sunElevation degrees
 * @returns {[number, number, number]}
 */
export function ambientFor(sunElevation) {
  let ambient = /** @type {[number, number, number]} */ ([0, 0, 0]);
  for (let order = 1; order < SCATTERING_ORDERS; order += 1) {
    ambient = averageOverSky(sunElevation, ambient);
  }
  return ambient;
}

/**
 * The average radiance of the whole sky for one sun elevation.
 *
 * This is the isotropic source for the next scattering order. Averaging over
 * the sky is the approximation: the real second order varies with height and
 * direction, and this collapses it to one colour.
 *
 * @param {number} sunElevation degrees
 * @param {[number, number, number]} ambient the previous order
 * @returns {[number, number, number]}
 */
function averageOverSky(sunElevation, ambient) {
  const d = Math.PI / 180;
  const total = /** @type {[number, number, number]} */ ([0, 0, 0]);
  let weight = 0;

  for (let e = 0; e < AMBIENT_ELEVATIONS; e += 1) {
    // Cosine-weighted in elevation, because that is how much of the sky each
    // band actually covers.
    const viewElevation = ((e + 0.5) / AMBIENT_ELEVATIONS) * 90;
    const bandWeight = Math.cos(viewElevation * d);

    for (let a = 0; a < AMBIENT_AZIMUTHS; a += 1) {
      const azimuth = ((a + 0.5) / AMBIENT_AZIMUTHS) * 180;
      const { rayleigh, mie } = scatter(viewElevation, sunElevation, azimuth, ambient);

      const cosTheta =
        Math.sin(viewElevation * d) * Math.sin(sunElevation * d) +
        Math.cos(viewElevation * d) * Math.cos(sunElevation * d) * Math.cos(azimuth * d);
      const pr = rayleighPhase(cosTheta);
      const pm = miePhase(cosTheta, MIE_G);

      for (let c = 0; c < 3; c += 1) total[c] += (rayleigh[c] * pr + mie * pm) * bandWeight;
      weight += bandWeight;
    }
  }

  return [total[0] / weight, total[1] / weight, total[2] / weight];
}

/**
 * The scattering integrals for one geometry, with the phase functions factored
 * out.
 *
 * @param {number} viewElevationDeg
 * @param {number} sunElevationDeg
 * @param {number} azimuthDeg between the view direction and the sun, 0..180
 * @param {[number, number, number]} [ambient] isotropic light from previous
 *   scattering orders; omit for single scattering only
 * @returns {{ rayleigh: [number, number, number], mie: number }}
 */
export function scatter(viewElevationDeg, sunElevationDeg, azimuthDeg, ambient) {
  const d = Math.PI / 180;

  // The viewer stands at the pole of the model, looking along +x; the sun is
  // placed at the given elevation and azimuth away from that direction.
  const origin = [0, 0, EARTH_RADIUS + VIEW_HEIGHT];
  const view = [Math.cos(viewElevationDeg * d), 0, Math.sin(viewElevationDeg * d)];
  const sun = [
    Math.cos(sunElevationDeg * d) * Math.cos(azimuthDeg * d),
    Math.cos(sunElevationDeg * d) * Math.sin(azimuthDeg * d),
    Math.sin(sunElevationDeg * d)
  ];

  const toAtmosphere = raySphere(origin, view, ATMOSPHERE_RADIUS);
  if (toAtmosphere === null) return { rayleigh: [0, 0, 0], mie: 0 };

  // A ray that meets the ground stops there: beyond it there is no sky.
  const toGround = raySphere(origin, view, EARTH_RADIUS);
  const end = toGround !== null ? Math.min(toGround, toAtmosphere) : toAtmosphere;

  const step = end / VIEW_SAMPLES;

  // Optical depth accumulated from the camera to the current sample.
  let viewDepthRayleigh = 0;
  let viewDepthMie = 0;
  let viewDepthOzone = 0;

  const rayleigh = /** @type {[number, number, number]} */ ([0, 0, 0]);
  let mie = 0;

  for (let i = 0; i < VIEW_SAMPLES; i += 1) {
    const distance = (i + 0.5) * step;
    const point = [
      origin[0] + view[0] * distance,
      origin[1] + view[1] * distance,
      origin[2] + view[2] * distance
    ];
    const height = Math.hypot(point[0], point[1], point[2]) - EARTH_RADIUS;

    const densityRayleigh = Math.exp(-height / RAYLEIGH_SCALE_HEIGHT);
    const densityMie = Math.exp(-height / MIE_SCALE_HEIGHT);
    const densityOzone = ozoneDensity(height);

    viewDepthRayleigh += densityRayleigh * step;
    viewDepthMie += densityMie * step;
    viewDepthOzone += densityOzone * step;

    // How much sunlight reaches this point. The sun's direction is the same
    // everywhere, but its zenith angle *at this point* differs from the one at
    // the viewer, because the point has moved over the curve of the planet.
    // That is the whole reason this table needs an azimuth axis.
    const sunDepth = sunOpticalDepth(point, sun);

    // Transmittance from the camera to this point, which both the direct and
    // the ambient contributions have to come back through.
    const toCamera = /** @type {[number, number, number]} */ ([0, 0, 0]);
    for (let c = 0; c < 3; c += 1) {
      toCamera[c] = Math.exp(
        -(
          RAYLEIGH_SCATTERING[c] * viewDepthRayleigh +
          MIE_EXTINCTION * viewDepthMie +
          OZONE_ABSORPTION[c] * viewDepthOzone
        )
      );
    }

    // Light that has already bounced arrives from every direction, so it is
    // not shadowed by the planet the way direct sunlight is. This is the term
    // that keeps twilight alive - and blue - after the sun has set.
    //
    // It is split between the two channels the same way the direct light is,
    // because the *last* bounce - ambient into the view direction - is itself
    // a scattering event and follows the matching phase function. Putting it
    // all in one channel would give the Mie part a Rayleigh phase.
    if (ambient) {
      for (let c = 0; c < 3; c += 1) {
        rayleigh[c] += RAYLEIGH_SCATTERING[c] * densityRayleigh * ambient[c] * toCamera[c] * step;
      }
      // The Mie channel is a single value, so the ambient's colour is
      // averaged into it. Haze is colour-neutral, so this loses little.
      const ambientGrey = (ambient[0] + ambient[1] + ambient[2]) / 3;
      const greyTransmittance = (toCamera[0] + toCamera[1] + toCamera[2]) / 3;
      mie += MIE_SCATTERING * densityMie * ambientGrey * greyTransmittance * step;
    }

    if (sunDepth === null) continue; // this point is in the Earth's shadow

    for (let c = 0; c < 3; c += 1) {
      const sunTransmittance = Math.exp(
        -(
          RAYLEIGH_SCATTERING[c] * sunDepth.rayleigh +
          MIE_EXTINCTION * sunDepth.mie +
          OZONE_ABSORPTION[c] * sunDepth.ozone
        )
      );
      const transmittance = toCamera[c] * sunTransmittance;

      rayleigh[c] += RAYLEIGH_SCATTERING[c] * densityRayleigh * transmittance * step;
      if (c === 0) mie += MIE_SCATTERING * densityMie * transmittance * step;
    }
  }

  return { rayleigh, mie };
}

/**
 * How much of the sun's own light survives the journey to the viewer.
 *
 * This is what colours the sun's disc, and it is the reason a setting sun is
 * orange while a midday one is white: at the horizon the light has come
 * through a dozen times as much air, and air removes blue first. Nothing about
 * that is drawn by hand - it is the same extinction the sky model already
 * uses, read out along one ray.
 *
 * Returns zero once the sun is below the horizon, where the planet is in the
 * way and there is no disc to draw.
 *
 * @param {number} sunElevationDeg
 * @returns {[number, number, number]} 0..1 per channel
 */
export function sunTransmittance(sunElevationDeg) {
  const d = Math.PI / 180;
  const origin = [0, 0, EARTH_RADIUS + VIEW_HEIGHT];
  const sun = [Math.cos(sunElevationDeg * d), 0, Math.sin(sunElevationDeg * d)];

  const depth = sunOpticalDepth(origin, sun);
  if (depth === null) return [0, 0, 0];

  return /** @type {[number, number, number]} */ (
    [0, 1, 2].map((c) =>
      Math.exp(
        -(
          RAYLEIGH_SCATTERING[c] * depth.rayleigh +
          MIE_EXTINCTION * depth.mie +
          OZONE_ABSORPTION[c] * depth.ozone
        )
      )
    )
  );
}

/**
 * How much haze the sun's light crosses on the way in, as an optical depth.
 *
 * Separated out so that turbidity - how dusty the air is - can redden and dim
 * the sun's own disc without the whole scattering table being rebuilt. Haze
 * is the parameter a user is most likely to drag a slider for, and a rebuild
 * takes the better part of a second.
 *
 * @param {number} sunElevationDeg
 * @returns {number}
 */
export function mieDepthTowardsSun(sunElevationDeg) {
  const d = Math.PI / 180;
  const origin = [0, 0, EARTH_RADIUS + VIEW_HEIGHT];
  const sun = [Math.cos(sunElevationDeg * d), 0, Math.sin(sunElevationDeg * d)];

  const depth = sunOpticalDepth(origin, sun);
  return depth === null ? 0 : depth.mie;
}

/** The Mie extinction coefficient, so callers can scale it with turbidity. */
export const MIE_EXTINCTION_COEFFICIENT = MIE_EXTINCTION;

/**
 * Optical depth from a point towards the sun, or null if the Earth is in the
 * way.
 *
 * The null case is what makes twilight work. Once the sun is below the horizon
 * the air near the ground is in shadow and only the air high above the viewer
 * is still lit, so the light that arrives has come a long way through the
 * upper atmosphere. That is why it is both dim and strongly coloured, and why
 * it drains from the side of the sky opposite the sunset first.
 *
 * @param {number[]} point
 * @param {number[]} sun unit vector towards the sun
 * @returns {{ rayleigh: number, mie: number, ozone: number } | null}
 */
function sunOpticalDepth(point, sun) {
  if (raySphere(point, sun, EARTH_RADIUS) !== null) return null;

  const top = raySphere(point, sun, ATMOSPHERE_RADIUS);
  if (top === null) return null;

  const step = top / SUN_SAMPLES;
  let rayleigh = 0;
  let mie = 0;
  let ozone = 0;

  for (let i = 0; i < SUN_SAMPLES; i += 1) {
    const distance = (i + 0.5) * step;
    const sample = [
      point[0] + sun[0] * distance,
      point[1] + sun[1] * distance,
      point[2] + sun[2] * distance
    ];
    const height = Math.hypot(sample[0], sample[1], sample[2]) - EARTH_RADIUS;

    rayleigh += Math.exp(-height / RAYLEIGH_SCALE_HEIGHT) * step;
    mie += Math.exp(-height / MIE_SCALE_HEIGHT) * step;
    ozone += ozoneDensity(height) * step;
  }

  return { rayleigh, mie, ozone };
}

/**
 * Ozone's tent-shaped profile: none at the ground, a peak around 25 km, gone
 * again by 40. Unlike air and haze it does not simply fall off with height,
 * which is why it needs its own term rather than riding on the Rayleigh one.
 *
 * @param {number} height metres
 * @returns {number} 0..1
 */
function ozoneDensity(height) {
  return Math.max(0, 1 - Math.abs(height - OZONE_CENTRE) / OZONE_WIDTH);
}

/**
 * Distance from a point to a sphere centred on the origin, along a direction.
 *
 * Returns the nearest intersection ahead of the origin, or null if the ray
 * misses or the sphere lies entirely behind it.
 *
 * @param {number[]} origin
 * @param {number[]} direction unit length
 * @param {number} radius
 * @returns {number | null}
 */
function raySphere(origin, direction, radius) {
  const b = origin[0] * direction[0] + origin[1] * direction[1] + origin[2] * direction[2];
  const c = origin[0] * origin[0] + origin[1] * origin[1] + origin[2] * origin[2] - radius * radius;

  const discriminant = b * b - c;
  if (discriminant < 0) return null;

  const root = Math.sqrt(discriminant);
  const near = -b - root;
  const far = -b + root;

  if (far < 0) return null;
  return near > 0 ? near : far;
}

/* ------------------------------------------------------- phase functions */

/**
 * Rayleigh phase: gentle, symmetric, slightly brighter both towards and away
 * from the sun. This is why the whole sky glows rather than only the part
 * near the sun.
 *
 * @param {number} cosTheta
 * @returns {number}
 */
export function rayleighPhase(cosTheta) {
  return (3 / (16 * Math.PI)) * (1 + cosTheta * cosTheta);
}

/**
 * Mie phase, Cornette-Shanks. Strongly forward scattering, which is the bright
 * halo around the sun and the white glare of a hazy day.
 *
 * @param {number} cosTheta
 * @param {number} g asymmetry; 0 is isotropic, 0.76 strongly forward
 * @returns {number}
 */
export function miePhase(cosTheta, g) {
  const g2 = g * g;
  const numerator = 3 * (1 - g2) * (1 + cosTheta * cosTheta);
  const denominator = 8 * Math.PI * (2 + g2) * Math.pow(1 + g2 - 2 * g * cosTheta, 1.5);
  return numerator / denominator;
}
