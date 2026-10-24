# Handoff

Where the project stands, for whoever picks it up next - a person or a fresh
session with no memory of this one. Newest session first.

## Current state

**Milestones 0, 1 and 2 are done. Milestones 3 and 4 - the clouds and the
horizon - are built and unmeasured.** The application runs, puts a computed sky on
the Windows desktop behind the icons on every screen, and the sky is the real
one: scattering for its colour, Meeus astronomy for the sun and moon, stars
turning at the sidereal rate, and a grade over the top.

- **Branch:** `main`
- **Remote:** `origin` is `github.com/BlackCanyonSoftware/dayandnight_BCS`.
  **Nothing has been pushed.** The owner pushes.
- **Tier:** MVP
- **Checks:** lint, format and typecheck clean; **156 unit and 31 browser
  tests**. The 12 desktop tests, the installer build and
  `node tools/verify-package.js` all passed on 2026-10-24 and have not been run
  since the clouds and the horizon went in - they open windows, and the owner
  asked for those to wait.
- **Nothing since Milestone 2 has been measured.** The clouds are the first
  thing in the product that moves, which is the one change that could undo
  frame-skipping, and `tools/measure-cost.js` now has a scenario for them that
  has never been run. The owner asked to hold the measurement until more was
  built; more is built. - the desktop ones were run on 2026-10-19, the first
  time since Milestone 0, because they open windows on the desktop and the owner
  has to be free.

- **NFR-1: met.** 0.15 % of one core against a 2 % budget, on two screens with
  the editor closed. See `ARCHITECTURE.md` under Measurement, Milestone 1. GPU
  time and GPU memory are still unmeasured.
- **Licensing and packaging: decided and built** (OQ-4, ADR 0006). Proprietary,
  the same seven-document shape as Pixel Galaxy Studio, adapted; a Windows NSIS
  installer from `npm run build`. The installer builds green and bundles its
  documents, and `node tools/verify-package.js` confirms the packaged
  application puts a sky on the real desktop - twelve checks, all passing.
  **A build is not releasable yet** for two reasons that are both owner
  decisions rather than work: there is no icon, because there is no brand, and
  there is no code-signing certificate.
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

1. **Run the cost measurement**, which is now the most overdue thing in the
   project. `node tools/measure-cost.js --shipped` has three scenarios and
   prints whether ADR 0007 reopens. Arithmetic says the clouds cost about
   0.4 % of a core against a budget of 2, but that is arithmetic. Then the
   desktop tests, the build and `verify-package.js`, which have not run since
   two milestones went in.
2. **The GPU, which has never been measured at all.** NFR-1 budgets 4 % and
   there is no way to check it. The cloud pass is a few hundred hashes a pixel
   where the sky used to be a table lookup, so this is the first time the
   question has had teeth.
3. **Verify by hand what only a person can:** a full-screen game pausing the
   wallpaper, and a system time-zone change with the application running. Lock,
   unlock, suspend and resume no longer need a person - the desktop tests
   deliver the real events and count the surface's render-loop ticks.
4. **The three-monitor criteria**, which need a third monitor: one continuous
   sky with no seam by screenshot, and NFR-1 re-measured with three active.
5. Then what is left of Milestone 4 - the user's own PNG as a horizon, which
   is the half of US-032 the computed library does not cover - and Milestone 5.
   The old note about Milestone 3, the clouds - which is also the event that reopens
   ADR 0007, because clouds need real frames and the sum that killed occlusion
   was done at the cost of a sky that barely redraws.

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
- ~~**OQ-4** Licensing and installer shape.~~ **Decided 2026-10-19:**
  proprietary, PGS's document shape adapted, Windows NSIS installer. ADR 0006.
  What is left is not a question but four `[[ ]]` placeholders only the owner can
  fill - publisher legal name and form, governing law and venue, support address,
  whether any mark is registered - plus a lawyer's single pass over `EULA.md` and
  `DISCLAIMER.md`. None of it blocks Milestone 2; all of it blocks a release.
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

## Gotcha worth repeating

**Do not open windows on the owner's machine without asking, every time.**
`npm run desktop`, `npm run test:desktop`, `tools/measure-cost.js` and
`tools/verify-package.js` all raise windows and replace the desktop wallpaper,
and the owner works on the same machine. A "yes, run it" covers that one run -
not the session, and not a different command. This was got wrong repeatedly on
2026-10-22; `AGENTS.md` now says so in those words. `npm run check` is safe:
its browser tests are headless.

## Session log

### 2026-10-24 - clouds and a horizon

- **Clouds** (`86df741`, `12fe462`, `409733c`). Three layers on horizontal
  planes, sampled where the view ray meets each, lit by the sun's own
  transmittance so the dawn colour is the real one. Composited by blending
  rather than through a second render target.
- **Frame-skipping survived**, which was the thing in doubt. The field only
  translates and evolves, so the signature answers "would this frame differ"
  from two scalars; the quantum is a pixel of the fastest layer, which makes
  the redraw rate about four a second against one every sixteen seconds for a
  clear sky.
- **Three bugs in the clouds, all of which produced a picture.** Drift growing
  without limit from the Unix epoch - fine in doubles, catastrophic through a
  `float` uniform, which tiled the sky. The wrap then applied in kilometres
  while the shader divides by two scale factors, so the field wrapped a third
  of the way through itself. And a coverage curve where everything happened
  between 0.3 and 0.6 of the slider.
- **A horizon** (`dc918a0`, `c718338`): mountains, a city or a treeline, all
  computed rather than bundled - the reasoning is in `ARCHITECTURE.md` and it
  is a deliberate departure from what US-032 asked for. Lit by the sky rather
  than drawn black; the far range takes the colour of the horizon behind it;
  a city's windows come on through dusk a few at a time.
- **Four more bugs there**, all visible: an invisible far range (ridged noise
  clusters near its mean, so a shorter far range hides everywhere), a
  single-colour haze that made it one olive band, a city of eleven buildings
  that read as a comb, and windows bright enough to clip to white at the
  4000x night exposure and lose their warmth.
- **A test that passed with the bug in place**, again: the cloud wrap test
  first used a wind so fast that consecutive frames were already uncorrelated,
  so a discontinuity had nothing to stand out against. Worth remembering as a
  shape - a test whose baseline is already at the maximum cannot detect
  anything.
- **A mistake worth recording:** `npm run check 2>&1 | tail -3` makes the exit
  status that of `tail`, so a failing suite still satisfies `&&` and the commit
  goes through. It did. The run turned out to be a dev server expiring rather
  than a regression, and a clean re-run passed, but the habit is the bug: use
  `set -o pipefail` or read `PIPESTATUS`.

### 2026-10-24 - Milestone 2 finished, as far as code can finish it

- **Tray icon and autostart** (`9c607d9`), which is OQ-1. A wallpaper normally
  has nothing on screen, so until now the application had no way back to it and
  no way to quit it. Autostart is read back from Windows rather than
  remembered, because the user can turn it off in Task Manager and a checkbox
  that disagreed with the machine is worse than none.
- **The login path found its own bug.** Started by Windows there is no editor,
  and the editor is what reads the settings and pushes them down - so the
  wallpaper would have come up drawing a sky for Denver rather than for
  wherever the user is. The shell now loads the settings itself when it starts
  without a renderer.
- **Occlusion dropped, with the arithmetic written down** (ADR 0007). It was
  scoped when the wallpaper cost 8.56 % of one core; at 0.15 % the polling it
  needs - about 250 foreign calls a second, all day - costs roughly what it
  would save, and a false positive stops the wallpaper while somebody is
  looking at it. It reopens if Milestone 3's clouds make drawing expensive
  again, and the condition is a measurement rather than an opinion.
- **It remembers that it was on** (`d3e15c4`). Wiring autostart made the gap
  obvious. The flag is mirrored from the shell, not kept by the editor, because
  the tray can change it too.
- **The sun crossing three screens is now a test** (`d3e15c4`), which is an
  exit criterion in the words it was written in. It asserts the order rather
  than the coverage, because a sun that jumped about would satisfy "appears on
  all three". Its first version failed by sweeping a UTC day, which at Denver
  starts at sunset; it starts at local solar midnight now.
- **An About panel** (`1d02831`) that opens the five documents every build has
  been shipping and nothing could read. The renderer picks an index into a
  fixed list, so no path crosses the IPC boundary.
- **The desktop suite found two of its own tests wrong, not the code.**
  `require` is not in scope inside `electronApplication.evaluate`; the way to
  reach one of our modules is `process.mainModule.require` with an absolute
  path built from `app.getAppPath()`, because it resolves relative to the
  electron module. One of the two was also a tautology - it compared a function
  against itself through two different doors - and now asks over IPC, which
  exercises the handler and the preload bridge as well.
- **`verify-package.js` now reads a document out of the packaged build.**
  `legal.js` resolves a different folder when packaged and that branch ran
  nowhere: exactly the "works in development, ships broken" case its own
  comment warns about.
- **A test that passed while the thing it tested was broken.** The reader's
  focus-restoration test drove the dialog by setting `hidden` directly, which
  bypassed the function that records where focus came from. It goes through the
  page API now. Worth remembering: a test that reconstructs the path instead of
  calling it will pass for the wrong reason.

### 2026-10-22 - Milestone 2: the span, the brand, and the pause policy

- **The span arithmetic is pure, tested and defined once** (`ad51992`). It
  moved to `app/engine/span.js` with the OS conversion injected, so the four
  arrangements in the exit criteria became eight fixtures and fifteen
  assertions instead of hardware nobody owns. It also killed two duplications:
  `degreesPerSpanY` existed in GLSL and in `signature.js`, which invariant 1
  depends on agreeing, and the span arithmetic existed in the shell and in the
  editor, where a drift would have shown as the preview framing the sky
  differently from the wallpaper.
- **The vertical stack found a real renderer bug.** Two stacked screens ask for
  169 degrees of sky vertically, 48 past the zenith, where the scattering
  lookup saturates and the gradient collapses from 49 levels to 18 - slack and
  wrong rather than obviously broken. `engine/view.js` caps the vertical field;
  the horizontal field is left alone because azimuth across the span is what
  carries the sun from screen to screen.
- **The brand arrived and is wired** (`1d22471`). The kit has a `daynnight`
  brand now, so the sidebar slot is filled and the installer has a real icon -
  which was the higher of the two things between a build and a release. The
  name is drawn DAYnNIGHT and written Day and Night; `TRADEMARKS.md` claims
  both and says they are the same name. The kit's palette and its typeface were
  deliberately NOT taken; that is a decision for the owner and is in tech debt.
- **The pause policy is tested and now stops when nobody is there** (`ca4054b`).
  Display sleep is covered by system idle time rather than by WM_POWERBROADCAST,
  which would need a window-proc subclass inside the module ADR 0002 keeps
  small; ten minutes, matching Windows' own display timeout. The rest of the
  policy was already written and had never been tested, because every branch is
  a fact about somebody's machine - now injected, and thirteen unit tests.
- **Invariant 7 is now actually checked.** Two desktop tests deliver a real
  `lock-screen` event to the real watcher and count the surface's render-loop
  ticks from inside its page. Zero while paused is what tells a loop torn down
  from one running and returning early, and nothing outside the page can see
  the difference.
- **One bug in passing:** the wallpaper state had a single `reason` with the
  host's winning over the pause policy's, so a fallback masked why nothing was
  drawing. Separate fields now, and the editor shows both - the first time the
  pause reason has been visible at all.
- **Still not done:** occlusion, the tray icon and autostart.

### 2026-10-19 - the packaged build verified, not just built

- **A sky reached the real desktop from the packaged application**, which is
  the claim the previous session could set up but not check. Twelve checks, two
  screens, `host: workerw`.
- Written as `tools/verify-package.js` rather than as a throwaway script,
  because Milestone 2 carries this as an exit criterion and because the
  interesting part is not repeatable by hand: `desktop/build/check-bundle.js`
  can prove koffi's native binary sits outside the asar archive, and only
  launching the packaged application proves it loads. The tool also catches two
  things that would survive a successful build - the custom scheme failing
  under asar, and WebGL failing inside the package.
- It runs `dist/win-unpacked`, which installs nothing, so checking a build
  leaves nothing in Installed Programs. It turns the wallpaper off again before
  exiting rather than relying on the process ending to restore the desktop.
- Extended the ESLint override that gives `tools/measure-cost.js` browser
  globals, since this tool has the same `evaluate()` callbacks, and used the
  project's own `DayAndNightWallpaperState` type rather than a hand-rolled
  shape - which typecheck caught, because the hand-rolled one had `reason` as
  `string | undefined` where the real contract is `string | null`.
- **Still not checked:** the installer itself, and any machine but this one.

### 2026-10-19 - OQ-4 settled: proprietary, and a Windows installer that exists

- **Decided and built both halves of OQ-4** (ADR 0006). Licensing is Pixel
  Galaxy Studio's shape - a short root `LICENSE` pointing into seven documents
  in `licenses/` - and distribution is a Windows NSIS installer, not one-click,
  with no auto-update and signing from the environment only.
- **Adapted the documents rather than copying them**, which was most of the
  work. Day and Night is legally smaller than PGS - no video, so no codec or
  format clauses; no bundled fonts, so no OFL - and technically riskier, so
  `DISCLAIMER.md` has three sections PGS has no need for: what it means to leave
  a nearly-still picture on an OLED screen all day, that the astronomy is
  decoration and must not be relied on for navigation or observance, and that
  drawing behind the desktop icons uses undocumented Windows behaviour that can
  stop working. Every Steam-specific paragraph was dropped, since nothing ships
  through Steam.
- **Kept ADR 0002's promise**, finally: koffi and its prebuilt binary are in
  `licenses/THIRD-PARTY-NOTICES.md` with their licence texts. The notices file
  also records that the city list was typed by hand rather than taken from a
  gazetteer, which is a licensing fact as much as an accuracy one.
- **Built the installer and it works**: 112 MB, `dist/`. The one risk specific
  to this product is that koffi's native binary cannot be loaded from inside an
  asar archive, so `desktop/build/check-bundle.js` now asserts a `.node` exists
  under `resources/app.asar.unpacked` by walking the directory, alongside the
  legal-document check it inherited. Verified the asar entry really is marked
  `unpacked: true` and that the installer really is `NotSigned`, rather than
  trusting either.
- **electron-builder's own warning is wrong.** It calls `directories.app: .`
  "superfluous or wrong configuration"; removing it makes the build fail,
  because it then finds the directory literally named `app/` and treats that as
  the application package. The line is back, with the reason written beside it
  so nobody obliges the warning again.
- **Not verified, and it cannot be from here:** that the _installed_ build puts
  a sky on the desktop. Packaging can prove the binary is in the right place,
  not that it loads. It needs someone to launch it.

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
