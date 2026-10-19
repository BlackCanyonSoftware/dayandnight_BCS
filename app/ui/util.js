// @ts-check
/**
 * The small shared helpers. Nothing here knows about the engine or the shell.
 *
 * @module ui/util
 */

/**
 * `querySelector`, but it throws rather than returning null.
 *
 * Every element this is asked for is in index.html, so a miss is a typo or a
 * deleted element - a developer error that should stop immediately rather than
 * become a null-pointer three frames later.
 *
 * @template {Element} [T=HTMLElement]
 * @param {string} selector
 * @returns {T}
 */
export function $(selector) {
  const found = document.querySelector(selector);
  if (!found) throw new Error(`No element matches ${selector}`);
  return /** @type {T} */ (found);
}

/**
 * @param {string} id
 * @returns {HTMLInputElement}
 */
export function input(id) {
  return $(`#${id}`);
}

/**
 * @param {string} id
 * @returns {HTMLSelectElement}
 */
export function select(id) {
  return $(`#${id}`);
}

/**
 * @param {number} v
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Degrees, one decimal, with the sign always shown for altitude - the
 * difference between -0.3 and 0.3 degrees is the difference between night and
 * day, so the sign is the information.
 *
 * @param {number} deg
 * @returns {string}
 */
export function fmtDegrees(deg) {
  const n = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    signDisplay: "exceptZero"
  }).format(deg);
  return `${n}°`;
}

/**
 * Degrees without a forced sign, for a bearing.
 * @param {number} deg
 * @returns {string}
 */
export function fmtBearing(deg) {
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(deg)}°`;
}

/**
 * A timestamp as the user's own local time, respecting their 12- or 24-hour
 * preference rather than guessing.
 *
 * @param {number} t
 * @returns {string}
 */
export function fmtTime(t) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(t));
}

/**
 * Minutes since local midnight, as a clock time. Used for the scrubber, where
 * there is no date in play.
 *
 * @param {number} minute 0..1439
 * @returns {string}
 */
export function fmtMinute(minute) {
  const h = Math.floor(minute / 60);
  const m = Math.floor(minute % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * `YYYY-MM-DD` in local time, which is what `<input type="date">` wants.
 * `toISOString` would be wrong here: it converts to UTC first, so for anyone
 * west of Greenwich the date flips a day during the evening.
 *
 * @param {number} t
 * @returns {string}
 */
export function toDateInputValue(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/**
 * `YYYY-MM-DD` to the timestamp of local midnight on that date.
 *
 * @param {string} value
 * @returns {number} NaN if the value is not a date
 */
export function fromDateInputValue(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return Number.NaN;
  const [, y, mo, d] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d)).getTime();
}

/**
 * Show a message the user can act on, or clear it.
 *
 * Errors are never swallowed and never only logged: if something went wrong
 * that affects what the user sees, it is said on screen.
 *
 * @param {string | null} message
 */
export function notice(message) {
  const box = $("#notice");
  if (message === null) {
    box.hidden = true;
    box.textContent = "";
    return;
  }
  box.hidden = false;
  box.textContent = message;
}

/**
 * An exposure gain as stops, which is how a photographer would read it.
 *
 * The automatic exposure spans about twelve stops between noon and deep
 * twilight, and a raw gain of "3700x" says much less about that than "+11.9".
 *
 * @param {number} gain
 * @returns {string}
 */
export function fmtExposure(gain) {
  if (!(gain > 0)) return "--";
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    signDisplay: "exceptZero"
  }).format(Math.log2(gain));
}
