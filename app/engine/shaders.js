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
  float nearHorizon = 1.0 - smoothstep(0.0, 40.0, altitude);
  float flicker = 1.0 + uTwinkle * nearHorizon * 0.55 *
    sin((uTwinklePhase + hash) * 2.0 * PI * 7.0 + hash * 31.0);

  vRadiance = radiance * uBrightness * max(flicker, 0.0);
  vColour = starColour(hash);

  // Brighter stars are drawn larger as well as more intensely, which is how
  // both a camera and an eye behave. Without it the bright stars clip to
  // white at the same size as the faint ones and the sky loses its depth.
  gl_PointSize = uSize * (1.0 + 2.2 * sqrt(clamp(radiance * 3200.0, 0.0, 1.0)));
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
  float core = exp(-r2 * 4.5);
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
 * layer would need `uDrift` to stop being a vec3, which is why this asserts
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
      `uDrift[${i}], ${float(layer.weight)});`
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
uniform vec3 uDrift;
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
float layerDepth(vec3 dir, float height, float scale, float drift, float weight) {
  if (dir.y < 0.02) return 0.0;

  float distance = height / dir.y;

  // Where the ray meets the plane, in kilometres, so the noise scale is a
  // number a person can reason about.
  vec2 at = dir.xz * (distance / 1000.0);

  // Divided into lattice cells FIRST, then offset. The drift arrives already
  // counted in cells, because that is the only place the wrap can be exactly
  // one period - see driftCells() for what happens when it is not.
  float cellKm = max(scale * uScale, 0.05);
  vec3 p = vec3(at.x / cellKm + drift, uEvolution, at.y / cellKm);
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
