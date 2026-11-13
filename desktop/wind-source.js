// @ts-check
"use strict";

/**
 * A real wind, from MET Norway's Locationforecast 2.0 - the parts of fetching
 * it that are not the fetching.
 *
 * **Nothing here touches the network, and nothing calls it yet.** What is here is
 * the request that would be made, the reading of what comes back, and the rules
 * for when to ask again, all of it pure and tested against a response shaped
 * like the documented one. Turning it on is the owner's decision, because it
 * ends the sentence "nothing leaves your computer" - see `docs/ROADMAP.md`,
 * Milestone 3, for what that needs: consent, a privacy notice that says so,
 * and an ADR.
 *
 * ## Why this source
 *
 * Checked against MET Norway's own pages on 2026-11-13, not remembered:
 *
 * - **Free for commercial use**, "including paid-for apps", under CC BY 4.0,
 *   with attribution (`ATTRIBUTION`).
 * - **Global**, by way of ECMWF outside the Nordic region.
 * - **Wind speed and direction**, hourly and then six-hourly to ten days.
 * - **Only at ten metres.** There is no upper-air wind, so the cloud layers'
 *   winds are estimated from the surface one: see `SURFACE_TO_CLOUD_LEVEL`.
 *
 * Its rules, which this follows and which are not suggestions: an identifying
 * User-Agent with a way to contact us (generic ones are blocked, and a fake one
 * is treated as abuse); coordinates truncated to at most four decimals; never
 * repeat a request before the `Expires` time; cache; and spread requests out
 * rather than all landing on the hour.
 *
 * **Privacy, which is the real cost.** Called directly, MET Norway sees the
 * user's IP address and the coordinates, and their own FAQ calls that personal
 * data and "always" recommends a proxy. Coordinates here are truncated to a
 * tenth of a degree, about eleven kilometres, which is as much as a wind field
 * needs and far less than the four decimals they allow. The IP address is the
 * part that only a proxy of our own would hide, and running one is a decision
 * and a bill.
 *
 * @module desktop/wind-source
 */

const ENDPOINT = "https://api.met.no/weatherapi/locationforecast/2.0/compact";

/** Who is asking, with a way to reach us, as the terms require. */
const CONTACT = "developer@blackcanyonsoftware.com";

/**
 * The credit CC BY 4.0 asks for: who, which licence, a link to it, and that the
 * data has been changed. It has to be easy to find, and the About panel is
 * where it would go.
 */
const ATTRIBUTION =
  "Weather data from MET Norway, licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). " +
  "Changed: reduced to a wind estimate for the clouds.";

/**
 * How much stronger the wind is at the middle cloud layer than at ten metres.
 *
 * The wind strengthens quickly with height as the surface's friction lets go;
 * the middle layer is at 2.6 kilometres, and the ratio there is commonly two
 * to three. 2.5 is a judgement, not a measurement, and it sets how fast the
 * clouds move on a real day. The three layers then multiply it as they always
 * have (`LAYERS` in `engine/sky/clouds.js`).
 */
const SURFACE_TO_CLOUD_LEVEL = 2.5;

/** Kilometres an hour in a metre a second. */
const KMH_PER_MS = 3.6;

/** Coordinates are truncated to this many decimals before they leave. */
const COORDINATE_DECIMALS = 1;

/** Never ask more often than this, whatever the server says. */
const MIN_INTERVAL_MS = 30 * 60_000;

/** How long to wait if the server did not say. */
const DEFAULT_INTERVAL_MS = 60 * 60_000;

/** Added at random, so that every copy of the product does not ask on the hour. */
const JITTER_MS = 10 * 60_000;

/**
 * Truncate toward zero, not round: the terms say truncate, and a rounded value
 * can sit up to half a step further from the true one.
 *
 * @param {number} value degrees
 * @param {number} [decimals]
 * @returns {number}
 */
function truncate(value, decimals = COORDINATE_DECIMALS) {
  const f = 10 ** decimals;
  return Math.trunc(value * f) / f;
}

/**
 * The request for a place.
 *
 * @param {{ lat: number, lon: number }} place
 * @param {string} version the application's version, for the User-Agent
 * @returns {{ url: string, headers: Record<string, string> }}
 */
function requestFor(place, version) {
  const lat = truncate(place.lat).toFixed(COORDINATE_DECIMALS);
  const lon = truncate(place.lon).toFixed(COORDINATE_DECIMALS);

  return {
    url: `${ENDPOINT}?lat=${lat}&lon=${lon}`,
    headers: { "User-Agent": `DayAndNight/${version} ${CONTACT}` }
  };
}

/**
 * Read a forecast into samples of the wind at the cloud layers' level.
 *
 * Tolerant of what is missing and strict about what is wrong: a time step
 * without a wind is skipped, because forecasts have gaps; one whose numbers are
 * not numbers is skipped too, rather than being given a made-up wind. Steps are
 * kept strictly increasing in time, which is what `makeWindSeries` insists on.
 *
 * @param {unknown} json the parsed response body
 * @param {number} [factor] surface to cloud level, see SURFACE_TO_CLOUD_LEVEL
 * @returns {{ t: number, east: number, north: number }[]}
 */
function parseSamples(json, factor = SURFACE_TO_CLOUD_LEVEL) {
  /** @type {{ t: number, east: number, north: number }[]} */
  const samples = [];

  const steps = /** @type {any} */ (json)?.properties?.timeseries;
  if (!Array.isArray(steps)) return samples;

  for (const step of steps) {
    const t = Date.parse(step?.time);
    const details = step?.data?.instant?.details;
    const speed = details?.wind_speed;
    const from = details?.wind_from_direction;

    if (!Number.isFinite(t) || !Number.isFinite(speed) || !Number.isFinite(from)) continue;
    if (samples.length > 0 && !(t > samples[samples.length - 1].t)) continue;

    // FROM a bearing is TOWARD the opposite one.
    const toward = ((from + 180) * Math.PI) / 180;
    const kmh = speed * KMH_PER_MS * factor;

    samples.push({ t, east: kmh * Math.sin(toward), north: kmh * Math.cos(toward) });
  }

  return samples;
}

/**
 * When to ask again: not before the server's `Expires`, never sooner than the
 * minimum interval, and a little later at random.
 *
 * @param {any} headers a fetch `Headers` (which has `.get`), a `Map`, or a plain
 *   object keyed `expires` or `Expires`; anything else means "not stated"
 * @param {number} now milliseconds since the epoch
 * @param {() => number} [random] in [0, 1), injectable so that tests are exact
 * @returns {number} milliseconds since the epoch
 */
function nextFetchAt(headers, now, random = Math.random) {
  const raw = headerValue(headers, "expires");
  const expires = typeof raw === "string" ? Date.parse(raw) : Number.NaN;

  const wanted = Number.isFinite(expires) ? expires : now + DEFAULT_INTERVAL_MS;
  const earliest = Math.max(wanted, now + MIN_INTERVAL_MS);

  return earliest + Math.floor(random() * JITTER_MS);
}

/**
 * One header, from whichever shape of headers a fetch implementation hands back.
 *
 * @param {any} headers
 * @param {string} name lower case
 * @returns {unknown}
 */
function headerValue(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === "function") return headers.get(name);

  const capitalised = name.charAt(0).toUpperCase() + name.slice(1);
  return headers[name] ?? headers[capitalised];
}

module.exports = {
  ATTRIBUTION,
  CONTACT,
  COORDINATE_DECIMALS,
  DEFAULT_INTERVAL_MS,
  ENDPOINT,
  MIN_INTERVAL_MS,
  SURFACE_TO_CLOUD_LEVEL,
  nextFetchAt,
  parseSamples,
  requestFor,
  truncate
};
