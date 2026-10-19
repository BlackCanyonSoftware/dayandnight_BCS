# Handoff

Where the project stands, for whoever picks it up next - a person or a fresh
session with no memory of this one. Newest session first.

## Current state

**Milestones 0 and 1 are done.** The application runs, puts a computed sky on
the Windows desktop behind the icons on every screen, and the sky is the real
one: scattering for its colour, Meeus astronomy for the sun and moon, stars
turning at the sidereal rate, and a grade over the top.

- **Branch:** `main`
- **Remote:** `origin` is `github.com/BlackCanyonSoftware/dayandnight_BCS`.
  **Nothing has been pushed.** The owner pushes.
- **Tier:** MVP
- **Checks:** lint, format, typecheck clean. 99 unit, 19 browser and **7
  desktop tests passing** - the desktop ones were run on 2026-10-19, the first
  time since Milestone 0, because they open windows on the desktop and the owner
  has to be free.
- **NFR-1: met.** 0.15 % of one core against a 2 % budget, on two screens with
  the editor closed. See `ARCHITECTURE.md` under Measurement, Milestone 1. GPU
  time and GPU memory are still unmeasured.
- **CI:** written, **never run**, because nothing has been pushed.

## Milestone 1, what it left behind

Done: `engine/astro/` (Meeus), `engine/sky/atmosphere.js` (scattering),
`engine/sky/grade.js`, `engine/stars.js`, `engine/bodies.js`, the three-pass
renderer, `ui/place.js` with a city list, and `ui/presets.js` with seven
looks. The roadmap carries the exit-criteria table, including the two
criteria that are qualified rather than fully met.

Two things to know before changing any of it:

- **The scattering table is built once per process and shared.** Sun elevation
  is one of its axes, so it never needs rebuilding. Anything that would need
  it rebuilt - turbidity, say - has to be applied in the shader instead, and
  turbidity is applied by scaling the Mie channel the table already keeps
  separate.
- **Everything is summed as linear light and tone mapped once.** That single
  decision is why stars vanish at noon and emerge through twilight with no
  rule written for it. A layer that tone maps itself would break that.

## Next steps

1. **Verify by hand what only a person can:** a full-screen game pausing the
   wallpaper, and a system time-zone change with the application running. These
   are the last two unobserved claims in the project.
2. **Decide OQ-4, licensing and the installer.** It blocks Milestone 2 and
   there is still no `LICENSE` file; `package.json` says `UNLICENSED`.
3. Then **Milestone 2**: the span across several screens, the full pause
   policy, the tray icon and autostart, monitor hot-plug, and NFR-1 re-measured
   with three screens active.

### Older, still open

1. ~~The owner picks an option for NFR-1.~~ Done: redraw only on a real
   change, and it met the budget.
2. ~~Re-measure on a quiet machine.~~ Done 2026-10-19.
3. **Verify pause-on-fullscreen by hand** against a real game. The policy and
   the signal are implemented; nobody has watched it stop. Still open.
4. ~~Then Milestone 1.~~ Done.

## Open questions for the owner

- **OQ-1** Tray icon and autostart in v1? (Recommend yes, M2.)
- **OQ-2** How many cities in the bundled picker? (Recommend 1,000.)
- **OQ-3** Editor theme follows Windows or the sun? (Recommend Windows; it is
  built and defaults to dark with a three-way toggle.)
- **OQ-4** Licensing and installer shape. **Needed before Milestone 2.** There
  is no `LICENSE` file yet and `package.json` says `UNLICENSED`.
- **The brand.** `app/brand/` is empty by design and the sidebar slot holds its
  space. There is still no `dayandnight-bcs` brand in the kit at
  `C:\Users\Kpier\Documents\brand logos`.

## Gotchas

- **Do not run `npm run desktop`, `npm run test:desktop` or
  `tools/measure-cost.js` on a machine somebody is using.** They create
  windows, parent them behind the desktop icons and raise them. This
  interrupted the owner during Milestone 0. `node tools/probe-host.js` checks
  the Win32 side and opens nothing.
- **Never touch `window.webContents` inside a `closed` handler.** The object is
  destroyed by then and it throws out of an event handler, which Electron
  shows the user as a crash dialog. Capture ids at creation. This was a real
  bug in M0.
- **Pixel Galaxy Studio is the reference for the UI, not the engine.** Its
  renderer is canvas 2D on CPU workers for offline mp4 export - the opposite of
  what this needs. Its `ui/panel.js`, `ui/schema.js`, `ui/output.js`,
  `ui/monitors.js`, `ui/settings.js` and Electron shell are worth porting;
  `engine/` is not, except `stars.js` and `twinkles.js` for ideas.
- **Oklab does not prevent a muddy midpoint between complementary hues.** A
  unit test originally asserted that it did and was wrong. Oklab buys an even
  lightness progression; keeping chroma is the ramp's job, via enough stops to
  trace the hue path. Both are now pinned by tests.
- **A purely vertical gradient makes two side-by-side crops identical**, so the
  span test cannot prove the crop is honoured horizontally until the sun has a
  real azimuth in M1. It proves it vertically instead.
- `strict` and `checkJs` are on from day one, unlike Pixel Galaxy Studio. Keep
  them on.
- The root `package.json` is `type: commonjs` for Electron's main process, so
  ESM config files must be `.mjs`.
- **Never attribute anything to an assistant**, and **never push**.

## Session log

### 2026-10-19 - NFR-1 measured and met, and the harness that was measuring it wrong

- **Ran the measurement the owner had been waiting to free the machine for, and
  the budget is met**: 0.15 % of one core against 2 %, two screens, default
  preset, 20 fps, editor closed. ADR 0001 stands and is annotated to say so.
- **The first attempt produced nothing usable, and that was the useful part.**
  Every scenario from idle to 30 fps landed in the same 1.5-3.5 % band and the
  tool's own self-check declared the run untrustworthy. It was right to: the
  signal had fallen below the noise, because the thing being measured had got
  40 times smaller while the method stayed the same.
- **Found that the Milestone 0 sweep had been measuring the wrong
  configuration** all along. Its floor was taken with the editor _hidden_, and a
  hidden editor is a second renderer with its own WebGL context that nobody
  leaves running for a day. It turned out to be 1.82 of the 1.97 points that
  remained, and 273 MB of working set.
- **Separated the two causes rather than guessing at them.** One run, two
  scenarios, identical window lengths, the only difference being the editor:
  skipping identical frames took 8.56 % to 1.97 %, and closing the editor took
  1.97 % to 0.15 %. The frame-rate sweep corroborates the first from the other
  side - its slope has collapsed, which only skipping explains.
- **Fixed four things in `tools/measure-cost.js`**: a `--shipped` mode that
  measures the configuration a user actually leaves running with the editor
  closed; 60-second windows, because 6 cannot resolve a figure near 2 %; a
  below-idle tolerance taken from the scenarios' own spreads, since "a drawing
  scenario cannot cost less than an idle one" stopped being true once frames are
  skipped; and that check disabled in `--shipped` mode, where the first row is
  not a floor. The third and fourth were mistakes made during this session and
  caught by the tool contradicting itself.
- **Ran the 7 desktop tests**, the first time since Milestone 0. All pass.
- Still unobserved by a person: a full-screen game pausing the wallpaper, and a
  system time-zone change with the application running.

### 2026-10-19 - Milestone 1 finished: shader, stars, bodies, grade, place, presets

- Drew the real sky: the table as a 3D texture, a cylindrical projection, and
  auto-exposure spanning about twelve stops. Deleted the Milestone 0 gradient.
- Added stars (sidereal rotation, pinned by comparing a render with one
  exactly one sidereal day later), the sun and moon (the moon's phase drawn as
  geometry, its lit area matching the computed illumination to two per cent),
  the grade (haze, a tint ramp, saturation and contrast in Oklab), the place
  picker, and seven presets.
- Several things had to be added that were not in the written scope because
  without them the product did not work: auto-exposure, an airglow floor, and
  a sky-lit ground.
- Nine more test assumptions turned out to be wrong and are recorded where
  they were made. The longest-running was banding: it took four attempts to
  arrive at the measure that distinguishes a band from a star, from the sun's
  glare, and from a steep gradient.

### 2026-10-18 - Milestone 1, slices 1 and 2: astronomy and the atmosphere

- Replaced the placeholder sun with Meeus-grade astronomy and added the Moon.
  Checked against the published worked examples, and then against physics
  independently: the equation of time has the right extremes and four zero
  crossings, the solstices land on the right days, perihelion is in early
  January, and the 2026 solar eclipses fall on computed new moons.
- Built the scattering model. Two design decisions came out of measurement
  rather than reasoning: the lookup table needs a third axis for azimuth
  (at civil twilight the far sky is 500x dimmer, which a 2D table would have
  erased), and twilight needs more than one scattering bounce to come out blue
  instead of red.
- Six test assumptions turned out to be wrong across the two slices, each
  recorded in place. Most instructive: a single patch of sky does not darken
  monotonically through sunset, and the synodic month cannot be averaged over
  a single year.
- **Nothing draws with the new sky yet.** The renderer still uses the
  Milestone 0 gradient.

### 2026-10-18 - Milestone 0, the walking skeleton

- Built the Electron shell with its own `dayandnight://` secure scheme, the
  editor window, and one borderless wallpaper window per monitor.
- **Proved the WorkerW technique** with `tools/probe-host.js` before writing
  anything on top of it - it worked first time, retiring ADR 0002's risk.
- Built the engine: pure-function renderer, placeholder solar position,
  Oklab colour, a nine-stop gradient palette, blue-noise dither, WebGL2
  context with loss handling.
- Built the editor shell to match Pixel Galaxy Studio's layout in the new
  palette: brand slot (empty), settings panel with a hint on every control,
  live preview, light/dark/system theme, and the 24-hour scrubber that paints
  the day's real shape into its track.
- Wrote 54 tests across three levels. **Two of them found real problems**: the
  Oklab chroma claim was wrong (docs and ADR 0004 corrected), and the palette
  crossed through near-neutral grey around +7 degrees (a stop was added).
- Fixed a crash that showed the owner an Electron error dialog: reading
  `window.webContents` inside a `closed` handler.
- Added an explicit `starting` host state after a test found `on: true` being
  reported with `host: "off"`, which the editor would have mislabelled as
  success.
- **Measured NFR-1 and it fails.** Written up in `docs/ARCHITECTURE.md` with
  the method and the caveats. This is the project's open question. _(Resolved
  2026-10-19: it passes at 0.15 %, and the method here had two further faults.)_
- Interrupted the owner twice by launching windows. Noted above so the next
  session does not repeat it.

### 2026-10-18 - project kickoff and plan

- Read the owner's standards, Pixel Galaxy Studio as the UI reference, and the
  brand kit. Put four architecture questions to the owner; all four
  recommendations were accepted and became ADRs 0001-0005.
- Wrote `docs/PRD.md`, `ARCHITECTURE.md`, `DESIGN.md`, `ROADMAP.md`, the five
  ADRs, and this file. Nothing was built or run.
