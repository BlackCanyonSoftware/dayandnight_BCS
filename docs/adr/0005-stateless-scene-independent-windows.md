# ADR 0005 - A stateless scene, and windows that never talk to each other

- **Status:** accepted
- **Date:** 2026-10-18
- **Deciders:** tech lead

## Context

The scene has to be correct on several surfaces at once - the editor's preview
and one window per monitor - and it has to stay correct across events that would
break a naive animation loop: the machine wakes after six hours, a monitor is
unplugged, a GL context is lost after a driver update, daylight saving begins,
the user drags the editor's time scrubber to next June, the application is
restarted at 3 p.m.

The instinctive design is an animation loop that advances a clock and mutates
scene state, with the windows kept in step by a synchronisation channel. Pixel
Galaxy Studio faced the analogous problem for a seamless loop and answered it
with a rule rather than a mechanism: everything that moves is a pure function
of loop position `u`, with whole cycles per loop, no timers and no accumulated
state. That rule is why its exports join end to end, and the owner's notes call
it "the product".

The same rule generalises here, with wall-clock time in place of `u`.

## Options considered

1. **A stateful animation loop with a synchronisation channel.** Each surface
   advances its own clock; a channel keeps them aligned. Conventional, and
   wrong here: every event above becomes a case to handle - resynchronise after
   sleep, re-seed a new window from an existing one, reconcile drift - and the
   editor's scrubber becomes a second, different code path from the live
   wallpaper, so the preview can disagree with the desktop.

2. **One renderer process shared by every surface,** blitting into each window.
   Removes drift by having one clock. But it means cross-process texture
   sharing, a surface that must survive a monitor disappearing, and per-monitor
   DPI handled by hand. All the complexity of option 3 with none of its
   simplicity.

3. **The scene as a pure function of its inputs, rendered independently on
   every surface, with no channel at all.**

## Decision

**Option 3.** The scene is a pure function:

```
render(preset, t, place, crop, pixelRatio) -> pixels
```

`t` is a UTC timestamp supplied by the caller - never read from the clock
inside the engine. Two calls with the same arguments produce identical pixels.
There is no accumulated state, no timer, no unseeded randomness, and no `start`
or `stop` on the engine: the host decides when a frame is wanted.

Each wallpaper window is a separate Electron window with its own GL context,
computing the scene from the same wall clock. **There is no synchronisation
channel between them, and there must never be one** (architecture
invariant 3).

Things that look stateful are written as functions of `t` instead:

| Appears to need state | Is actually |
|---|---|
| Cloud drift | `position = rate * t`, wrapped to the sheet's period |
| Star twinkle | `phase = hash(starIndex) + rate * t` |
| Star field rotation | Local sidereal time for `t` and `place` |
| Bloom, glow, pulse | Functions of altitude and `t` |
| The sky's slow change | Sun altitude for `t`, via the lookup texture |

## Consequences

**Good.** Every one of the events in the Context section stops being a case:

- **Wake from sleep** - the next frame renders at the new `t`. Nothing to
  resynchronise.
- **Monitor unplugged** - its window closes. No other window notices.
- **Monitor plugged in** - a new window opens and is immediately correct. There
  is nothing to seed it from.
- **Lost GL context** - recreate it and render `t` again. There is no state to
  lose, which is what makes ADR 0003's commitment on context loss cheap.
- **Restart at 3 p.m.** - correct at 3 p.m.
- **DST or time-zone change** - `t` is UTC, so the arithmetic never saw the
  local offset; only the displayed local time changes (US-011).
- **The editor's scrubber** - passes a different `t` through the same path as
  the live wallpaper, so the preview is WYSIWYG by construction. Fast-forward is
  the same, with `t` advancing faster.
- **Image tests** - a fixed `t` gives byte-identical output, so the sky can be
  pinned by screenshot and a regression cannot hide.
- **Drift is not mitigated, it is impossible.** Nothing accumulates, so there
  is nothing to accumulate error in.

**Bad, and accepted.**

- Every surface recomputes the same sun position and rebuilds the same lookup
  texture - duplicated work proportional to monitor count. It is genuinely
  negligible: the astronomy is a few hundred floating-point operations a frame,
  and the texture bake is one small render pass every few seconds. Paying it
  buys the whole list above.
- Some effects are harder to express without state. Anything with genuine
  history - a weather front that evolves, a bird that remembers where it was -
  needs a deterministic function of `t` rather than a simulation. That is a
  real constraint on Milestone 3 and later, and it is the right trade: an
  effect that cannot be written this way probably cannot survive the machine
  sleeping either.
- A contributor's instinct will be to add a channel, a cache or a `lastFrame`.
  The invariant is therefore written down in three places and checked in
  review.

**Commitments.**

- A unit test asserts that two renders with identical arguments produce
  identical output.
- `Date.now()`, `performance.now()` and unseeded `Math.random()` are banned
  inside `app/engine/` and the ban is enforced by a lint rule, not by vigilance.
