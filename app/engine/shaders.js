// @ts-check
/**
 * The shaders, as strings.
 *
 * Strings in a `.js` file rather than `.glsl` files because the project has no
 * build step (ADR 0001): there is no bundler to turn an import of a `.glsl`
 * file into text, and fetching them at run time would mean the first frame
 * waits on the network stack for files that are already on disk.
 *
 * ---------------------------------------------------------------------------
 * MILESTONE 0. This is a vertical gradient, not a sky.
 *
 * Its job is to prove the pipeline end to end: that the gradient is continuous
 * across the whole monitor span rather than restarting on each screen, that
 * light is mixed in linear space, that the output is dithered and gamma-encoded
 * correctly, and that all of it is driven by a timestamp.
 *
 * Milestone 1 replaces the body of the fragment shader with the scattering
 * model and its lookup texture (ADR 0004). The uniform interface - the crop,
 * the span, the sun - is meant to survive that.
 * ---------------------------------------------------------------------------
 *
 * @module engine/shaders
 */

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
 *
 * Everything interesting happens per fragment, so this does nothing but pass
 * clip-space positions through.
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
 * The one idea worth reading: the gradient is a function of position in the
 * **span** - the bounding box of every monitor - not of position in this
 * window. That is what makes one sky stretch across three screens instead of
 * three skies (US-012). Each window is handed the rectangle it occupies and
 * samples the same larger picture.
 */
export const SKY_FRAG = /* glsl */ `#version 300 es
precision highp float;
${COMMON}
uniform vec2 uResolution;   // this drawing buffer, in device pixels
uniform vec4 uCrop;         // this window's rect in the span: x, y, w, h
uniform vec2 uSpan;         // the whole span, in span pixels

uniform vec3 uZenith;       // linear light at the top of the span
uniform vec3 uHorizon;      // linear light at the bottom
uniform float uCurve;       // how tightly the gradient bunches at the horizon

uniform float uSunAltitude;  // degrees; drives nothing yet beyond the colours above
uniform float uSunAzimuth;   // degrees clockwise from north

out vec4 fragColor;

void main() {
  // gl_FragCoord is in device pixels with the origin bottom-left. Flip y so
  // that 0 is the top of the picture, which is how the span is described.
  vec2 inWindow = gl_FragCoord.xy / uResolution;
  vec2 inSpan = uCrop.xy + vec2(inWindow.x, 1.0 - inWindow.y) * uCrop.zw;

  // 0 at the top of the span, 1 at the bottom.
  float v = clamp(inSpan.y / max(uSpan.y, 1.0), 0.0, 1.0);

  // A real sky is not a linear ramp: most of the colour change happens in the
  // few degrees nearest the horizon, so the parameter is bent before use.
  float h = pow(v, max(uCurve, 0.0001));

  // Mixed in LINEAR light. Mixing in sRGB here is the classic mistake and
  // gives a muddy band through the middle of every gradient.
  vec3 linear = mix(uZenith, uHorizon, h);

  vec3 srgb = linearToSrgb(linear);
  fragColor = vec4(dither(srgb, gl_FragCoord.xy), 1.0);
}
`;
