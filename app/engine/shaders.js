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

// How many degrees of sky the span covers vertically, given its width in
// degrees. Matching the two keeps the picture square: a degree across the
// screen is a degree up it.
float degreesPerSpanY(float fieldOfView, vec2 span) {
  return fieldOfView * (span.y / span.x);
}
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
uniform float uFieldOfView;

uniform float uGroundAlbedo;
uniform vec3 uAirglow;

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

  return entry.rgb * rayleighPhase(cosTheta) + vec3(entry.a) * miePhase(cosTheta, MIE_G);
}

void main() {
  // gl_FragCoord is in device pixels with the origin bottom-left. Flip y so
  // that 0 is the top of the picture, which is how the span is described.
  vec2 inWindow = gl_FragCoord.xy / uResolution;
  vec2 inSpan = (uCrop.xy + vec2(inWindow.x, 1.0 - inWindow.y) * uCrop.zw) / uSpan;

  float azimuth = uBearing + (inSpan.x - 0.5) * uFieldOfView;
  float elevation = (uHorizon - inSpan.y) * degreesPerSpanY(uFieldOfView, uSpan);

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
  float spanFracY = uHorizon - altitude / degreesPerSpanY(uFieldOfView, uSpan);

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
uniform float uFieldOfView;

void main() {
  // Degrees of sky to pixels of span, which is the scale everything here
  // works in.
  float pixelsPerDegree = uSpan.x / uFieldOfView;

  float spanFracX = wrap180(uAzimuth - uBearing) / uFieldOfView + 0.5;
  float spanFracY = uHorizon - uAltitude / degreesPerSpanY(uFieldOfView, uSpan);

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
export const COMPOSITE_FRAG = /* glsl */ `#version 300 es
precision highp float;
${OUTPUT}

uniform sampler2D uScene;
uniform vec2 uResolution;
uniform float uExposure;
uniform float uWhite;

out vec4 fragColor;

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
  vec3 colour = toneMap(max(radiance, vec3(0.0)) * uExposure);
  vec3 srgb = linearToSrgb(clamp(colour, 0.0, 1.0));
  fragColor = vec4(dither(srgb, gl_FragCoord.xy), 1.0);
}
`;
