# Day and Night - product requirements

A live desktop wallpaper that is the sky outside, right now: the sun rises on
your screen when it rises where you are, crosses at the altitude it really
crosses, and sets when it really sets. Not a video of a sunrise. The sky itself,
computed.

> The product name and wordmark are not final. The application reserves the
> top-left brand slot and ships no mark there until the owner supplies one.

## 1. Problem and vision

A wallpaper that moves is either a short loop that repeats every thirty seconds
until you stop seeing it, or a video file large enough that nobody ships a long
one. Neither has any relationship to the day you are actually having. Walk away
at dawn, come back at dusk, and the wallpaper is wherever it was in its loop.

Day and Night has no loop and no video. The scene is a pure function of the
clock and your coordinates, so there is nothing to repeat: the sky at 06:12 on a
December morning in Denver has never been on screen before and will not be again
for a year. The thing that produces it is a few hundred kilobytes of shader and
preset, not a few gigabytes of frames.

The vision is that the wallpaper stops being decoration and becomes a window:
something you glance at to know roughly what time it is and what the light is
doing, the way you would glance out of an actual window.

## 2. Target users

| Who | What they want | What they will not tolerate |
|---|---|---|
| **The desktop tinkerer** (primary) | A wallpaper nobody else has, with enough knobs to make it theirs. Already runs Wallpaper Engine or Lively and has opinions about both. | Anything that costs frames in a game, or that they have to restart after the machine wakes. |
| **The quiet-desk professional** | Something calm and good-looking that is not a stock photograph, on three monitors, set up once and never thought about again. | Fiddly setup, a tray icon that nags, visible CPU use in Task Manager. |
| **The seasonal-light watcher** | The real thing: correct twilight, correct moon phase, the days visibly shortening in autumn. | A fake or stylised sky that does not match what is out of the window. |

Secondary, later: the preset author who wants to publish looks for other people,
and the laptop user who needs it to behave on battery.

## 3. Goals and non-goals

### Goals

- **G1 - Truthful.** Sun and moon position accurate to better than 0.5 degrees;
  twilight bands, seasonal change and polar behaviour all consequences of the
  same arithmetic, never special cases.
- **G2 - Continuous.** No perceptible step, kink or repeat anywhere in 24 hours,
  and nothing that depends on the application having been running since dawn.
- **G3 - Invisible in use.** Within the performance budget (NFR-1) around the
  clock, and fully stopped whenever the desktop is not being looked at.
- **G4 - Yours.** The look is authored in the application, not hard-coded, and a
  preset is a small file a user can keep, share and go back to.
- **G5 - Honest about where it is.** Location and time come from the machine or
  from the user, never from a service the user did not agree to.

### Non-goals

- **Not a video exporter.** Pixel Galaxy Studio already does that. A user who
  wants a file wants a different product.
- **Not a weather application.** Real-weather sync is a later maybe (US-031);
  the sky is astronomical, not meteorological, in v1.
- **Not a 3D scene.** No camera the user flies, no terrain, no parallax beyond
  layered sheets. It is a sky with things in front of it.
- **Not cross-platform in v1.** Windows 10 and 11 only. The engine is written so
  that macOS is a host swap rather than a rewrite, but no macOS work is in scope.
- **Not a login-bound service.** No accounts, no server, no telemetry.

## 4. User stories

Acceptance criteria are Given / When / Then. IDs are referenced from test names
and from `ROADMAP.md`.

### Epic A - the sky is the real sky

- **US-001 - Sun follows the real sun.**
  Given my location is set to Denver and the local time is 06:12 on 21 December,
  When the wallpaper renders,
  Then the sun sits below the horizon at the altitude a solar-position
  calculation gives for that instant, within 0.5 degrees, and the sky is in
  civil twilight.
- **US-002 - It keeps up without being watched.**
  Given the application has been running since midnight,
  When I look at the desktop at any point in the day,
  Then the sky matches the current instant, having accumulated no drift, and the
  same is true if the application was started one minute ago.
- **US-003 - Seasons and latitude are consequences, not settings.**
  Given the same preset,
  When I compare 21 June with 21 December at latitude 60 N,
  Then the summer day is visibly far longer, the winter sun never rises high,
  and at latitude 70 N in midsummer the sun does not set at all.
- **US-004 - The moon is the real moon.**
  Given tonight's actual moon phase is a waxing crescent 23 per cent lit,
  When the moon is above the horizon in the scene,
  Then it is drawn as a waxing crescent at that illumination, at its real
  altitude and azimuth, with the terminator oriented correctly for my latitude.
- **US-005 - Stars are where stars are.**
  Given it is astronomical night,
  When I watch the star field over an hour,
  Then it has rotated about the celestial pole by about 15 degrees, in the
  direction and about the axis my latitude implies.

### Epic B - setting it up

- **US-010 - Location without a tracker.**
  Given a fresh install,
  When I open the application,
  Then it offers a latitude and longitude already guessed from my system time
  zone, a searchable city picker, and manual entry; and it makes no network
  request unless I explicitly ask it to look my location up.
- **US-011 - It survives the clock changing.**
  Given the wallpaper is running,
  When daylight saving begins, I fly to another time zone, or the machine wakes
  after six hours idle,
  Then the sky is correct for the new local time within one render frame, with
  no restart and no visible jump beyond the real change in the sun's position.
- **US-012 - One sky across every screen.**
  Given three monitors arranged in a row in Windows,
  When the wallpaper is running,
  Then the sky is one continuous scene across all three, the sun occupies its
  true azimuth within that span and so crosses from the left monitor to the
  right over the day, and each screen's slice is correct for its own resolution
  and scaling.
- **US-013 - It gets out of the way.**
  Given a game is running full screen, or the session is locked, or the display
  has powered down,
  When I check the application's cost,
  Then it is rendering nothing and using no measurable GPU, and it resumes
  within two seconds of the desktop being visible again.

### Epic C - making it yours

- **US-020 - Author across time, not in real time.**
  Given I am editing a preset,
  When I drag the time scrubber or pick a date,
  Then the preview shows that exact instant immediately, and a fast-forward
  control plays a whole day in about thirty seconds so I can judge the
  transitions without waiting for them.
- **US-021 - Change the look, keep the truth.**
  Given the physical sky model,
  When I adjust haze, exposure, or the colour grade,
  Then the sky changes as I asked while sunrise still happens at sunrise, and
  no setting can put the sun in the wrong place.
- **US-022 - Presets are files.**
  Given a preset I like,
  When I save it,
  Then I get a small file I can keep, send to someone, and load back to exactly
  the same look on another machine.
- **US-023 - Every control explains itself.**
  Given any control in the settings panel,
  When I hover or focus its `i`,
  Then I get a sentence on what it does and why I would touch it, and the panel
  carries no loose explanatory text.
- **US-024 - Undo covers everything.**
  Given any change I have made, including a slider drag,
  When I press Ctrl+Z,
  Then the change is undone as one step, and Ctrl+Y puts it back.

### Later stories (not v1)

- **US-030 - Clouds.** Lit, drifting, parallax cloud layers shaded by the real
  sun direction.
- **US-031 - Weather.** Haze, fog, rain and snow, optionally following the real
  local forecast with the user's consent.
- **US-032 - Horizon.** A silhouette layer: a bundled skyline or mountain
  library, or the user's own PNG.
- **US-033 - Share codes.** A look as a short string, as in Pixel Galaxy Studio.
- **US-034 - HDR.** scRGB output on Windows 11 HDR displays.

## 5. Scope (MoSCoW)

**Must** - solar and lunar position; physical sky with grade; sun, moon and star
rendering; one spanning scene across monitors; the WorkerW wallpaper host; the
pause policy; the editor shell with the time scrubber; location setup; presets
as files; settings persistence.

**Should** - the city picker; light and dark editor themes; undo and redo; the
guide; first-run welcome; a preset library with thumbnails.

**Could** - clouds (US-030); horizon silhouettes (US-032); share codes
(US-033); per-monitor overrides.

**Will not, this version** - weather (US-031); HDR (US-034); macOS and Linux;
accounts or any server; video export; audio reactivity.

## 6. Non-functional requirements

- **NFR-1 - Performance budget.** Measured on a mid-range 2020 desktop
  (4-core CPU, GTX 1650-class GPU) at 2560x1440, default preset, 20 fps:
  under 2 per cent of one CPU core, under 4 per cent GPU, under 80 MB GPU
  memory per screen, and no measurable effect on a game's frame rate once
  paused. A number in this budget that cannot be met is a defect, not a tuning
  opportunity.
- **NFR-2 - Idle correctness.** Running for 30 days without a restart changes
  nothing about correctness or memory use. No leak, no drift, no accumulation.
- **NFR-3 - Visual continuity.** No visible banding on an 8-bit or 10-bit panel,
  no step at a keyframe or model boundary, no seam between monitors.
- **NFR-4 - Start cost.** Wallpaper rendering on screen within 3 seconds of
  login; the editor window interactive within 2 seconds of being opened.
- **NFR-5 - Privacy.** No network request without an explicit user action.
  Location, when entered, stays in the local settings file. No telemetry.
- **NFR-6 - Accessibility.** The editor meets WCAG 2.2 AA: keyboard operable
  throughout, visible focus, 4.5:1 text contrast, `prefers-reduced-motion`
  honoured in the editor chrome. The wallpaper itself is decorative and exempt,
  but a "reduce motion" preset setting damps every animation rate.
- **NFR-7 - Offline.** Every feature except the optional location lookup works
  with no network, forever.

## 7. Success metrics

- A user leaves it on for more than two weeks without switching back. This is
  the real test; it is measured by asking, because there is no telemetry.
- Sun position agrees with published ephemeris tables to within 0.5 degrees at
  ten sampled instants across a year and five latitudes. This is a test, not a
  survey.
- The performance budget in NFR-1 holds, measured and written down.
- A new developer can clone the repository and ship a small change using only
  `README.md` and `AGENTS.md`.

## 8. Assumptions

- Windows 10 1903 or later, which is where the WorkerW technique is reliable.
- A GPU with working WebGL2. Hardware without it gets a clear message, not a
  software-rendered slideshow.
- The user's system clock and time zone are roughly right. The application does
  not try to correct them, but it reads the time zone rather than assuming UTC.
- Desktop icons are usually present, so a default preset keeps enough contrast
  behind them to leave label text readable.
- The user is the only person at the machine; there is no multi-user state.

## 9. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **Electron is too heavy to run all day.** | Fatal to G3. | The budget in NFR-1 is measured at Milestone 0, before any art exists. The pause policy is load-bearing, not polish. If the budget fails with pausing in place, the host swaps to native, which ADR 0002 keeps possible. |
| **The WorkerW technique breaks in a Windows update.** | The wallpaper stops appearing. | Host detection is isolated in one module with a documented fallback to a bottom-most desktop-level window. A Windows update is then a bug to fix, not a redesign. |
| **A physical sky model gives too few knobs to feel customizable.** | Undermines G4. | The grade layer is specified alongside the model, not after it, and the first preset pass happens in Milestone 1 while the model can still change. |
| **Multi-monitor layouts are endlessly varied** (mixed DPI, rotation, vertical stacks, gaps). | Visible seams, wrong scale. | Reuse Pixel Galaxy Studio's layout arithmetic, which has been through this. Test the four nastiest arrangements explicitly. |
| **Native FFI adds a fragile dependency.** | Build and packaging pain. | Only a handful of Win32 calls are needed, behind one module, with a documented hand-written alternative (ADR 0002). |
| **Scope creep into a weather and terrain simulator.** | It never ships. | The non-goals above are enforced in review. Clouds, weather and horizon are separately numbered milestones after the core ships. |

## 10. Open questions

- **OQ-1** Does the owner want a tray icon and autostart in v1, or is launching
  the editor the only entry point? Recommendation: tray icon plus autostart,
  since a wallpaper nobody has to start is the whole point. Deferred to
  Milestone 2.
- **OQ-2** How large a bundled city list is worth the megabytes: 1,000 cities
  over 100k population, or 25,000 over 15k? Recommendation: start at 1,000 and
  find out whether anyone misses theirs.
- **OQ-3** Should the editor's own light and dark themes follow the Windows
  theme by default, or the sun altitude it is already computing? The second is a
  better joke and a worse default. Recommendation: follow Windows, offer the
  other.
- **OQ-4** Licensing and distribution: the same EULA and installer shape as
  Pixel Galaxy Studio, or different? Needed before Milestone 2.

## 11. Glossary

One term per concept; these are the words used in code, tests and docs.

| Term | Meaning in this project |
|---|---|
| **Altitude** | The sun's or moon's angle above the horizon, in degrees; negative below. The master parameter for the whole scene. |
| **Azimuth** | Compass bearing of the sun or moon, in degrees clockwise from north. |
| **Civil / nautical / astronomical twilight** | Sun altitude between 0 and -6, -6 and -12, and -12 and -18 degrees. |
| **Grade** | The user-authored colour transform applied on top of the physical sky. |
| **Host** | Whatever puts a rendering surface on the desktop. On Windows, a window parented to WorkerW. |
| **Preset** | A complete authored look, as a file. |
| **Scene** | Everything drawn for one instant: sky, bodies, stars, and later clouds and horizon. |
| **Span** | The bounding rectangle of every enabled monitor, in virtual-desktop pixels. The scene is composed for it. |
| **WorkerW** | The Windows Explorer window that sits behind the desktop icons and in front of the wallpaper. |
