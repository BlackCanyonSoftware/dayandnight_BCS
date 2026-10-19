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

### Known limitations

These are real and are tracked in `docs/ROADMAP.md`; none of them is presented
as finished.

- **The sky is a gradient, not a sky.** The scattering model and the colour
  grade arrive in Milestone 1, along with the sun, the moon and the stars.
- **The sun's position is approximate**, to roughly one or two degrees. It
  ignores the equation of time, so the time of day can be up to about a
  quarter of an hour out. Milestone 1 replaces the arithmetic and holds it to
  the half-degree the product promises.
- **It costs more than it should.** At 20 frames a second on two screens it
  uses about 8.5% of one CPU core against a budget of 2%, and about 570 MB.
  Measured, not estimated; see `docs/ARCHITECTURE.md`. This is the open
  question of Milestone 0 and is being decided before more is built on it.
