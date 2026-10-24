// @ts-check
"use strict";

/**
 * The tray icon, and starting with Windows.
 *
 * Both halves of OQ-1, together because they answer the same question: how
 * does a program with no window of its own stay reachable?
 *
 * A wallpaper is unusual among desktop applications in that its normal state
 * is to have nothing on screen. The editor is a tool you open, change
 * something in and close; the product carries on without it. That leaves a
 * running process with no way back to it and no way to stop it, which the
 * lifecycle in `main.js` has been noting as a known gap since Milestone 0.
 * The tray is the answer to both, and once there is a tray there is somewhere
 * honest to put "start with Windows" - a checkbox the user can see the state
 * of, rather than a registry entry they have to take on trust.
 *
 * Autostart is Electron's `setLoginItemSettings`, which on Windows writes the
 * `Run` key under HKCU. It is read back rather than remembered: the user can
 * turn it off in Task Manager's Startup tab or with any number of cleanup
 * tools, and a checkbox that disagreed with the machine would be worse than no
 * checkbox. `isEnabled()` asks Windows every time it is shown.
 *
 * @module desktop/tray
 */

const path = require("node:path");
const { Menu, Tray, app, nativeImage } = require("electron");

/**
 * The icon, from the same brand build the installer and the editor use.
 *
 * A `.ico` carries every size Windows asks for, and the tray asks for a small
 * one. Letting Electron pick from the `.ico` gives a drawn-for-16-pixels
 * version rather than a downscale of the 1024, which is the difference between
 * a mark and a smudge at that size.
 */
const ICON = path.join(__dirname, "build", "icon.ico");

/**
 * @typedef {object} TrayActions
 * @property {() => void} openEditor
 * @property {() => boolean} isWallpaperOn
 * @property {(on: boolean) => void} setWallpaper
 * @property {() => string} statusLine what the wallpaper is doing, in words
 */

/** @type {Electron.Tray | null} */
let tray = null;

/** @type {TrayActions | null} */
let actions = null;

/**
 * Whether Windows will start the application at login.
 *
 * Asked rather than stored. See the note at the top of this file.
 *
 * @returns {boolean}
 */
function startsWithWindows() {
  // Not available on every platform, and this is a Windows product, so a
  // failure here is "no" rather than a crash in a tray menu.
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch {
    return false;
  }
}

/**
 * Ask Windows to start the application at login, or stop asking.
 *
 * `openAsHidden` is deliberately not set. It is a macOS option that does
 * nothing on Windows, and the argument below is what actually keeps the editor
 * from appearing at every login.
 *
 * @param {boolean} enabled
 */
function setStartWithWindows(enabled) {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    // Started by Windows, not by a person, so the editor should not appear.
    // `main.js` reads this and puts the wallpaper up without a window.
    args: enabled ? ["--autostart"] : []
  });
}

/** Whether this process was started by Windows at login rather than by a person. */
function startedByWindows() {
  return process.argv.includes("--autostart");
}

/**
 * Build the menu afresh every time it is opened.
 *
 * Rebuilt rather than mutated because three of its four items are a question
 * about the world - is the wallpaper on, what is it doing, does Windows start
 * it - and a menu built once would answer them as they were at launch.
 *
 * @returns {Electron.Menu}
 */
function buildMenu() {
  const on = actions?.isWallpaperOn() ?? false;

  return Menu.buildFromTemplate([
    { label: actions?.statusLine() ?? "Day and Night", enabled: false },
    { type: "separator" },
    {
      label: on ? "Turn the wallpaper off" : "Turn the wallpaper on",
      click: () => actions?.setWallpaper(!on)
    },
    { label: "Settings…", click: () => actions?.openEditor() },
    { type: "separator" },
    {
      label: "Start with Windows",
      type: "checkbox",
      checked: startsWithWindows(),
      click: (item) => setStartWithWindows(item.checked)
    },
    { type: "separator" },
    { label: "Quit Day and Night", click: () => app.quit() }
  ]);
}

/**
 * Put the icon in the tray.
 *
 * @param {TrayActions} handlers
 */
function create(handlers) {
  if (tray) return;
  actions = handlers;

  const image = nativeImage.createFromPath(ICON);
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  tray.setToolTip("Day and Night");

  // Rebuilt on every open, so what it says is true when it is read.
  tray.on("click", () => actions?.openEditor());
  tray.on("right-click", () => tray?.popUpContextMenu(buildMenu()));

  // Windows shows the context menu on left-click too for some shell versions,
  // and a tray icon with no menu attached is a dead end on those. Attaching
  // one gives the shell something to fall back to; the handlers above are
  // what normally runs.
  tray.setContextMenu(buildMenu());
}

/** Take it away again. */
function destroy() {
  tray?.destroy();
  tray = null;
  actions = null;
}

/**
 * Whether the icon is in the tray.
 *
 * Electron keeps no registry of trays, so there is no way to ask the framework
 * this - and "the tray exists" is exactly what a test of OQ-1 needs to know.
 * One accessor is a smaller price than a test that cannot see its subject.
 *
 * @returns {boolean}
 */
function exists() {
  return tray !== null && !tray.isDestroyed();
}

/** Refresh the attached menu after something changed outside it. */
function refresh() {
  if (tray) tray.setContextMenu(buildMenu());
}

module.exports = {
  create,
  destroy,
  exists,
  refresh,
  startsWithWindows,
  setStartWithWindows,
  startedByWindows
};
