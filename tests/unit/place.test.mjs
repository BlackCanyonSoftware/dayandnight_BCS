import test from "node:test";
import assert from "node:assert/strict";

import { CITIES, cityForTimeZone, searchCities } from "../../app/ui/cities.js";
import {
  greatCircleKm,
  guessPlace,
  labelFor,
  nearestCity,
  resolveCity
} from "../../app/ui/place.js";
import { sunPosition } from "../../app/engine/astro/solar.js";

/**
 * The city list is typed-in data, so most of what is worth checking is that it
 * is *internally* consistent and that nothing in it is wildly wrong - a
 * latitude and longitude swapped, a sign dropped, a zone that does not match
 * the hemisphere. A gazetteer would make these checks unnecessary and is on
 * the roadmap; until then they are what stands between a typo and a sky for
 * the wrong continent.
 */

test("every city is somewhere on Earth, with a plausible time zone", () => {
  for (const city of CITIES) {
    assert.ok(city.name.length > 0, "a city needs a name");
    assert.ok(city.country.length > 0, `${city.name} needs a country`);

    assert.ok(city.lat >= -90 && city.lat <= 90, `${city.name} latitude ${city.lat}`);
    assert.ok(city.lon >= -180 && city.lon <= 180, `${city.name} longitude ${city.lon}`);

    // An IANA zone is Region/City, which is also what the guess relies on.
    assert.match(city.zone, /^[A-Za-z_]+\/[A-Za-z_\-+0-9/]+$/, `${city.name} zone ${city.zone}`);
  }
});

test("no two cities share a name", () => {
  const seen = new Set();
  for (const city of CITIES) {
    const key = `${city.name}|${city.country}`;
    assert.ok(!seen.has(key), `${key} appears twice`);
    seen.add(key);
  }
});

test("longitude agrees with the time zone, to within a zone's width", () => {
  // The sharpest check available on typed-in coordinates, and it catches the
  // mistakes that matter: a dropped minus sign, or latitude and longitude
  // swapped. Solar noon at a city must land near the middle of its own
  // working day - if the longitude were wrong by a sign, it would be twelve
  // hours out.
  const problems = [];

  for (const city of CITIES) {
    // What the zone thinks the offset is, in January and in July, so that
    // summer time cannot confuse the comparison.
    for (const month of [0, 6]) {
      const when = Date.UTC(2026, month, 15, 12, 0);
      const offsetMinutes = zoneOffsetMinutes(city.zone, when);
      if (offsetMinutes === null) continue;

      // Local solar noon, in UTC hours, from the longitude alone.
      const solarNoonUtc = 12 - city.lon / 15;
      const clockNoonUtc = 12 - offsetMinutes / 60;

      let difference = solarNoonUtc - clockNoonUtc;
      while (difference > 12) difference -= 24;
      while (difference < -12) difference += 24;

      // Zones are wide and some are deliberately skewed - western China is on
      // Beijing time, Spain on Berlin time - so three hours is the honest
      // bound. A sign error would show up as nine or more.
      if (Math.abs(difference) > 3) {
        problems.push(`${city.name}: solar noon is ${difference.toFixed(1)}h from clock noon`);
      }
    }
  }

  assert.deepEqual(problems, []);
});

test("the sun behaves as the hemisphere implies at every city", () => {
  // Catches a latitude whose sign is wrong, which the longitude check cannot
  // see: in June the sun is higher at noon in the north than in the south.
  for (const city of CITIES) {
    if (Math.abs(city.lat) < 10) continue; // the tropics are not one-sided

    const place = { lat: city.lat, lon: city.lon };
    const noonJune = highestAltitude(place, Date.UTC(2026, 5, 21));
    const noonDecember = highestAltitude(place, Date.UTC(2026, 11, 21));

    if (city.lat > 0) {
      assert.ok(
        noonJune > noonDecember,
        `${city.name} is in the north, so June should be higher than December`
      );
    } else {
      assert.ok(
        noonDecember > noonJune,
        `${city.name} is in the south, so December should be higher than June`
      );
    }
  }
});

test("searching finds cities by name and by country, best first", () => {
  const san = searchCities("san");
  assert.ok(san.length > 0, "san should match something");
  assert.equal(san[0]?.name, "San Francisco", "a prefix match should outrank one in the middle");

  const japan = searchCities("japan");
  assert.ok(
    japan.some((city) => city.name === "Tokyo"),
    "searching a country should find its cities"
  );

  assert.deepEqual(searchCities(""), [], "an empty query matches nothing");
  assert.deepEqual(searchCities("   "), [], "and neither does whitespace");
  assert.deepEqual(searchCities("zzzzz"), [], "nor nonsense");
});

test("a time zone gives a city, and names the right one when it holds several", () => {
  const denver = cityForTimeZone("America/Denver");
  assert.equal(denver?.name, "Denver", "the zone names the city it should pick");

  // Salt Lake City shares America/Denver, and must not win it.
  assert.ok(
    CITIES.filter((c) => c.zone === "America/Denver").length > 1,
    "this test is only meaningful while the zone holds more than one city"
  );

  assert.equal(cityForTimeZone("Asia/Tokyo")?.name, "Tokyo");
  assert.equal(cityForTimeZone("Europe/London")?.name, "London");
});

test("an unknown time zone guesses nothing rather than guessing wrongly", () => {
  // A wrong guess is worse than none: the user has to notice it before they
  // can correct it, and a sky for the wrong city looks right until checked.
  assert.equal(cityForTimeZone("Mars/Olympus_Mons"), null);
  assert.equal(guessPlace("Mars/Olympus_Mons"), null);
});

test("a guess carries the place and says what it was based on", () => {
  const guess = guessPlace("Australia/Sydney");
  assert.ok(guess);
  assert.ok(Math.abs(guess.place.lat - -33.87) < 0.1);
  assert.match(guess.description, /Sydney/);
  assert.match(guess.description, /Australia\/Sydney/);
});

test("a typed city resolves only when it is unambiguous", () => {
  assert.equal(resolveCity("Tokyo")?.name, "Tokyo");
  assert.equal(resolveCity("Tokyo, Japan")?.name, "Tokyo", "the label the list writes also works");
  assert.equal(resolveCity(""), null);
  assert.equal(resolveCity("zzzz"), null);

  // "San" could be San Francisco or Santiago, so it waits.
  assert.equal(resolveCity("San"), null, "an ambiguous prefix should not pick one");
});

test("the nearest city names a place, and admits when nothing is near", () => {
  assert.equal(nearestCity({ lat: 51.5, lon: -0.1 })?.name, "London");
  assert.equal(nearestCity({ lat: 35.68, lon: 139.7 })?.name, "Tokyo");

  // The middle of the Pacific is not near anything.
  assert.equal(nearestCity({ lat: -30, lon: -140 }), null);
});

test("great-circle distance is sane", () => {
  assert.ok(greatCircleKm({ lat: 0, lon: 0 }, { lat: 0, lon: 0 }) < 1e-9);

  // London to Paris is about 344 km.
  const londonParis = greatCircleKm({ lat: 51.51, lon: -0.13 }, { lat: 48.86, lon: 2.35 });
  assert.ok(londonParis > 320 && londonParis < 370, `got ${londonParis.toFixed(0)} km`);

  // A quarter of the way round, from the equator to the pole.
  const toPole = greatCircleKm({ lat: 0, lon: 0 }, { lat: 90, lon: 0 });
  assert.ok(Math.abs(toPole - 10007) < 50, `got ${toPole.toFixed(0)} km`);
});

test("every label is something a person could read", () => {
  for (const city of CITIES) {
    assert.equal(labelFor(city), `${city.name}, ${city.country}`);
  }
});

/* ------------------------------------------------------------- helpers */

/**
 * A zone's offset from UTC at an instant, in minutes east, or null if the
 * runtime does not know the zone.
 *
 * @param {string} zone
 * @param {number} when
 * @returns {number | null}
 */
function zoneOffsetMinutes(zone, when) {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });

    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(when)).map((part) => [part.type, part.value])
    );

    const asUtc = Date.UTC(
      Number(parts["year"]),
      Number(parts["month"]) - 1,
      Number(parts["day"]),
      Number(parts["hour"]) % 24,
      Number(parts["minute"]),
      Number(parts["second"])
    );

    return Math.round((asUtc - when) / 60000);
  } catch {
    return null;
  }
}

/**
 * The sun's highest altitude on a day.
 *
 * @param {{ lat: number, lon: number }} place
 * @param {number} dayStartUtc
 * @returns {number}
 */
function highestAltitude(place, dayStartUtc) {
  let highest = -Infinity;
  for (let minute = 0; minute < 1440; minute += 10) {
    highest = Math.max(highest, sunPosition(dayStartUtc + minute * 60_000, place).altitude);
  }
  return highest;
}
