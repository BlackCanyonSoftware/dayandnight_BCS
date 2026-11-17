// @ts-check
/**
 * The shaders, as strings.
 *
 * Strings in a `.js` file rather than `.glsl` files because the project has no
 * build step (ADR 0001): there is no bundler to turn an import of a `.glsl`
 * file into text, and fetching them at run time would mean the first frame
 * waits on the network stack for files that are already on disk.
 *
 * Three passes, and the order matters:
 *
 * 1. **Sky** fills a half-float buffer with linear radiance.
 * 2. **Stars** add into the same buffer, in the same units.
 * 3. **Bodies** - the sun and the moon - add into it too.
 * 4. **Composite** exposes the sum, tone maps it once, and writes sRGB.
 *
 * Summing before tone mapping is what makes the stars behave. A star drawn
 * over an already tone-mapped sky could never be dimmer than the sky it sits
 * on, so stars would still be there at noon. Added as light, they are simply
 * swamped, exactly as they are in life.
 *
 * @module engine/shaders
 */

import {
  LUT_AZIMUTH,
  LUT_SUN,
  LUT_VIEW,
  MIE_G,
  SUN_MAX,
  SUN_MIN,
  VIEW_MAX,
  VIEW_MIN
} from "./sky/atmosphere.js";
import { LAYERS, PERIOD } from "./sky/clouds.js";
import { CELL_HEIGHT } from "./sky/weather.js";

/**
 * Shared GLSL: the table's axes, and the view mapping the sky and the stars
 * have to agree on.
 *
 * They agree because it is written once. A star that used a slightly
 * different projection from the sky would drift across it through the day,
 * which is the kind of bug that takes a week to notice and a minute to fix.
 */
const VIEW = /* glsl */ `
const float PI = 3.14159265358979;
const float RADIANS = PI / 180.0;

const float LUT_SUN = ${LUT_SUN}.0;
const float LUT_VIEW = ${LUT_VIEW}.0;
const float LUT_AZIMUTH = ${LUT_AZIMUTH}.0;
const float SUN_MIN = ${SUN_MIN}.0;
const float SUN_MAX = ${SUN_MAX}.0;
const float VIEW_MIN = ${VIEW_MIN}.0;
const float VIEW_MAX = ${VIEW_MAX}.0;
const float MIE_G = ${MIE_G};

// Resolution is concentrated near the horizon, because that is where the sky
// changes. Must match encodeElevation() in sky/atmosphere.js exactly.
float encodeElevation(float degrees, float lo, float hi) {
  float c = clamp(degrees, lo, hi);
  return c >= 0.0 ? 0.5 + 0.5 * sqrt(c / hi) : 0.5 - 0.5 * sqrt(c / lo);
}

// Fold an angle into -180..180.
float wrap180(float degrees) {
  return mod(degrees + 540.0, 360.0) - 180.0;
}

// Henyey-Greenstein, for the clouds. The sky's own Mie phase is folded into
// the scattering table and applied there; this is the same function at a
// different asymmetry, which is why it is written out rather than shared.
float miePhaseCloud(float cosTheta, float g) {
  float gg = g * g;
  float d = 1.0 + gg - 2.0 * g * cosTheta;
  return (1.0 - gg) / (4.0 * PI * max(d * sqrt(max(d, 1e-4)), 1e-4));
}

// How many degrees of sky the span covers vertically arrives as the uniform
// uDegreesPerSpanY, computed by engine/view.js. It used to be worked out here
// AND in signature.js, and the two had to agree exactly for architecture
// invariant 1 to hold - so now it is worked out once, on the CPU, and the cap
// that a tall span needs lives in one place with its reasoning.
`;

/** The sRGB transfer function and the output dither. Composite pass only. */
const OUTPUT = /* glsl */ `
// Exactly the IEC 61966-2-1 transfer function, not the 2.2 power
// approximation. The approximation is visibly wrong in the darkest few
// percent, which for a night sky is most of the picture.
vec3 linearToSrgb(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(hi, lo, step(c, vec3(0.0031308)));
}

// Interleaved gradient noise (Jimenez, SIGGRAPH 2014). One fract and a dot
// product, and it looks better than an ordered Bayer matrix at this cost.
//
// Dither is not a nicety here. A sky is a wide, shallow gradient, which is the
// exact case 8-bit output bands on: without this, a clear twilight shows a
// dozen visible steps across a 1440p screen. NFR-3.
float ditherNoise(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

vec3 dither(vec3 srgb, vec2 fragCoord) {
  return srgb + (ditherNoise(fragCoord) - 0.5) / 255.0;
}
`;

/** One full-screen triangle, no transforms. Used by the sky and composite. */
export const FULLSCREEN_VERT = /* glsl */ `#version 300 es
layout(location = 0) in vec2 aPosition;

void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

/**
 * The sky pass: writes linear radiance, no tone mapping.
 *
 * The picture is a function of position in the **span** - the bounding box of
 * every monitor - not of position in this window. That is what makes one sky
 * stretch across three screens instead of three skies (US-012).
 */
export const SKY_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler3D;
${VIEW}

uniform vec2 uResolution;
uniform vec4 uCrop;
uniform vec2 uSpan;

uniform sampler3D uSky;

uniform float uSunAltitude;
uniform float uSunAzimuth;

uniform float uBearing;
uniform float uHorizon;
uniform float uDegreesPerSpanY;
uniform float uFieldOfView;

uniform float uGroundAlbedo;
uniform vec3 uAirglow;
uniform float uTurbidity;

out vec4 fragColor;

float rayleighPhase(float cosTheta) {
  return (3.0 / (16.0 * PI)) * (1.0 + cosTheta * cosTheta);
}

float miePhase(float cosTheta, float g) {
  float g2 = g * g;
  float numerator = 3.0 * (1.0 - g2) * (1.0 + cosTheta * cosTheta);
  float denominator = 8.0 * PI * (2.0 + g2) * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5);
  return numerator / denominator;
}

// Look the table up and apply the phase functions, for one direction.
vec3 skyRadiance(float elevation, float fromSun) {
  // The two elevation axes are sampled at texel centres, so the encoded value
  // is already the right coordinate. The azimuth axis stores its endpoints
  // exactly instead, so it needs the half-texel shift spelled out.
  vec3 uvw = vec3(
    encodeElevation(uSunAltitude, SUN_MIN, SUN_MAX),
    encodeElevation(elevation, VIEW_MIN, VIEW_MAX),
    ((fromSun / 180.0) * (LUT_AZIMUTH - 1.0) + 0.5) / LUT_AZIMUTH
  );

  vec4 entry = texture(uSky, uvw);

  // The angle between the view direction and the sun, which both phase
  // functions turn on. Constant along a view ray, which is exactly why it
  // could be taken out of the integral and left until now.
  float cosTheta =
    sin(elevation * RADIANS) * sin(uSunAltitude * RADIANS) +
    cos(elevation * RADIANS) * cos(uSunAltitude * RADIANS) * cos(fromSun * RADIANS);

  // Haze is the Mie term, and the table keeps it in its own channel - which
  // it does because the phase functions had to be applied separately anyway.
  // So turbidity costs one multiply here, where changing it in the model
  // would mean rebuilding the table and most of a second of waiting.
  //
  // This scales the light haze scatters *in*. It does not scale what haze
  // takes *out* along the view ray, which is baked; the sun's own disc does
  // get the extinction, in transmittanceFor(). At ordinary turbidities the
  // difference is small, and it is the in-scattering that makes a hazy sky
  // look hazy.
  return entry.rgb * rayleighPhase(cosTheta) +
         vec3(entry.a) * uTurbidity * miePhase(cosTheta, MIE_G);
}

void main() {
  // gl_FragCoord is in device pixels with the origin bottom-left. Flip y so
  // that 0 is the top of the picture, which is how the span is described.
  vec2 inWindow = gl_FragCoord.xy / uResolution;
  vec2 inSpan = (uCrop.xy + vec2(inWindow.x, 1.0 - inWindow.y) * uCrop.zw) / uSpan;

  float azimuth = uBearing + (inSpan.x - 0.5) * uFieldOfView;
  float elevation = (uHorizon - inSpan.y) * uDegreesPerSpanY;

  // How far round from the sun, folded into 0..180: the sky is mirror
  // symmetric about the sun's own meridian, which is why the table only
  // stores half a turn.
  float fromSun = abs(wrap180(azimuth - uSunAzimuth));

  vec3 radiance = skyRadiance(elevation, fromSun);

  // Below the horizon there is ground, and the model has none: a view ray
  // that meets the Earth carries only the short column of air in front of it,
  // which is nearly nothing, so without this the bottom of the picture is a
  // black void rather than a landscape.
  //
  // The stand-in is the sky just above the horizon in the same direction,
  // dimmed by an albedo. That is roughly what ground does - it returns the
  // light falling on it - and it behaves correctly without being asked to:
  // dark at night, warm under a sunset, bright at noon, and darker away from
  // the sun than towards it. A real surface, with a silhouette on it, is
  // Milestone 4.
  float belowHorizon = smoothstep(0.0, -1.2, elevation);
  if (belowHorizon > 0.0) {
    radiance = mix(radiance, skyRadiance(0.75, fromSun) * uGroundAlbedo, belowHorizon);
  }

  // Airglow: the faint light a night sky has of its own, from oxygen and
  // sodium high in the atmosphere, plus the combined glow of stars too faint
  // to resolve. Without it the scattering model reaches exactly zero once the
  // sun is more than about eight degrees down, and nautical twilight renders
  // as a dead black rectangle - which is both wrong and ugly. Above the
  // horizon only; the ground does not glow.
  radiance += uAirglow * (1.0 - belowHorizon);

  fragColor = vec4(max(radiance, vec3(0.0)), 1.0);
}
`;

/**
 * The star pass, vertex half.
 *
 * Each star carries a real right ascension and declination, and this turns
 * them into what the observer sees - the same transform `astro/coords.js`
 * does on the CPU for the sun. That is where the whole of US-005 comes from:
 * the field turns about the celestial pole at the sidereal rate, tilted by
 * the observer's latitude, without any of that being written down as a rule.
 */
export const STAR_VERT = /* glsl */ `#version 300 es
precision highp float;
${VIEW}

// right ascension, declination, radiance, per-star hash
layout(location = 0) in vec4 aStar;

// A planet's own colour. Zero, which is what a star's attribute is left at,
// means "colour it from the hash".
layout(location = 1) in vec3 aTint;

uniform vec4 uCrop;
uniform vec2 uSpan;

uniform float uLatitude;
uniform float uSiderealTime;   // local apparent sidereal time, degrees

uniform float uBearing;
uniform float uHorizon;
uniform float uDegreesPerSpanY;
uniform float uFieldOfView;

uniform float uBrightness;
uniform float uSize;           // base point size, device pixels
uniform float uTwinkle;        // 0 none, 1 plenty
uniform float uTwinklePhase;   // 0..1, wraps continuously

out vec3 vColour;
out float vRadiance;
out float vSize;

// A sprite under about a pixel and a quarter can fall between pixel centres and
// not be drawn at all, so a star in a small picture - a gallery thumbnail, a
// README tile - would vanish rather than shrink. This is the least a star is
// ever drawn at, whatever the picture is a picture of.
const float MIN_STAR_PX = 1.3;

// A star's colour from its hash. Real visible stars run from blue-white
// through white to orange, weighted towards the warm end; this is that ramp,
// not a hue wheel, because a sky with green and purple stars in it reads as a
// screensaver.
vec3 starColour(float hash) {
  vec3 hot = vec3(0.70, 0.80, 1.00);
  vec3 white = vec3(1.00, 0.98, 0.95);
  vec3 cool = vec3(1.00, 0.80, 0.62);
  return hash < 0.5 ? mix(hot, white, hash * 2.0) : mix(white, cool, (hash - 0.5) * 2.0);
}

void main() {
  float rightAscension = aStar.x;
  float declination = aStar.y;
  float radiance = aStar.z;
  float hash = aStar.w;

  // The hour angle: how far the star is past the observer's meridian. This
  // one subtraction is what makes the sky turn, because sidereal time
  // advances a little over 15 degrees an hour.
  float H = (uSiderealTime - rightAscension) * RADIANS;
  float lat = uLatitude * RADIANS;
  float dec = declination * RADIANS;

  float sinAltitude = sin(lat) * sin(dec) + cos(lat) * cos(dec) * cos(H);
  float altitude = asin(clamp(sinAltitude, -1.0, 1.0)) / RADIANS;

  float azimuthFromSouth = atan(sin(H), cos(H) * sin(lat) - tan(dec) * cos(lat));
  float azimuth = mod(azimuthFromSouth / RADIANS + 180.0, 360.0);

  // Below the horizon there is ground in the way. Pushed off-screen rather
  // than discarded in the fragment shader, which is cheaper and avoids half a
  // star sitting on the horizon line.
  if (altitude < -0.5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }

  // The same projection the sky uses, run backwards.
  float spanFracX = wrap180(azimuth - uBearing) / uFieldOfView + 0.5;
  float spanFracY = uHorizon - altitude / uDegreesPerSpanY;

  vec2 spanPixel = vec2(spanFracX * uSpan.x, spanFracY * uSpan.y);
  vec2 inWindow = (spanPixel - uCrop.xy) / uCrop.zw;

  gl_Position = vec4(inWindow.x * 2.0 - 1.0, (1.0 - inWindow.y) * 2.0 - 1.0, 0.0, 1.0);

  // Twinkling is refraction in moving air, so it is strongest near the
  // horizon where the light has come through most of it, and almost absent
  // overhead. Faking it evenly across the sky is the usual mistake and reads
  // as flickering rather than as stars.
  //
  // A planet twinkles much less than a star, and that is a fact about the sky
  // and not a style choice: a star is a point and a planet is a small disc, so
  // the air's shimmer averages out across it. The old advice that the ones that
  // do not twinkle are planets is true.
  bool planet = dot(aTint, vec3(1.0)) > 0.0;
  float nearHorizon = 1.0 - smoothstep(0.0, 40.0, altitude);
  float flicker = 1.0 + uTwinkle * (planet ? 0.3 : 1.0) * nearHorizon * 0.55 *
    sin((uTwinklePhase + hash) * 2.0 * PI * 7.0 + hash * 31.0);

  vRadiance = radiance * uBrightness * max(flicker, 0.0);
  vColour = planet ? aTint : starColour(hash);

  // Brighter stars are drawn larger as well as more intensely, which is how
  // both a camera and an eye behave. Without it the bright stars clip to
  // white at the same size as the faint ones and the sky loses its depth.
  //
  // But only a little larger. It was 2.2, which made the brightest star 3.2
  // times the size of the faintest: eight pixels at the default, which on a
  // single 1080p screen is wider than the moon and on two is about three fifths
  // of it. A bright star is a brighter point, not a disc. 0.6 makes the
  // brightest 1.6 times the faintest, so the sky's depth comes from how bright
  // they are and not from a few of them being swollen. (1.4 was tried and the
  // brightest were still moons in a small picture, where a single pixel is
  // already half the moon's width.)
  float size = max(MIN_STAR_PX, uSize * (1.0 + 0.6 * sqrt(clamp(radiance * 3200.0, 0.0, 1.0))));

  // The brightest planets are a good deal brighter than any star, and a
  // camera's glare on them is wider: Venus is a small blaze and not a bigger
  // dot. Up to a little over half as large again, for the very brightest.
  if (planet) size *= 1.0 + 0.5 * clamp(log(radiance / 2.7e-3) / 2.3026, 0.0, 1.2);
  gl_PointSize = size;
  vSize = size;
}
`;

/**
 * The star pass, fragment half: a soft round point.
 *
 * The falloff matters more than it looks. A hard-edged disc reads as a
 * sticker; a tight core with a wide faint skirt reads as a point of light
 * seen through air, and it is what gives the brighter stars their glow
 * without a separate bloom pass.
 */
export const STAR_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec3 vColour;
in float vRadiance;
in float vSize;

out vec4 fragColor;

void main() {
  vec2 offset = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(offset, offset);
  if (r2 > 1.0) discard;

  // A tight core plus a broad halo: the sum of two falloffs rather than one,
  // because a single Gaussian gives either no glow or no definition.
  //
  // The core is gentler than it looks like it should be, and that is
  // deliberate. A star is only a couple of pixels across, so a sharp falloff
  // drops most of its light *between* pixel centres: measured, the brightest
  // star in the sky was reaching 97 of 255 instead of nearly white, purely
  // because the peak kept landing in a gap. Spreading it over the pixels it
  // actually covers is what makes a star look like a star rather than a
  // flickering speck.
  //
  // And flatter still when the sprite is small. A sprite a pixel or so wide is
  // sampled at a single point wherever its centre happens to fall, so a sharp
  // core makes the same star anything from full brightness to nothing
  // depending on where it landed. Flatten the falloff as the sprite shrinks;
  // at the size a star is on a real desktop it is the core it always was.
  float small = 1.0 - smoothstep(1.3, 3.0, vSize);
  float core = exp(-r2 * mix(4.5, 0.9, small));
  float halo = exp(-r2 * 1.2) * 0.25;

  fragColor = vec4(vColour * vRadiance * (core + halo), 1.0);
}
`;

/**
 * The sun and the moon, vertex half.
 *
 * One point, positioned entirely from uniforms - there is no vertex buffer,
 * because there is nothing to put in it. The sprite is made far larger than
 * the disc so that the glare has somewhere to live: at a wide field of view
 * the sun is only a handful of pixels across, and what makes it read as the
 * sun is everything around it rather than the disc itself.
 */
export const BODY_VERT = /* glsl */ `#version 300 es
precision highp float;
${VIEW}

uniform vec4 uCrop;
uniform vec2 uSpan;

uniform float uAltitude;
uniform float uAzimuth;
uniform float uSpriteRadius;   // half the sprite, in degrees

uniform float uBearing;
uniform float uHorizon;
uniform float uDegreesPerSpanY;
uniform float uFieldOfView;

void main() {
  // Degrees of sky to pixels of span, which is the scale everything here
  // works in.
  float pixelsPerDegree = uSpan.x / uFieldOfView;

  float spanFracX = wrap180(uAzimuth - uBearing) / uFieldOfView + 0.5;
  float spanFracY = uHorizon - uAltitude / uDegreesPerSpanY;

  vec2 spanPixel = vec2(spanFracX * uSpan.x, spanFracY * uSpan.y);
  vec2 inWindow = (spanPixel - uCrop.xy) / uCrop.zw;

  gl_Position = vec4(inWindow.x * 2.0 - 1.0, (1.0 - inWindow.y) * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 2.0 * uSpriteRadius * pixelsPerDegree;
}
`;

/**
 * The sun and the moon, fragment half.
 *
 * Three things happen here, and the second is the interesting one.
 *
 * **The disc** is a circle of the body's true angular radius - about a
 * quarter of a degree for both, which is far smaller than people remember.
 *
 * **The phase** is drawn as geometry, not as brightness. The terminator - the
 * line between lit and unlit - is the edge of a sphere's shadow seen in
 * projection, which is half an ellipse: its width across the disc is the
 * cosine of the phase angle. So a quarter moon is a straight line, a crescent
 * bows one way and a gibbous moon the other, and all three come out of the
 * same expression without being special-cased. The whole figure is then
 * turned to face the sun as the *observer* sees it, which is why the same
 * crescent stands upright in the tropics and lies on its side in Norway.
 *
 * **The glare** is the wide falloff outside the disc. Two power curves rather
 * than one: a tight one for the bright ring that hugs the sun, and a broad
 * shallow one for the haze that reaches across the sky.
 */
export const BODY_FRAG = /* glsl */ `#version 300 es
precision highp float;

uniform float uAltitude;
uniform float uSpriteRadius;   // half the sprite, in degrees
uniform float uAngularRadius;  // the disc itself, in degrees
uniform vec3 uRadiance;
uniform float uPhase;          // cos of the phase angle: 1 full, 0 half, -1 new
uniform float uLimbAngle;      // degrees from up, towards the lit side
uniform float uGlare;
uniform float uPixelsPerDegree;

out vec4 fragColor;

const float RADIANS = 3.14159265358979 / 180.0;

void main() {
  // gl_PointCoord runs down the sprite, so y is flipped to put up at the top.
  vec2 offset = vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y) * 2.0 - 1.0;
  vec2 fromCentre = offset * uSpriteRadius;
  float distance = length(fromCentre);

  // The sprite is a square and the glare is not. Without this the glare is
  // cut off at the square's edge and the sun wears a visible box.
  float inSprite = distance / uSpriteRadius;
  if (inSprite > 1.0) discard;

  // Anything below the horizon is behind the ground, which is how a body
  // sets: the disc is cut off rather than fading out.
  if (uAltitude + fromCentre.y < 0.0) discard;

  // A soft edge about a pixel wide, so the disc is anti-aliased without being
  // blurred. Measured against the *sprite* instead, as this first did, the
  // edge came out at a sixth of the disc's radius - the moon was mostly
  // gradient, and its lit area read about ten per cent too large.
  float edge = max(uAngularRadius * 0.02, 0.7 / max(uPixelsPerDegree, 0.001));
  float disc = 1.0 - smoothstep(uAngularRadius - edge, uAngularRadius + edge, distance);

  float lit = disc;
  if (disc > 0.0 && uPhase < 0.999) {
    // Into the frame where the lit side is +x, so the terminator is an
    // ellipse about the origin.
    float limb = uLimbAngle * RADIANS;
    vec2 towardsSun = vec2(sin(limb), cos(limb));
    vec2 unit = fromCentre / max(uAngularRadius, 1e-6);

    float along = dot(unit, towardsSun);
    float across = dot(unit, vec2(towardsSun.y, -towardsSun.x));

    // The terminator: half an ellipse whose width is the cosine of the phase
    // angle. Full moon (uPhase = 1) puts it off the disc entirely; new moon
    // (-1) puts it on the far limb and nothing is lit.
    float terminator = -uPhase * sqrt(max(0.0, 1.0 - across * across));

    // Softened a little, because a real terminator is a gradient: that line
    // is sunrise crossing the moon, striking the ground at a grazing angle,
    // not a switch. Centred on the true terminator, so the lit area is still
    // exactly right.
    lit = disc * smoothstep(terminator - 0.035, terminator + 0.035, along);
  }

  // Glare. A tight ring plus a broad haze; both fall away from the disc's own
  // edge rather than from its centre, so a larger body glares more.
  float beyond = max(distance, uAngularRadius) / uAngularRadius;
  float tight = pow(beyond, -3.4);
  float broad = pow(beyond, -1.5) * 0.22;

  // Faded out well before the sprite's edge. A power falloff never actually
  // reaches zero, and at the sun's brightness even a thousandth of it is a
  // visible rim - which is the box this used to draw.
  float fade = 1.0 - smoothstep(0.5, 1.0, inSprite);

  float glare = uGlare * (tight + broad) * (1.0 - disc) * fade;

  fragColor = vec4(uRadiance * (lit + glare), 1.0);
}
`;

/** The composite pass: expose the summed light, tone map once, write sRGB. */

/**
 * The three layers, written into the shader from `clouds.js` rather than
 * retyped - the same reason the LUT dimensions are injected above. A fourth
 * layer would need `uDriftX` and `uDriftZ` to stop being vec3s, which is why this asserts
 * rather than silently dropping one.
 */
const LAYER_CALLS = (() => {
  if (LAYERS.length !== 3) {
    throw new Error(`the cloud shader carries drift for 3 layers, not ${LAYERS.length}`);
  }
  // Every number written with a decimal point. GLSL ES 3.00 does not convert
  // an int to a float at a call site, so a layer whose scale happens to be a
  // round 1.0 serialises as "1" and the whole shader fails to compile with
  // "no matching overloaded function" - which names the function rather than
  // the argument, and so points at the wrong thing entirely.
  const float = (/** @type {number} */ value) =>
    Number.isInteger(value) ? `${value}.0` : String(value);

  return LAYERS.map(
    (layer, i) =>
      `depth += layerDepth(dir, ${float(layer.height)}, ${float(layer.scale)}, ` +
      `vec2(uDriftX[${i}], uDriftZ[${i}]), ${float(layer.weight)});`
  ).join("\n  ");
})();

/**
 * The clouds: a plane of domain-warped noise, lit by the real sun.
 *
 * Drawn over the accumulated radiance rather than added to it, because a cloud
 * is the one thing in this scene that takes light away as well as giving it.
 * It runs after the stars and the bodies for the same reason: a cloud in front
 * of the moon should hide the moon, and one in front of the sun should both
 * hide it and light up.
 *
 * **The geometry is the half that matters.** Sampling noise by azimuth and
 * elevation is the obvious thing and it looks wrong immediately: the features
 * stay the same size all the way up, so the sky reads as a wall with a texture
 * on it. Clouds sit on a plane at a height, so the view ray is intersected
 * with that plane and the noise is sampled where it lands. Everything else
 * follows - features shrink and crowd towards the horizon, the layers slide
 * past each other at rates their heights decide, and a low sheet reaches the
 * horizon sooner than a high one. That is the parallax US-030 asks for, and it
 * is one divide.
 *
 * Near the horizon the ray turns parallel to the plane and the intersection
 * runs away to infinity, so the sample fades out over the last stretch. Real
 * cloudscapes do the same thing for the same reason - the far ones merge into
 * haze - so the limit of the model and the look of the sky agree for once.
 */
export const CLOUD_FRAG = /* glsl */ `#version 300 es
precision highp float;

${VIEW}

uniform vec2 uResolution;
uniform vec4 uCrop;
uniform vec2 uSpan;

uniform float uBearing;
uniform float uHorizon;
uniform float uFieldOfView;
uniform float uDegreesPerSpanY;

uniform float uSunAltitude;
uniform float uSunAzimuth;
uniform vec3 uSunColour;
uniform vec3 uAmbient;

uniform float uCover;
uniform float uSoftness;
uniform vec3 uDriftX;
uniform vec3 uDriftZ;
uniform float uEvolution;
uniform float uScale;

out vec4 outColour;

// A hash with no trigonometry in it. sin-based hashes band visibly on some
// drivers at the precision this needs, and the banding looks exactly like a
// cloud edge - the worst artefact available here.
vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

// Value noise on a lattice, smoothed with the quintic so the second
// derivative is continuous. The cubic leaves creases that read as faint
// straight lines across a cloud, which is the artefact that gives a procedural
// sky away second-fastest.
//
// **Periodic, which is not decoration.** The lattice index is wrapped to
// the period before it is hashed, so the field repeats exactly. That is what
// lets the drift be wrapped on the CPU without the sky jumping: a single
// precision uniform cannot hold an offset that grows from the Unix epoch, and
// the alternative to a seamless wrap is a visible discontinuity every few
// days.
float noise3(vec3 p, float period) {
  vec3 i = floor(p);
  vec3 f = p - i;
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);

  // Both corners wrapped, so a cell straddling the seam reads the same two
  // hashes from either side of it.
  vec3 lo = mod(i, period);
  vec3 hi = mod(i + 1.0, period);

  float n000 = hash33(vec3(lo.x, lo.y, lo.z)).x;
  float n100 = hash33(vec3(hi.x, lo.y, lo.z)).x;
  float n010 = hash33(vec3(lo.x, hi.y, lo.z)).x;
  float n110 = hash33(vec3(hi.x, hi.y, lo.z)).x;
  float n001 = hash33(vec3(lo.x, lo.y, hi.z)).x;
  float n101 = hash33(vec3(hi.x, lo.y, hi.z)).x;
  float n011 = hash33(vec3(lo.x, hi.y, hi.z)).x;
  float n111 = hash33(vec3(hi.x, hi.y, hi.z)).x;

  return mix(
    mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
    mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
    u.z
  );
}

// Lacunarity of exactly two, and whole-number offsets, so that every octave
// shares the field's period. A lacunarity of 2.02 hides the octave alignment
// slightly better and destroys the periodicity completely, which is a bad
// trade: the alignment is invisible behind the domain warp, and the
// periodicity is what keeps the sky from jumping.
float fbm(vec3 p, int octaves) {
  float sum = 0.0;
  float amplitude = 0.5;
  float total = 0.0;
  float period = ${PERIOD}.0;

  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    sum += amplitude * noise3(p, period);
    total += amplitude;

    // The offset is integral, so wrapping stays consistent; it exists only to
    // stop the octaves sharing their lattice corners.
    p = p * 2.0 + vec3(17.0, 9.0, 23.0);
    period *= 2.0;
    amplitude *= 0.5;
  }

  return sum / max(total, 1e-5);
}

// The warp is what turns fBm from a grey crust into something with billows in
// it. Two octaves is enough; a third costs four more noise evaluations for a
// difference nobody sees at this scale.
float cloudDensity(vec3 p) {
  // Whole-number offsets again: a fractional one shifts the lattice relative
  // to the period and reintroduces the seam the wrapping exists to remove.
  vec3 warp = vec3(
    fbm(p, 2),
    fbm(p + vec3(37.0, 11.0, 19.0), 2),
    fbm(p + vec3(73.0, 29.0, 53.0), 2)
  );

  // The warp displacement is what turns fBm from a grey crust into something
  // with billows in it. It is not periodic itself - it is a small local
  // displacement of a periodic field, which stays periodic.
  return fbm(p + 1.9 * (warp - 0.5), 4);
}

// One layer's optical depth along the view ray. Zero where the ray never
// reaches the plane, which is everything at and below the horizon: clouds are
// above you, and drawing them below it would put them in the ground.
float layerDepth(vec3 dir, float height, float scale, vec2 drift, float weight) {
  if (dir.y < 0.02) return 0.0;

  float distance = height / dir.y;

  // Where the ray meets the plane, in kilometres, so the noise scale is a
  // number a person can reason about.
  vec2 at = dir.xz * (distance / 1000.0);

  // Divided into lattice cells FIRST, then offset. The drift arrives already
  // counted in cells, along both axes, because that is the only place the wrap can be exactly
  // one period - see driftCells() for what happens when it is not.
  float cellKm = max(scale * uScale, 0.05);
  vec3 p = vec3(at.x / cellKm + drift.x, uEvolution, at.y / cellKm + drift.y);
  float density = cloudDensity(p);

  // Coverage as a threshold, not a multiply. Multiplying fades the whole field
  // towards transparent and gives a permanent overcast haze; thresholding
  // dissolves it into separate clouds with sky between them, which is what
  // less cloud actually looks like.
  //
  // The range is set against the distribution this fBm actually has, which is
  // centred near 0.5 and rarely leaves 0.2 to 0.8 - four octaves of value
  // noise, normalised, so the tails are thin. Three layers then stack on top
  // of one another, which compresses it further.
  //
  // Measured, with the first mapping of 0.85 down to 0.15: a cover setting of
  // 0.3 gave 13 per cent of the sky, 0.4 gave 39, 0.5 gave 74 and 0.6 gave 96.
  // Everything happened between a third and two thirds of the slider and the
  // rest of it did nothing. Inverting that measurement gives the range below,
  // which runs about linearly: 0.3 of the setting is a bit under a third of
  // the sky, and 0.7 is a bit over two thirds.
  float edge = mix(0.70, 0.40, uCover);
  density = smoothstep(edge, edge + uSoftness, density);

  // The far fade, where the plane is edge-on and the sample stops meaning
  // anything - and where a real cloudscape turns into a band of haze.
  float far = 1.0 - smoothstep(35.0, 70.0, distance / 1000.0);

  return density * weight * far;
}

void main() {
  vec2 inWindow = gl_FragCoord.xy / uResolution;
  vec2 inSpan = (uCrop.xy + vec2(inWindow.x, 1.0 - inWindow.y) * uCrop.zw) / uSpan;

  float azimuth = uBearing + (inSpan.x - 0.5) * uFieldOfView;
  float elevation = (uHorizon - inSpan.y) * uDegreesPerSpanY;

  // The view direction, y up, azimuth measured from north and going clockwise.
  float ce = cos(elevation * RADIANS);
  vec3 dir = vec3(
    ce * sin(azimuth * RADIANS),
    sin(elevation * RADIANS),
    ce * cos(azimuth * RADIANS)
  );

  float depth = 0.0;
  ${LAYER_CALLS}

  // Nothing here. Alpha of one leaves what is already in the target exactly
  // as it was - see the blend note at the bottom.
  if (depth <= 0.0) {
    outColour = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  // How much of the sky behind still gets through.
  float transmittance = exp(-depth * 3.2);

  float sce = cos(uSunAltitude * RADIANS);
  vec3 toSun = vec3(
    sce * sin(uSunAzimuth * RADIANS),
    sin(uSunAltitude * RADIANS),
    sce * cos(uSunAzimuth * RADIANS)
  );
  float cosTheta = dot(dir, toSun);

  // Strong forward scattering, which is why a cloud in front of the sun has a
  // bright edge and the same cloud with the sun behind you is flat and white.
  // Rim-lighting at sunrise falls out of this: uSunColour is already reddened
  // by the long path through the atmosphere, so a cloud lit edge-on at dawn is
  // lit in the colour the dawn actually is.
  float forward = miePhaseCloud(cosTheta, 0.72);

  // Deeper parts are darker, because less of the sun reaches them. One
  // exponential rather than a second march: the difference is invisible
  // against a sky and the march would roughly triple the pass.
  float lit = exp(-depth * 1.1);

  vec3 sunlit = uSunColour * (forward + 0.22) * lit;
  vec3 ambient = uAmbient * (0.55 + 0.45 * lit);
  vec3 cloud = sunlit + ambient;

  // Written as a blend rather than by reading the target back.
  //
  // A pass cannot sample the texture it is drawing into, so the obvious
  // version of this - read the sky, mix, write - needs a second full-size
  // float target and a copy of the whole frame. It does not need either.
  // glBlendFunc(ONE, SRC_ALPHA) computes
  //
  //     result = source + destination * sourceAlpha
  //
  // so emitting the cloud's own light as the colour and its transmittance as
  // the alpha gives exactly sky * T + cloud * (1 - T), which is the
  // compositing equation this pass wanted in the first place. No second
  // target, no copy, and the sum stays in linear light where invariant 4
  // requires it.
  outColour = vec4(cloud * (1.0 - transmittance), transmittance);
}
`;

/**
 * What stands between you and the horizon.
 *
 * Drawn after the clouds and before the tone map, so it occludes everything -
 * a building in front of the moon hides the moon - and so it is exposed with
 * the rest of the frame rather than separately. A silhouette tone-mapped on
 * its own would be the one part of the picture that did not respond to the
 * light, which is exactly what makes a pasted-on foreground look pasted on.
 *
 * **It is not black.** A real silhouette at dusk is very dark and not actually
 * black: it is lit by the whole sky above it, which is why a ridge against a
 * red sunset is a deep red-brown rather than a hole in the picture. So it is
 * shaded by the ambient sky light with a very low albedo, and it goes the
 * colour of whatever the sky is doing - for nothing, because the ambient term
 * is already computed for the clouds.
 *
 * **Aerial perspective is the depth.** The far mountain range is mixed towards
 * the sky colour by distance. That single blend is what separates two ranges
 * into near and far; without it they read as one jagged shape, however
 * different their outlines are.
 */
export const SKYLINE_FRAG = /* glsl */ `#version 300 es
precision highp float;

${VIEW}

uniform vec2 uResolution;
uniform vec4 uCrop;
uniform vec2 uSpan;

uniform float uBearing;
uniform float uHorizon;
uniform float uFieldOfView;
uniform float uDegreesPerSpanY;

uniform int uStyle;
uniform float uHeight;
uniform float uSeed;
uniform float uLights;
uniform vec3 uAmbient;
uniform float uSunAzimuth;
uniform vec3 uHazeToSun;
uniform vec3 uHazeAway;
uniform vec3 uSunColour;
uniform float uSunAltitude;

out vec4 outColour;

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float noise1(float x) {
  float i = floor(x);
  float f = x - i;
  float u = f * f * (3.0 - 2.0 * f);
  return mix(hash11(i), hash11(i + 1.0), u);
}

// Ridged noise: the absolute value folded over, which turns the smooth humps
// of ordinary fBm into the creases and peaks a mountain actually has.
float ridges(float x, float seed, int octaves) {
  float sum = 0.0;
  float amplitude = 0.5;
  float total = 0.0;
  float f = 1.0;

  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    float n = noise1(x * f + seed * 19.7 + float(i) * 37.0);
    sum += amplitude * (1.0 - abs(2.0 * n - 1.0));
    total += amplitude;
    f *= 2.0;
    amplitude *= 0.5;
  }

  return sum / max(total, 1e-5);
}

// ---------------------------------------------------------------- the city
//
// A skyline is not a row of boxes, and the first three versions of this were.
// What makes one read as a city, built in here:
//
//   layout     buildings of every width, set by jittered edges rather than a
//              grid of equal slots, because equal spacing is what made it a
//              barcode; some touch, some stand apart;
//   heights    a district sets how tall the neighbourhood is, a downtown gathers
//              the towers, and the few tallest stand well above the rest;
//   form       a podium with a tower on it, setbacks that step in as it climbs,
//              and a roof that is flat, a plant room, slanted, a gable, a dome,
//              or a spire; and now and then a mast;
//   faces      a building is turned a little to the view, so it shows a broad
//              face and a narrow side. The streets in a district run one way,
//              so the turn is shared. Each face takes the sun as a wall does:
//              the one the sun reaches is bright, the other is in shade, and
//              which is which follows the sun round the sky. Some towers are
//              round, and shade smoothly across;
//   facades    glass, stone, brick and dark glass, each with its floors and its
//              windows. Glass shows the sky; stone has dark windows set in it;
//              the pattern is drawn when the pixels can resolve it and fades to
//              its average when they cannot;
//   depth      four rows, from a far haze to a near row, the farther paler;
//   night      lit rooms, floodlit crowns, a warm glow at the foot, and a red
//              light on the tallest masts.
//
// All of it is a function of the azimuth alone, so every screen draws the same
// city and nothing is stored.

const float DEG = 0.017453292;

// Smooth value noise that repeats after period steps, so that what it drives
// is continuous all the way round the horizon.
float pnoise(float x, float period, float seed) {
  float i = floor(x);
  float f = x - i;
  float u = f * f * (3.0 - 2.0 * f);
  float a = hash11(mod(i, period) + seed * 19.0);
  float b = hash11(mod(i + 1.0, period) + seed * 19.0);
  return mix(a, b, u);
}

// How much of the interval [lo, hi] a pixel centred on x and px wide covers.
// Exact for a box, which is what makes a one-pixel spire a faint line rather
// than either a stripe or nothing.
float boxCover(float x, float lo, float hi, float px) {
  return clamp(min(x + 0.5 * px, hi) - max(x - 0.5 * px, lo), 0.0, px) / px;
}

// Where building i begins. Jittered by up to 0.35 of a slot either way, so a
// building is between 0.3 and 1.7 slots wide and the edges never cross.
float edgeAt(float i, float slots, float seed) {
  return i + (hash11(mod(i, slots) * 5.13 + seed * 3.7) - 0.5) * 0.7;
}

struct Building {
  float cover;     // how much of this pixel the building covers, 0 to 1
  float body;      // how much of it is the windowed body rather than a spire
  float top;       // the very top, spire included, in degrees
  float height;    // the tower's height, degrees
  float floorDeg;  // one storey, degrees
  float id;
  float u;         // 0 to 1 across the whole building
  float pxU;       // a pixel, in the building's width
  float ut;       // 0 to 1 across the tier this pixel is in
  float pxUt;      // a pixel, in the tier's width
  float tone;      // this building's own brightness
  float tall;
  float material;  // 0 glass, 1 stone, 2 brick, 3 dark glass
  float yaw;       // how far it is turned to the view, degrees
  float sideFrac;  // the share of its width that is the narrow side face
  float round;     // 1 for a cylinder
  float cols;      // window columns across the tier
  float beacon;
  float beaconU;
  float flood;     // floodlit crown
};

Building cityBuilding(
  float az, float elevation, float seed, float slots, float scale, float district,
  float crowd, float towers, float pxAzTurns, float pxE
) {
  Building b;

  float x = az * slots;
  float i = floor(x);
  if (x < edgeAt(i, slots, seed)) i -= 1.0;
  else if (x >= edgeAt(i + 1.0, slots, seed)) i += 1.0;
  float e0 = edgeAt(i, slots, seed);
  float e1 = edgeAt(i + 1.0, slots, seed);
  float id = mod(i, slots);

  float width = e1 - e0;
  float joined = hash11(id * 3.17 + seed * 5.9);
  float gap = joined < crowd ? 0.0 : (0.06 + 0.3 * hash11(id * 8.3 + seed * 2.1)) * width;
  float used = width - gap;
  float u = (x - e0 - 0.5 * gap) / used;
  float pxU = pxAzTurns * slots / used;

  float azf = fract(az);
  float core = smoothstep(0.36, 0.7, pnoise(azf * 6.0, 6.0, seed + district));
  float mid = pnoise(azf * 17.0, 17.0, seed + district * 2.0);
  float r1 = hash11(id * 7.31 + seed * 11.3);
  float tall = step(0.72, hash11(id * 13.9 + seed * 2.7)) * smoothstep(0.2, 0.55, core);
  float nominal = (mix(0.05, 0.24, mid) + 0.3 * core) * (0.3 + 1.3 * pow(r1, 1.7))
                + tall * towers * (0.4 + 0.9 * hash11(id * 19.3 + seed * 1.7));
  float H = nominal * scale * uHeight;

  float rA = hash11(id * 17.1 + seed * 4.3);
  float rB = hash11(id * 31.7 + seed * 6.1);
  float rC = hash11(id * 43.3 + seed * 8.9);
  float rD = hash11(id * 59.9 + seed * 2.3);
  float rE = hash11(id * 71.3 + seed * 12.7);
  float rF = hash11(id * 97.1 + seed * 5.3);
  float rK = hash11(id * 5.9 + seed * 13.1);

  float big = step(0.28, nominal);

  // A podium the width of the plot, with a narrower tower standing on it.
  float podium = step(0.5, rB) * big * (0.14 + 0.2 * rC);
  float tw = podium > 0.0 ? 0.42 + 0.4 * rD : 1.0;
  float c = 0.5 + (rE - 0.5) * (1.0 - tw) * 0.9;
  float hwBase = 0.5 * tw;

  // Setbacks: the tower steps in as it climbs, and the steps are not centred.
  float steps = big > 0.5 ? (rA < 0.35 ? 2.0 : rA < 0.62 ? 1.0 : 0.0) : (rA < 0.12 ? 1.0 : 0.0);
  float hA = 0.0;
  float hwA = hwBase;
  float hB = 0.0;
  float hwB = hwBase;
  float cB = c;
  float hT = H;
  float hwT = hwBase;
  float cT = c;
  if (steps == 1.0) {
    hA = 0.78 * H;
    hwT = hwBase * 0.68;
    cT = c + (rF - 0.5) * (hwA - hwT) * 1.6;
  } else if (steps == 2.0) {
    hA = 0.6 * H;
    hB = 0.83 * H;
    hwB = hwBase * 0.74;
    cB = c + (rF - 0.5) * (hwA - hwB) * 1.6;
    hwT = hwBase * 0.5;
    cT = cB + (rC - 0.5) * (hwB - hwT) * 1.6;
  }

  // The roof of the top tier.
  float uTt = (u - (cT - hwT)) / (2.0 * hwT);
  float uTf = rE < 0.5 ? uTt : 1.0 - uTt;
  float ridge = clamp(2.0 * uTt - 1.0, -1.0, 1.0);
  float lift = 0.0;
  float plant = 0.0;
  float spire = 0.0;
  if (rK < 0.3) {
    plant = 1.0;
  } else if (rK < 0.44) {
    lift = -0.12 * H * clamp(uTf, 0.0, 1.0);
  } else if (rK < 0.56) {
    lift = (big > 0.5 ? 0.13 : 0.22) * H * (1.0 - abs(ridge));
  } else if (rK < 0.64) {
    lift = 0.09 * H * sqrt(max(0.0, 1.0 - ridge * ridge));
  } else if (rK < 0.86 && nominal > 0.3) {
    spire = 1.0;
  }
  float mast = step(0.84, rF) * big;

  float spireTop = hT + 0.38 * H;
  float mastTop = hT + 0.62 * H;
  float mastU = cT + 0.3 * hwT;

  float cPod = podium > 0.0
    ? boxCover(u, 0.0, 1.0, pxU) * boxCover(elevation, -1000.0, podium * H, pxE) : 0.0;
  float cA = hA > 0.0
    ? boxCover(u, c - hwA, c + hwA, pxU) * boxCover(elevation, -1000.0, hA, pxE) : 0.0;
  float cBt = hB > 0.0
    ? boxCover(u, cB - hwB, cB + hwB, pxU) * boxCover(elevation, -1000.0, hB, pxE) : 0.0;
  float insideT = boxCover(u, cT - hwT, cT + hwT, pxU);
  float cTop = insideT * clamp((hT + lift - elevation) / pxE + 0.5, 0.0, 1.0);
  float cPlant = plant * boxCover(uTt, 0.28, 0.62, pxU / (2.0 * hwT))
               * boxCover(elevation, -1000.0, hT + 0.055 * H, pxE);
  float cSpire = spire * boxCover(u, cT - 0.022, cT + 0.022, pxU)
               * boxCover(elevation, -1000.0, spireTop, pxE);
  float cMast = mast * boxCover(u, mastU - 0.012, mastU + 0.012, pxU)
              * boxCover(elevation, -1000.0, mastTop, pxE);

  float body = max(max(cPod, cA), max(cBt, max(cTop, cPlant)));
  b.body = body;
  b.cover = max(body, max(cSpire, cMast));

  // Which tier this pixel is in decides the width its faces are measured across.
  float ctr = 0.5;
  float hw = 0.5;
  if (cTop > 0.5 || cPlant > 0.5) { ctr = cT; hw = hwT; }
  else if (cBt > 0.5) { ctr = cB; hw = hwB; }
  else if (cA > 0.5) { ctr = c; hw = hwA; }
  else if (cPod <= 0.5) { ctr = cT; hw = hwT; }
  b.u = u;
  b.pxU = pxU;
  b.ut =(u - (ctr - hw)) / (2.0 * hw);
  b.pxUt = pxU / (2.0 * hw);

  b.top = max(hT + max(lift, 0.0) + plant * 0.055 * H, max(spire * spireTop, mast * mastTop));
  b.height = H;
  b.floorDeg = scale * uHeight / (28.0 + 18.0 * hash11(id * 13.1 + seed));
  b.id = id;
  b.tone = 0.78 + 0.5 * hash11(id * 37.0 + seed * 3.1);
  b.tall = tall;

  float m = hash11(id * 83.1 + seed * 15.3);
  b.material = big > 0.5
    ? (m < 0.55 ? 0.0 : m < 0.85 ? 1.0 : 3.0)
    : (m < 0.2 ? 0.0 : m < 0.6 ? 1.0 : m < 0.9 ? 2.0 : 3.0);

  // Streets in a district run the same way, so its buildings are turned the
  // same way; a few are not.
  float grid = (pnoise(azf * 5.0, 5.0, seed + 9.0) - 0.5) * 70.0;
  float yaw = hash11(id * 3.7 + seed * 21.0) < 0.15
    ? (hash11(id * 9.9 + seed) - 0.5) * 80.0
    : grid + (rD - 0.5) * 10.0;
  yaw = clamp(yaw, -44.0, 44.0);
  float sn = abs(sin(yaw * DEG));
  float fs = sn / (abs(cos(yaw * DEG)) + sn);
  b.yaw = yaw;
  b.sideFrac = fs < 0.07 ? 0.0 : fs;

  b.round = (tw > 0.6 && steps < 0.5 && hash11(id * 6.7 + seed * 17.0) < 0.12) ? 1.0 : 0.0;
  b.cols = max(2.0, floor((4.0 + 7.0 * hash11(id * 29.0 + seed * 3.0)) * 2.0 * hw * used + 0.5));

  b.beacon = (spire > 0.5 || mast > 0.5) && tall > 0.5 ? 1.0 : 0.0;
  b.beaconU = mast > 0.5 ? mastU : cT;
  b.flood = (tall > 0.5 && hash11(id * 11.9 + seed * 7.0) < 0.4) ? 1.0 : 0.0;
  if (b.beacon > 0.5) b.top = max(b.top, mast > 0.5 ? mastTop : spireTop);
  return b;
}

// What a building looks like in the sky's light and its own: the facade of one
// face, its windows and its floors, then the air in front of it.
vec3 cityShade(Building b, float layer, float elevation, float azimuth, float lights,
               float seed, float pxE, float haze) {
  // Which face this pixel is on, and which way that face points.
  float yawDeg = b.yaw;
  float uf = b.ut;
  float faceW = 1.0;
  float pxUf = b.pxUt;
  if (b.round > 0.5) {
    float a = clamp(2.0 * b.ut - 1.0, -0.98, 0.98);
    yawDeg = asin(a) / DEG;
    uf = asin(a) / 3.14159 + 0.5;
    pxUf = b.pxUt * 2.0 / (3.14159 * sqrt(1.0 - a * a));
  } else if (b.sideFrac > 0.0) {
    float s = b.sideFrac;
    bool left = b.yaw > 0.0;
    bool inSide = left ? b.ut < s : b.ut > 1.0 - s;
    if (inSide) {
      faceW = s;
      yawDeg = b.yaw + (left ? -90.0 : 90.0);
      uf = left ? b.ut / s : (b.ut - (1.0 - s)) / s;
    } else {
      faceW = 1.0 - s;
      uf = left ? (b.ut - s) / (1.0 - s) : b.ut / (1.0 - s);
    }
    pxUf = b.pxUt / faceW;
  }

  // The light on it: the sky from every side, and the sun if the face is turned
  // towards it. The face points at the sun when the sun is behind the viewer.
  float facing = -cos((uSunAzimuth - azimuth - yawDeg) * DEG);
  float sunOn = max(facing, 0.0) * max(cos(uSunAltitude * DEG), 0.0)
              * smoothstep(-2.0, 2.0, uSunAltitude);
  vec3 incoming = uAmbient * 0.85 + uSunColour * (0.13 * sunOn);

  float fromSun = abs(wrap180(azimuth - uSunAzimuth)) / 180.0;
  float glowNear = smoothstep(0.35, 0.0, fromSun);
  vec3 air = 0.6 * mix(uHazeAway, uHazeToSun, glowNear * glowNear);
  float up = clamp(elevation / max(b.top, 1e-4), 0.0, 1.0);

  // What glass shows: the sky near the horizon, a little darker higher up.
  vec3 reflected = air * mix(1.05, 0.7, up);

  // The window grid: columns across the face, storeys up the building.
  float cols = max(1.0, floor(b.cols * faceW + 0.5));
  vec2 grid = vec2(uf * cols, elevation / b.floorDeg);
  vec2 index = floor(grid);
  vec2 cell = fract(grid);
  vec2 pix = clamp(vec2(pxUf * cols, pxE / b.floorDeg), vec2(0.0), vec2(0.5));

  // The window, as a share of its cell, by material.
  vec2 wx = vec2(0.22, 0.78);
  vec2 wy = vec2(0.2, 0.78);
  if (b.material < 0.5) { wx = vec2(0.03, 0.97); wy = vec2(0.14, 0.8); }
  else if (b.material > 2.5) { wx = vec2(0.06, 0.94); wy = vec2(0.1, 0.84); }
  float inWin = boxCover(cell.x, wx.x, wx.y, pix.x) * boxCover(cell.y, wy.x, wy.y, pix.y);
  float average = (wx.y - wx.x) * (wy.y - wy.x);
  float resolved = 1.0 - smoothstep(0.35, 0.9, max(pix.x, pix.y));
  float win = mix(average, inWin, resolved);

  // Each window is a little different: blinds, a light behind it, the sky.
  float vary = hash11(b.id * 101.0 + index.x * 17.0 + index.y * 3.7 + seed * 29.0);
  float lum = mix(1.0, 0.82 + 0.4 * vary, resolved);
  // A band of storeys a little darker or lighter than the rest.
  float band = hash11(b.id * 7.0 + floor(index.y / 7.0) * 13.0 + seed);
  lum *= mix(1.0, 0.9 + 0.2 * band, 0.8);

  vec3 albedo;
  vec3 windowRad;
  if (b.material < 0.5) {
    float t = hash11(b.id * 61.0 + seed);
    vec3 tint = t < 0.35 ? vec3(0.5, 0.74, 0.9)
              : t < 0.6 ? vec3(0.5, 0.8, 0.74)
              : t < 0.85 ? vec3(0.7, 0.72, 0.74)
              : vec3(0.85, 0.7, 0.52);
    albedo = 0.09 * tint;
    windowRad = reflected * tint * 0.3 * lum + albedo * incoming * 0.5;

    // The sun in the glass: a face turned to throw it back at the viewer
    // flashes, and only when the sun is as low as the part of the face being
    // looked at, which is why it is a sunrise and sunset thing.
    float away = wrap180(uSunAzimuth - (azimuth + 180.0 + 2.0 * yawDeg));
    float glint = exp(-away * away / 40.0) * exp(-pow((uSunAltitude - elevation) / 7.0, 2.0));
    windowRad += uSunColour * 0.22 * glint * smoothstep(-1.0, 2.0, uSunAltitude);
  } else if (b.material < 1.5) {
    float t = hash11(b.id * 61.0 + seed);
    albedo = (t < 0.5 ? vec3(0.36, 0.34, 0.31) : vec3(0.3, 0.31, 0.33)) * b.tone;
    windowRad = reflected * 0.12 * lum + albedo * incoming * 0.1;
  } else if (b.material < 2.5) {
    albedo = vec3(0.2, 0.125, 0.1) * b.tone;
    windowRad = reflected * 0.1 * lum + albedo * incoming * 0.1;
  } else {
    albedo = vec3(0.035, 0.04, 0.05);
    windowRad = reflected * 0.2 * lum + albedo * incoming * 0.3;
  }
  vec3 wall = albedo * incoming * mix(0.9, 1.1, up);
  vec3 body = mix(wall, windowRad, win);

  // Air in front of the farther rows, thicker at the foot.
  body = mix(body, air, haze * mix(1.0, 0.6, up));

  // Below the horizon is the street, in shadow: the facade sinks into the dark
  // the rows stand on, which keeps the eye on the skyline and not on the
  // bottom edge of the picture.
  float sunk = smoothstep(0.0, -0.32 * uHeight, elevation);
  body = mix(body, uAmbient * 0.06, sunk);

  // Lights shine through the haze rather than being dulled by it.
  vec3 lit = vec3(0.0);
  if (lights > 0.0) {
    float character = hash11(b.id * 57.0 + seed * 13.0);
    float busy = character < 0.06 ? 0.0 : mix(0.2, 1.0, hash11(b.id * 29.0 + seed * 3.0));
    float floorKey = hash11(b.id * 131.0 + index.y * 7.9 + seed * 17.0);
    float key = mix(vary, floorKey, 0.6);
    float on = step(key, lights * busy * 0.5);

    float tone = hash11(b.id * 41.0 + index.x * 11.3 + index.y * 5.7 + seed * 31.0);
    float level = mix(0.45, 1.0, hash11(index.x * 3.3 + index.y * 9.1 + b.id * 67.0));
    vec3 lamp = vec3(2.0e-4, 1.45e-4, 0.78e-4);
    vec3 office = vec3(1.75e-4, 1.6e-4, 1.2e-4);
    vec3 cool = vec3(1.3e-4, 1.5e-4, 1.8e-4);
    vec3 screen = vec3(0.7e-4, 1.0e-4, 2.1e-4);
    vec3 colour = tone < 0.55 ? lamp : tone < 0.8 ? office : tone < 0.95 ? cool : screen;

    // A rounded room with a soft glow past its edge.
    vec2 outside = max(abs(cell - 0.5) - vec2(0.3), 0.0);
    float room = max(
      1.0 - smoothstep(0.0, 1.0, length(outside / max(pix, vec2(1e-3)))),
      0.22 * exp(-dot(outside, outside) * 60.0)
    );
    float avg = lights * busy * 0.2;
    float shown = mix(avg, on * room, resolved);
    lit = colour * level * shown * lights;

    // The street's lamps light the foot of it, and a few towers are floodlit
    // at the top, which is where a skyline gets its crown.
    float foot = exp(-max(elevation, 0.0) / max(b.floorDeg * 6.0, 1e-4));
    lit += vec3(1.0, 0.62, 0.32) * 4.0e-6 * foot * lights * (1.0 - haze);
    float crown = smoothstep(b.top - b.height * 0.22, b.top, elevation);
    lit += b.flood * vec3(1.0, 0.9, 0.7) * 5.0e-5 * crown * lights * (1.0 - haze);

    lit *= b.body > 0.0 ? 1.0 : 0.0;
    lit *= 1.0 - sunk;
    lit *= layer < 0.5 ? 0.35 : layer < 1.5 ? 0.5 : layer < 2.5 ? 0.6 : 1.0;
  }
  return body + lit;
}

// The red light on the tallest masts, which is what an aircraft sees of a city.
vec3 cityBeacon(Building b, float elevation, float pxE, float lights) {
  if (b.beacon < 0.5 || lights <= 0.0) return vec3(0.0);
  float dx = (b.u - b.beaconU) / max(b.pxU, 1e-6);
  float dy = (elevation - b.top) / pxE;
  return vec3(2.6e-4, 0.2e-4, 0.12e-4) * exp(-(dx * dx + dy * dy) / 1.5) * min(lights * 2.0, 1.0);
}

void main() {
  vec2 inWindow = gl_FragCoord.xy / uResolution;
  vec2 inSpan = (uCrop.xy + vec2(inWindow.x, 1.0 - inWindow.y) * uCrop.zw) / uSpan;

  float azimuth = uBearing + (inSpan.x - 0.5) * uFieldOfView;
  float elevation = (uHorizon - inSpan.y) * uDegreesPerSpanY;

  // Azimuth in turns, so the profile is continuous all the way round and a
  // span that wraps past north does not meet a seam.
  float az = azimuth / 360.0;

  if (uStyle == 2) {
    // The size of a pixel, taken before anything diverges, and used to give
    // every edge a pixel's width of softness.
    float pxAzTurns = fwidth(azimuth) / 360.0;
    float pxElev = max(fwidth(elevation), 1e-5);

    // Nothing stands higher than this, so most of the frame stops here.
    if (elevation > uHeight * 4.2) {
      outColour = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }

    // Far to near, each laid over the last. Below the horizon is the dark mass
    // the rows stand on, so the gaps between the near buildings are not a taller
    // row of buildings behind them, which read as a barcode.
    float ground = boxCover(elevation, -1000.0, 0.0, pxElev);
    vec3 colour = uAmbient * 0.06 * ground;
    float opacity = ground;

    for (int layer = 0; layer < 4; layer++) {
      float l = float(layer);
      float slots = layer == 0 ? 170.0 : layer == 1 ? 118.0 : layer == 2 ? 280.0 : 64.0;
      float scale = layer == 0 ? 0.95 : layer == 1 ? 0.62 : layer == 2 ? 0.2 : 1.7;
      float towers = layer == 2 ? 0.0 : layer == 3 ? 0.55 : 1.0;
      float haze = layer == 0 ? 0.5 : layer == 1 ? 0.24 : layer == 2 ? 0.1 : 0.0;
      float crowd = layer == 0 ? 0.35 : layer == 1 ? 0.5 : layer == 2 ? 0.8 : 0.85;
      float seed = uSeed + l * 41.0;

      Building b = cityBuilding(az, elevation, seed, slots, scale, 3.0 + l * 0.8, crowd, towers, pxAzTurns, pxElev);

      // The farther rows stand on the horizon: nothing of them below it.
      if (layer < 2) b.cover *= boxCover(elevation, 0.0, 1000.0, pxElev);

      vec3 shaded = vec3(0.0);
      if (b.cover > 0.0) {
        shaded = cityShade(b, l, elevation, azimuth, uLights, seed, pxElev, haze);
      }
      colour = colour * (1.0 - b.cover) + shaded * b.cover;
      opacity = 1.0 - (1.0 - opacity) * (1.0 - b.cover);

      // The beacon is light, not a surface: it is added over what is there and
      // is hidden only by what stands in front, which the next rows do by
      // covering it.
      if (layer > 0) colour += cityBeacon(b, elevation, pxElev, uLights);
    }

    outColour = vec4(colour, 1.0 - opacity);
    return;
  }

  float profile = 0.0;
  float far = 0.0;
  if (uStyle == 1) {
    // Two ranges, and the far one sits HIGHER in the frame rather than lower.
    //
    // The obvious arrangement - a shorter far range behind a taller near one -
    // does not work, and the reason is a property of the noise rather than of
    // mountains. Ridged noise clusters near its mean, so two ranges drawn the
    // same way differ by far less than their extremes suggest, and a far range
    // scaled to two thirds is then hidden everywhere. It was: the first
    // version drew one black mass.
    //
    // Giving the far range a high baseline and little variation, and the near
    // range a low baseline and a lot, is also what the eye expects. A distant
    // range reads as a pale band along the top of the near one, with the near
    // ridge cutting into it.
    far = 0.52 + 0.48 * ridges(az * 7.0, uSeed + 3.0, 4);

    // Raised to a power to push the valleys down and leave the peaks, which
    // is what gives the near range somewhere for the far one to show through.
    profile = 0.92 * pow(ridges(az * 13.0, uSeed, 5), 1.7);
  } else if (uStyle == 3) {
    // Trees: high frequency, low amplitude, with a solid band underneath so
    // the gaps between trunks do not show sky at ground level.
    profile = 0.45 + 0.55 * ridges(az * 95.0, uSeed, 3);
  }

  float nearTop = profile * uHeight;
  float farTop = far * uHeight;

  // Nothing of ours is here; leave the frame alone.
  if (elevation > nearTop && elevation > farTop) {
    outColour = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  bool isNear = elevation <= nearTop;

  // The silhouette is lit by the whole sky above it. A very low albedo, so it
  // reads as dark against anything bright, and takes the sky's own colour
  // against anything dim.
  vec3 body = uAmbient * 0.085;

  if (!isNear) {
    // The far range, mixed towards the haze by distance. This blend is what
    // makes two ranges read as near and far rather than as one shape.
    //
    // The haze is not one colour across the frame. The sky near the horizon is
    // warm towards the sun and cold away from it, and a distant range takes
    // the colour of whatever is behind it - so a ridge below a sunset glows
    // and the same ridge on the other side of the sky stays grey. Two samples
    // and an interpolation, rather than the single colour this first had,
    // which made the far range the same olive band all the way along.
    float fromSun = abs(wrap180(azimuth - uSunAzimuth)) / 180.0;
    vec3 haze = mix(uHazeToSun, uHazeAway, fromSun);

    body = mix(uAmbient * 0.11, haze, 0.62);
  }

  outColour = vec4(body, 0.0);
}
`;

/**
 * Fog, rain and snow: the weather near, drawn over everything else and before
 * the tone map, as light.
 *
 * Output is the premultiplied pair the clouds and the skyline use - light in the
 * colour, what is left of what is behind in the alpha - so fog is a veil
 * (alpha below one, colour the fog's own) and rain is added light (alpha near
 * one, colour the streak).
 *
 * Everything is placed in pixels of the whole span, scaled to a 1080-line
 * screen, so a streak is the same size on every monitor of a multi-monitor
 * desktop, continuous across them, and the same in the editor's smaller
 * preview as on the desktop.
 */
export const WEATHER_FRAG = /* glsl */ `#version 300 es
precision highp float;
${VIEW}

uniform vec2 uResolution;
uniform vec4 uCrop;
uniform vec2 uSpan;

uniform float uBearing;
uniform float uHorizon;
uniform float uFieldOfView;
uniform float uDegreesPerSpanY;

uniform float uFog;
uniform float uPrecip;
uniform int uKind;
uniform vec3 uFall;
uniform float uSway;
uniform float uSlant;

uniform vec3 uAmbient;
uniform float uSunAzimuth;
uniform vec3 uHazeToSun;
uniform vec3 uHazeAway;
uniform float uCityGlow;

out vec4 outColour;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// One layer of rain. The pattern is columns, each with a streak per repeat of
// its height that is there or not by a hash; the whole thing is sheared by the
// wind and slides down with the phase. Streaks are brightest at the leading end,
// which is how a falling drop is seen.
float rainLayer(vec2 p, float layer, float phase, float density, float aa) {
  vec2 cell = layer < 0.5 ? vec2(14.0, ${CELL_HEIGHT.rain[0].toFixed(1)})
            : layer < 1.5 ? vec2(22.0, ${CELL_HEIGHT.rain[1].toFixed(1)})
            : vec2(34.0, ${CELL_HEIGHT.rain[2].toFixed(1)});
  float width = layer < 0.5 ? 0.7 : layer < 1.5 ? 1.0 : 1.5;
  float streak = layer < 0.5 ? 0.35 : layer < 1.5 ? 0.45 : 0.55;

  float x = p.x - p.y * uSlant;
  float column = floor(x / cell.x);
  float offset = hash12(vec2(column, layer * 13.0));

  float q = p.y / cell.y - phase + offset;
  float rep = floor(q);
  float v = q - rep;

  float present = step(hash12(vec2(column * 1.7 + layer, rep)), density);
  float centre = (0.15 + 0.7 * hash12(vec2(column, rep + 31.0))) * cell.x;
  float dx = abs(x - column * cell.x - centre);

  float across = 1.0 - smoothstep(0.0, width + aa, dx);
  float along = smoothstep(0.0, streak, v) * (1.0 - smoothstep(streak, streak + 0.04, v));

  return present * across * along;
}

// One layer of snow: a soft disc in each cell that has one, drifting down with
// the phase and swaying from side to side, each flake on its own cycle.
float snowLayer(vec2 p, float layer, float phase, float density, float aa) {
  float size = layer < 0.5 ? ${CELL_HEIGHT.snow[0].toFixed(1)}
             : layer < 1.5 ? ${CELL_HEIGHT.snow[1].toFixed(1)}
             : ${CELL_HEIGHT.snow[2].toFixed(1)};
  float radius = layer < 0.5 ? 0.12 : layer < 1.5 ? 0.17 : 0.23;
  float soft = max(layer < 0.5 ? 0.08 : layer < 1.5 ? 0.1 : 0.12, aa / size);

  vec2 uv = vec2(p.x - p.y * uSlant, p.y) / size;
  uv.y -= phase;

  vec2 id = floor(uv);
  vec2 f = uv - id;

  float h = hash12(id + layer * 17.0);
  float present = step(hash12(id * 1.31 + layer * 3.0), density);

  vec2 centre = vec2(
    0.5 + 0.1 * sin(6.2831853 * (uSway + h)) + 0.16 * (hash12(id + 5.0) - 0.5),
    0.5 + 0.3 * (hash12(id + 9.0) - 0.5)
  );

  return present * (1.0 - smoothstep(radius - soft, radius + soft, length(f - centre)));
}

void main() {
  vec2 inWindow = gl_FragCoord.xy / uResolution;
  vec2 inSpan = (uCrop.xy + vec2(inWindow.x, 1.0 - inWindow.y) * uCrop.zw) / uSpan;

  float azimuth = uBearing + (inSpan.x - 0.5) * uFieldOfView;
  float elevation = (uHorizon - inSpan.y) * uDegreesPerSpanY;

  // Pixels of the whole span, as if it were 1080 lines tall. The size of a
  // pixel is taken here, before anything diverges.
  vec2 p = inSpan * uSpan * (1080.0 / uSpan.y);
  float aa = max(fwidth(p.x), fwidth(p.y));

  // Rain and snow thicken the air, which is half of why a wet day is grey.
  float mist = clamp(uFog + 0.3 * uPrecip, 0.0, 1.0);

  // Fog is lit by the sky around it, and glows towards the sun.
  float fromSun = abs(wrap180(azimuth - uSunAzimuth)) / 180.0;
  float glow = smoothstep(0.35, 0.0, fromSun);
  vec3 air = mix(uHazeAway, uHazeToSun, glow * glow);
  vec3 fogColour = 0.6 * uAmbient + 0.4 * air;

  // A city's lights, scattered by whatever is in the air above it: fog and rain
  // at night glow with them, low down, which is most of what makes a wet night
  // street look the way it does. The warm of the windows, fading with height.
  vec3 cityLight = vec3(2.0e-4, 1.45e-4, 0.78e-4) * uCityGlow * exp(-max(elevation, 0.0) / 9.0);
  fogColour += cityLight * (elevation < 0.0 ? 0.3 : 0.5);

  // Thickest at the ground and thinning with height, more slowly the denser it
  // is - and never quite nothing, so even high fog flattens the whole picture.
  float low = exp(-max(elevation, 0.0) / (6.0 + 30.0 * uFog));
  float veil = min(0.96, mist * mix(0.35, 1.0, low));

  vec3 colour = fogColour * veil;
  float transmit = 1.0 - veil;

  if (uPrecip > 0.0) {
    float light;
    if (uKind == 0) {
      // The far layers are the denser, as there is more rain at a distance.
      light = 0.35 * rainLayer(p, 0.0, uFall.x, 0.55 * uPrecip, aa)
            + 0.55 * rainLayer(p, 1.0, uFall.y, 0.4 * uPrecip, aa)
            + 0.8 * rainLayer(p, 2.0, uFall.z, 0.28 * uPrecip, aa);
      colour += (uAmbient * 1.8 + cityLight * 0.5) * light;
    } else {
      light = 0.5 * snowLayer(p, 0.0, uFall.x, 0.5 * uPrecip, aa)
            + 0.75 * snowLayer(p, 1.0, uFall.y, 0.32 * uPrecip, aa)
            + 1.0 * snowLayer(p, 2.0, uFall.z, 0.2 * uPrecip, aa);
      // Snow is white, whatever colour the light on it is.
      vec3 white = mix(uAmbient, vec3(dot(uAmbient, vec3(0.3333))), 0.6);
      colour += (white * 2.4 + cityLight * 1.2) * light;
    }
    transmit *= 1.0 - 0.1 * clamp(light, 0.0, 1.0);
  }

  outColour = vec4(colour, transmit);
}
`;

export const COMPOSITE_FRAG = /* glsl */ `#version 300 es
precision highp float;
${OUTPUT}

uniform sampler2D uScene;
uniform vec2 uResolution;
uniform float uExposure;
uniform float uWhite;

uniform vec3 uTint;
uniform float uSaturation;
uniform float uContrast;

out vec4 fragColor;

// Oklab, Bjorn Ottosson. The same matrices as sky/oklab.js, which is the only
// other place in the project that converts a colour - and a unit test holds
// the two to each other.
//
// The grade is done here rather than in linear light because saturation and
// contrast mean what their names say in a perceptual space and something else
// anywhere else: scaling chroma in linear RGB shifts hue, and bending
// lightness there crushes the shadows long before it looks like it should.
vec3 linearToOklab(vec3 c) {
  float l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
  float m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
  float s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;

  float l_ = sign(l) * pow(abs(l), 1.0 / 3.0);
  float m_ = sign(m) * pow(abs(m), 1.0 / 3.0);
  float s_ = sign(s) * pow(abs(s), 1.0 / 3.0);

  return vec3(
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
  );
}

vec3 oklabToLinear(vec3 lab) {
  float l_ = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
  float m_ = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
  float s_ = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;

  float l = l_ * l_ * l_;
  float m = m_ * m_ * m_;
  float s = s_ * s_ * s_;

  return vec3(
     4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  );
}

// Extended Reinhard, applied to luminance so that hue survives.
//
// A per-channel curve desaturates everything bright, which on a sunrise means
// the one part of the picture worth looking at turns white. This compresses
// the brightness and leaves the colour alone.
vec3 toneMap(vec3 colour) {
  float luminance = dot(colour, vec3(0.2126, 0.7152, 0.0722));
  if (luminance <= 0.0) return vec3(0.0);
  float mapped = luminance * (1.0 + luminance / (uWhite * uWhite)) / (1.0 + luminance);
  return colour * (mapped / luminance);
}

void main() {
  vec3 radiance = texture(uScene, gl_FragCoord.xy / uResolution).rgb;

  // The tint multiplies light, before the tone curve, so it colours the
  // picture rather than washing over it. A neutral tint is exactly (1,1,1)
  // and this line does nothing at all.
  vec3 colour = toneMap(max(radiance, vec3(0.0)) * uExposure * uTint);

  if (uSaturation != 1.0 || uContrast != 1.0) {
    vec3 lab = linearToOklab(colour);

    // Contrast pivots about mid-grey in Oklab, where "mid" really is the
    // middle: 0.5 of L is the lightness halfway between black and white to
    // the eye, which is not true of 0.5 anywhere else.
    lab.x = 0.5 + (lab.x - 0.5) * uContrast;
    lab.yz *= uSaturation;

    colour = oklabToLinear(lab);
  }

  vec3 srgb = linearToSrgb(clamp(colour, 0.0, 1.0));
  fragColor = vec4(dither(srgb, gl_FragCoord.xy), 1.0);
}
`;
