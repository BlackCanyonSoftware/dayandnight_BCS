"use strict";

/**
 * The one bridge between the shell and a renderer.
 *
 * `contextIsolation` is on, `nodeIntegration` off, `sandbox` on. What crosses
 * is a frozen object with a named function per operation - there is no generic
 * "invoke anything" channel, because a renderer is the less trusted side even
 * though we wrote it, and a channel that can call anything is a channel an
 * injected script can call anything through.
 *
 * Two different APIs are exposed, depending on which window this is preloading:
 * the editor gets `window.dayAndNight`, a wallpaper surface gets
 * `window.wallpaper`. A wallpaper window has no business setting settings, and
 * giving it the editor's API would mean trusting it not to.
 *
 * @module desktop/preload
 */

const { contextBridge, ipcRenderer } = require("electron");

/**
 * Which API to expose, and the version, both passed as `--role=` and
 * `--app-version=` in `additionalArguments` by main.js.
 *
 * Command-line arguments rather than environment variables: a sandboxed
 * preload's `process` is a reduced shim, and an environment variable set in
 * the main process after launch is not reliably visible in it.
 *
 * @param {string} flag
 * @returns {string | undefined}
 */
function arg(flag) {
  const prefix = `--${flag}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

const role = arg("role");

if (role === "wallpaper") {
  contextBridge.exposeInMainWorld("wallpaper", {
    getInitial: () => ipcRenderer.invoke("wallpaper:initial"),

    /** @param {(c: unknown) => void} cb */
    onConfig: (cb) => {
      ipcRenderer.on("wallpaper:config", (_event, config) => cb(config));
    },

    /** @param {(g: unknown) => void} cb */
    onGeometry: (cb) => {
      ipcRenderer.on("wallpaper:geometry", (_event, geometry) => cb(geometry));
    },

    /** @param {(paused: boolean) => void} cb */
    onPause: (cb) => {
      ipcRenderer.on("wallpaper:pause", (_event, paused) => cb(Boolean(paused)));
    }
  });
} else {
  contextBridge.exposeInMainWorld("dayAndNight", {
    version: arg("app-version") ?? "dev",

    getMonitors: () => ipcRenderer.invoke("monitors:list"),

    /** @param {(monitors: unknown) => void} cb */
    onMonitorsChanged: (cb) => {
      ipcRenderer.on("monitors:changed", (_event, monitors) => cb(monitors));
    },

    /** @param {boolean} on */
    setWallpaper: (on) => ipcRenderer.invoke("wallpaper:set", Boolean(on)),

    getWallpaperState: () => ipcRenderer.invoke("wallpaper:state"),

    getStartWithWindows: () => ipcRenderer.invoke("startup:get"),
    /** @param {boolean} on */
    setStartWithWindows: (on) => ipcRenderer.send("startup:set", Boolean(on)),

    /** @param {(s: unknown) => void} cb */
    onWallpaperState: (cb) => {
      ipcRenderer.on("wallpaper:stateChanged", (_event, state) => cb(state));
    },

    /** @param {unknown} config */
    pushConfig: (config) => ipcRenderer.send("config:push", config),

    loadSettings: () => ipcRenderer.invoke("settings:load"),

    /** @param {unknown} doc */
    saveSettings: (doc) => ipcRenderer.send("settings:save", doc)
  });
}
