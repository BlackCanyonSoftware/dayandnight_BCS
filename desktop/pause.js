// @ts-check
"use strict";

/**
 * When the wallpaper should stop.
 *
 * A process that runs 24 hours a day earns its place by not running. This
 * module gathers every signal that says nobody is looking at the desktop and
 * reduces them to one boolean, which the wallpaper windows use to tear their
 * render loops down (architecture invariant 7 - tear down, never run and
 * return early).
 *
 * | Signal                       | Source                            |
 * |------------------------------|-----------------------------------|
 * | Full-screen or exclusive app | SHQueryUserNotificationState      |
 * | Session locked               | powerMonitor lock-screen          |
 * | Suspending                   | powerMonitor suspend              |
 * | On battery (configurable)    | powerMonitor                      |
 * | Nobody at the machine        | powerMonitor getSystemIdleTime    |
 *
 * **Why idleness rather than the display's own power state.** US-013 asks for
 * the wallpaper to stop when "the display has powered down", and the obvious
 * reading is to listen for that. Windows will say so - `WM_POWERBROADCAST`
 * with `GUID_CONSOLE_DISPLAY_STATE` - but only to a window procedure, which
 * means registering for the notification and then subclassing a window to
 * receive it. That is a callback into our process from the OS message pump, in
 * a module that ADR 0002 deliberately keeps to a handful of straight-line
 * calls, and it would be the most dangerous code in the application.
 *
 * Idle time asks a better question anyway. The point of the criterion is that
 * nobody is looking, and a display that has powered down is only one of the
 * ways that happens - the other, and the commoner one, is somebody who walked
 * away while the screen is still lit. One number covers both, and because
 * Windows turns the display off from the same idle timer, a threshold at or
 * above the display timeout means the screen is already dark by the time this
 * fires. It costs one Electron call and no Win32 at all.
 *
 * Still to come: desktop occlusion - stopping when windows cover the desktop
 * entirely - which genuinely does need new Win32 calls and is its own slice.
 *
 * @module desktop/pause
 */

const electron = require("electron");
const realHost = require("./host-win32.js");

/**
 * How often to ask the shell what the user is doing.
 *
 * There is no event for "a game went full screen", so this is a poll. Two
 * seconds is chosen against the cost of being wrong: a game that starts costs
 * at most two seconds of wasted rendering, and a game that ends at most two
 * seconds of blank desktop. The call itself is a few microseconds.
 */
const POLL_MS = 2000;

/** States in which nothing of the desktop is visible, so nothing should draw. */
const BLOCKING = new Set(["fullscreen", "presentation", "busy", "not-present"]);

/**
 * How long with no input before nobody is assumed to be there.
 *
 * Ten minutes, which is Windows' own default for switching the display off on
 * mains power. Choosing the same number means that in the ordinary case the
 * screen is already dark when this fires, so the wallpaper stops being drawn
 * at about the moment it stops being visible.
 *
 * It is not shorter on purpose. The sky moves fastest at sunrise, about a
 * quarter of a degree a minute, so a pause that resumed after five minutes
 * could show a visible jump. Ten minutes of a sky nobody is looking at is a
 * better trade than a jump somebody might.
 */
const AWAY_SECONDS = 600;

/**
 * @typedef {object} PauseState
 * @property {boolean} paused
 * @property {string | null} reason
 */

/**
 * The two things this module asks the outside world.
 *
 * Injected so that the policy can be tested. Every branch below is a decision
 * about somebody's machine - locked, on battery, a game running, nobody in the
 * room - and none of them can be reached from a test that has to produce the
 * real condition. With these as arguments they are all nine lines of a table.
 *
 * @typedef {object} Sources
 * @property {{
 *   isOnBatteryPower: () => boolean,
 *   getSystemIdleTime: () => number,
 *   on: (event: string, handler: () => void) => unknown,
 *   off: (event: string, handler: () => void) => unknown
 * }} powerMonitor
 * @property {{ userNotificationState: () => string }} host
 */

class PauseWatcher {
  /**
   * @param {(state: PauseState) => void} onChange
   * @param {Partial<Sources>} [sources] the real ones unless a test says otherwise
   */
  constructor(onChange, sources = {}) {
    /** @type {(state: PauseState) => void} */
    this.onChange = onChange;

    /** @type {Sources} */
    this.sources = {
      // Cast because Electron types `on` as a list of overloads, one per
      // event name, which no single signature is assignable to. The methods
      // are all there; it is the shape of the declaration that does not fit.
      powerMonitor:
        sources.powerMonitor ??
        /** @type {Sources["powerMonitor"]} */ (/** @type {unknown} */ (electron.powerMonitor)),
      host: sources.host ?? realHost
    };

    /** @type {PauseState} */
    this.state = { paused: false, reason: null };

    /**
     * Stop when the machine is on battery. Cautious by default: Chromium's
     * power behaviour on battery is the least predictable part of ADR 0001's
     * accepted downside, so the default is the safe one and the user can
     * choose otherwise.
     * @type {boolean}
     */
    this.pauseOnBattery = true;

    /**
     * Seconds of no input before stopping. Zero never stops for this reason.
     * @type {number}
     */
    this.awaySeconds = AWAY_SECONDS;

    /** @type {boolean} */
    this.locked = false;
    /** @type {boolean} */
    this.suspended = false;

    /** @type {NodeJS.Timeout | null} */
    this.timer = null;

    // Bound once and kept, so they can be removed again in stop(). Arrow
    // functions so `this` survives.
    /** @type {() => void} */
    this.onLock = () => this.update({ locked: true });
    /** @type {() => void} */
    this.onUnlock = () => this.update({ locked: false });
    /** @type {() => void} */
    this.onSuspend = () => this.update({ suspended: true });
    /** @type {() => void} */
    this.onResume = () => this.update({ suspended: false });
    /** @type {() => void} */
    this.onPowerChange = () => this.update({});

    const power = this.sources.powerMonitor;
    power.on("lock-screen", this.onLock);
    power.on("unlock-screen", this.onUnlock);
    power.on("suspend", this.onSuspend);
    power.on("resume", this.onResume);
    power.on("on-ac", this.onPowerChange);
    power.on("on-battery", this.onPowerChange);
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.update({}), POLL_MS);
    this.update({});
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    const power = this.sources.powerMonitor;
    power.off("lock-screen", this.onLock);
    power.off("unlock-screen", this.onUnlock);
    power.off("suspend", this.onSuspend);
    power.off("resume", this.onResume);
    power.off("on-ac", this.onPowerChange);
    power.off("on-battery", this.onPowerChange);
  }

  /** @param {boolean} value */
  setPauseOnBattery(value) {
    this.pauseOnBattery = value;
    this.update({});
  }

  /** @param {number} seconds 0 to never stop for being away */
  setAwaySeconds(seconds) {
    this.awaySeconds = Math.max(0, Math.round(seconds));
    this.update({});
  }

  /**
   * Recompute, and tell the caller only if the answer changed.
   * @param {{ locked?: boolean, suspended?: boolean }} patch
   */
  update(patch) {
    if (patch.locked !== undefined) this.locked = patch.locked;
    if (patch.suspended !== undefined) this.suspended = patch.suspended;

    const next = this.evaluate();
    if (next.paused === this.state.paused && next.reason === this.state.reason) return;

    this.state = next;
    this.onChange(next);
  }

  /**
   * The whole policy, in the order the reasons are worth hearing.
   *
   * Ordered rather than combined on purpose: when several are true at once -
   * and a locked laptop on battery with the screen off is three - the user is
   * told the one that explains the most, not the one that happened to be
   * checked first. Suspending outranks everything because the machine is
   * leaving; being away is last because it is the weakest claim, inferred from
   * a lack of typing rather than observed.
   *
   * @returns {PauseState}
   */
  evaluate() {
    if (this.suspended) return { paused: true, reason: "the computer is going to sleep" };
    if (this.locked) return { paused: true, reason: "the session is locked" };

    if (this.pauseOnBattery && this.sources.powerMonitor.isOnBatteryPower()) {
      return { paused: true, reason: "the computer is on battery" };
    }

    const notification = this.sources.host.userNotificationState();
    if (BLOCKING.has(notification)) {
      return {
        paused: true,
        reason:
          notification === "fullscreen"
            ? "an application is running full screen"
            : `the shell reports ${notification}`
      };
    }

    if (this.awaySeconds > 0) {
      const idle = this.sources.powerMonitor.getSystemIdleTime();
      if (idle >= this.awaySeconds) {
        const minutes = Math.round(idle / 60);
        return {
          paused: true,
          reason: `nobody has touched the computer for ${minutes} minutes`
        };
      }
    }

    return { paused: false, reason: null };
  }

  /** @returns {PauseState} */
  current() {
    return this.state;
  }
}

module.exports = { PauseWatcher, AWAY_SECONDS, POLL_MS, BLOCKING };
