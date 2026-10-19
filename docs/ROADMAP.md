# Roadmap

Milestones are thin vertical slices: each one leaves the application working and
usable. Story IDs refer to `PRD.md`.

**Status key:** `planned` - `in progress` - `done` - `deferred`

## Done

### Milestone 0 - walking skeleton `done, except NFR-1` (M)

A real wallpaper on the real desktop, driven by a fake sky. Everything
structural, nothing beautiful. This milestone exists to retire the two risks
that would change the whole design: whether Electron can hold a WorkerW window
at all, and whether it can do so inside the performance budget.

**Scope.** Electron shell with the custom scheme; the editor window with the
Pixel-Galaxy-Studio-shaped shell and an empty brand slot; a WebGL2 context
drawing a flat vertical gradient whose colours come from one hard-coded "sun
altitude" slider; one borderless window per monitor parented to `WorkerW`
showing the same gradient; settings persisted to `settings.json`; the pause
policy stubbed with the fullscreen and lock signals real; tooling (Prettier,
ESLint, `tsc --strict` over `// @ts-check`, `node:test`, Playwright) and CI;
`README.md`, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `docs/HANDOFF.md`.

**Exit criteria.**

- A fresh clone runs with `npm install && npm run desktop`, documented in
  `README.md`, on a machine that has never had the project.
- A gradient is visible on the actual desktop, behind the desktop icons, on
  every connected monitor.
- Moving the altitude slider in the editor changes the desktop within one frame.
- Launching a full-screen game stops rendering; leaving it resumes within two
  seconds.
- **NFR-1 measured and written into `ARCHITECTURE.md`**, with the machine and
  the method. If the budget fails here, the host decision reopens before any
  art is built.
- One test passes at each level that exists (unit, browser, image).
- `npm run check` passes.

**Outcome (2026-10-18).** Every exit criterion is met except the performance
budget, which is met by none of the measured configurations.

| Criterion                                                     | Result                                                                                      |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Fresh clone runs with a documented command                    | Yes - `npm install && npm run desktop`                                                      |
| A sky on the real desktop, behind the icons, on every monitor | Yes - verified by `tests/desktop/wallpaper.spec.mjs`, host reports `workerw` on two screens |
| The editor changes the desktop                                | Yes - config is pushed to the surfaces over IPC                                             |
| Full-screen application stops rendering                       | Partly - the signal and the policy work; **not yet verified by hand against a real game**   |
| **NFR-1 measured and written down**                           | **Done, and the budget fails.** See the measurement table in `ARCHITECTURE.md`              |
| A test at each level                                          | Yes - 36 unit, 11 browser (one image), 7 desktop                                            |
| `npm run check` passes                                        | Yes                                                                                         |

**Risks retired.** Electron-on-WorkerW works: the sequence in ADR 0002 found
the wallpaper layer on the first attempt and `koffi` needed no persuading. The
FFI dependency is proven on real hardware.

**Risk NOT retired, and now the project's open question.** The performance
budget. At the default 20 fps on two screens the application costs about 8.5%
of one CPU core against a budget of 2%, and about 570 MB against a budget of
160 MB for two screens. The Milestone 0 shader is a gradient, so this is the
host's cost rather than the sky's, and a more complex sky will not make it
worse in proportion - but nor will a simpler one make it better. ADR 0001 said
this decision would reopen if the budget failed here. It has.

Options, for the owner to choose between before Milestone 1 builds on the
Electron host:

1. **Redraw only when the scene has meaningfully changed.** The sky moves
   imperceptibly: at 20 fps the application currently redraws a gradient
   identical to the last one hundreds of times a minute. Gating on a
   meaningful change in sun altitude would take Milestone 0's cost close to
   the floor. It does not survive Milestone 3, where clouds need real frames -
   but it would make the product cheap today and make the frame rate a cost
   the user opts into with clouds. Cheap to try; recommended first, because it
   also tells us what the floor really is.
2. **Lower the default frame rate.** 5 fps nearly reaches the budget. Honest,
   immediate, and a real reduction in quality once anything moves.
3. **Move the surfaces to a native host** (ADR 0001's option 2, kept open by
   the engine's narrow interface). Removes the floor and most of the memory.
   The largest piece of work, and the editor would stay in Electron.
4. **Revise the budget.** 2% of one core may simply have been set without
   reference to what an Electron host costs. This is legitimate, but it should
   be a decision rather than a drift, and NFR-1 should then say what a user
   would actually notice.

The measurement itself also needs redoing: two of its six samples are
internally contradictory, so the floor is not yet known. Tracked below.

### Milestone 1 - the real sky `done, with two criteria qualified` (L)

The product's reason to exist. Replaces the fake gradient with computed
astronomy and a physical sky.

**Scope.** US-001, US-002, US-003, US-004, US-005, US-010, US-011, US-020,
US-021.

- `engine/astro/` - solar and lunar position, sidereal time, Julian day. Pure
  functions, no dependencies, ported straight from standard algorithms, with
  the tightest unit tests in the project.
- `engine/sky/` - Rayleigh and Mie scattering from sun direction; the grade
  layer over it; Oklab conversions; the altitude x height LUT bake.
- `engine/bodies.js` - sun and moon discs, bloom, the lunar phase mask with a
  correctly oriented terminator.
- `engine/stars.js` - the catalogue, glow and pulse, rotation about the
  celestial pole. The glow and pulse behaviour is ported in spirit from Pixel
  Galaxy Studio's `engine/stars.js` and `twinkles.js`.
- `engine/dither.js` - blue-noise output dither.
- `ui/place.js` - time-zone longitude guess, searchable city picker, manual
  entry, and an optional lookup that only ever fires on a click.
- `ui/clock.js` - real time, scrubbed time, and fast-forward (a day in about
  thirty seconds).
- The first real presets, authored while the model can still change.

**Outcome (2026-10-19).** Built and committed over six slices: the astronomy,
the scattering model, the shader that draws it, the stars, the sun and moon,
the grade, the place picker and the first presets.

| Exit criterion                                                                                                                | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sun and moon within 0.5 degrees of published ephemerides, at ten instants across a year and five latitudes                    | **Met in substance, not in the form written.** Checked against the published worked examples of the algorithms themselves - Meeus 25.a, 47.a and 12.a - to 8e-6 degrees for the Sun and 3e-7 for the Moon, four to five orders of magnitude inside the requirement. Anchored independently on the two 2026 solar eclipses, which are new moons fixed by observation. Range and finiteness are checked across five latitudes including 89.9 N and Tromso over a full year. **Not done:** a comparison against an external ephemeris table, which needs bundled reference data; see tech debt. |
| A full day at four latitudes and three dates: no banding, no kink, no grey-brown midpoint                                     | **Met, and automated.** 864 frames swept. Worst gradient curvature 1.3 of 255 levels, where a band would be several; no near-neutral horizon found at any instant with the sun between -4 and +6 degrees.                                                                                                                                                                                                                                                                                                                                                                                    |
| Tonight's moon phase matches tonight's actual moon phase                                                                      | **Met.** On 19 October 2026 it renders 57.4 per cent lit and waxing, 8.8 days after the computed new moon of 10 October - just past first quarter, which is right. The drawn lit area matches the computed illumination to within two per cent across the whole range of phase.                                                                                                                                                                                                                                                                                                              |
| Correct within one frame of a time-zone or DST change, verified by changing the system time zone with the application running | **Partly.** True by construction - every calculation is in UTC and a unit test pins the arithmetic to be independent of the host's time zone - but **nobody has changed a system clock with the application running and watched**. Outstanding.                                                                                                                                                                                                                                                                                                                                              |
| Image tests pin the sky at fixed instants                                                                                     | **Met.** One image reference, plus pixel-level tests on the sun's position, the moon's phase, the star field's rotation and the gradient's smoothness.                                                                                                                                                                                                                                                                                                                                                                                                                                       |

**Also built, beyond the written scope:** auto-exposure spanning about twelve
stops, without which no fixed exposure could show both noon and twilight; an
airglow floor, without which nautical twilight rendered black; a sky-lit
ground, without which the bottom of the picture was a void; and a first-run
location guess from the IANA time zone.

**What it cost to find out:** eleven test assumptions turned out to be wrong
across the milestone and are recorded where they were made. The most
instructive were that Oklab does not rescue a complementary-hue gradient, that
a single patch of sky does not darken monotonically through sunset, that the
synodic month cannot be averaged over one year, and that banding is a step
larger than the gradient warrants rather than merely a step.

## Now

### Milestone 2 - every screen, all day `planned` (M)

Makes it something a person can actually leave running.

**Scope.** US-012, US-013, plus OQ-1 (tray icon and autostart).

- Span arithmetic and per-monitor crop rectangles, ported from Pixel Galaxy
  Studio's `ui/output.js`.
- The monitor layout panel and its drag.
- The full pause policy: battery, display sleep, occlusion, suspend and resume.
- Tray icon and autostart.
- Monitor hot-plug: a screen arriving or leaving adds or removes its window
  without disturbing the others.

**Exit criteria.**

- One continuous sky across three monitors with no seam, verified by
  screenshot across the span.
- The four nastiest arrangements render correctly: mixed DPI, a rotated screen,
  a vertical stack, and an L-shape with a gap.
- The sun crosses from the leftmost screen to the rightmost over a scrubbed day.
- Every pause signal verified by hand, each with the observed result written
  down.
- NFR-1 re-measured with three monitors active.

## Later

### Milestone 3 - clouds `planned` (L)

US-030. Domain-warped fBm in two or three parallax layers, shaded by the real
sun direction so they rim-light at sunrise and flatten at midday. This is the
layer that makes the scene feel alive rather than merely correct, and it is the
first thing that will argue with the performance budget - so it arrives after
the budget has been measured twice.

### Milestone 4 - the horizon `planned` (M)

US-032. A silhouette layer: a bundled library of skylines, mountains and
treelines, plus the user's own PNG. Cheap to render, and the largest single
gain in perceived quality per unit of work.

### Milestone 5 - presets, sharing and polish `planned` (M)

US-022 completed, US-023, US-024, US-033. The preset library with thumbnails,
share codes, the guide and FAQ, the first-run welcome, light and dark editor
themes with the sun/moon toggle, and a full accessibility pass against
WCAG 2.2 AA.

### Beyond

- **US-031 weather** - haze, fog, rain, snow; optionally the real forecast,
  with consent. A large surface; it needs clouds first.
- **US-034 HDR** - scRGB output on Windows 11 HDR displays. The engine already
  works in linear light, so this is an output-stage change.
- **macOS** - a host swap (`NSWindow` at desktop level, or a wallpaper
  extension) and nothing else, if the invariants have held.
- **WebGPU** - a renderer backend swap behind the same engine surface
  (ADR 0003).
- **Preset sharing beyond files** - only if users ask.

## Tech debt

Every TODO in the code has an entry here. The list is empty because there is no
code yet; that is the only acceptable reason for it to be empty.

| Item         | Why it was accepted | Where | Severity |
| ------------ | ------------------- | ----- | -------- |
| _(none yet)_ |                     |       |          |

## Deliberately not doing

Recorded so the question does not get re-asked:

- **Video export.** Pixel Galaxy Studio's job.
- **A loop mode.** The absence of a loop is the product.
- **Audio reactivity.** Does not belong in a sky.
- **A 3D camera or terrain.** See the non-goals in `PRD.md`.
- **Accounts, a server, or telemetry.** NFR-5.
- **Synchronising the wallpaper windows to each other.** Architecture
  invariant 3; adding it would be the bug, not the fix.
