# Handoff

Where the project stands, for whoever picks it up next - a person or a fresh
session with no memory of this one. Newest session first.

## Current state

**Milestones 0, 1 and 2 are done. Milestones 3 and 4 - the clouds and the
horizon - are built and unmeasured, and parts of Milestone 5 are in: share
codes, and the accessibility audit NFR-6 has always asked for.** The application runs, puts a computed sky on
the Windows desktop behind the icons on every screen, and the sky is the real
one: scattering for its colour, Meeus astronomy for the sun and moon, stars
turning at the sidereal rate, and a grade over the top.

- **Branch:** `main`
- **Remote:** `origin` is `github.com/BlackCanyonSoftware/dayandnight_BCS`,
  public. The owner pushes; commits wait locally until they do.
- **Tier:** MVP
- **Checks:** lint, format and typecheck clean; **168 unit and 45 browser
  tests**, all passing on 2026-11-12. `npm run build` was last run green on
  2026-11-06, including `check-bundle.js` with its nine legal documents, and
  `npm audit --audit-level=high` is clean (it was not before Electron 44.10.2).
  **CI has passed on every push since 2026-11-04**; before that it had never
  passed, for the reasons in the 2026-11-03 session entry.
- **The 12 desktop tests and `node tools/verify-package.js` pass**, run on
  2026-11-04 - the first time since 2026-10-24, and so the first time against
  the clouds, the horizon, Electron 44.10.2 and the two typefaces. The
  packaged build put a sky on the real desktop through the WorkerW host on two
  screens, which is the one thing only a packaged run can prove: koffi's
  native binary loading from outside the asar.
- **Everything is measured now.** The 2026-11-04 run is in
  `ARCHITECTURE.md` under Measurement, Milestones 3 and 4: 0.44 % of a core
  shipped, the clouds costing 0.05 of it, ADR 0007 standing. It took two
  attempts - the first found a bug in the harness rather than a number, and
  nothing from it is quoted anywhere.

- **NFR-1: met, with the clouds and the horizon in.** **0.44 % of one core**
  against a 2 % budget, two screens, editor closed, measured 2026-11-04. The
  clouds themselves cost 0.05 points, so frame-skipping survived the first
  thing in the product that moves. ADR 0007 stands. See `ARCHITECTURE.md`
  under Measurement, Milestones 3 and 4. GPU time and GPU memory are still
  unmeasured.
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

1. **Windows 11, 24H2 and later - PENDING, held by the owner.** This project has
   only ever run on Windows 10 (build 19045), which left mainstream support in
   October 2025, so most people who find it will be on 11. The host finds the
   desktop by sending Explorer the undocumented `0x052C` and looking for a
   top-level `WorkerW` with no `SHELLDLL_DefView` child - the classic recipe -
   and whether that still works on 24H2 is **unverified, not known to be
   broken**: a forum post reports the message doing nothing under Spy++, and
   Microsoft has listed wallpaper applications in a 24H2 compatibility hold, but
   nothing found confirms what the shell looks like now. The owner has a machine
   that can boot Windows 11 and will switch to it when ready.

   **When it is available, in this order:** `node tools/probe-host.js` first,
   which opens nothing and says whether the `WorkerW` is found. If it is, run
   `npm run test:desktop` and `node tools/verify-package.js`, which open windows
   and need asking first as always. If it is not, the lookup in
   `desktop/host-win32.js` - the only file allowed to call Win32 - needs a
   second path, written from what Spy++ shows rather than from memory. Until
   then the application falls back to drawing in front of the desktop rather
   than behind it, which is visibly worse and is announced in the editor. Also
   update the README's Requirements line, which says only that Windows 10 1903
   or later is needed.

2. **Real local wind, optional and later.** The wind is a simulation now and
   the interface is ready for something that knows the real one. `ROADMAP.md`,
   Milestone 3, lists what that would need: the host fetches on consent, a table
   of samples with an exact piecewise integral, a changed privacy notice, and a
   data source whose licence allows commercial use (Open-Meteo's free tier does
   not). Not started.
3. **The GPU, which has never been measured at all.** NFR-1 budgets 4 % and
   there is no way to check it. The cloud pass is a few hundred hashes a pixel
   where the sky used to be a table lookup, so this is the first time the
   question has had teeth.
4. **Verify by hand what only a person can:** a full-screen game pausing the
   wallpaper, and a system time-zone change with the application running. Lock,
   unlock, suspend and resume no longer need a person - the desktop tests
   deliver the real events and count the surface's render-loop ticks.
5. **The three-monitor criteria**, which need a third monitor: one continuous
   sky with no seam by screenshot, and NFR-1 re-measured with three active.
6. Then what is left of Milestone 4 - the user's own PNG as a horizon, which
   is the half of US-032 the computed library does not cover - and Milestone 5,
   which wants the guide, the FAQ and the first-run welcome. All three are
   writing rather than engineering.

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
  The four `[[ ]]` placeholders it left were filled on 2026-11-12 (publisher
  named without a legal form, by the owner's choice; Arizona law and Maricopa
  County courts; the support address; no mark registered). What is left is a
  lawyer's single pass over `EULA.md` and `DISCLAIMER.md`, which blocks a
  release and nothing before it.
- **Brand last checked: 2026-11-06, kit 1.56.1.** `app/brand/` (app set) and
  `docs/brand/` (readme set) are `brandkit bundle`s of `daynnight`, both
  reporting `matches daynnight`. The brand's design standard is **Material
  Design 3** and the editor is now built to it: see `docs/DESIGN.md`, Brand
  and Tokens. Two shipped font licences (SIL OFL 1.1, Jost and Public Sans).
  `app/brand/README.md` lists what to check after the next brand change.

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

### 2026-11-12 (last) - the wind

- **The owner's idea, taken in two halves.** "Use the real local wind" is a
  network feature with consent, a privacy-notice change and a licensing question,
  and is recorded, not built. "Failing that, simulate a wind that varies day to
  day in speed and direction" is built, because it needs no network, fits the
  invariants, and is the same interface real data would later fill.
- **`sky/wind.js`**: velocity and its exact integral. The integral is the point:
  clouds sit wherever the wind has carried them, which for a changing wind is an
  integral, and it has to be a pure function of the clock. A constant plus
  sinusoids integrates in closed form, so there is no history. **A unit test
  differentiates the position and compares it with the velocity**, which is what
  protects the algebra; at a 20-second step it was off by 0.001 km/h on the 17-
  minute gusts alone, which is the finite difference and not the model, so the
  step is two seconds.
- **`cloudWindFrom`**: `null` is the simulated weather, a number is a fixed
  compass bearing the wind blows from. In the panel as "Wind from", leftmost =
  Weather, like Facing. `cloudDrift` now means the _typical_ speed.
- **The layers veer** (20, 8, 0 degrees up, mirrored in the south). Judgement
  from how real winds turn with height, like the speeds, and a revert is three
  numbers.
- **Behavioural test for direction**: render the same sky three minutes apart,
  measure the sideways shift of the pattern. A wind from the east moved it 50 px
  rightward against a threshold of 8, from the west leftward, and along the view
  barely at all.
- **The wrap test** now fixes a wind from the east, because the simulated wind
  has no single instant at which the fastest layer wraps; the simulation is
  covered by the unit tests instead (bounded over a century, every axis).
- **Day-to-day behaviour of the simulation**, Denver, 3 to 16 November 2026:
  mostly westerly, with a calm south-easterly on the 8th, a north-westerly on
  the 9th and speeds from 1 to 25 km/h. The README animation uses the 9th and
  was not chosen for its wind.
- **Not done:** the real wind (above), and the animation's weight (7 MB).

### 2026-11-12 (later) - the owner looked at the animation

Four things, from looking at the README on GitHub - which also answers whether
it plays inline: it does.

- **Stars "like moons": a real bug, and a bigger one than the picture.** A
  star's size is set in pixels of the desktop, and everything that draws the
  sky smaller than the desktop it stands for passed `pixelRatio: 1`. The
  preview (1600 px for a 3840-px span), the gallery thumbnails (192 px) and
  my animation (400 px) all drew stars at the size they are on a full desktop:
  eight pixels for the brightest, which is wider than the moon on one 1080p
  screen. `ui/scale.js` now supplies the ratio and the preview and thumbnails
  use it; a unit test checks the arithmetic and another reads the source for a
  literal `pixelRatio: 1`, which is the only thing that fails if someone puts it
  back. **`pixelRatio` is used for nothing else in the engine**, which is why
  this was safe.
- **The brightest star was 3.2 times the faintest.** The bloom is 0.6 now (1.6
  times). 1.1 and 1.4 were tried and the brightest were still moons in a small
  picture, where one pixel is already half the moon's width - there is no
  correct star size in a 560-pixel picture of a 150-degree sky, only one that
  does not read as a moon.
- **A sprite under a pixel vanishes.** Correct angular scaling alone made the
  stars disappear from small pictures: a sprite narrower than a pixel can fall
  between pixel centres and not be drawn at all. A 1.3 px floor and a flatter
  falloff for small sprites fix it.
- **Pixelation: the stars were blocks, and my encoding turned them grey.** At
  400 px a 2.6-px star is a visible square, and 4:2:0 WebP drops a coloured
  one-pixel star's colour. The animation is drawn at 680 px per tile (1370 wide)
  for an 806-px slot, so it is crisp on high-DPI screens as well. 7 MB.
- **Two tests had to change, and why is written on them.** The sidereal test
  failed at 71 % after exactly one sidereal day, and the cause was not the
  rotation: auto-exposure moves a few per cent over four minutes of sun
  motion, and the small stars now sit right at the test's brightness
  threshold. A one-pixel tolerance and turning twinkle off were both tried and
  were not it; it now draws the stars at twice the scale so each has a core well
  over the threshold - the test is about where the stars are. And my own new
  test assumed area fell with the square of the scale, written in the same
  change as the floor that makes it false.
- **The city lights are a barcode** and are in the roadmap with a list of what
  would help. **The cloud motion** is in the roadmap and Next steps, as a
  decision between three looks.
- The animation uses the stars at ratio 1.7 and the looks' own brightness: it
  is a picture 680 pixels wide standing in for a 3840-pixel sky, and a star has
  to be a couple of pixels at the size a reader sees it or the field disappears.

### 2026-11-12 - the clouds were not life-like, and are now measured to be

- **Prompted by the owner, while building the README animation:** "the clouds
  need to be life-like throughout the day ... if your cloud motion isn't
  life-like that's another problem that should be fixed before doing these
  animations." It was.
- **Evolution was about five times too fast.** `EVOLUTION_SECONDS` was 1200 and
  its comment said the field became a different sky in twenty minutes. Measured
  with the wind off, the pattern lost half of what it shared with itself in
  **2.8 minutes** and was gone in eight. Now 3600: about 14 minutes for fine
  detail and 29 for large features, by the same measure. A browser test pins it
  and was checked to fail at the old value (63 % lost at four minutes against a
  limit of 45).
- **The wind ran the wrong way up.** Layer multipliers were 0.55 high to 1.9
  low, so the low layer crossed the sky about twenty times faster than the high
  one. Now 1.5, 1.0, 0.75. **That half is judgement, not measurement**, and
  `ARCHITECTURE.md` says so: the metric I first used for it - best-alignment
  correlation under the wind - cannot follow a plane through a wide projection
  and scores a frozen drifting field as lost, so its wind-on numbers are not
  quoted. Revert is two numbers in `LAYERS` if the look is not liked.
- **A test that passed by luck was found on the way.** "Clouds are lit from the
  side the sun is on" rendered one instant, whose result depends on which clouds
  happen to be in the frame. Over forty independent mornings the lit side is
  brighter by about 14 levels on average and on 31 to 34 mornings of 40 under
  both the old and the new engine - real, and with a spread as large as the
  effect, so one sky in five or six comes out the wrong way. The old test
  passed while its instant was a good one and failed when the corrected
  evolution moved it onto a bad one. It now averages sixteen mornings and still
  asserts the same thing, so the claim is not weakened, only measured on enough
  skies. The drift-wrap test hard-coded layer 2 as the fastest, which stopped
  being true; it uses the layer with the largest multiplier.
- **A stale claim fixed in the same paragraph:** `ARCHITECTURE.md` still said the
  clouds were "not yet measured end to end", three days after they were
  (0.05 points of a core). Redraws are now about three a second, not four, so
  the cost can only have fallen, but it has **not been re-measured**.
- **The README animation is built from the corrected engine**, and replaced the
  four still tiles: one day in four looks at once - a clear sky with the sun
  crossing, three cloudy ones, a city that lights up, stars wheeling - 236 frames
  at 15 fps, 16 seconds, 3.8 MB, `docs/screenshots/a-day.webp`. Daylight is four
  simulated minutes a frame and the night three times faster, eased across dusk
  and dawn. Four minutes is a step at which the same cloud is still recognisable
  frame to frame; at the old evolution rate it would have been flicker.
- **It was drawn at the panels' final size, by the engine directly.** The first
  two attempts went through the editor's preview and showed almost no stars: a
  one-pixel star shrunk 2.8 times by the preview's CSS is a smudge. Rendering
  each 400x225 panel with `DayNightEngine` shows a dense coloured star field,
  and took 31 seconds where the preview route took eleven minutes.
- **Two checks that misled me, so they are written down.** The loop seam
  looked like a hard cut (28 to 35 against a median of 5), but the median was
  dragged down by quiet night frames: a daytime step in a cloudy panel is
  already about that big, so the seam is an ordinary step and a cross-dissolve
  only added ghosting. And 8x-median "jumps" in the cloudy panels are a real
  cloud bank forming over a few minutes, continuous at one-minute steps, not a
  glitch.
- **Still true and worth knowing:** the overcast "Big weather" panel is almost
  black at night, which is accurate for an overcast sky and means that panel is
  quiet for a third of the loop. Cloud banks can still form quickly (a large
  mass covers 40 % of the view in about six minutes); that may deserve a look
  later, and it is not something this session measured against reality.

### 2026-11-12 - the repository's front door

- **The EULA's four blanks are filled**, from the owner's answers: the
  publisher is "Black Canyon Software" with no legal form and no personal name
  (the owner's choice, and the licence README says it is worth raising with a
  lawyer); Arizona law, state and federal courts in Maricopa County; the support
  address is the one every commit already carries, now also in the EULA, the
  privacy notice and the source licence; no mark is registered, so
  `TRADEMARKS.md` says so. Nothing in the code or the tests reads the
  placeholders, which was checked.
- **The GitHub description and ten topics are set**, from the command line.
  **Still to do by hand, and it can only be done by hand:** upload
  `app/brand/social/og-dark.png` as the social preview (Settings, General,
  Social preview). GitHub has no API for it. The dark cut, because the light one
  is almost the colour of a white link card.
- The README shows the product now - four looks across one day, and the editor.
  Windows 11 is recorded as pending and held, in Next steps item 1.

### 2026-11-06 - the editor built to Material Design 3

- **The brand now carries a design standard**, one per brand, and
  `daynnight`'s is Material Design 3. A standard owns shape, spacing, the type
  scale, elevation, motion, layout and how a control behaves; the brand keeps
  its colours, mark and display face. Kit **1.56.1** (the rollout named 1.56.0;
  the patch between was the library's own CI reproducibility and nothing about
  this brand's design).
- **This project had been holding the opposite arrangement.** Its tokens were
  imported into a CSS layer _underneath_ the kit's so that its own radii,
  spacing and shadows won. That was right when the kit's values were a house
  default; it is backwards once they are a published standard. The layers are
  gone, `app/tokens.css` is colours only, and nothing in this project names a
  radius, a step, a size, a shadow or a duration any more.
- **What moved, visibly:** corners 4/8/12 to Material's 8/12/16 with 4 for
  fields and 28 for dialogs; buttons from 26px rectangles to 40px pills at
  medium weight; fields from 28px to 56px outlined, focus thickening the
  outline rather than adding a glow; state from a background swap and a
  brightness filter to an 8%/10% wash of the content colour; the gallery's
  selected tile from an inset ring to a filled container; the type scale from
  five steps of this project's own to the standard's, which collapsed the two
  smallest; the sidebar from 360px to the standard's 280px drawer.
- **Two pre-existing bugs fell out of it.** `.readerhead h2` asked for
  `--text-md` and a gallery tile for `--r-1`, neither of which this project
  has ever defined, so both declarations were invalid and had been since they
  were written. And the colour table in `DESIGN.md` still named the
  `--ink-faint` value that failed WCAG in October.
- **The focus test was weaker than it read.** It compared outline width,
  colour, shadow and border before and after focus - but an unfocused element
  computes `outline-width` as the UA default of 3px with `outline-style: none`,
  so Material's 3px ring looked like no ring at all and the test failed. It
  passed before only because this project's ring happened to be 2px. It now
  compares `outline-style` too, which is the property that says whether an
  outline is drawn, and it is strictly harder to pass than before.
- **Native controls needed `color-scheme`.** Once the fields stopped painting
  their own fill, Chromium drew the date picker in its light scheme on a dark
  panel. Set per theme in `app/tokens.css`.
- Checked at 375, 768 and 1280 in both themes: nothing clipped, the drawer
  overlays below 900 as before, and the sidebar footer is stacked because at
  280px on the standard's scale the two lines no longer shared one.
- **The suite is slower.** The preview is 21% more pixels now the sidebar gave
  back 80, and every test renders it under a software rasteriser. One full run
  timed out on three tests while screenshot scripts were competing for the
  machine; a clean run passes all 44. Worth watching rather than acting on.

### 2026-11-04 - NFR-1 met with the clouds in, on the second attempt

- **0.44 % of one core** shipped - editor closed, two screens, 20 fps -
  against a 2 % budget. Windows 0.46, 0.28, 0.44, 0.21, 0.64: the whole band
  is inside the budget, not just the median. Verdict `usable`, no churn, no
  noise. `ARCHITECTURE.md`, Measurement, Milestones 3 and 4.
- **The clouds cost 0.05 points**, which is the whole reason this run
  mattered. They are the first thing in the product that moves, and
  frame-skipping is a bet that successive frames are identical; a sky that
  never repeats was the case that could have broken it. A full overcast
  against a clear sky is 2.46 against 2.41, inside the spread of either.
- **ADR 0007 stands**, and now says so with a dated re-check. The tool prints
  the verdict itself, which is why it was worth teaching it the question.
- 500 MB across 5 processes, roughly where it was. GPU time and GPU memory
  are still not measured at all; NFR-1's other two lines remain unverified
  rather than met, and that is now the only unmeasured thing left.
- **The figure replaced 0.15 % everywhere it was a current claim** - the
  README, the handoff, the changelog's user-facing entry, ADR 0007's
  arithmetic. The Milestone 1 sections keep theirs: they are what that
  measurement said at the time, and they are what separated the two savings
  that got here.

### 2026-11-04 - the measurement that measured the measurer

- **The deferred NFR-1 run happened, and is thrown away.** One window read
  **-29.88% of a core**. `measure-cost.js` summed `Get-Process`'s `CPU` - a
  per-process total since that process started - across every `electron`
  process and differenced the sums. A sum over a changing set cannot be
  differenced: a renderer exiting mid-window removed its entire lifetime from
  the total. 29.88% of 60 seconds is 17.9 processor-seconds, about what a
  renderer accrues in a few minutes, and the shipped row's process count fell
  from 6 to 5.
- **The silent half of the same bug is the dangerous one.** A process
  _starting_ mid-window adds its whole lifetime and the window reads far too
  high, with nothing to give it away. Any figure this tool has ever produced
  during a period of renderer churn was wrong in that direction and looked
  fine.
- Fixed by differencing **per pid** over the processes alive at both ends of a
  window, clamped at zero because Windows reuses pids. A window that gained or
  lost one is a lower bound, not a reading, so it is counted as `churn`,
  printed, and enough on its own to make the verdict UNRELIABLE - a different
  complaint from noise, and not answered by "close other applications".
- **No number from that run is recorded**, here or anywhere. The shipped
  scenario said 8.02% against a 2% budget and that ADR 0007 reopens; its
  process set changed mid-run, so it measured something other than a rate.
  The clear-versus-cloudy pair came through without churn and still cannot
  answer NFR-1: both keep the editor loaded.
- The sampler's PowerShell, its parsing and the difference were checked
  directly - a process removed and a process added each give 0 seconds and 1
  churn, never a negative.

### 2026-11-04 - two faces: named in Jost, read in Public Sans

- **The kit's 1.55.0 rebuild, taken.** `app/brand/` is 43 files now and
  `brandkit check` reports `matches daynnight`. The brand split its type: Jost
  is the display face - the wordmark, the headings - and **Public Sans** is
  what everything else is read in.
- **Most of this cost nothing to adopt.** `--font` already came from
  `brand/template/tokens.css`, so the body changed face the moment the bundle
  landed. What this project had to decide was where the display face goes, and
  the answer was two rules: `.sec > summary`, the panel's section headings, and
  `.readerhead h2`, the document reader's title.
- **A token that never existed.** `.readerhead h2` asked for `--text-md`, which
  this project has never defined, so the declaration was invalid and the dialog
  title had been inheriting body size since it was written. It is `--text-xl`
  now, which is what `DESIGN.md`'s own table says a dialog title is.
- **The test pins the mapping, not the tokens.** A heading computes to Jost, a
  label computes to Public Sans, and both `.woff` files reach `document.fonts`.
  Swapping the two faces would pass any check that only read the tokens, and
  would put a logo face in every sentence - which is the mistake the kit's
  BRAND.md explicitly warns about.
- **A second OFL licence.** Public Sans joins Jost in
  `licenses/third-party/` and in `check-bundle.js`'s required list, so a build
  that drops either fails. Both Jost and Public Sans licence texts were re-taken
  from the new bundle rather than assumed unchanged. Nine legal documents now.
- 112 KB of `.woff` in the installer, up from 61.
- **Checked on the real desktop afterwards.** The 12 desktop tests and
  `verify-package.js` both pass: the packaged application, carrying the new
  runtime and both faces, puts a sky behind the desktop icons on two screens.
  Nothing about the type reaches the wallpaper surface - it draws a canvas and
  no text - so this was about the runtime bump, and the runtime is fine.

### 2026-11-03 - CI's first real run, and the repository in public

- **CI had never passed.** The 2026-10-29 run did not start at all - GitHub
  blocked it for billing, which is what a three-second "failure" means. The
  2026-11-01 run was the first to execute, and it failed for real.
- **Two tests depended on the developer's timezone**, which nobody had
  declared. `fromDateInputValue` builds the day with `new Date(y, mo - 1, d)`,
  local midnight, which is right for the product; but a test that scrubs to
  minute 0 and expects night has fixed a zone whether it says so or not. On a
  UTC runner that instant is 18:00 the previous day in Denver, sun 26.26
  degrees up. The snapshot test was the same bug: a different instant, so 94%
  of the picture differed. `playwright.config.mjs` now pins
  `timezoneId: "America/Denver"`.
- **The snapshot was never Denver's sky.** This machine is America/Phoenix,
  which keeps no DST, so `sunrise-denver-june.png` held Denver's sky an hour
  out of step with Denver's clock. Regenerated under the pin; same 0.002 diff
  ratio, and the picture now matches the name.
- **A second CI failure was queued behind the first.** `npm audit
--audit-level=high` never ran, and would have failed: Electron 44.9.0 carries
  GHSA-jr5w-w6x2-84p9. Bumped to 44.10.2 within the existing `^44.9.0` range.
  The build is green on it, and the desktop tests passed against the new
  runtime the next day.
- **The repository is public and pinned now.** Four lines named a local
  filesystem with a Windows account in it, three of them written in the brand
  re-sync two days earlier. Gone from the working tree. They remain in two
  commits - the root commit and the re-sync - and clearing that means rewriting
  from the root and force-pushing something public and pinned: the owner's
  call, and arguably not worth it when every commit carries their name and
  email anyway.
- **The README has a banner** - a second `brandkit bundle`, `--set readme`, in
  `docs/brand/`, both cuts in a `<picture>` so the half of readers on a dark
  page see one too. Four claims in it had stopped being true: the milestone
  count, the known limitations, the number of ADRs, and a build carrying
  Electron's default icon.
- **The brand has moved again.** The kit is at **1.55.0** and now reads in a
  second face: `--font-display` stays Jost for the wordmark and headings,
  `--font` becomes **Public Sans** for body copy. `app/brand/` is a 1.49.0
  bundle and `brandkit check` reports the difference. Re-syncing changes the
  editor's body type, adds a second font file and a second OFL row, and wants
  our headings moved onto `--font-display` - its own piece of work.

### 2026-11-01 - the brand kit re-synced, and the editor set in Jost

- The kit was rebuilt at **1.49.0** and this brand's face changed. `app/brand/`
  is now a `brandkit bundle` of 41 files in the kit's own folder shape, written
  by `brandkit bundle` and reporting `matches daynnight`, replacing four SVGs
  that had been copied in by hand.
- **The typeface is the brand's now**, which reverses the design decision that
  the editor should use the system stack. The owner asked for it; `DESIGN.md`
  under Type records what it cost - 61 KB of `.woff`, and the first
  third-party licence in the product that is not MIT.
- **Neither the family nor the file is named in this project's CSS.**
  `app/styles.css` imports the kit's `template/fonts.css` and
  `template/tokens.css`; `app/tokens.css` no longer defines `--font` at all and
  keeps `--font-mono: var(--mono)` as an alias. This is what
  `app/brand/BRAND.md` asks for: the face a brand is set in is recorded in the
  brand definition, not in the application.
- **The kit's token sheet is imported into a CSS layer underneath ours**, so
  this project's measured radii, spacing and shadows win whatever the selector
  weight. That is not tidiness: the kit's dark block is
  `:root:not([data-theme="light"])`, which outweighs our plain `:root`, and
  without the layer it would have replaced the shadows silently.
- **Prettier reformatted fourteen files inside the bundle** the first time it
  saw them, and `brandkit check` immediately called it a forked brand.
  `app/brand/` is now in `.prettierignore`, in ESLint's `ignores` and in
  `jsconfig.json`'s `exclude`, for the same reason `app/vendor/` is.
- **The Windows icon is no longer copied.** `electron-builder.yml` points
  `win.icon` at `app/brand/icon/favicon.ico` directly and the two hand copies
  under `desktop/build/` are gone - a copy is a file that has to be remembered
  at every brand rebuild and looks identical when it has been forgotten. The
  build is green and the brand icon's bytes are in the packaged `.exe`.
- **The font is a licence now**, not just an asset. SIL OFL 1.1, text in
  `licenses/third-party/Jost.OFL.txt`, required by `check-bundle.js` so a
  build that drops it fails. `THIRD-PARTY-NOTICES.md` works through the two
  clauses that matter to a product sold under this EULA: it may be sold as part
  of a larger package but not by itself, and the notice must travel with the
  file.
- **Git was normalising two of the bundle's files.** `.gitattributes` sets
  `eol=lf` for the whole repository and the kit writes `BRAND.md` and
  `BUNDLE.json` with CRLF; `check` compares bytes, so a fresh clone would have
  reported a forked brand in a repository nobody had touched. `app/brand/**`
  is `-text` now, and `git checkout-index` into a scratch folder reports
  `matches daynnight`.
- One new browser test, which asserts the face arrives _from the kit_ - that
  `--font` contains Jost and that `jost.woff` actually loaded. A `@font-face`
  whose `src` 404s leaves the page in the fallback and reports nothing
  anywhere, which is exactly what a brand rebuild that renames a file would do.

### 2026-10-24 - the look gallery

- **Thumbnails** (`8efff44`), the last substantial piece of Milestone 5. A
  preset list is a column of words for things that are entirely visual.
- All eight are rendered at one low June sun rather than at the current moment.
  At the current moment they would all be the same near-black rectangle for
  half of every day, which is exactly when somebody is most likely to be
  choosing one. The hint says so, since a thumbnail that does not match the sky
  would otherwise look like a bug.
- A second engine, used once and released along with its WebGL context - a
  browser limits live contexts rather than memory, and the preview needs the
  one it holds. The scattering table is cached at module level, so the second
  engine pays for a texture upload rather than the 780 ms bake.
- A real radio group: one tab stop, arrows within it that wrap, and no Custom
  tile - Custom is what the panel says when you have edited a look, not
  something you can choose.

### 2026-10-24 - undo and redo

- **US-024** (`459369e`). A history of whole settings documents rather than
  diffs, because a diff history needs an inverse for every kind of change and
  the first missing inverse is a silent corruption. Undo applies a document
  through the editor's own load path, so there is one way to apply a state
  rather than two that can disagree.
- A slider drag folds into one step when the change is to the same single
  setting _and_ within the fold window. Both conditions are needed: time alone
  merges a drag with whatever came next, the key alone merges two deliberate
  edits made minutes apart.
- The theme and the wallpaper's on/off state are deliberately outside the
  history - a view preference and an action with an effect outside the
  application, neither of which is an edit.
- **The tests hid a bug.** `connect()` did not take the state as it found it as
  a baseline, so the first edit after opening the editor became the baseline
  and could not be undone - the first thing a user does being the one thing
  they cannot take back. The unit tests missed it because they called
  `record()` by hand after connecting, which the editor does not; the browser
  test caught it. The manual calls are gone and the first edit has its own
  test. Worth remembering: a fake that is more helpful than the real caller
  tests something other than the real caller.

### 2026-10-24 - share codes, and the accessibility audit that found something

- **Share codes** (`173d39c`), US-033. A look as a short string that carries
  the preset and deliberately nothing else - not the place, not the frame rate.
  A code that moved somebody's location would be the worst bug this product
  could have, so the test checks the decoded object's keys as well as its
  values. Decoded codes go through the settings validator rather than being
  trusted, because a code arrives from outside.
- Two bugs in the decoder, both about the prefix: punctuation was stripped
  after the prefix was looked for, so a code pasted as `"DAN1-abc."` kept its
  prefix in the body where it is itself valid base64url; and the prefix was
  assumed rather than tried, when base64url can produce those four letters
  followed by a dash. Both readings are attempted now.
- **NFR-6 failed and nothing had checked** (`16e2dc0`). The PRD has named WCAG
  2.2 AA since the beginning and only the keyboard half had ever been tested.
  `--ink-faint` measured 3.06:1 where AA asks for 4.5, and that token draws
  every hint marker, the footer and the product name - about forty pieces of
  text in each theme. It is 5.06 and 5.05 now, and there is a test, so dimming
  a token fails the suite rather than the standard.
- **An hour lost to a test artefact that looked like a serious bug.** The audit
  first reported the light theme buttons at 1.88:1. They are 5.9. The colour
  tokens are transitioned when the theme changes and `getComputedStyle` during
  a transition returns the interpolated value, so the measurement was reading
  the colour of the theme being left. Disabling transitions before measuring is
  now part of the test. Worth remembering as a shape: anything measured from
  computed style needs animation turned off first.

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
