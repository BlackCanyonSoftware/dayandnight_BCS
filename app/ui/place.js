// @ts-check
/**
 * Where the user is.
 *
 * Three ways in, in the order most people will want them (US-010):
 *
 * 1. **A guess from the time zone**, offered on first run. Costs nothing and
 *    needs no permission, because the computer already knows its zone.
 * 2. **A city**, typed and matched against the bundled list.
 * 3. **The numbers**, for anyone who wants their own garden rather than the
 *    middle of their city.
 *
 * And a deliberate absence: **nothing here touches the network**. That is
 * NFR-5, and it is the reason the guess is built on a time zone rather than
 * on an IP lookup - the zone is already on the machine, and an address is
 * not the application's business.
 *
 * @module ui/place
 */

import { CITIES, cityForTimeZone, searchCities } from "./cities.js";

/** @typedef {import("./cities.js").City} City */
/** @typedef {import("../engine/types.js").Place} Place */

/**
 * The time zone this computer is in, or an empty string if it will not say.
 * @returns {string}
 */
export function currentTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "";
  }
}

/**
 * @typedef {object} Guess
 * @property {Place} place
 * @property {string} description what to tell the user it was based on
 * @property {City | null} city
 */

/**
 * Guess where this computer is.
 *
 * Returns null rather than guessing badly. A wrong guess is worse than none,
 * because a user has to notice it before they can correct it - and a sky that
 * is merely plausible for the wrong city looks right until someone checks it
 * against a window.
 *
 * @param {string} [timeZone]
 * @returns {Guess | null}
 */
export function guessPlace(timeZone) {
  const zone = timeZone ?? currentTimeZone();
  const city = cityForTimeZone(zone);
  if (!city) return null;

  return {
    place: { lat: city.lat, lon: city.lon },
    description: `${city.name}, from your time zone (${zone})`,
    city
  };
}

/**
 * The cities matching what has been typed.
 *
 * @param {string} query
 * @returns {City[]}
 */
export function suggest(query) {
  return searchCities(query);
}

/**
 * The city a typed string refers to, if it unambiguously refers to one.
 *
 * Accepts both what the user typed and what the suggestion list shows, since
 * a datalist fills the field with its own label.
 *
 * @param {string} value
 * @returns {City | null}
 */
export function resolveCity(value) {
  const text = value.trim();
  if (text.length === 0) return null;

  // "Denver, United States" as the list writes it.
  const [namePart] = text.split(",");
  const matches = searchCities(namePart ?? text, 2);
  if (matches.length === 0) return null;

  // Only when it is unambiguous: two equally good matches means the user has
  // not finished choosing, and silently picking one would move their sky.
  const first = matches[0];
  if (first && first.name.toLowerCase() === (namePart ?? "").trim().toLowerCase()) return first;

  return matches.length === 1 ? (first ?? null) : null;
}

/**
 * How a city is written in the picker.
 * @param {City} city
 * @returns {string}
 */
export function labelFor(city) {
  return `${city.name}, ${city.country}`;
}

/**
 * The city nearest a pair of coordinates, if one is close enough to be worth
 * naming.
 *
 * Used to label a place the user arrived at by dragging the sliders: "near
 * Denver" is more use than two numbers. The limit is about 150 km, beyond
 * which "near" would be a stretch.
 *
 * @param {Place} place
 * @returns {City | null}
 */
export function nearestCity(place) {
  /** @type {City | null} */
  let best = null;
  let bestDistance = Infinity;

  for (const city of CITIES) {
    const distance = greatCircleKm(place, { lat: city.lat, lon: city.lon });
    if (distance < bestDistance) {
      bestDistance = distance;
      best = city;
    }
  }

  return bestDistance <= 150 ? best : null;
}

/**
 * Distance between two points on the Earth, in kilometres.
 *
 * The haversine formula, which stays accurate for short distances where the
 * obvious spherical cosine rule loses precision.
 *
 * @param {Place} a
 * @param {Place} b
 * @returns {number}
 */
export function greatCircleKm(a, b) {
  const R = 6371;
  const d = Math.PI / 180;

  const dLat = (b.lat - a.lat) * d;
  const dLon = (b.lon - a.lon) * d;

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(a.lat * d) * Math.cos(b.lat * d) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
