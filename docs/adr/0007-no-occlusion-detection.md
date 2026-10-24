# ADR 0007 - No desktop occlusion detection

- **Status:** accepted
- **Date:** 2026-10-24
- **Deciders:** tech lead (reverses a scope line in Milestone 2)

## Context

Milestone 2's scope has always listed "the full pause policy: battery, display
sleep, occlusion, suspend and resume". Everything but occlusion is now built and
tested. This records why the last one is not being built, because a scope item
dropped without a reason comes back every six months.

Occlusion means stopping when other windows cover the desktop entirely - a
maximised browser, say. It is the obvious last member of the list: the policy
exists to stop drawing when nobody is looking, and a covered desktop is nobody
looking.

**What it would take.** There is no Windows event for it, so it would be part
of the two-second poll. Each pass would enumerate every top-level window and
ask five things of each: `GetWindowRect`, `IsWindowVisible`, `IsIconic`,
`GetWindowLongW` for the tool-window style, and `DwmGetWindowAttribute` for the
cloaked flag - the last being essential, because store applications leave
cloaked windows lying around that report themselves visible and would otherwise
be counted as covering the screen. Then a rectangle-union over the survivors,
per monitor.

Five new calls and a new DLL. ADR 0002 confined koffi to five calls in total;
this would double that, and `host-win32.js` is the module the whole product
rests on.

## The arithmetic that decides it

The case for occlusion was written when the wallpaper cost 8.56 % of one core.
It now costs **0.15 %** (`ARCHITECTURE.md`, Measurement, Milestone 1), because
identical frames are no longer redrawn. That changes the sum completely, and
the sum is no longer close.

**What it would save.** Pausing tears down the render loop; it does not remove
the processes. So occlusion could only recover the _drawing_ part of 0.15 %,
and the Milestone 1 sweep found 30, 20, 10, 5 and 1 fps indistinguishable from
one another - the per-frame component is already below what the instrument can
resolve. Call it under 0.05 % of one core, recovered during whatever fraction
of the day the desktop is wholly covered.

**What it would cost.** Roughly a hundred top-level windows on an ordinary
desktop, five foreign calls each, every two seconds: about 250 calls a second,
continuously, whether or not anything is covered. Even at a microsecond a call
that is around 0.025 % of one core - the same order as the saving, spent all
day to recover something only some of the day.

It is a wash at best, and quite possibly a loss.

## Decision

**Do not build it.** Remove it from Milestone 2's scope and record it here.

## Consequences

- The pause policy stops for: a full-screen or exclusive application, a locked
  session, suspend, battery, and nobody having touched the machine for ten
  minutes. A maximised window over the desktop is not one of them, and the
  wallpaper goes on drawing behind it at a cost that does not register.
- **ADR 0002's five Win32 calls stand**, and the most dangerous module in the
  application does not double in size for a saving that cannot be measured.
- The failure mode avoided is worth naming on its own. Occlusion detection that
  is wrong in the unsafe direction - a cloaked window counted as covering, a
  rectangle union off by a monitor - stops the wallpaper while somebody is
  looking at it. That is a visible defect traded for an invisible saving, and
  on a product whose whole claim is that the sky is there when you look, it is
  the wrong trade twice over.
- **This reverses if drawing ever gets expensive again.** Milestone 3's clouds
  are the obvious candidate: they need real frames, so the per-frame component
  comes back and the sum has to be redone rather than assumed. The condition
  for reopening this is a measurement, not an opinion - if `measure-cost.js`
  ever shows the drawing component above about half a per cent of one core,
  this is worth the five calls.
