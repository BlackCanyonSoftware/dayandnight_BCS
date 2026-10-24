# Changelog

Every change a user would notice. The format is
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The walking skeleton: an Electron application that puts a live, computed sky
  on the Windows desktop behind the icons, on every connected screen.
- **The wallpaper host.** A window per monitor, parented to Explorer's
  `WorkerW` so it draws behind the desktop icons, with a documented fallback
  mode that keeps the product visible if the technique ever fails.
- **One sky across every screen.** The scene is composed for the whole monitor
  span and each screen renders the slice it occupies, so the picture is
  continuous across a multi-monitor desktop.
- **The editor**: a settings panel with a hint on every control, a live
  preview, a place to set latitude and longitude, and a light/dark/system
  theme on a sun-moon toggle.
- **The 24-hour time scrubber**, which paints the day's actual shape into the
  track - night, the twilight bands and daylight, in the colours the sky will
  really be - with sunrise and sunset marked, plus a date picker, a fast
  forward that runs a day in about thirty seconds, and a live readout of local
  time, sun altitude and azimuth.
- **Pausing** when the session is locked, the machine suspends, an application
  is running full screen, or the computer is on battery.
- Settings are kept in the OS app-data folder and written atomically, and can
  be saved out as a file.

- **It remembers that it was on.** Close the settings window, restart the
  computer, and the sky comes back by itself instead of waiting to be switched
  on again. A settings file from before this existed counts as off, so nothing
  takes over a desktop unasked.
- **An About panel** with the version and the documents the build ships: the
  licence you agreed to, the disclaimers, what it does with your location, and
  whose work is in it. They are read from the application itself, so they work
  with no network and cannot change under you.
- **A tray icon**, so the application is reachable with no window open. It
  says what the wallpaper is doing, turns it on and off, opens this panel, and
  quits - which until now there was no way to do once you had closed the
  settings window.
- **Start with Windows.** Sign in and the sky is already there, without the
  settings window opening at every login. The checkbox asks Windows rather than
  remembering, so if you turn it off in Task Manager's Startup tab the box
  follows.
- **It stops when you are away.** After ten minutes with no keyboard or mouse -
  about when Windows turns most screens off anyway - the wallpaper stops
  drawing, and starts again the moment you come back. Adjustable, and the left
  end of the slider is never.
- **It says why it stopped.** A wallpaper that has paused now tells you whether
  that was the lock screen, a full-screen game, the battery, or you being away,
  instead of just saying "paused".
- **A Windows installer**, built with one command. It lets you choose where it
  goes rather than installing itself silently, and it carries the licence, the
  disclaimers, the privacy notice and the third-party notices next to the
  application.
- **The legal documents the product ships with**, in `licenses/`: what you may
  do with it, what it does with your location (nothing leaves your computer),
  and three things worth knowing before you leave a picture on a screen all
  day - image retention, that the sun and moon are decoration rather than an
  instrument, and that drawing behind your desktop icons relies on undocumented
  Windows behaviour that can stop working.

### Changed

- **The wallpaper now costs almost nothing to leave running.** It redraws only
  when the picture would actually differ, which for a sky is a few thousand
  times a day rather than nearly two million, and the result is 0.15 % of one
  CPU core across two screens - against a budget of 2 %, and against 8.5 %
  before the change. The frame rate did not have to be lowered to get there.
- **The sun is now in the right place.** The Milestone 0 approximation has been
  replaced with the standard Meeus algorithms, which agree with the published
  worked examples to better than a thousandth of a degree - against the half a
  degree the product promises. In practice: solar noon is now correct to the
  minute rather than up to a quarter of an hour out, because the equation of
  time is accounted for, and sunrise is correctly a little earlier than the
  geometry alone would give, because light bends through the atmosphere.
- **The moon is computed too**, including its distance, the fraction of it that
  is lit, and the angle its crescent sits at - which depends on where you are
  standing, not only on where the moon is. Nothing draws it yet.

- **Stars.** Four thousand of them, turning about the celestial pole at the
  real sidereal rate for wherever you are - so they rise in the east, tilt by
  your latitude, and are circumpolar if you live far enough north. They
  twinkle more near the horizon than overhead, because that is where the air
  is thickest. They are added to the sky as light rather than painted over it,
  so they appear through twilight and vanish at dawn on their own.
- **The sun and the moon.** Both at their true positions and true angular
  size - about half a degree, which is far smaller than most people remember,
  so there is a control to draw them larger. The sun takes its colour from the
  air it shines through, which is why it yellows and then reddens as it
  descends, and the moon reddens the same way when it rises. Both set behind
  the horizon rather than fading out.
- **The moon's real phase**, drawn as geometry rather than as a picture: the
  terminator is the edge of a sphere's shadow in projection, so a crescent
  bows one way and a gibbous moon the other, and the whole figure leans the
  way it actually leans from where you are standing. The same crescent sits
  upright in the tropics and on its side in Norway.
- **A night sky that is not black.** Airglow - the faint light the upper
  atmosphere gives off, plus the glow of stars too faint to resolve - so the
  hours either side of midnight read as a dark blue sky rather than a dead
  rectangle. The control doubles as a light-pollution dial.

- **The grade**, over a sky that is already physically right. **Haze** for how
  much dust the air holds, which whitens the sky, widens the sun's glare and
  is most of what makes a sunset deep red rather than merely warm. A **colour
  cast in three stops** - day, twilight and night - so you can warm a sunrise
  without touching the middle of the day. And **saturation** and **contrast**,
  adjusted in a perceptual space so that raising saturation does not drag the
  hues around.
  The default grade is exactly neutral, so a fresh preset shows the sky the
  physics drew and nothing else.

- **Setting where you are.** Day and Night now guesses on first run from your
  computer's time zone - which names a place, so it gives a latitude as well
  as a longitude - and you can search a hundred-odd cities by name or country,
  or type coordinates straight in. Drag the sliders somewhere and it tells you
  the nearest city, so the numbers mean something.
  Nothing here touches the network. The time zone is already on your machine,
  and your address is not the application&rsquo;s business.

- **Seven looks to start from**, each a complete appearance over the same
  physical sky: Clear, Hazy, Desert night, Edge of town, Cinematic, Quiet and
  Wide horizon. Where you are and how often it redraws are not part of a look,
  so switching never moves your sky or changes what it costs. Change any
  control and it says Custom.

### Known limitations

These are real and are tracked in `docs/ROADMAP.md`; none of them is presented
as finished.

- **The constellations are not real.** The stars are generated rather than
  catalogued: the sky turns exactly as it should, but you will not find Orion
  in it. A real catalogue is a later change and needs no new rendering.
- **The sun's disc is off-screen at sunrise and sunset.** The view is as wide
  as it can be without the sky turning into a fisheye dome, and the sun rises
  and sets a little outside it. The glow is there throughout; the disc comes
  into frame later in the morning. Turning the view west with Facing shows a
  sunset in full.
- **Moonlight does not light the sky**, and the moon is drawn dimmer than life
  so its phase stays readable against a dark sky.
- **The clock shows your time, not the chosen place&rsquo;s.** Pick a city in
  another country and the sky is right for it, but the time beside it is still
  yours.
- **The city list is short** - about a hundred, accurate to a tenth of a
  degree. If yours is missing, the coordinate boxes take anything.
- **Deep twilight is darker than it should be.** The scattering model runs out
  of lit atmosphere about eight degrees below the horizon, so the blue glow
  that lingers towards the sunset through nautical twilight is missing. The
  airglow floor keeps it from being black.
- **It costs more than it should.** At 20 frames a second on two screens it
  used about 8.5% of one CPU core against a budget of 2%, and about 570 MB.
  Measured, not estimated; see `docs/ARCHITECTURE.md`. The application now
  skips frames that would look identical, which removes 99.7% of the
  redrawing over a day - but **the resulting CPU saving has not been measured
  yet**, so the budget is still formally unmet.
