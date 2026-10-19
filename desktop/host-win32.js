"use strict";

/**
 * The only module in the project that calls Win32 (architecture invariant 8).
 *
 * Its job is to get a window to draw *behind the desktop icons*. Windows has
 * no API for that, so the technique is the one every live-wallpaper
 * application uses:
 *
 *   1. Find `Progman`, the Explorer window that owns the desktop.
 *   2. Send it the undocumented message 0x052C. This asks Explorer to split
 *      the desktop into layers and spawn a `WorkerW` window behind the icons.
 *   3. Walk the top-level windows for the `WorkerW` that has **no**
 *      `SHELLDLL_DefView` child. There are usually two: the one that owns
 *      `SHELLDLL_DefView` is the icon layer and sits in front; the other is
 *      the wallpaper layer and sits behind. We want the second.
 *   4. `SetParent` our window into it.
 *
 * It exposes intent rather than mechanism, so a hand-written N-API addon could
 * replace the body without anything above it changing (ADR 0002):
 *
 *   attachToDesktop(hwnd)   -> "workerw" | "fallback"
 *   detachFromDesktop(hwnd)
 *   userNotificationState() -> "normal" | "fullscreen" | ...
 *
 * @module desktop/host-win32
 */

const koffi = require("koffi");

/** The undocumented Progman message that spawns the WorkerW layer. */
const WM_SPAWN_WORKER = 0x052c;

/** SendMessageTimeout flags: SMTO_NORMAL | SMTO_ABORTIFHUNG. */
const SMTO_ABORTIFHUNG = 0x0002;

/** How long to wait for Explorer. It is normally instant; a hung shell is not. */
const SPAWN_TIMEOUT_MS = 1000;

/**
 * QUERY_USER_NOTIFICATION_STATE, from ShellAPI.h. The two that matter are
 * RUNNING_D3D_FULL_SCREEN and PRESENTATION_MODE; BUSY and
 * ACCEPTS_NOTIFICATIONS are the ordinary cases.
 */
/** @typedef {"normal" | "busy" | "fullscreen" | "presentation" | "quiet-time" | "not-present" | "unknown"} NotificationState */

/** @type {Record<number, NotificationState>} */
const QUNS = {
  1: "not-present", // QUNS_NOT_PRESENT - the user's screen is off or locked
  2: "busy", // QUNS_BUSY - a full-screen window, not necessarily exclusive
  3: "fullscreen", // QUNS_RUNNING_D3D_FULL_SCREEN
  4: "presentation", // QUNS_PRESENTATION_MODE
  5: "normal", // QUNS_ACCEPTS_NOTIFICATIONS
  6: "quiet-time", // QUNS_QUIET_TIME
  7: "busy" // QUNS_APP (Windows 8+ app in the foreground)
};

/** @type {Win32 | null} */
let win32 = null;
/** @type {string | null} */
let loadError = null;

/**
 * @typedef {object} Win32
 * @property {Function} FindWindowW
 * @property {Function} FindWindowExW
 * @property {Function} SendMessageTimeoutW
 * @property {Function} EnumWindows
 * @property {Function} SetParent
 * @property {Function} MoveWindow
 * @property {Function} GetClassNameW
 * @property {Function} SHQueryUserNotificationState
 * @property {any} enumProto
 */

/**
 * Declare the handful of calls we need, once.
 *
 * Handles are declared as `uintptr` rather than as pointers on purpose: a
 * window handle is an opaque integer, and treating it as a number keeps every
 * value crossing this boundary a plain JavaScript primitive. There is nothing
 * for koffi to marshal and nothing for us to get wrong about ownership.
 *
 * @returns {Win32 | null} null if the libraries could not be loaded
 */
function load() {
  if (win32) return win32;
  if (loadError) return null;

  try {
    const user32 = koffi.load("user32.dll");
    const shell32 = koffi.load("shell32.dll");

    const enumProto = koffi.proto("__stdcall", "WndEnumProc", "bool", ["uintptr", "intptr"]);

    win32 = {
      FindWindowW: user32.func("__stdcall", "FindWindowW", "uintptr", ["str16", "str16"]),

      FindWindowExW: user32.func("__stdcall", "FindWindowExW", "uintptr", [
        "uintptr",
        "uintptr",
        "str16",
        "str16"
      ]),

      SendMessageTimeoutW: user32.func("__stdcall", "SendMessageTimeoutW", "intptr", [
        "uintptr",
        "uint32",
        "uintptr",
        "intptr",
        "uint32",
        "uint32",
        koffi.out(koffi.pointer("uintptr"))
      ]),

      EnumWindows: user32.func("__stdcall", "EnumWindows", "bool", [
        koffi.pointer(enumProto),
        "intptr"
      ]),

      SetParent: user32.func("__stdcall", "SetParent", "uintptr", ["uintptr", "uintptr"]),

      MoveWindow: user32.func("__stdcall", "MoveWindow", "bool", [
        "uintptr",
        "int32",
        "int32",
        "int32",
        "int32",
        "bool"
      ]),

      GetClassNameW: user32.func("__stdcall", "GetClassNameW", "int32", [
        "uintptr",
        koffi.out(koffi.pointer("char16")),
        "int32"
      ]),

      SHQueryUserNotificationState: shell32.func(
        "__stdcall",
        "SHQueryUserNotificationState",
        "int32",
        [koffi.out(koffi.pointer("int32"))]
      ),

      enumProto
    };

    return win32;
  } catch (error) {
    loadError = error instanceof Error ? error.message : String(error);
    return null;
  }
}

/**
 * Why the host could not do the real thing, if it could not.
 * @returns {string | null}
 */
function problem() {
  return loadError;
}

/**
 * An Electron native window handle (a Buffer) as an integer.
 *
 * @param {Buffer} handle from `BrowserWindow.getNativeWindowHandle()`
 * @returns {number}
 */
function handleToNumber(handle) {
  if (!Buffer.isBuffer(handle)) throw new TypeError("Expected a native window handle Buffer.");

  // 8 bytes on x64, 4 on x86. Window handles are small, so the BigInt always
  // fits a double; Number() here cannot lose a bit in practice.
  const value = handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0));
  return Number(value);
}

/**
 * Ask Explorer to spawn the wallpaper layer, then find it.
 *
 * @returns {number} the WorkerW handle, or 0 if there is not one
 */
function findWallpaperWorkerW() {
  const api = load();
  if (!api) return 0;

  const progman = api.FindWindowW("Progman", null);
  if (!progman) return 0;

  // The result is ignored: what matters is the side effect on Explorer. The
  // timeout means a hung shell costs us a second, not the launch.
  const result = [0];
  api.SendMessageTimeoutW(
    progman,
    WM_SPAWN_WORKER,
    0,
    0,
    SMTO_ABORTIFHUNG,
    SPAWN_TIMEOUT_MS,
    result
  );

  // Walk every top-level window for a WorkerW with no SHELLDLL_DefView child.
  let found = 0;

  const callback = koffi.register(
    /** @param {number} hwnd */ (hwnd) => {
      if (className(api, hwnd) !== "WorkerW") return true;

      // The WorkerW that owns SHELLDLL_DefView is the icon layer, in front of
      // the wallpaper. The one without it is the layer we want.
      const defView = api.FindWindowExW(hwnd, 0, "SHELLDLL_DefView", null);
      if (defView) return true;

      found = hwnd;
      return false; // stop enumerating
    },
    koffi.pointer(api.enumProto)
  );

  try {
    api.EnumWindows(callback, 0);
  } finally {
    // Registered callbacks are a fixed-size pool; leaking them exhausts it.
    koffi.unregister(callback);
  }

  return found;
}

/**
 * @param {Win32} api
 * @param {number} hwnd
 * @returns {string}
 */
function className(api, hwnd) {
  const buffer = Buffer.alloc(256 * 2);
  const length = api.GetClassNameW(hwnd, buffer, 256);
  if (length <= 0) return "";
  return buffer.toString("utf16le", 0, length * 2);
}

/**
 * Put a window behind the desktop icons.
 *
 * Returns which mode was achieved rather than throwing, because the fallback
 * is a supported degraded mode and not a failure: the product still works and
 * is still visible, it just sits in front of the user's static wallpaper
 * instead of behind the icons. The editor says which mode is active, so a
 * future Windows change shows up as a visible difference rather than a blank
 * desktop (ADR 0002).
 *
 * @param {Buffer} nativeHandle from `BrowserWindow.getNativeWindowHandle()`
 * @returns {{ mode: "workerw" | "fallback", reason: string | null }}
 */
function attachToDesktop(nativeHandle) {
  if (process.platform !== "win32") {
    return { mode: "fallback", reason: "The desktop host is only implemented for Windows." };
  }

  const api = load();
  if (!api) {
    return {
      mode: "fallback",
      reason: `The Windows desktop libraries could not be loaded (${problem()}), so the wallpaper is running in front of your existing wallpaper.`
    };
  }

  const workerW = findWallpaperWorkerW();
  if (!workerW) {
    return {
      mode: "fallback",
      reason:
        "No wallpaper layer was found behind the desktop icons, so the wallpaper is running in front of your existing wallpaper. Restarting Windows Explorer usually fixes it."
    };
  }

  try {
    const hwnd = handleToNumber(nativeHandle);
    api.SetParent(hwnd, workerW);
    return { mode: "workerw", reason: null };
  } catch (error) {
    return {
      mode: "fallback",
      reason: `The window could not be attached to the desktop (${
        error instanceof Error ? error.message : String(error)
      }).`
    };
  }
}

/**
 * Position a window inside the desktop layer.
 *
 * This is needed because `SetParent` does not move a window - it changes what
 * its coordinates *mean*. Before reparenting they are virtual-screen
 * coordinates; afterwards they are relative to WorkerW's client area, whose
 * origin is the top-left of the virtual screen. So a window that was correctly
 * placed jumps by the virtual screen's offset the moment it is adopted, and
 * Electron's own `setBounds` cannot put it back because that works in screen
 * coordinates.
 *
 * The coordinates here are therefore physical pixels relative to the virtual
 * screen's top-left, which is exactly the crop rectangle the renderer is
 * given - the same number serving two purposes, which is a good sign the
 * model is right.
 *
 * @param {Buffer} nativeHandle
 * @param {{ x: number, y: number, w: number, h: number }} rect
 * @returns {boolean}
 */
function moveInDesktop(nativeHandle, rect) {
  const api = load();
  if (!api) return false;
  try {
    return Boolean(
      api.MoveWindow(
        handleToNumber(nativeHandle),
        Math.round(rect.x),
        Math.round(rect.y),
        Math.round(rect.w),
        Math.round(rect.h),
        true
      )
    );
  } catch {
    return false;
  }
}

/**
 * Take a window back out of the desktop, so it can be closed cleanly.
 *
 * @param {Buffer} nativeHandle
 */
function detachFromDesktop(nativeHandle) {
  const api = load();
  if (!api) return;
  try {
    api.SetParent(handleToNumber(nativeHandle), 0);
  } catch {
    // The window is being destroyed anyway; a failure here changes nothing.
  }
}

/**
 * What the user is doing, as far as the shell knows.
 *
 * `"fullscreen"` and `"presentation"` are the two that must stop rendering: a
 * game has the GPU and a wallpaper behind it is pure waste. `"busy"` is a
 * maximised or full-screen window that is not exclusive - also worth stopping
 * for, since nothing of the desktop is visible.
 *
 * @returns {NotificationState}
 */
function userNotificationState() {
  const api = load();
  if (!api) return "unknown";

  try {
    const out = [0];
    const hr = api.SHQueryUserNotificationState(out);
    if (hr !== 0) return "unknown";
    return QUNS[out[0]] ?? "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Whether the real technique is available at all. Used by the probe and by
 * the editor's host note; everything else should call `attachToDesktop` and
 * read the mode it returns.
 *
 * @returns {{ available: boolean, reason: string | null }}
 */
function probe() {
  if (process.platform !== "win32") {
    return { available: false, reason: "not Windows" };
  }
  const api = load();
  if (!api) return { available: false, reason: problem() };

  const progman = api.FindWindowW("Progman", null);
  if (!progman) return { available: false, reason: "Progman not found; is Explorer running?" };

  const workerW = findWallpaperWorkerW();
  if (!workerW) return { available: false, reason: "no WorkerW behind the icons" };

  return { available: true, reason: null };
}

module.exports = {
  attachToDesktop,
  moveInDesktop,
  detachFromDesktop,
  userNotificationState,
  probe
};
