"use strict";

/**
 * Prove the WorkerW technique on this machine, without launching the app.
 *
 *   node tools/probe-host.js
 *
 * Milestone 0 exists partly to retire the risk that Electron cannot hold a
 * window behind the desktop icons (ADR 0002). This is the cheapest way to
 * check the Win32 half of that: it runs in plain Node, touches no windows, and
 * says whether `Progman` is there, whether Explorer spawns the wallpaper
 * `WorkerW`, and what the shell thinks the user is doing.
 *
 * It changes nothing. Safe to run at any time.
 */

const host = require("../desktop/host-win32.js");

const result = host.probe();

console.log("platform                :", process.platform, process.arch);
console.log("node                    :", process.version);
console.log("WorkerW available       :", result.available);
if (result.reason) console.log("reason                  :", result.reason);
console.log("user notification state :", host.userNotificationState());

if (!result.available) {
  console.log(
    "\nThe wallpaper would run in its documented fallback mode: visible, but in\n" +
      "front of the existing desktop wallpaper rather than behind the icons."
  );
}

process.exitCode = result.available ? 0 : 1;
