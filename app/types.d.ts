/**
 * The globals a window exposes, declared so that callers - the editor's own
 * modules, the browser tests, the desktop tests and the measurement tool -
 * are all held to the same shape.
 *
 * These are contracts, not conveniences. `window.DayAndNight` is what a test
 * or a script may ask of the editor without clicking, and `window.dayAndNight`
 * is the named bridge `desktop/preload.js` exposes. Changing either one
 * changes something outside this file, so the type is where that is noticed.
 */

import type { FrameInfo, Place, Preset, Rect, Span } from "./engine/types.js";

declare global {
  /** One screen, as the shell reports it. */
  interface DayAndNightMonitor {
    id: number;
    bounds: Rect;
    scale: number;
    primary: boolean;
  }

  interface DayAndNightWallpaperState {
    on: boolean;
    host: "workerw" | "fallback" | "starting" | "off";
    screens: number;
    paused: boolean;
    /** Why the host is what it is - a fallback, say. Not why it is paused. */
    reason: string | null;
    /** Why nothing is being drawn, or null when something is. */
    pausedBecause: string | null;
  }

  interface DayAndNightSettingsDoc {
    app: string;
    version: number;
    savedAt: string;
    cfg: { preset: Preset; place: Place; fps: number };
    ui: { theme: "system" | "light" | "dark" };
  }

  /** The editor's page API. Present only in the editor window. */
  interface DayAndNightPageApi {
    lastFrame(): FrameInfo | null;
    document(): DayAndNightSettingsDoc;
    /** @returns a problem to show the user, or null on success */
    apply(raw: unknown): string | null;
    setScreens(list: import("./engine/span.js").Monitor[]): void;
    scrubTo(minute: number): void;
    dateTo(value: string): void;
    version(): string;
  }

  /** The shell bridge from desktop/preload.js. Absent in a plain browser. */
  interface DayAndNightShellApi {
    version: string;
    getMonitors(): Promise<DayAndNightMonitor[]>;
    onMonitorsChanged(cb: (monitors: DayAndNightMonitor[]) => void): void;
    setWallpaper(on: boolean): Promise<DayAndNightWallpaperState>;
    getWallpaperState(): Promise<DayAndNightWallpaperState>;
    onWallpaperState(cb: (state: DayAndNightWallpaperState) => void): void;
    pushConfig(config: { preset: Preset; place: Place; fps: number }): void;
    loadSettings(): Promise<unknown>;
    saveSettings(doc: unknown): void;
  }

  /** A wallpaper surface's bridge. Present only in a wallpaper window. */
  interface DayAndNightWallpaperApi {
    getInitial(): Promise<{
      geometry: { crop: Rect; span: Span; pixelRatio: number };
      preset: Preset;
      place: Place;
      fps: number;
    }>;
    onConfig(cb: (c: { preset: Preset; place: Place; fps: number }) => void): void;
    onGeometry(cb: (g: { crop: Rect; span: Span; pixelRatio: number }) => void): void;
    onPause(cb: (paused: boolean) => void): void;
  }

  interface Window {
    DayAndNight: DayAndNightPageApi;
    dayAndNight?: DayAndNightShellApi;
    wallpaper?: DayAndNightWallpaperApi;
  }
}

export {};
