# ADR 0008 - The real wind, opt-in, from MET Norway

- **Status:** accepted
- **Date:** 2026-11-13
- **Deciders:** owner ("Yes, proceed", after the groundwork and its open
  decisions were laid out)

## Context

The clouds move with a wind. Until now it was a simulation: believable, varied
from day to day, and the same on every screen, but not the wind outside. The
owner asked for the real local wind if it can be had, with the simulation as the
fallback.

That is the first time the product has a reason to leave the machine, and its
privacy position until now was "nothing leaves your computer" (NFR-5, the
privacy notice, the EULA). Three things had to be decided together: where the
data comes from, how consent works, and what the engine does with a table of
samples instead of a formula.

## Decision

1. **Source: MET Norway Locationforecast 2.0.** Checked on its own pages on
   2026-11-13: free including for commercial and paid-for apps, CC BY 4.0 with
   attribution, global, hourly to ten days. It requires an identifying
   User-Agent with a contact, coordinates of at most four decimals, no request
   before `Expires`, caching and spread-out requests, and the adapter follows
   all of it (`desktop/wind-source.js`).
2. **Opt-in, off by default, one checkbox.** "Use the real wind", saved with the
   settings and nowhere else: not in the preset, so a share code cannot carry it;
   not in the undo history, so Ctrl+Z cannot toggle it; and not applied from a
   settings file that is merely opened, so a file somebody sent cannot turn it
   on. It is read from the user's own settings file at start-up and from a click.
   The main process accepts only the boolean `true`.
3. **Only what is needed leaves.** Coordinates truncated to 0.1 degree (about
   11 km, finer than a wind field), the application's name and version, and our
   contact address. The IP address is inherent to any request.
4. **No proxy of our own, for now.** MET Norway's FAQ recommends one for
   privacy. Running a server is a standing cost and a thing to keep alive, and
   everything a proxy would add (hiding the IP address) is stated plainly in the
   privacy notice instead. This is the decision most worth revisiting if the
   product grows.
5. **The host fetches, the engine never does** (invariant 2). A feed in the
   main process (`desktop/wind-feed.js`) asks, and every surface and the editor
   are handed the same table over IPC, which is data distribution and not the
   windows talking to each other (invariant 3). Fetching happens only while the
   editor is open or the wallpaper is on.
6. **The engine takes a table.** `makeWindSeries` over piecewise-linear
   velocity gives an exact piecewise-quadratic position, a pure function of the
   clock. Outside the data the simulation's increments carry on, so a stale or
   missing table degrades to the weather. A new forecast starts at the current
   hour, so it is positioned to agree with the one before it at the moment it
   arrives (`continueSeries`); without that every cloud would jump once an
   hour.
7. **A fixed "Wind from" direction wins.** The owner said where it blows from.

## Consequences

- The privacy notice, EULA section 7, PRD NFR-5 and NFR-7, the settings hint,
  and the third-party notices all change, in the same commit, and the credit
  CC BY 4.0 asks for is shown in the panel whenever the data is in use.
- The data is the **ten-metre** wind. The wind at the clouds is estimated at 2.5
  times that (`SURFACE_TO_CLOUD_LEVEL`): a judgement, not a measurement, and it
  sets how fast real clouds move. It is one number.
- A failure is quiet and slow: backoff from fifteen minutes, an hour for a 403 or
  429, one request a minute at most, one at a time.
- After an application restart the clouds start from the first forecast's own
  origin, so they are in a different place than before the restart. Nobody can
  see a restart, and the alternative is persisting a position.
- It is the only thing in the application that uses the internet, which the
  hint says.

## Addendum, 2026-11-17: the same consent now covers the weather

The control became **Use the real weather**. The forecast response that carries
the wind also carries cloud cover, rain or snow and a fog symbol, so following
those costs no new request and sends nothing more: the privacy notice, EULA,
notices, hint and credit were reworded in the same commit, and the notice says so
in a sentence. While a forecast covers the moment, `cloudCover`, `fog`,
`precipitation` and `precipitationKind` come from it (`engine/sky/conditions.js`)
and their controls are dimmed; the rest of the look is the user's. A fixed Wind
from direction still wins over the real wind.

The settings key is still `realWind`: renaming it would be a settings migration
for no change of meaning to the file, and a name that is a little out of date
costs less than a version step. Recorded here so it is not a surprise.

## Alternatives rejected

- **Open-Meteo.** Its free tier is for non-commercial use; this product is
  proprietary. Price and pressure-level coverage under a paid plan were not
  verified.
- **A proxy of our own.** Above. Revisit with usage.
- **Simulation only.** Safe, and what it was. The owner wanted the real thing
  if it could be had, and now it can, without taking away the safe default.
- **On by default.** Rejected outright: a product whose claim was that nothing
  leaves the machine does not start sending a location because of an update.
