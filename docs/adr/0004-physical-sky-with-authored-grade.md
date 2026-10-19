# ADR 0004 - A physical sky with an authored grade over it

- **Status:** accepted
- **Date:** 2026-10-18
- **Deciders:** owner, tech lead

## Context

The product has two requirements that pull against each other. The sky must
look **realistic** - the owner's word - and match what is actually outside the
window (G1). And the look must be **fully customizable** in the application
(G4), because that is what makes it a studio rather than a screensaver.

There is a third, quieter requirement: a user must not be able to author an
ugly sky by accident. A wallpaper that looks wrong at 05:40 once a week is worse
than one with fewer knobs.

## Options considered

1. **Authored gradient keyframes.** The user defines vertical colour ramps at
   chosen sun altitudes; the renderer interpolates between the bracketing pair
   in Oklab. Maximum stylistic range, far less engine work, tiny presets, and
   the full span from photoreal to flat illustration. But realism rests
   entirely on whoever authors the preset, and hand-authored twilight almost
   never matches real twilight - the gradient from a horizon that is still lit
   to a zenith that is already dark is subtler than people draw it.

2. **Physical scattering only.** Rayleigh and Mie from the sun direction, with
   the physical knobs: turbidity, ground albedo, exposure. Correct sunrise
   reddening, horizon glow and twilight fall out for free, and the model cannot
   produce an impossible sky. But customization becomes "adjust the haze",
   which is not what G4 promises.

3. **Physical scattering with a user-authored grade over it.** The model
   produces linear-light radiance; a user-authored colour transform then shapes
   it. Realistic by default, customizable in the way users expect, and the
   grade cannot move the sun or invent light where there is none.

4. **Keyframes first, physical later.** Ship option 1 to get something on
   screen sooner, with the engine arranged so a physical base can be added.
   Rejected: the grade UI and the keyframe UI are different surfaces, so this
   buys early progress at the price of rebuilding the customization panel and
   re-authoring every preset.

## Decision

**Option 3.** A physical sky model, graded.

**The base.** An analytic daylight and twilight model evaluated per pixel from
the sun direction - Hosek-Wilkie where it applies, with a twilight extension
below the horizon, since the Hosek-Wilkie and Preetham family are fitted for a
sun above or near the horizon and go wrong in deep twilight, which is exactly
the hour this product is about. The final choice of twilight treatment is an
implementation detail of Milestone 1 and does not change this decision.

**The grade.** Applied to linear radiance before tone mapping:

- exposure, in stops;
- a three-band lift / gamma / gain in Oklab, so a user can warm the horizon
  without greying the zenith;
- an altitude-keyed tint ramp - a small set of colour stops against sun
  altitude - which is where option 1's expressiveness is retained, as a
  *modifier* on a correct sky rather than as the sky itself;
- turbidity and ground albedo, which belong to the model rather than the
  grade but sit in the same panel because that is where a user looks for them.

**The bake.** Model and grade together are baked into the altitude x height
lookup texture described in `ARCHITECTURE.md`, so the per-frame cost is a
texture read regardless of how expensive the model is.

## Consequences

**Good.**

- Correct by default. Twilight bands, seasonal change and polar behaviour are
  consequences of the geometry, not content a preset author has to get right.
- The expressive range of keyframes is kept, as a tint ramp over a sky that is
  already right.
- Architecture invariant 5 becomes enforceable: a preset describes appearance
  only, and there is no setting that can put the sun in the wrong place.
- The expensive part is amortised by the bake, so realism is nearly free per
  frame.

**Bad, and accepted.**

- The most engine work of the four options, and the twilight extension is the
  genuinely hard part - the published models are weakest exactly where this
  product lives.
- A user who wants a flat, stylised, non-physical sky is less well served than
  option 1 would serve them. If that audience turns out to matter, a "flat"
  grade mode that ignores the base is an additive change, not a redesign.
- Two conceptual layers to explain in the UI. Mitigated by the hint on every
  control (US-023) and by the grade panel being ordered so the common controls
  come first.

**Commitments.**

- The grade is specified and built in Milestone 1 alongside the model, not
  after it, so the customization surface is designed while the model can still
  change to suit it.
- The first real presets are authored in Milestone 1, for the same reason: a
  model nobody has authored against is a model that is not yet finished.
- Oklab, linear light and output dither are not optional refinements. They are
  the difference between this reading as professional and reading as cheap, and
  they are architecture invariant 4.
