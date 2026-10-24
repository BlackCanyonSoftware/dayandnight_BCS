// @ts-check
/**
 * The shell, when there is one.
 *
 * Every function here does the Electron thing if `window.dayAndNight` exists
 * and a sensible browser thing if it does not, so no other module in the page
 * knows which it is running in. That is what lets the browser tests drive the
 * real editor over `http://` without an Electron process, and what would let
 * the page open in a plain browser for debugging.
 *
 * Same pattern as Pixel Galaxy Studio's `ui/desktop.js`.
 *
 * @module ui/desktop
 */

/** @typedef {import("./state.js").Monitor} Monitor */

/**
 * What the shell exposes through `desktop/preload.js`. One named function per
 * operation - there is no generic "invoke anything" channel, because a
 * renderer is the less trusted side even though we wrote it.
 *
 * @typedef {object} ShellApi
 * @property {string} version
 * @property {() => Promise<Monitor[]>} getMonitors
 * @property {(cb: (monitors: Monitor[]) => void) => void} onMonitorsChanged
 * @property {(on: boolean) => Promise<WallpaperState>} setWallpaper
 * @property {() => Promise<WallpaperState>} getWallpaperState
 * @property {() => Promise<boolean>} getStartWithWindows
 * @property {(on: boolean) => void} setStartWithWindows
 * @property {(cb: (s: WallpaperState) => void) => void} onWallpaperState
 * @property {(config: RuntimeConfig) => void} pushConfig
 * @property {() => Promise<unknown>} loadSettings
 * @property {(doc: unknown) => void} saveSettings
 */

/**
 * @typedef {object} WallpaperState
 * @property {boolean} on
 * @property {"workerw" | "fallback" | "starting" | "off"} host
 * @property {number} screens
 * @property {boolean} paused
 * @property {string} [reason] why the host is what it is - a fallback, say
 * @property {string | null} [pausedBecause] why nothing is being drawn
 */

/**
 * What the wallpaper windows need in order to draw. Pushed rather than polled.
 *
 * @typedef {object} RuntimeConfig
 * @property {import("../engine/types.js").Preset} preset
 * @property {import("../engine/types.js").Place} place
 * @property {number} fps
 * @property {number} awaySeconds seconds of no input before drawing stops
 */

/** @returns {ShellApi | null} */
function shell() {
  return (
    /** @type {{ dayAndNight?: ShellApi }} */ (/** @type {unknown} */ (globalThis)).dayAndNight ??
    null
  );
}

/** True when running inside the Electron shell. */
export const hasShell = () => shell() !== null;

/** @returns {string} */
export function version() {
  return shell()?.version ?? "browser";
}

/**
 * Every screen, or one invented 1080p screen in the browser so the preview has
 * a shape.
 *
 * @returns {Promise<Monitor[]>}
 */
export async function getMonitors() {
  const api = shell();
  if (!api) {
    return [
      {
        id: 0,
        bounds: { x: 0, y: 0, w: 1920, h: 1080 },
        scale: 1,
        primary: true
      }
    ];
  }
  return api.getMonitors();
}

/** @param {(monitors: Monitor[]) => void} cb */
export function onMonitorsChanged(cb) {
  shell()?.onMonitorsChanged(cb);
}

/**
 * @param {boolean} on
 * @returns {Promise<WallpaperState>}
 */
export async function setWallpaper(on) {
  const api = shell();
  if (!api) {
    return {
      on: false,
      host: "off",
      screens: 0,
      paused: false,
      reason: "There is no desktop to put a wallpaper on: this is a browser, not the application."
    };
  }
  return api.setWallpaper(on);
}

/** @returns {Promise<WallpaperState>} */
export async function getWallpaperState() {
  const api = shell();
  if (!api) return { on: false, host: "off", screens: 0, paused: false };
  return api.getWallpaperState();
}

/** @param {(s: WallpaperState) => void} cb */
export function onWallpaperState(cb) {
  shell()?.onWallpaperState(cb);
}

/**
 * Whether Windows starts the application at login.
 *
 * False in a browser, where there is nothing to start.
 *
 * @returns {Promise<boolean>}
 */
export async function getStartWithWindows() {
  const api = shell();
  if (!api) return false;
  return api.getStartWithWindows();
}

/** @param {boolean} on */
export function setStartWithWindows(on) {
  shell()?.setStartWithWindows(on);
}

/**
 * Hand the wallpaper windows what they need to draw. A no-op in the browser.
 * @param {RuntimeConfig} config
 */
export function pushConfig(config) {
  shell()?.pushConfig(config);
}

/**
 * The settings document, from the app-data file in the shell or from
 * `localStorage` in a browser.
 *
 * @returns {Promise<unknown>}
 */
export async function loadSettings() {
  const api = shell();
  if (api) return api.loadSettings();
  try {
    const raw = localStorage.getItem("dayandnight.settings");
    return raw ? JSON.parse(raw) : null;
  } catch {
    // A corrupt or blocked store is not worth failing a launch over; the
    // caller falls back to defaults, which is the right answer either way.
    return null;
  }
}

/** @param {unknown} doc */
export function saveSettings(doc) {
  const api = shell();
  if (api) {
    api.saveSettings(doc);
    return;
  }
  try {
    localStorage.setItem("dayandnight.settings", JSON.stringify(doc));
  } catch {
    // Private browsing, or a full quota. Losing the saved look is a far
    // smaller problem than refusing to run.
  }
}
