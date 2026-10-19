// @ts-check
/**
 * What time the editor is showing.
 *
 * The engine takes a timestamp and never reads the clock (architecture
 * invariant 1), so something has to decide what that timestamp is. For the
 * wallpaper it is always the real now. For the editor it is whatever the user
 * is pointing at, because a preset is authored across the whole day and nobody
 * is going to sit at the screen from dawn to dusk to check it (US-020).
 *
 * @module ui/clock
 */

import { clock, setClock } from "./state.js";
import { fromDateInputValue, toDateInputValue } from "./util.js";

/** A whole day in about thirty seconds: 86400 / 30. */
export const FAST_FORWARD_RATE = 2880;

const MINUTE_MS = 60_000;
const DAY_MINUTES = 1440;

/**
 * The timestamp to render.
 *
 * @param {number} realNow the current wall clock, passed in rather than read
 *   so that this function is testable and so the caller reads the clock once
 *   per frame instead of several times
 * @returns {number}
 */
export function currentT(realNow) {
  if (clock.mode === "now") return realNow;
  return clock.dayStart + clock.minute * MINUTE_MS;
}

/**
 * Point the clock at the real now, and set the date and minute to match so
 * that switching to manual afterwards starts from where the user was looking.
 *
 * @param {number} realNow
 */
export function snapToNow(realNow) {
  const d = new Date(realNow);
  const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  setClock({
    mode: "now",
    dayStart,
    minute: (realNow - dayStart) / MINUTE_MS,
    playing: false
  });
}

/**
 * Move to a minute of the chosen day. Any manual move stops following the real
 * clock - the user has taken the wheel.
 *
 * @param {number} minute 0..1439
 */
export function setMinute(minute) {
  setClock({ mode: "manual", minute: wrapMinute(minute), playing: false });
}

/**
 * Change the date, keeping the time of day. The season changes the shape of
 * the day far more than the hour does, so this is a first-class control
 * rather than a detail (US-003).
 *
 * @param {string} dateInputValue `YYYY-MM-DD`
 * @returns {boolean} false if the value was not a date
 */
export function setDate(dateInputValue) {
  const dayStart = fromDateInputValue(dateInputValue);
  if (Number.isNaN(dayStart)) return false;
  setClock({ mode: "manual", dayStart, playing: false });
  return true;
}

/**
 * Start or stop fast-forward. Starting it from `now` pins the current day
 * first, so the run has a date to be on.
 *
 * @param {boolean} playing
 * @param {number} realNow
 */
export function setPlaying(playing, realNow) {
  if (playing && clock.mode === "now") {
    const d = new Date(realNow);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    setClock({
      mode: "manual",
      dayStart,
      minute: (realNow - dayStart) / MINUTE_MS,
      playing: true
    });
    return;
  }
  setClock({ playing });
}

/**
 * Advance a fast-forward run by one frame's worth of wall time.
 *
 * Wrapping at midnight rather than rolling into the next date is deliberate:
 * the point of the run is to watch one day's transitions over and over, and a
 * run that silently walked into next week would be worse for that.
 *
 * @param {number} elapsedMs real milliseconds since the last frame
 */
export function advance(elapsedMs) {
  if (!clock.playing || clock.mode !== "manual") return;
  const minutes = (elapsedMs * FAST_FORWARD_RATE) / MINUTE_MS;
  setClock({ minute: wrapMinute(clock.minute + minutes) });
}

/**
 * The date to show in the date input for the current clock.
 *
 * @param {number} realNow
 * @returns {string} `YYYY-MM-DD`
 */
export function dateInputValue(realNow) {
  return toDateInputValue(clock.mode === "now" ? realNow : clock.dayStart);
}

/**
 * The minute to show on the scrubber for the current clock.
 *
 * @param {number} realNow
 * @returns {number} 0..1439
 */
export function scrubValue(realNow) {
  if (clock.mode !== "now") return clock.minute;
  const d = new Date(realNow);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

/**
 * @param {number} minute
 * @returns {number} folded into 0..1439
 */
function wrapMinute(minute) {
  return ((minute % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
}
