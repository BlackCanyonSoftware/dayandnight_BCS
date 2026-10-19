// @ts-check
/**
 * The shaders, as strings.
 *
 * Strings in a `.js` file rather than `.glsl` files because the project has no
 * build step (ADR 0001): there is no bundler to turn an import of a `.glsl`
 * file into text, and fetching them at run time would mean the first frame
 * waits on the network stack for files that are already on disk.
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
 * Shared GLSL: the sRGB transfer function and the output dither.
 *
 * `linearToSrgb` here must agree with `linearToSrgb1` in sky/oklab.js. The two
 * exist because the same conversion is needed on both sides of the GPU
 * boundary; a unit test pins them to each other.
 */
const COMMON = /* glsl */ `
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

// Shift by up to half a quantisation step, so rounding goes both ways and the
// step boundaries dissolve into noise the eye reads as a smooth ramp.
vec3 dither(vec3 srgb, vec2 fragCoord) {
  return srgb + (ditherNoise(fragCoord) - 0.5) / 255.0;
}
`;

/**
 * The vertex shader: one full-screen triangle, no transforms.
 */
export const SKY_VERT = /* glsl */ `#version 300 es
layout(location = 0) in vec2 aPosition;

void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

/**
 * The fragment shader.
 *
 * Two ideas carry most of it.
 *
 * The gradient is a function of position in the **span** - the bounding box of
 * every monitor - not of position in this window. That is what makes one sky
 * stretch across three screens instead of three skies (US-012).
 *
 * And the sky itself is a table lookup plus two phase functions. The table
 * (`sky/atmosphere.js`) holds the scattering integrals, which are expensive
 * and are computed once; the phase functions are cheap, depend on the angle
 * between the view and the sun, and are what put the glow around the sun. The
 * shader is therefore short even though the model behind it is not.
 */
export const SKY_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler3D;
${COMMON}

uniform vec2 uResolution;   // this drawing buffer, in device pixels
uniform vec4 uCrop;         // this window's rect in the span: x, y, w, h
uniform vec2 uSpan;         // the whole span, in span pixels

uniform sampler3D uSky;     // the scattering table

uniform float uSunAltitude; // degrees above the horizon
uniform float uSunAzimuth;  // degrees clockwise from north

uniform float uBearing;     // which way the camera faces, degrees from north
uniform float uHorizon;     // where the horizon sits down the span, 0..1
uniform float uFieldOfView; // degrees across the whole span

uniform float uExposure;    // auto-exposure times the user's offset
uniform float uWhite;       // the tone curve's white point
uniform float uGroundAlbedo;// how much light the ground below the horizon returns

out vec4 fragColor;

const float PI = 3.14159265358979;

// The table's axes, mirrored from sky/atmosphere.js. If those change and
// these do not, the sky silently samples the wrong place - so they are
// injected from the module rather than written twice by hand.
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

float rayleighPhase(float cosTheta) {
  return (3.0 / (16.0 * PI)) * (1.0 + cosTheta * cosTheta);
}

float miePhase(float cosTheta, float g) {
  float g2 = g * g;
  float numerator = 3.0 * (1.0 - g2) * (1.0 + cosTheta * cosTheta);
  float denominator = 8.0 * PI * (2.0 + g2) * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5);
  return numerator / denominator;
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
  // gl_FragCoord is in device pixels with the origin bottom-left. Flip y so
  // that 0 is the top of the picture, which is how the span is described.
  vec2 inWindow = gl_FragCoord.xy / uResolution;
  vec2 inSpan = (uCrop.xy + vec2(inWindow.x, 1.0 - inWindow.y) * uCrop.zw) / uSpan;

  // Where this pixel is looking. Azimuth runs across the span and elevation
  // up it, at the same degrees per pixel in both, so nothing is stretched.
  float degreesPerSpanY = uFieldOfView * (uSpan.y / uSpan.x);
  float azimuth = uBearing + (inSpan.x - 0.5) * uFieldOfView;
  float elevation = (uHorizon - inSpan.y) * degreesPerSpanY;

  // How far round from the sun, folded into 0..180: the sky is mirror
  // symmetric about the sun's own meridian, which is why the table only
  // stores half a turn.
  float fromSun = abs(mod(azimuth - uSunAzimuth + 540.0, 360.0) - 180.0);

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
  float rad = PI / 180.0;
  float cosTheta =
    sin(elevation * rad) * sin(uSunAltitude * rad) +
    cos(elevation * rad) * cos(uSunAltitude * rad) * cos(fromSun * rad);

  vec3 radiance = entry.rgb * rayleighPhase(cosTheta) + vec3(entry.a) * miePhase(cosTheta, MIE_G);

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
    vec4 groundLight = texture(uSky, vec3(uvw.x, encodeElevation(0.75, VIEW_MIN, VIEW_MAX), uvw.z));

    float groundCos =
      sin(0.75 * rad) * sin(uSunAltitude * rad) +
      cos(0.75 * rad) * cos(uSunAltitude * rad) * cos(fromSun * rad);

    vec3 lit = groundLight.rgb * rayleighPhase(groundCos) +
               vec3(groundLight.a) * miePhase(groundCos, MIE_G);

    radiance = mix(radiance, lit * uGroundAlbedo, belowHorizon);
  }

  vec3 colour = toneMap(max(radiance, vec3(0.0)) * uExposure);
  vec3 srgb = linearToSrgb(clamp(colour, 0.0, 1.0));

  fragColor = vec4(dither(srgb, gl_FragCoord.xy), 1.0);
}
`;
