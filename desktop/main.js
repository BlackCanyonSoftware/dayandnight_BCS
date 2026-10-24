"use strict";

/**
 * The Electron main process: the only part of the application that touches the
 * machine.
 *
 * It owns the windows, the monitor list, the reparenting, the pause policy and
 * the settings file. Renderers get none of that directly - they ask through
 * the named channels in preload.js, and every payload is validated here before
 * it is acted on, because a renderer is the less trusted side even though we
 * wrote it.
 *
 * @module desktop/main
 */

const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, ipcMain, net, protocol, shell: electronShell } = require("electron");

const host = require("./host-win32.js");
const monitors = require("./monitors.js");
const store = require("./store.js");
const { PauseWatcher } = require("./pause.js");
const tray = require("./tray.js");

const APP_DIR = path.join(__dirname, "..", "app");
const SCHEME = "dayandnight";
const PRELOAD = path.join(__dirname, "preload.js");

/**
 * The application's own scheme, registered as a standard secure origin.
 *
 * `file://` is not a secure context, which would cost ES modules their
 * behaviour and leave WebGL in a worse place. A local HTTP server would work
 * and is what the dev script uses, but shipping one means opening a port on a
 * user's machine for no reason. A custom scheme is the right answer and is
 * what Pixel Galaxy Studio does with `pgs://`.
 *
 * This must run before `app.whenReady`.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
]);

/* ------------------------------------------------------------------- state */

/** @type {BrowserWindow | null} */
let editor = null;

/** @type {Map<number, BrowserWindow>} Keyed by monitor id. */
const surfaces = new Map();

/**
 * Which monitor each surface's renderer belongs to, keyed by `webContents.id`.
 *
 * Kept here rather than read back out of the window's `additionalArguments`:
 * a renderer must not be the authority on which screen it is, and the
 * web-preferences round trip is undocumented territory.
 *
 * @type {Map<number, number>}
 */
const surfaceMonitor = new Map();

/** @type {InstanceType<typeof PauseWatcher> | null} */
let pauseWatcher = null;

/** @type {() => void} */
let unwatchMonitors = () => {};

/**
 * Which host mode the surfaces achieved, and why if it was the fallback.
 *
 * "starting" is a real state, not a placeholder: the windows exist from the
 * moment they are created, but they cannot be attached to the desktop until
 * each one is ready to show. Without it a caller sees `on: true` with
 * `host: "off"` for a few hundred milliseconds and reports it as success.
 */
let hostMode = /** @type {"workerw" | "fallback" | "starting" | "off"} */ ("off");
/** @type {string | null} */
let hostReason = null;

/**
 * What the surfaces need in order to draw. Held here so a surface created
 * later - a monitor plugged in at midnight - starts correct immediately.
 *
 * @type {{
 *   preset: { exposure: number },
 *   place: { lat: number, lon: number },
 *   fps: number,
 *   awaySeconds: number
 * }}
 */
let runtime = {
  preset: { exposure: 0 },
  place: { lat: 39.7, lon: -105 },
  fps: 20,
  awaySeconds: 600
};

/* ------------------------------------------------------------------ serving */

/**
 * Serve `app/` over the custom scheme.
 *
 * The path check is the security-relevant line: a request is resolved inside
 * `app/` and anything that escapes is refused, so a crafted URL cannot read
 * arbitrary files off the disk.
 */
function serveApp() {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
    const target = path.resolve(APP_DIR, relative);

    const inside = path.relative(APP_DIR, target);
    if (inside.startsWith("..") || path.isAbsolute(inside)) {
      return new Response("Forbidden", { status: 403 });
    }

    return net.fetch(pathToFileURL(target).toString());
  });
}

/* ------------------------------------------------------------------ windows */

function createEditor() {
  editor = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 720,
    minHeight: 520,
    backgroundColor: "#0a0d14",
    show: false,
    title: "Day and Night",
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: ["--role=editor", `--app-version=${app.getVersion()}`]
    }
  });

  editor.once("ready-to-show", () => editor?.show());
  void editor.loadURL(`${SCHEME}://app/index.html`);

  // Nothing in this application should ever navigate, and no link should open
  // a window. Anything that tries goes to the user's real browser instead.
  editor.webContents.setWindowOpenHandler(({ url }) => {
    void electronShell.openExternal(url);
    return { action: "deny" };
  });

  editor.on("closed", () => {
    editor = null;
  });
}

/**
 * One borderless window per monitor, parented into the desktop.
 *
 * One window per monitor rather than one spanning them all: per-monitor DPI on
 * a single oversized window is a long-standing Chromium problem, and a monitor
 * that is unplugged should take its window with it and disturb nothing else
 * (ADR 0005).
 */
function createSurfaces() {
  const all = monitors.list();
  if (hostMode === "off") hostMode = "starting";
  hostReason = null;

  for (const monitor of all) {
    if (surfaces.has(monitor.id)) continue;

    const window = new BrowserWindow({
      x: monitor.bounds.x,
      y: monitor.bounds.y,
      width: monitor.bounds.w,
      height: monitor.bounds.h,
      frame: false,
      show: false,
      skipTaskbar: true,
      focusable: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      hasShadow: false,
      thickFrame: false,
      acceptFirstMouse: false,
      backgroundColor: "#000000",
      title: "Day and Night wallpaper",
      webPreferences: {
        preload: PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        additionalArguments: ["--role=wallpaper", `--app-version=${app.getVersion()}`]
      }
    });

    // Captured now, not in the "closed" handler: by the time that fires the
    // WebContents is destroyed and touching it throws "Object has been
    // destroyed" out of an event handler, which Electron shows the user as a
    // crash dialog.
    const contentsId = window.webContents.id;

    surfaces.set(monitor.id, window);
    surfaceMonitor.set(contentsId, monitor.id);

    window.once("ready-to-show", () => {
      window.showInactive();

      const result = host.attachToDesktop(window.getNativeWindowHandle());
      if (result.mode === "workerw") {
        // SetParent reinterprets the window's coordinates rather than moving
        // it, so it has to be placed again afterwards. See moveInDesktop.
        host.moveInDesktop(
          window.getNativeWindowHandle(),
          monitors.physicalRectFor(monitor, monitors.list())
        );
      }

      // The whole set reports the worst outcome: if any screen fell back, the
      // user should be told that rather than shown a cheerful average.
      if (hostMode !== "fallback") hostMode = result.mode;
      if (surfaces.size === 0) hostMode = "off";
      if (result.reason) hostReason = result.reason;

      sendWallpaperState();
    });

    void window.loadURL(`${SCHEME}://app/wallpaper.html`);

    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.on("closed", () => {
      surfaces.delete(monitor.id);
      surfaceMonitor.delete(contentsId);
    });
  }

  pauseWatcher?.start();
  sendWallpaperState();
}

function destroySurfaces() {
  // Snapshotted because destroy() fires "closed" synchronously, and that
  // handler deletes from the very Map this would otherwise be iterating.
  for (const window of [...surfaces.values()]) {
    if (window.isDestroyed()) continue;
    host.detachFromDesktop(window.getNativeWindowHandle());
    window.destroy();
  }
  surfaces.clear();
  surfaceMonitor.clear();

  pauseWatcher?.stop();
  hostMode = "off";
  hostReason = null;
  sendWallpaperState();
}

/** Re-place every surface after the arrangement changes. */
function relayoutSurfaces() {
  const all = monitors.list();
  const ids = new Set(all.map((m) => m.id));

  // A monitor that has gone takes its window with it.
  for (const [id, window] of surfaces) {
    if (ids.has(id)) continue;
    if (!window.isDestroyed()) {
      host.detachFromDesktop(window.getNativeWindowHandle());
      window.destroy();
    }
    surfaces.delete(id);
  }

  for (const monitor of all) {
    const window = surfaces.get(monitor.id);
    if (!window || window.isDestroyed()) continue;

    host.moveInDesktop(window.getNativeWindowHandle(), monitors.physicalRectFor(monitor, all));
    window.webContents.send("wallpaper:geometry", monitors.geometryFor(monitor, all));
  }

  // A monitor that has arrived needs a window of its own.
  if (surfaces.size > 0) createSurfaces();
}

/* ---------------------------------------------------------------- messaging */

/**
 * Send to the editor, if there is one to send to.
 *
 * `editor` is nulled in its own "closed" handler, but a send can be attempted
 * between the window being destroyed and that handler running - and touching a
 * destroyed WebContents throws out of an event handler, which Electron shows
 * the user as a crash dialog.
 *
 * @param {string} channel
 * @param {unknown} payload
 */
function toEditor(channel, payload) {
  if (!editor || editor.isDestroyed()) return;
  editor.webContents.send(channel, payload);
}

function sendWallpaperState() {
  toEditor("wallpaper:stateChanged", wallpaperState());

  // The tray shows the same three facts the editor does, and is often the only
  // thing on screen showing them.
  tray.refresh();
}

/**
 * Two reasons, kept apart.
 *
 * They used to share one field, with the host's winning. That is wrong in the
 * one case where it matters: a machine that fell back to drawing in front of
 * the wallpaper AND is paused because a game is running has two things worth
 * saying, and the user was shown the first and left wondering why nothing
 * moved. `reason` is why the host is what it is; `pausedBecause` is why
 * nothing is being drawn.
 *
 * @returns {{
 *   on: boolean,
 *   host: "workerw" | "fallback" | "starting" | "off",
 *   screens: number,
 *   paused: boolean,
 *   reason: string | null,
 *   pausedBecause: string | null
 * }}
 */
function wallpaperState() {
  const pause = pauseWatcher?.current() ?? { paused: false, reason: null };
  return {
    on: surfaces.size > 0,
    host: hostMode,
    screens: surfaces.size,
    paused: pause.paused,
    reason: hostReason,
    pausedBecause: pause.reason
  };
}

/** @param {boolean} paused */
function broadcastPause(paused) {
  for (const window of surfaces.values()) {
    if (!window.isDestroyed()) window.webContents.send("wallpaper:pause", paused);
  }
  sendWallpaperState();
}

function broadcastConfig() {
  for (const window of surfaces.values()) {
    if (!window.isDestroyed()) window.webContents.send("wallpaper:config", runtime);
  }
}

/* --------------------------------------------------------------- validation */

/**
 * Nothing from a renderer is trusted. A config push is the only message that
 * carries numbers into the engine, and an Infinity or a NaN in a uniform turns
 * the screen black with no clue why - so every field is checked and clamped
 * here rather than hoped about.
 *
 * @param {unknown} raw
 * @returns {typeof runtime | null}
 */
function validateConfig(raw) {
  if (typeof raw !== "object" || raw === null) return null;

  const record = /** @type {Record<string, unknown>} */ (raw);
  const preset = asRecord(record["preset"]);
  const place = asRecord(record["place"]);

  return {
    preset: { exposure: finite(preset["exposure"], 0, -8, 8) },
    place: {
      lat: finite(place["lat"], 39.7, -89.9, 89.9),
      lon: finite(place["lon"], -105, -180, 180)
    },
    fps: Math.round(finite(record["fps"], 20, 1, 60)),
    awaySeconds: Math.round(finite(record["awaySeconds"], 600, 0, 86_400))
  };
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  return typeof value === "object" && value !== null
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
function finite(value, fallback, lo, hi) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(hi, Math.max(lo, value));
}

function registerIpc() {
  ipcMain.handle("monitors:list", () => monitors.list());

  ipcMain.handle("wallpaper:state", () => wallpaperState());

  ipcMain.handle("wallpaper:set", (_event, on) => {
    if (on) createSurfaces();
    else destroySurfaces();
    return wallpaperState();
  });

  ipcMain.handle("wallpaper:initial", (event) => {
    const id = surfaceMonitor.get(event.sender.id);
    const all = monitors.list();
    const monitor = all.find((m) => m.id === id) ?? all[0];
    const geometry = monitor
      ? monitors.geometryFor(monitor, all)
      : { crop: { x: 0, y: 0, w: 1920, h: 1080 }, span: { w: 1920, h: 1080 }, pixelRatio: 1 };

    return { geometry, ...runtime };
  });

  ipcMain.on("config:push", (_event, raw) => {
    const next = validateConfig(raw);
    if (!next) return;
    runtime = next;
    broadcastConfig();

    // The pause policy is the shell's, not a surface's, so this is the only
    // place the new threshold can land. Setting it re-evaluates immediately,
    // which is what makes dragging the control to "never" start the wallpaper
    // again rather than waiting for the next poll.
    pauseWatcher?.setAwaySeconds(next.awaySeconds);
  });

  // Asked of Windows every time rather than remembered, because the user can
  // turn it off in Task Manager's Startup tab or with any cleanup tool, and a
  // checkbox that disagreed with the machine is worse than none.
  ipcMain.handle("startup:get", () => tray.startsWithWindows());

  ipcMain.on("startup:set", (_event, on) => {
    tray.setStartWithWindows(Boolean(on));
    tray.refresh();
  });

  ipcMain.handle("settings:load", () => store.read());

  ipcMain.on("settings:save", (_event, doc) => {
    // Written as given, but only after being read back through the same
    // validator the renderer uses, so a corrupt document cannot be persisted.
    if (typeof doc !== "object" || doc === null) return;
    store.write(doc);
  });
}

/**
 * Put the wallpaper up at login, with no editor and nobody to ask.
 *
 * The settings have to be loaded here, which is the part that is easy to miss.
 * Every other time the application runs, the *renderer* reads the settings
 * file and pushes them down - so a start with no renderer would draw a sky for
 * the default coordinates in Denver rather than for wherever the user actually
 * is. The product's entire claim is that the sky matches the window, and this
 * is the one path where that could silently stop being true.
 *
 * A settings file that is missing or unreadable is the normal first-run case,
 * not an error: the defaults stand and the wallpaper still appears.
 */
async function startWithoutEditor() {
  try {
    const saved = await store.read();
    const doc = asRecord(saved);
    const next = validateConfig(asRecord(doc["cfg"]));
    if (next) {
      runtime = next;
      pauseWatcher?.setAwaySeconds(next.awaySeconds);
    }
  } catch (error) {
    console.error("[main] could not read settings at login; using defaults", error);
  }

  createSurfaces();
}

/* ---------------------------------------------------------------- lifecycle */

// One instance only. A second copy would fight the first for the WorkerW and
// double the cost of a product whose whole argument is that it is cheap.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (editor) {
      if (editor.isMinimized()) editor.restore();
      editor.focus();
    } else {
      createEditor();
    }
  });

  void app.whenReady().then(() => {
    serveApp();
    registerIpc();

    pauseWatcher = new PauseWatcher((state) => broadcastPause(state.paused));
    unwatchMonitors = monitors.watch(() => {
      toEditor("monitors:changed", monitors.list());
      if (surfaces.size > 0) relayoutSurfaces();
    });

    tray.create({
      openEditor: () => {
        if (!editor) {
          createEditor();
          return;
        }
        if (editor.isMinimized()) editor.restore();
        editor.show();
        editor.focus();
      },
      isWallpaperOn: () => surfaces.size > 0,
      setWallpaper: (on) => {
        if (on) createSurfaces();
        else destroySurfaces();
      },
      statusLine: () => {
        const state = wallpaperState();
        if (!state.on) return "The wallpaper is off";
        if (state.paused) {
          return state.pausedBecause ? `Stopped: ${state.pausedBecause}` : "Stopped";
        }
        const screens = `${state.screens} screen${state.screens === 1 ? "" : "s"}`;
        return `Running on ${screens}`;
      }
    });

    // Started by Windows at login, nobody asked for a window. The wallpaper is
    // the product; the editor is a tool, and opening it unbidden at every
    // login is how a wallpaper becomes something people uninstall.
    if (tray.startedByWindows()) {
      void startWithoutEditor();
    } else {
      createEditor();
    }
  });

  // The editor closing does not quit: the wallpaper is the product and it
  // keeps running without it. That used to leave a process with no way back to
  // it and no way to stop it; the tray is now both, which is what OQ-1 was
  // really asking.
  //
  // With the wallpaper off and the editor closed there is nothing left to be,
  // so it quits - the tray alone is not a reason for a process to exist.
  app.on("window-all-closed", () => {
    if (surfaces.size === 0) app.quit();
  });

  app.on("before-quit", () => {
    unwatchMonitors();
    pauseWatcher?.stop();
    tray.destroy();
    destroySurfaces();
    store.flushSync();
  });
}
