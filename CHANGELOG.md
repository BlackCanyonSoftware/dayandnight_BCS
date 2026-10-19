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

### Changed

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

### Known limitations

These are real and are tracked in `docs/ROADMAP.md`; none of them is presented
as finished.

- **The sky is a gradient, not a sky.** The scattering model and the colour
  grade arrive in Milestone 1, along with the sun, the moon and the stars.
- **It costs more than it should.** At 20 frames a second on two screens it
  used about 8.5% of one CPU core against a budget of 2%, and about 570 MB.
  Measured, not estimated; see `docs/ARCHITECTURE.md`. The application now
  skips frames that would look identical, which removes 99.7% of the
  redrawing over a day - but **the resulting CPU saving has not been measured
  yet**, so the budget is still formally unmet.
