// @ts-check
/**
 * Settings documents: their shape, their version, and how an old one becomes a
 * new one.
 *
 * A document is `{ app, version, savedAt, cfg, ui }`, the same arrangement as
 * Pixel Galaxy Studio. The version is the shape of the *document*, moved only
 * when a key is renamed or changes meaning, and each move is one entry in the
 * migration table. A newer application opens every older file; an older one
 * refuses a newer file and says so rather than guessing.
 *
 * Everything that loads settings - the file at boot, a user's .json, a test -
 * goes through `readDocument`, so there is exactly one path in.
 *
 * @module ui/settings
 */

import { defaultPreset } from "../engine/index.js";

/** @typedef {import("../engine/types.js").Place} Place */
/** @typedef {import("../engine/types.js").Preset} Preset */
/** @typedef {import("./theme.js").Theme} Theme */

export const APP = "dayandnight";
export const VERSION = 1;

/**
 * @typedef {object} SettingsDoc
 * @property {string} app
 * @property {number} version
 * @property {string} savedAt ISO 8601
 * @property {{ preset: Preset, place: Place, fps: number, awaySeconds: number, wallpaperOn: boolean }} cfg
 * @property {{ theme: Theme }} ui
 */

/**
 * One entry per version step. `migrate[n]` takes a document at version `n` and
 * returns it at version `n + 1`.
 *
 * Empty because nothing has shipped yet. The table exists now so that the
 * first migration is an entry rather than an afternoon of archaeology.
 *
 * @type {Record<number, (doc: SettingsDoc) => SettingsDoc>}
 */
const MIGRATIONS = {};

/**
 * Build a document from the current state.
 *
 * @param {{ preset: Preset, place: Place, fps: number, awaySeconds: number, wallpaperOn: boolean, theme: Theme }} from
 * @param {number} now timestamp, passed in rather than read from the clock
 * @returns {SettingsDoc}
 */
export function writeDocument(from, now) {
  return {
    app: APP,
    version: VERSION,
    savedAt: new Date(now).toISOString(),
    cfg: {
      preset: { ...from.preset },
      place: { ...from.place },
      fps: from.fps,
      awaySeconds: from.awaySeconds,
      wallpaperOn: from.wallpaperOn
    },
    ui: { theme: from.theme }
  };
}

/**
 * @typedef {object} ReadResult
 * @property {SettingsDoc | null} doc null when there was nothing usable
 * @property {string | null} problem a sentence for the user, or null
 */

/**
 * Validate, migrate and normalise whatever was handed to us.
 *
 * Nothing here trusts its input. A settings file is the one piece of outside
 * data this application reads, it may have been edited by hand or written by
 * an older build, and a bad value must not be able to put the application into
 * a state it cannot start from. So every field is checked and anything missing
 * or out of range falls back to a default rather than failing the load.
 *
 * @param {unknown} raw
 * @returns {ReadResult}
 */
export function readDocument(raw) {
  if (raw === null || typeof raw !== "object") return { doc: null, problem: null };

  const asRecord = /** @type {Record<string, unknown>} */ (raw);

  if (asRecord["app"] !== APP) {
    return { doc: null, problem: "That file is not a Day and Night settings file." };
  }

  const version = asRecord["version"];
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return { doc: null, problem: "That settings file does not say which version it is." };
  }

  if (version > VERSION) {
    return {
      doc: null,
      problem: `Those settings were saved by a newer version of Day and Night (file version ${version}, this build reads ${VERSION}). Update the application to open them.`
    };
  }

  /** @type {SettingsDoc} */
  let doc = {
    app: APP,
    version,
    savedAt: typeof asRecord["savedAt"] === "string" ? asRecord["savedAt"] : "",
    cfg: normaliseCfg(asRecord["cfg"]),
    ui: normaliseUi(asRecord["ui"])
  };

  while (doc.version < VERSION) {
    const step = MIGRATIONS[doc.version];
    if (!step) {
      return {
        doc: null,
        problem: `Those settings are version ${doc.version}, and this build has no way to bring them forward. Defaults have been loaded instead.`
      };
    }
    doc = step(doc);
  }

  return { doc, problem: null };
}

/* ----------------------------------------------------------- normalisation */

/**
 * @param {unknown} raw
 * @returns {SettingsDoc["cfg"]}
 */
function normaliseCfg(raw) {
  const cfg = isRecord(raw) ? raw : {};
  const presetRaw = isRecord(cfg["preset"]) ? cfg["preset"] : {};
  const placeRaw = isRecord(cfg["place"]) ? cfg["place"] : {};

  const defaults = defaultPreset();

  return {
    preset: {
      exposure: num(presetRaw["exposure"], defaults.exposure, -8, 8),
      // null is a real value here - it means "face whichever side of the sky
      // the sun crosses" - so it is preserved rather than coerced.
      bearing:
        presetRaw["bearing"] === null || presetRaw["bearing"] === undefined
          ? defaults.bearing
          : num(presetRaw["bearing"], 180, 0, 360),
      horizon: num(presetRaw["horizon"], defaults.horizon, 0, 1),
      fieldOfView: num(presetRaw["fieldOfView"], defaults.fieldOfView, 20, 200),
      whitePoint: num(presetRaw["whitePoint"], defaults.whitePoint, 0.5, 32),
      groundAlbedo: num(presetRaw["groundAlbedo"], defaults.groundAlbedo, 0, 1),
      starBrightness: num(presetRaw["starBrightness"], defaults.starBrightness, 0, 8),
      starSize: num(presetRaw["starSize"], defaults.starSize, 0.5, 6),
      twinkle: num(presetRaw["twinkle"], defaults.twinkle, 0, 1),
      airglow: num(presetRaw["airglow"], defaults.airglow, 0, 1e-4),
      glare: num(presetRaw["glare"], defaults.glare, 0, 4),
      bodyScale: num(presetRaw["bodyScale"], defaults.bodyScale, 1, 12),
      turbidity: num(presetRaw["turbidity"], defaults.turbidity, 0.2, 8),
      dayTint: hex(presetRaw["dayTint"], defaults.dayTint),
      twilightTint: hex(presetRaw["twilightTint"], defaults.twilightTint),
      nightTint: hex(presetRaw["nightTint"], defaults.nightTint),
      saturation: num(presetRaw["saturation"], defaults.saturation, 0, 3),
      contrast: num(presetRaw["contrast"], defaults.contrast, 0.3, 3)
    },
    place: {
      // Latitude stops just short of the poles: at exactly 90 the azimuth
      // transform divides by cos(lat), which is zero.
      lat: num(placeRaw["lat"], 39.7, -89.9, 89.9),
      lon: num(placeRaw["lon"], -105, -180, 180)
    },
    fps: Math.round(num(cfg["fps"], 20, 1, 60)),

    // Seconds of no input before the wallpaper stops. Absent from any document
    // written before this setting existed, so the default stands in - which is
    // a default rather than a migration, because nothing was renamed and
    // nothing changed meaning.
    awaySeconds: Math.round(num(cfg["awaySeconds"], 600, 0, 86_400)),

    // Whether the sky was up when the application last closed. Defaulting to
    // false matters: a settings file written before this existed belongs to
    // somebody who has never seen the wallpaper start itself, and turning it
    // on for them at the next launch would be the application taking over
    // their desktop unasked.
    wallpaperOn: cfg["wallpaperOn"] === true
  };
}

/**
 * @param {unknown} raw
 * @returns {SettingsDoc["ui"]}
 */
function normaliseUi(raw) {
  const ui = isRecord(raw) ? raw : {};
  const theme = ui["theme"];
  return {
    theme: theme === "light" || theme === "dark" || theme === "system" ? theme : "dark"
  };
}

/**
 * A `#rrggbb` colour, or the fallback.
 *
 * Checked rather than trusted: a tint reaches a shader as three numbers, and
 * a malformed one would throw out of the render loop rather than quietly
 * looking wrong.
 *
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function hex(value, fallback) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

/**
 * A finite number in range, or the fallback. Rejects NaN and Infinity, which
 * is the whole point: an Infinity in a uniform turns the screen black and
 * gives no clue why.
 *
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
function num(value, fallback, lo, hi) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(hi, Math.max(lo, value));
}

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isRecord(v) {
  return typeof v === "object" && v !== null;
}
