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
 * | Signal                       | Source                       |
 * |------------------------------|------------------------------|
 * | Full-screen or exclusive app | SHQueryUserNotificationState |
 * | Session locked               | powerMonitor lock-screen     |
 * | Suspending                   | powerMonitor suspend         |
 * | On battery (configurable)    | powerMonitor                 |
 *
 * Milestone 2 adds the two signals that need more than an event: desktop
 * occlusion - stopping when windows cover the desktop entirely - and the
 * display powering down, for which Windows gives no Electron event and which
 * needs a `WM_POWERBROADCAST` hook in host-win32.js. The rest are here because
 * Milestone 0's job includes proving the policy works at all.
 *
 * @module desktop/pause
 */

const { powerMonitor } = require("electron");
const host = require("./host-win32.js");

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
 * @typedef {object} PauseState
 * @property {boolean} paused
 * @property {string | null} reason
 */

class PauseWatcher {
  /** @param {(state: PauseState) => void} onChange */
  constructor(onChange) {
    /** @type {(state: PauseState) => void} */
    this.onChange = onChange;

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

    powerMonitor.on("lock-screen", this.onLock);
    powerMonitor.on("unlock-screen", this.onUnlock);
    powerMonitor.on("suspend", this.onSuspend);
    powerMonitor.on("resume", this.onResume);
    powerMonitor.on("on-ac", this.onPowerChange);
    powerMonitor.on("on-battery", this.onPowerChange);
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

    powerMonitor.off("lock-screen", this.onLock);
    powerMonitor.off("unlock-screen", this.onUnlock);
    powerMonitor.off("suspend", this.onSuspend);
    powerMonitor.off("resume", this.onResume);
    powerMonitor.off("on-ac", this.onPowerChange);
    powerMonitor.off("on-battery", this.onPowerChange);
  }

  /** @param {boolean} value */
  setPauseOnBattery(value) {
    this.pauseOnBattery = value;
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

  /** @returns {PauseState} */
  evaluate() {
    if (this.suspended) return { paused: true, reason: "the computer is going to sleep" };
    if (this.locked) return { paused: true, reason: "the session is locked" };

    if (this.pauseOnBattery && powerMonitor.isOnBatteryPower()) {
      return { paused: true, reason: "the computer is on battery" };
    }

    const notification = host.userNotificationState();
    if (BLOCKING.has(notification)) {
      return {
        paused: true,
        reason:
          notification === "fullscreen"
            ? "an application is running full screen"
            : `the shell reports ${notification}`
      };
    }

    return { paused: false, reason: null };
  }

  /** @returns {PauseState} */
  current() {
    return this.state;
  }
}

module.exports = { PauseWatcher };
