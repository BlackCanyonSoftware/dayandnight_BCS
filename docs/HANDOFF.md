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
- **Checks:** lint, format, typecheck clean. 99 unit and 19 browser tests
  passing. 7 desktop tests exist and **have not been run since Milestone 0** -
  they open windows on the desktop, which the owner asked not to have
  interrupted. They cover the host and the window lifecycle, none of which has
  changed since.
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

1. **Re-measure NFR-1.** Frame-skipping removed 99.7% of the redrawing and the
   CPU saving has never been measured. This is the one thing that decides
   whether ADR 0001 stands. It needs a quiet machine; `tools/measure-cost.js`
   now refuses to report a contaminated run.
2. **Verify by hand what only a person can:** a full-screen game pausing the
   wallpaper, and a system time-zone change with the application running.
3. Then **Milestone 2**: the span across several screens, the full pause
   policy, the tray icon and autostart.

### Older, still open

1. **The owner picks an option for NFR-1** (`docs/ROADMAP.md`, Milestone 0
   outcome). Recommended first: redraw only when the scene has meaningfully
   changed - it is cheap to try and it also reveals the true floor.
2. **Re-measure** with a longer settling window, on a quiet machine, to get a
   trustworthy floor.
3. **Verify pause-on-fullscreen by hand** against a real game. The policy and
   the signal are implemented and unit-covered; nobody has watched it stop.
4. Then **Milestone 1**: real astronomy, the scattering model, the grade, the
   sun, the moon, the stars. Exit criteria in `docs/ROADMAP.md`.

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
  the method and the caveats. This is the project's open question.
- Interrupted the owner twice by launching windows. Noted above so the next
  session does not repeat it.

### 2026-10-18 - project kickoff and plan

- Read the owner's standards, Pixel Galaxy Studio as the UI reference, and the
  brand kit. Put four architecture questions to the owner; all four
  recommendations were accepted and became ADRs 0001-0005.
- Wrote `docs/PRD.md`, `ARCHITECTURE.md`, `DESIGN.md`, `ROADMAP.md`, the five
  ADRs, and this file. Nothing was built or run.
