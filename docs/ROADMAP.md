# Roadmap

Milestones are thin vertical slices: each one leaves the application working and
usable. Story IDs refer to `PRD.md`.

**Status key:** `planned` - `in progress` - `done` - `deferred`

## Done

### Milestone 0 - walking skeleton `done` (M)

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

**Outcome (2026-10-18, closed 2026-10-19).** Every exit criterion was met
except the performance budget, which was met by none of the configurations
measured that day. The budget was brought inside its limit the following day by
redrawing only on a real change - option 1 below - and the milestone closes with
one criterion still unobserved rather than unmet.

| Criterion                                                     | Result                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh clone runs with a documented command                    | Yes - `npm install && npm run desktop`                                                                                                                                                                                                                                             |
| A sky on the real desktop, behind the icons, on every monitor | Yes - verified by `tests/desktop/wallpaper.spec.mjs`, host reports `workerw` on two screens                                                                                                                                                                                        |
| The editor changes the desktop                                | Yes - config is pushed to the surfaces over IPC                                                                                                                                                                                                                                    |
| Full-screen application stops rendering                       | Partly - the signal and the policy work; **not yet verified by hand against a real game**                                                                                                                                                                                          |
| **NFR-1 measured and written down**                           | **Done. The budget failed, then passed.** 8.56 % of one core on 18 October, 0.15 % against a 2 % budget on 19 October once identical frames stopped being redrawn. Both measurements, and what separates them, are in `ARCHITECTURE.md`. GPU time and GPU memory remain unmeasured |
| A test at each level                                          | Yes - 36 unit, 11 browser (one image), 7 desktop                                                                                                                                                                                                                                   |
| `npm run check` passes                                        | Yes                                                                                                                                                                                                                                                                                |

**Risks retired.** Electron-on-WorkerW works: the sequence in ADR 0002 found
the wallpaper layer on the first attempt and `koffi` needed no persuading. The
FFI dependency is proven on real hardware.

**Risk retired on 2026-10-19.** The performance budget. Recorded here as it
stood, because the options below were a real decision and the reasoning should
survive the outcome.

The owner chose option 1. Skipping identical frames took the default from
8.56 % of one core to 1.97 %, and closing the editor rather than merely hiding
it - which is what a user actually does, and which the first measurement never
tested - took it to **0.15 % against the 2 % budget**. ADR 0001 stands, the
frame rate did not have to be lowered, and the native host stays available and
unneeded. The write-up is in `ARCHITECTURE.md` under Measurement, Milestone 1.

**As it stood on 2026-10-18.** The performance budget. At the default 20 fps on two screens the application costs about 8.5%
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

**Done, 2026-10-19.** Redone, and the method was wrong in three further ways
that the contradiction had hidden: the windows were too short to resolve a
figure near the budget, the floor included a hidden editor that is not part of
the product, and "a drawing scenario cannot cost less than an idle one" stopped
being true the moment frames began to be skipped. All three are fixed in
`tools/measure-cost.js`, which now also has a `--shipped` mode that measures
only the configuration a user leaves running.

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

**Scope.** US-012, US-013, plus OQ-1 (tray icon and autostart). The
licensing and packaging half of what used to block this milestone is done
ahead of it - see ADR 0006 - so what is left here is the product, not the
paperwork.

- Span arithmetic and per-monitor crop rectangles. **Done.** The arithmetic
  moved to `app/engine/span.js`, pure and with the OS conversion injected, so
  the four arrangements are unit tests rather than hardware nobody owns.
- The monitor layout panel. **Done, read-only** - and the drag is deliberately
  not being built. In Pixel Galaxy Studio the layout is the user's choice about
  how a video maps onto their screens; here the arrangement belongs to Windows,
  and the sky is placed by real azimuth across whatever Windows reports. A drag
  here could only lie about what it did or move the sun somewhere it is not,
  and architecture invariant 5 forbids the second. The panel draws the
  arrangement to scale and says when sky is falling in a gap.
- The full pause policy: battery, display sleep, suspend and resume.
  **Done.** All of them were already there and are now tested rather than
  assumed - thirteen unit tests over an injected pair of sources, and two
  desktop tests that deliver a real event and count the surface's render-loop
  ticks. Display sleep is covered by idleness instead, for the reasons in
  `ARCHITECTURE.md`.
- ~~Occlusion.~~ **Dropped, with the sum written down** - see
  [ADR 0007](adr/0007-no-occlusion-detection.md). It was scoped when the
  wallpaper cost 8.56 % of one core; at 0.15 % the polling it needs costs about
  what it would save, and it would double the Win32 surface ADR 0002 keeps to
  five calls. It reopens if Milestone 3's clouds make drawing expensive again,
  and the condition is a measurement rather than an opinion.
- Tray icon and autostart. **Done.** The tray is how a product with no window
  of its own stays reachable: it can open the editor, turn the wallpaper on and
  off, start with Windows, and quit. Started by Windows at login it puts the
  sky up without opening the editor - and loads the settings itself, which is
  the path on which the sky could otherwise have been drawn for the wrong
  place.
- Tray icon and autostart.
- Monitor hot-plug: a screen arriving or leaving adds or removes its window
  without disturbing the others.
- The About panel, which shows the EULA, the disclaimers, the privacy notice,
  the trademarks and the third-party notices that `electron-builder.yml`
  already copies next to the application. **Done.** They are read and shown as
  text rather than handed to the shell: a `.md` file has no reliable
  association on Windows, and "your licence is in a file you may not be able to
  open" is not an answer. The renderer picks an index into a fixed list, so no
  path ever crosses the IPC boundary.

**Exit criteria.**

- One continuous sky across three monitors with no seam, verified by
  screenshot across the span.
- The four nastiest arrangements render correctly: mixed DPI, a rotated screen,
  a vertical stack, and an L-shape with a gap. **Done, in arithmetic rather
  than in hardware**, which is the only way it was ever going to be done: 15
  unit tests over eight arrangements in `tests/unit/span.test.mjs`, plus a
  browser test that drives the editor's panel through four of them. The
  vertical stack found a real bug in the projection - see below.
- The sun crosses from the leftmost screen to the rightmost over a scrubbed
  day. **Done**, and in the form it was asked for: three screens, each one's
  crop rendered separately the way three real surfaces do, every twenty minutes
  through an equinox. The order is what is asserted rather than the coverage -
  a sun that jumped about would satisfy "appears on all three" while being
  obviously wrong.
- Every pause signal verified by hand, each with the observed result written
  down. **Partly done, and the split is worth stating.** Lock, unlock, suspend
  and resume are now verified automatically, by delivering the real event to
  the real watcher - better than by hand, because it runs every time. What a
  person still has to do is the one nothing can fake: launch a full-screen
  game and watch it stop.
- NFR-1 re-measured with three monitors active.
- The build from the installer - not the one run from source - puts a sky on the
  desktop on a machine that has never had the project. **Half done:**
  `node tools/verify-package.js` confirms the packaged application works, and
  did so on 2026-10-19 on the development machine. What is left is a clean
  machine, and the installer rather than the unpacked build.

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

Every TODO in the code has an entry here.

| Item                                                                                                                                                                                                                     | Why it was accepted                                                                                                                                                                                                                                                                                   | Where                       | Severity |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | -------- |
| **No comparison against an external ephemeris table.** Accuracy is checked against the algorithms' own published worked examples instead                                                                                 | A bundled reference table is licensed data and a decision of its own. The margin is four to five orders of magnitude inside the requirement, so this buys confidence, not accuracy                                                                                                                    | `tests/unit/solar`, `lunar` | Low      |
| **GPU time and GPU memory are not measured**, so NFR-1's 4 % GPU and 80 MB-per-screen lines are unverified rather than met                                                                                               | There is no dependency-free way to read either on Windows, and a figure derived from a frame counter would not be a measurement                                                                                                                                                                       | `tools/measure-cost.js`     | Medium   |
| **Working set is about 488 MB** across the shell and two surfaces, roughly double ADR 0001's 150-250 MB estimate                                                                                                         | It is not the quantity NFR-1 budgets, and the CPU budget - the one that decides whether the product can run all day - is met with room. Worth a pass, not worth blocking on                                                                                                                           | the Electron host           | Low      |
| **The city list is typed by hand**, about a hundred entries at a tenth of a degree                                                                                                                                       | A real gazetteer is a licensed data file. The tests check every entry against its own time zone and against the sun's seasonal swing, so an error is caught rather than trusted                                                                                                                       | `app/ui/cities.js`          | Low      |
| **The editor does not use the brand palette or its typeface.** It keeps its own tokens and the system font stacks                                                                                                        | The logo arrived on 2026-10-22 and the rest of the kit with it. Adopting the palette and Nunito changes every screen, and would put a font file in the product and a row in the third-party notices - an owner decision                                                                               | `app/tokens.css`            | Medium   |
| **The installer is unsigned**, so Windows shows a SmartScreen warning                                                                                                                                                    | A code-signing certificate is a purchase and an owner decision. The configuration takes one from `CSC_LINK` at release time, so this is a release step and not a code change                                                                                                                          | `electron-builder.yml`      | High     |
| **Four `[[ ]]` placeholders in `licenses/`**: publisher legal name and form, governing law and venue, support address, registered marks                                                                                  | Only the owner can supply them, and a lawyer reads `EULA.md` and `DISCLAIMER.md` once before release. They block a release and nothing before it                                                                                                                                                      | `licenses/`                 | High     |
| **No auto-update.** A user who installs v1 stays on v1 until they download the next one                                                                                                                                  | There is no update server, and a wallpaper that replaces itself while running is a problem to solve deliberately. Revisit when there is a second version to ship                                                                                                                                      | `electron-builder.yml`      | Medium   |
| **The Microsoft Store route is unproven.** A packaged app's restrictions may forbid `SetParent` into Explorer's window tree                                                                                              | ADR 0006 rejected MSIX for v1 on this risk rather than measuring it. Worth an afternoon before any plan depends on the Store                                                                                                                                                                          | `desktop/host-win32.js`     | Low      |
| **A tall span is squashed rather than square.** Capping the vertical field is what keeps a stacked or portrait arrangement inside the sky, and the cost is that a degree across such a frame is no longer a degree up it | The alternative was worse: without the cap the top of the frame asks for sky above the zenith, where the scattering lookup saturates and the gradient collapses to a third of itself. Narrowing the horizontal field instead would have moved the sun off its true azimuth, which invariant 5 forbids | `app/engine/view.js`        | Low      |
| **The moon is drawn about 30x dimmer than life**                                                                                                                                                                         | At its true radiance it blows out the tone map and washes the stars out of a night sky, which is the opposite of what people recognise. Documented at the constant                                                                                                                                    | `app/engine/bodies.js`      | Low      |

## Deliberately not doing

Recorded so the question does not get re-asked:

- **Video export.** Pixel Galaxy Studio's job.
- **A loop mode.** The absence of a loop is the product.
- **Audio reactivity.** Does not belong in a sky.
- **A 3D camera or terrain.** See the non-goals in `PRD.md`.
- **Accounts, a server, or telemetry.** NFR-5.
- **Synchronising the wallpaper windows to each other.** Architecture
  invariant 3; adding it would be the bug, not the fix.
- **Occlusion detection.** ADR 0007: at the cost the wallpaper now runs at, the
  polling needed to notice a covered desktop costs about what noticing it would
  save, and getting it wrong stops the wallpaper while somebody is looking.
