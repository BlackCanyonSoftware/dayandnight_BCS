# ADR 0003 - WebGL2 now, WebGPU as a backend swap later

- **Status:** accepted
- **Date:** 2026-10-18
- **Deciders:** tech lead

## Context

The scene is a shader problem: a physically-modelled sky, a lookup texture
baked from it, bloom, a star field as points, and eventually volumetric-ish
clouds. Pixel Galaxy Studio renders on the CPU in web workers with canvas 2D,
which is right for an offline exporter writing an mp4 and completely wrong
here, where frames are drawn continuously for years.

So the choice is which GPU API, inside Electron's Chromium.

## Options considered

1. **WebGL2 / GLSL ES 3.0.** Present and working in every Chromium Electron
   has shipped for years, on every driver that matters, including the old
   Intel integrated parts a desktop-wallpaper audience actually has. Float
   render targets, instancing and texture arrays - everything this engine needs
   - are core or universally available extensions. Mature tooling and an
     enormous body of reference shaders for exactly this problem domain
     (atmospheric scattering).

2. **WebGPU / WGSL.** The better API by some distance: compute shaders would
   suit the LUT bake, the binding model is saner, and it is where the platform
   is going. But it is younger on Windows, driver-dependent, and a process that
   runs unattended for weeks is the worst possible place to be early. Compute
   would buy little here, because the expensive work is already amortised to
   roughly once every few seconds (see the frame pipeline in
   `ARCHITECTURE.md`).

3. **Canvas 2D, as Pixel Galaxy Studio does.** Rejected outright. The sky is
   per-pixel gradient and scattering work; doing it on the CPU at 20 fps across
   a multi-monitor span would consume the entire performance budget many times
   over.

4. **Both, behind an abstraction, from the start.** Rejected as speculative
   generality - the thing the engineering standards call out by name. Two
   backends is two things to debug for a benefit nobody has asked for.

## Decision

**WebGL2.** One backend, written directly, no abstraction layer over the
graphics API.

What makes WebGPU available later is not an abstraction but the engine's
existing shape: all GL calls live under `app/engine/gl/` (`context.js`,
`program.js`, `target.js`), and the passes above them are described in terms of
textures and draws rather than in terms of GL objects. A WebGPU backend is a
replacement for that folder. The sky, astronomy, colour and grade modules - the
parts with the actual product in them - are plain arithmetic and do not know
which API is underneath.

## Consequences

**Good.**

- Mature, predictable, widely deployed; the audience's older GPUs work.
- The reference literature for atmospheric scattering is almost entirely
  GLSL, so ports are direct.
- No abstraction tax: shaders are written and read as shaders.

**Bad, and accepted.**

- No compute shaders, so the LUT bake is a render-to-texture pass. Given it
  runs once every few seconds, this costs nothing real.
- GLSL ES 3.0 is a less pleasant language than WGSL, and the binding model
  means more uniform plumbing by hand.
- A WebGPU migration later is genuine work, bounded to `engine/gl/` plus a
  shader translation pass.

**Commitments.**

- WebGL2 context loss is handled, not assumed away: `gl/context.js` listens for
  it, recreates the context and re-renders. This is cheap here precisely
  because of architecture invariant 1 - there is no state to restore, only a
  timestamp to render again. A 24/7 process will see context loss, after a
  driver update if nothing else.
- Hardware without working WebGL2 gets a clear message naming the problem, not
  a software-rendered slideshow that would quietly violate NFR-1.
- The decision is revisited if clouds (Milestone 3) turn out to want compute.
