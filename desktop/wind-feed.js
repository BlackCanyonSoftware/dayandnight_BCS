// @ts-check
"use strict";

/**
 * Keeping a real wind up to date: when to ask, whom, and what to do when it goes
 * wrong.
 *
 * `wind-source.js` knows what a request and a response look like. This is the
 * part that owns the schedule, and it is the only place in the application that
 * decides to go to the network, which is why it is small and why the network
 * itself - `fetch` - is handed in rather than reached for. Tests give it a fake
 * one and a fake clock; the shell gives it Electron's.
 *
 * ## What it promises
 *
 * - **Nothing is asked until it is switched on**, and switching it off forgets
 *   the data as well as stopping.
 * - **At most one request a minute**, however the place is dragged about, and
 *   one at a time. A place change waits for the dragging to stop.
 * - **The provider's rules** (`wind-source.js`): not before `Expires`, never
 *   within the minimum interval, spread by a random amount, and
 *   `If-Modified-Since` when asking again for the same place.
 * - **Failure is quiet and slow.** An error, a refusal or nonsense keeps what
 *   there is, tries again later with a longer wait each time, and a 403 or 429
 *   waits at least an hour. The product never depends on the answer: the engine
 *   falls back to the simulated weather.
 *
 * @module desktop/wind-feed
 */

const source = require("./wind-source.js");

/** How long a changed place has to stay changed before it is asked about. */
const SETTLE_MS = 8_000;

/** The least time between any two requests, whichever place they are for. */
const MIN_GAP_MS = 60_000;

/** A request that has not answered by now is given up on. */
const TIMEOUT_MS = 20_000;

/** First wait after a failure; it doubles each time. */
const RETRY_BASE_MS = 15 * 60_000;

/** Never wait longer than this between attempts. */
const RETRY_MAX_MS = 3 * 60 * 60_000;

/** After being told to slow down or go away, wait at least this. */
const REFUSED_MS = 60 * 60_000;

/**
 * What every surface is given: samples, and where the clouds are at the first
 * of them (see `continueSeries` in the engine).
 *
 * @typedef {object} WindPayload
 * @property {{ t: number, east: number, north: number }[]} samples
 * @property {{ east: number, north: number }} origin
 */

/**
 * @typedef {"off" | "waiting" | "live" | "offline"} WindState
 *
 * `waiting` is on, with nothing yet; `live` is data from the provider that has
 * not gone stale; `offline` is on, and the last attempt failed.
 */

/**
 * @typedef {object} WindStatus
 * @property {WindState} state
 * @property {number | null} fetchedAt milliseconds since the epoch of the last
 *   good answer for this place, or null
 */

/**
 * @typedef {object} Options
 * @property {(url: string, init: { headers: Record<string, string>, signal: AbortSignal }) => Promise<any>} fetch
 *   Electron's `net.fetch` in the shell
 * @property {string} version the application's version, for the User-Agent
 * @property {(payload: WindPayload | null, status: WindStatus) => void} onChange
 * @property {(previous: WindPayload | null, samples: WindPayload["samples"], now: number, place: { lat: number, lon: number }) => WindPayload | null} anchor
 *   Positions a new forecast so the clouds do not jump; the engine's
 *   `continueSeries`, which this module cannot import because it is not CommonJS
 * @property {() => number} [now]
 * @property {() => number} [random]
 * @property {(fn: () => void, ms: number) => unknown} [setTimer]
 * @property {(handle: unknown) => void} [clearTimer]
 */

class WindFeed {
  /** @param {Options} options */
  constructor(options) {
    this.fetch = options.fetch;
    this.version = options.version;
    this.onChange = options.onChange;
    this.anchor = options.anchor;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer =
      options.clearTimer ?? ((handle) => clearTimeout(/** @type {NodeJS.Timeout} */ (handle)));

    this.enabled = false;
    /** @type {{ lat: number, lon: number } | null} */
    this.place = null;
    /** @type {string | null} which place `payload` is for, as the request names it */
    this.key = null;

    /** @type {WindPayload | null} */
    this.payload = null;
    /** @type {WindState} */
    this.state = "off";
    /** @type {number | null} */
    this.fetchedAt = null;
    /** @type {string | null} */
    this.lastModified = null;

    /** @type {unknown} */
    this.timer = null;
    this.inFlight = false;
    this.failures = 0;
    this.lastAttemptAt = -Infinity;
    /** Bumped when what is wanted changes, so a late answer can tell it is stale. */
    this.generation = 0;
  }

  /**
   * Say what is wanted. Idempotent, and called as often as the settings change.
   *
   * @param {{ enabled: boolean, place: { lat: number, lon: number } }} want
   */
  configure(want) {
    const key = want.enabled ? keyFor(want.place) : null;

    if (!want.enabled) {
      if (this.enabled) this.turnOff();
      return;
    }

    if (!this.enabled) {
      this.enabled = true;
      this.place = want.place;
      this.key = key;
      this.state = "waiting";
      this.failures = 0;
      this.generation += 1;
      this.notify();
      this.scheduleAt(this.now());
      return;
    }

    this.place = want.place;
    if (key === this.key) return;

    // A different place: what there is belongs to the old one, so it goes, and
    // the new one is asked about once the dragging has stopped.
    this.key = key;
    this.payload = null;
    this.fetchedAt = null;
    this.lastModified = null;
    this.failures = 0;
    this.state = "waiting";
    this.generation += 1;
    this.notify();
    this.scheduleAt(this.now() + SETTLE_MS);
  }

  /** @returns {WindPayload | null} */
  current() {
    return this.payload;
  }

  /** @returns {WindStatus} */
  status() {
    return { state: this.state, fetchedAt: this.fetchedAt };
  }

  /** Stop for good, as at quitting. */
  dispose() {
    if (this.enabled) this.turnOff();
  }

  turnOff() {
    this.enabled = false;
    this.generation += 1;
    this.cancel();
    this.payload = null;
    this.fetchedAt = null;
    this.lastModified = null;
    this.failures = 0;
    this.key = null;
    this.state = "off";
    this.notify();
  }

  notify() {
    this.onChange(this.payload, this.status());
  }

  cancel() {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  /**
   * Ask at `at`, or as soon after as the rate limit allows. Replaces whatever
   * was scheduled: there is only ever one thing pending.
   *
   * @param {number} at milliseconds since the epoch
   */
  scheduleAt(at) {
    this.cancel();

    const when = Math.max(at, this.lastAttemptAt + MIN_GAP_MS);
    this.timer = this.setTimer(
      () => {
        this.timer = null;
        void this.run();
      },
      Math.max(0, when - this.now())
    );
  }

  async run() {
    if (!this.enabled || !this.place) return;
    // One at a time. Whatever is in flight schedules the next ask when it lands.
    if (this.inFlight) return;

    const place = this.place;
    const key = this.key;
    const generation = this.generation;
    const { url, headers } = source.requestFor(place, this.version);
    if (this.lastModified && this.payload) headers["If-Modified-Since"] = this.lastModified;

    this.inFlight = true;
    this.lastAttemptAt = this.now();
    const controller = new AbortController();
    const giveUp = this.setTimer(() => controller.abort(), TIMEOUT_MS);

    /** @type {{ ok: boolean, status: number, headers: any, json: () => Promise<unknown> } | null} */
    let response = null;
    /** @type {unknown} */
    let body = null;
    let failed = false;

    try {
      response = await this.fetch(url, { headers, signal: controller.signal });
      if (response && response.status !== 304 && response.ok) body = await response.json();
    } catch {
      failed = true;
    } finally {
      this.clearTimer(giveUp);
      this.inFlight = false;
    }

    // Switched off, or moved, while waiting: this answer is for something that
    // is no longer wanted. The change scheduled its own ask, but that timer may
    // have fired while this was still in flight and found the door shut, so the
    // ask is put back.
    if (generation !== this.generation || !this.enabled || key !== this.key) {
      if (this.enabled) this.scheduleAt(this.now() + SETTLE_MS);
      return;
    }

    const now = this.now();

    if (!failed && response && response.status === 304 && this.payload) {
      this.succeeded(response.headers, now);
      return;
    }

    if (!failed && response && response.ok) {
      const samples = source.parseSamples(body);
      const payload = samples.length >= 2 ? this.anchor(this.payload, samples, now, place) : null;

      if (payload) {
        this.payload = payload;
        this.fetchedAt = now;
        this.lastModified = headerOf(response.headers, "last-modified");
        this.succeeded(response.headers, now);
        return;
      }
    }

    const refused = response !== null && (response.status === 403 || response.status === 429);
    this.fell(now, refused);
  }

  /**
   * @param {unknown} headers
   * @param {number} now
   */
  succeeded(headers, now) {
    this.failures = 0;
    this.state = "live";
    this.notify();
    this.scheduleAt(source.nextFetchAt(headers, now, this.random));
  }

  /**
   * @param {number} now
   * @param {boolean} refused
   */
  fell(now, refused) {
    this.failures += 1;
    this.state = "offline";
    this.notify();

    const backoff = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (this.failures - 1));
    const wait = Math.max(backoff, refused ? REFUSED_MS : 0);
    this.scheduleAt(now + wait + Math.floor(this.random() * 10 * 60_000));
  }
}

/**
 * Which place a request is for, as the request itself will name it: two places
 * that truncate to the same tenth of a degree are the same ask.
 *
 * @param {{ lat: number, lon: number }} place
 * @returns {string}
 */
function keyFor(place) {
  return `${source.truncate(place.lat)},${source.truncate(place.lon)}`;
}

/**
 * @param {any} headers a Headers, a Map, or a plain object
 * @param {string} name lower case
 * @returns {string | null}
 */
function headerOf(headers, name) {
  if (!headers) return null;
  const value =
    typeof headers.get === "function" ? headers.get(name) : (headers[name] ?? undefined);
  return typeof value === "string" ? value : null;
}

module.exports = {
  MIN_GAP_MS,
  REFUSED_MS,
  RETRY_BASE_MS,
  SETTLE_MS,
  TIMEOUT_MS,
  WindFeed,
  keyFor
};
