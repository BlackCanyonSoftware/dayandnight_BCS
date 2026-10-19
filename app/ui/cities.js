// @ts-check
/**
 * A short list of cities, so that setting a location is a matter of typing a
 * name rather than knowing your own coordinates.
 *
 * ## How accurate this is, and why that is enough
 *
 * Coordinates are to about a tenth of a degree. For this product the figure
 * that matters is longitude, because that is what sets the time of day: a
 * tenth of a degree is 24 seconds of solar time. Latitude at that precision
 * moves sunrise by a second or two. So a city entry is comfortably good
 * enough to put the sunrise at the right minute, and anyone who wants their
 * own garden rather than the middle of their city can type the numbers in.
 *
 * ## Why it is short
 *
 * A hundred-odd cities, not the twenty-five thousand a real gazetteer holds
 * (open question OQ-2 in the PRD). This covers the large cities of every
 * inhabited region and at least one place in nearly every common time zone,
 * which is what the two jobs below actually need. A full gazetteer is a data
 * file to be imported under its own licence rather than typed, and is on the
 * roadmap.
 *
 * ## Two jobs
 *
 * Searching is the obvious one. The other is the first-run guess: a system
 * knows its IANA time zone, and a zone name like `America/Denver` names a
 * place. Matching the zone to a city here turns "somewhere in Mountain Time"
 * into a latitude as well as a longitude - which an offset from UTC can never
 * give, since every point on a meridian shares it.
 *
 * @module ui/cities
 */

/**
 * @typedef {object} City
 * @property {string} name
 * @property {string} country
 * @property {number} lat degrees north
 * @property {number} lon degrees east
 * @property {string} zone IANA time zone
 */

/** @type {readonly City[]} */
export const CITIES = [
  // Europe
  { name: "London", country: "United Kingdom", lat: 51.51, lon: -0.13, zone: "Europe/London" },
  { name: "Dublin", country: "Ireland", lat: 53.35, lon: -6.26, zone: "Europe/Dublin" },
  { name: "Paris", country: "France", lat: 48.86, lon: 2.35, zone: "Europe/Paris" },
  { name: "Madrid", country: "Spain", lat: 40.42, lon: -3.7, zone: "Europe/Madrid" },
  { name: "Barcelona", country: "Spain", lat: 41.39, lon: 2.17, zone: "Europe/Madrid" },
  { name: "Lisbon", country: "Portugal", lat: 38.72, lon: -9.14, zone: "Europe/Lisbon" },
  { name: "Rome", country: "Italy", lat: 41.9, lon: 12.5, zone: "Europe/Rome" },
  { name: "Milan", country: "Italy", lat: 45.46, lon: 9.19, zone: "Europe/Rome" },
  { name: "Berlin", country: "Germany", lat: 52.52, lon: 13.4, zone: "Europe/Berlin" },
  { name: "Munich", country: "Germany", lat: 48.14, lon: 11.58, zone: "Europe/Berlin" },
  { name: "Hamburg", country: "Germany", lat: 53.55, lon: 9.99, zone: "Europe/Berlin" },
  { name: "Amsterdam", country: "Netherlands", lat: 52.37, lon: 4.9, zone: "Europe/Amsterdam" },
  { name: "Brussels", country: "Belgium", lat: 50.85, lon: 4.35, zone: "Europe/Brussels" },
  { name: "Zurich", country: "Switzerland", lat: 47.37, lon: 8.54, zone: "Europe/Zurich" },
  { name: "Vienna", country: "Austria", lat: 48.21, lon: 16.37, zone: "Europe/Vienna" },
  { name: "Prague", country: "Czechia", lat: 50.08, lon: 14.44, zone: "Europe/Prague" },
  { name: "Warsaw", country: "Poland", lat: 52.23, lon: 21.01, zone: "Europe/Warsaw" },
  { name: "Budapest", country: "Hungary", lat: 47.5, lon: 19.04, zone: "Europe/Budapest" },
  { name: "Bucharest", country: "Romania", lat: 44.43, lon: 26.1, zone: "Europe/Bucharest" },
  { name: "Athens", country: "Greece", lat: 37.98, lon: 23.73, zone: "Europe/Athens" },
  { name: "Copenhagen", country: "Denmark", lat: 55.68, lon: 12.57, zone: "Europe/Copenhagen" },
  { name: "Oslo", country: "Norway", lat: 59.91, lon: 10.75, zone: "Europe/Oslo" },
  { name: "Stockholm", country: "Sweden", lat: 59.33, lon: 18.07, zone: "Europe/Stockholm" },
  { name: "Helsinki", country: "Finland", lat: 60.17, lon: 24.94, zone: "Europe/Helsinki" },
  { name: "Reykjavik", country: "Iceland", lat: 64.15, lon: -21.94, zone: "Atlantic/Reykjavik" },
  { name: "Kyiv", country: "Ukraine", lat: 50.45, lon: 30.52, zone: "Europe/Kyiv" },
  { name: "Moscow", country: "Russia", lat: 55.76, lon: 37.62, zone: "Europe/Moscow" },
  { name: "Istanbul", country: "Turkey", lat: 41.01, lon: 28.98, zone: "Europe/Istanbul" },
  { name: "Tromso", country: "Norway", lat: 69.65, lon: 18.96, zone: "Europe/Oslo" },
  {
    name: "Longyearbyen",
    country: "Svalbard",
    lat: 78.22,
    lon: 15.63,
    zone: "Arctic/Longyearbyen"
  },

  // North America
  { name: "New York", country: "United States", lat: 40.71, lon: -74.01, zone: "America/New_York" },
  { name: "Boston", country: "United States", lat: 42.36, lon: -71.06, zone: "America/New_York" },
  {
    name: "Washington",
    country: "United States",
    lat: 38.91,
    lon: -77.04,
    zone: "America/New_York"
  },
  { name: "Atlanta", country: "United States", lat: 33.75, lon: -84.39, zone: "America/New_York" },
  { name: "Miami", country: "United States", lat: 25.76, lon: -80.19, zone: "America/New_York" },
  { name: "Chicago", country: "United States", lat: 41.88, lon: -87.63, zone: "America/Chicago" },
  { name: "Houston", country: "United States", lat: 29.76, lon: -95.37, zone: "America/Chicago" },
  { name: "Dallas", country: "United States", lat: 32.78, lon: -96.8, zone: "America/Chicago" },
  {
    name: "Minneapolis",
    country: "United States",
    lat: 44.98,
    lon: -93.27,
    zone: "America/Chicago"
  },
  { name: "Denver", country: "United States", lat: 39.74, lon: -104.99, zone: "America/Denver" },
  {
    name: "Salt Lake City",
    country: "United States",
    lat: 40.76,
    lon: -111.89,
    zone: "America/Denver"
  },
  { name: "Phoenix", country: "United States", lat: 33.45, lon: -112.07, zone: "America/Phoenix" },
  {
    name: "Los Angeles",
    country: "United States",
    lat: 34.05,
    lon: -118.24,
    zone: "America/Los_Angeles"
  },
  {
    name: "San Francisco",
    country: "United States",
    lat: 37.77,
    lon: -122.42,
    zone: "America/Los_Angeles"
  },
  {
    name: "Seattle",
    country: "United States",
    lat: 47.61,
    lon: -122.33,
    zone: "America/Los_Angeles"
  },
  {
    name: "Anchorage",
    country: "United States",
    lat: 61.22,
    lon: -149.9,
    zone: "America/Anchorage"
  },
  {
    name: "Utqiagvik",
    country: "United States",
    lat: 71.29,
    lon: -156.79,
    zone: "America/Anchorage"
  },
  {
    name: "Honolulu",
    country: "United States",
    lat: 21.31,
    lon: -157.86,
    zone: "Pacific/Honolulu"
  },
  { name: "Toronto", country: "Canada", lat: 43.65, lon: -79.38, zone: "America/Toronto" },
  { name: "Montreal", country: "Canada", lat: 45.5, lon: -73.57, zone: "America/Toronto" },
  { name: "Winnipeg", country: "Canada", lat: 49.9, lon: -97.14, zone: "America/Winnipeg" },
  { name: "Calgary", country: "Canada", lat: 51.05, lon: -114.07, zone: "America/Edmonton" },
  { name: "Vancouver", country: "Canada", lat: 49.28, lon: -123.12, zone: "America/Vancouver" },
  { name: "Nuuk", country: "Greenland", lat: 64.18, lon: -51.72, zone: "America/Nuuk" },
  { name: "Mexico City", country: "Mexico", lat: 19.43, lon: -99.13, zone: "America/Mexico_City" },
  { name: "Havana", country: "Cuba", lat: 23.11, lon: -82.37, zone: "America/Havana" },
  { name: "Panama City", country: "Panama", lat: 8.98, lon: -79.52, zone: "America/Panama" },

  // South America
  { name: "Bogota", country: "Colombia", lat: 4.71, lon: -74.07, zone: "America/Bogota" },
  { name: "Quito", country: "Ecuador", lat: -0.18, lon: -78.47, zone: "America/Guayaquil" },
  { name: "Lima", country: "Peru", lat: -12.05, lon: -77.04, zone: "America/Lima" },
  { name: "Santiago", country: "Chile", lat: -33.45, lon: -70.67, zone: "America/Santiago" },
  {
    name: "Buenos Aires",
    country: "Argentina",
    lat: -34.6,
    lon: -58.38,
    zone: "America/Argentina/Buenos_Aires"
  },
  {
    name: "Ushuaia",
    country: "Argentina",
    lat: -54.8,
    lon: -68.3,
    zone: "America/Argentina/Ushuaia"
  },
  { name: "Sao Paulo", country: "Brazil", lat: -23.55, lon: -46.63, zone: "America/Sao_Paulo" },
  {
    name: "Rio de Janeiro",
    country: "Brazil",
    lat: -22.91,
    lon: -43.17,
    zone: "America/Sao_Paulo"
  },

  // Africa and the Middle East
  { name: "Casablanca", country: "Morocco", lat: 33.57, lon: -7.59, zone: "Africa/Casablanca" },
  { name: "Accra", country: "Ghana", lat: 5.6, lon: -0.19, zone: "Africa/Accra" },
  { name: "Lagos", country: "Nigeria", lat: 6.52, lon: 3.38, zone: "Africa/Lagos" },
  { name: "Cairo", country: "Egypt", lat: 30.04, lon: 31.24, zone: "Africa/Cairo" },
  { name: "Addis Ababa", country: "Ethiopia", lat: 9.03, lon: 38.74, zone: "Africa/Addis_Ababa" },
  { name: "Nairobi", country: "Kenya", lat: -1.29, lon: 36.82, zone: "Africa/Nairobi" },
  {
    name: "Johannesburg",
    country: "South Africa",
    lat: -26.2,
    lon: 28.05,
    zone: "Africa/Johannesburg"
  },
  {
    name: "Cape Town",
    country: "South Africa",
    lat: -33.92,
    lon: 18.42,
    zone: "Africa/Johannesburg"
  },
  { name: "Jerusalem", country: "Israel", lat: 31.78, lon: 35.22, zone: "Asia/Jerusalem" },
  { name: "Tel Aviv", country: "Israel", lat: 32.08, lon: 34.78, zone: "Asia/Jerusalem" },
  { name: "Dubai", country: "United Arab Emirates", lat: 25.2, lon: 55.27, zone: "Asia/Dubai" },
  { name: "Riyadh", country: "Saudi Arabia", lat: 24.71, lon: 46.68, zone: "Asia/Riyadh" },
  { name: "Tehran", country: "Iran", lat: 35.69, lon: 51.39, zone: "Asia/Tehran" },

  // Asia
  { name: "Karachi", country: "Pakistan", lat: 24.86, lon: 67.01, zone: "Asia/Karachi" },
  { name: "Delhi", country: "India", lat: 28.61, lon: 77.21, zone: "Asia/Kolkata" },
  { name: "Mumbai", country: "India", lat: 19.08, lon: 72.88, zone: "Asia/Kolkata" },
  { name: "Bengaluru", country: "India", lat: 12.97, lon: 77.59, zone: "Asia/Kolkata" },
  { name: "Kolkata", country: "India", lat: 22.57, lon: 88.36, zone: "Asia/Kolkata" },
  { name: "Dhaka", country: "Bangladesh", lat: 23.81, lon: 90.41, zone: "Asia/Dhaka" },
  { name: "Bangkok", country: "Thailand", lat: 13.76, lon: 100.5, zone: "Asia/Bangkok" },
  {
    name: "Ho Chi Minh City",
    country: "Vietnam",
    lat: 10.82,
    lon: 106.63,
    zone: "Asia/Ho_Chi_Minh"
  },
  { name: "Kuala Lumpur", country: "Malaysia", lat: 3.14, lon: 101.69, zone: "Asia/Kuala_Lumpur" },
  { name: "Singapore", country: "Singapore", lat: 1.35, lon: 103.82, zone: "Asia/Singapore" },
  { name: "Jakarta", country: "Indonesia", lat: -6.21, lon: 106.85, zone: "Asia/Jakarta" },
  { name: "Manila", country: "Philippines", lat: 14.6, lon: 120.98, zone: "Asia/Manila" },
  { name: "Hong Kong", country: "Hong Kong", lat: 22.32, lon: 114.17, zone: "Asia/Hong_Kong" },
  { name: "Shanghai", country: "China", lat: 31.23, lon: 121.47, zone: "Asia/Shanghai" },
  { name: "Beijing", country: "China", lat: 39.9, lon: 116.41, zone: "Asia/Shanghai" },
  { name: "Taipei", country: "Taiwan", lat: 25.03, lon: 121.57, zone: "Asia/Taipei" },
  { name: "Seoul", country: "South Korea", lat: 37.57, lon: 126.98, zone: "Asia/Seoul" },
  { name: "Tokyo", country: "Japan", lat: 35.68, lon: 139.69, zone: "Asia/Tokyo" },
  { name: "Osaka", country: "Japan", lat: 34.69, lon: 135.5, zone: "Asia/Tokyo" },
  { name: "Sapporo", country: "Japan", lat: 43.06, lon: 141.35, zone: "Asia/Tokyo" },

  // Oceania
  { name: "Perth", country: "Australia", lat: -31.95, lon: 115.86, zone: "Australia/Perth" },
  { name: "Adelaide", country: "Australia", lat: -34.93, lon: 138.6, zone: "Australia/Adelaide" },
  { name: "Darwin", country: "Australia", lat: -12.46, lon: 130.84, zone: "Australia/Darwin" },
  { name: "Brisbane", country: "Australia", lat: -27.47, lon: 153.03, zone: "Australia/Brisbane" },
  { name: "Sydney", country: "Australia", lat: -33.87, lon: 151.21, zone: "Australia/Sydney" },
  {
    name: "Melbourne",
    country: "Australia",
    lat: -37.81,
    lon: 144.96,
    zone: "Australia/Melbourne"
  },
  { name: "Hobart", country: "Australia", lat: -42.88, lon: 147.33, zone: "Australia/Hobart" },
  { name: "Auckland", country: "New Zealand", lat: -36.85, lon: 174.76, zone: "Pacific/Auckland" },
  {
    name: "Wellington",
    country: "New Zealand",
    lat: -41.29,
    lon: 174.78,
    zone: "Pacific/Auckland"
  },
  { name: "Suva", country: "Fiji", lat: -18.14, lon: 178.44, zone: "Pacific/Fiji" },

  // The far south, because the product's behaviour there is a feature
  {
    name: "McMurdo Station",
    country: "Antarctica",
    lat: -77.85,
    lon: 166.67,
    zone: "Antarctica/McMurdo"
  }
];

/**
 * Cities whose name matches, best first.
 *
 * Matches on the city and on the country, so "japan" finds Tokyo. A prefix
 * match outranks one in the middle, which is what makes typing "san" offer
 * San Francisco before Santiago.
 *
 * @param {string} query
 * @param {number} [limit]
 * @returns {City[]}
 */
export function searchCities(query, limit = 8) {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];

  /** @type {{ city: City, rank: number }[]} */
  const hits = [];

  for (const city of CITIES) {
    const name = city.name.toLowerCase();
    const country = city.country.toLowerCase();

    let rank = -1;
    if (name.startsWith(needle)) rank = 0;
    else if (name.includes(needle)) rank = 1;
    else if (country.startsWith(needle)) rank = 2;
    else if (country.includes(needle)) rank = 3;

    if (rank >= 0) hits.push({ city, rank });
  }

  hits.sort((a, b) => a.rank - b.rank || a.city.name.localeCompare(b.city.name));
  return hits.slice(0, limit).map((hit) => hit.city);
}

/**
 * The best guess at where this computer is, from its time zone.
 *
 * Far better than it sounds. A zone name is a place name - `America/Denver`,
 * `Australia/Sydney` - so matching it gives a latitude as well as a
 * longitude, where an offset from UTC can only ever give the second, and
 * badly: every point on a meridian shares an offset, and half of them are in
 * the wrong hemisphere.
 *
 * Returns null when the zone is not in the list, which is honest - a wrong
 * guess is worse than none, because the user would have to notice it before
 * they could correct it.
 *
 * @param {string} [timeZone] defaults to this computer's
 * @returns {City | null}
 */
export function cityForTimeZone(timeZone) {
  const zone = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!zone) return null;

  const exact = CITIES.filter((city) => city.zone === zone);
  if (exact.length === 0) return null;

  // A zone can hold several cities here, and the zone names the one that
  // should win: `America/Denver` should give Denver rather than Salt Lake
  // City, which shares its zone.
  const named = zone
    .slice(zone.lastIndexOf("/") + 1)
    .replace(/_/g, " ")
    .toLowerCase();
  return exact.find((city) => city.name.toLowerCase() === named) ?? exact[0];
}
