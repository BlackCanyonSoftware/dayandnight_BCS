"use strict";

/**
 * The settings file.
 *
 * `settings.json` in the OS app-data folder, written atomically and debounced
 * to one write per burst of changes. A slider drag produces dozens of change
 * events and must not produce dozens of file writes.
 *
 * Atomic means write to a temporary file and rename over the target: a rename
 * within a volume is atomic, so a crash or a power cut leaves either the old
 * file or the new one, never a half-written one. The alternative - truncating
 * and rewriting in place - is how applications lose a user's settings.
 *
 * @module desktop/store
 */

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { app } = require("electron");

const FILE = "settings.json";
const DEBOUNCE_MS = 400;

/** @type {NodeJS.Timeout | null} */
let timer = null;
/** @type {unknown} */
let pending = null;

/** @returns {string} */
function filePath() {
  return path.join(app.getPath("userData"), FILE);
}

/**
 * Read the settings document, or null if there is not a usable one.
 *
 * A file that will not parse is moved aside rather than deleted, and the
 * caller gets null and loads defaults. Silently destroying something a user
 * may have hand-edited is not ours to do, and keeping it means the problem can
 * be looked at.
 *
 * @returns {Promise<unknown>}
 */
async function read() {
  const target = filePath();

  let raw;
  try {
    raw = await fsp.readFile(target, "utf8");
  } catch (error) {
    // A missing file on first run is the normal case, not a problem.
    if (isNotFound(error)) return null;
    console.error("[store] could not read settings:", error);
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    const aside = `${target}.corrupt-${Date.now()}`;
    try {
      await fsp.rename(target, aside);
      console.error(`[store] settings would not parse; moved to ${aside}`, error);
    } catch (renameError) {
      console.error("[store] settings would not parse and could not be moved", renameError);
    }
    return null;
  }
}

/**
 * Queue a write. Returns at once; the write happens after the burst settles.
 * @param {unknown} doc
 */
function write(doc) {
  pending = doc;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void flushAsync();
  }, DEBOUNCE_MS);
}

/** @returns {Promise<void>} */
async function flushAsync() {
  if (pending === null) return;

  const doc = pending;
  pending = null;

  const target = filePath();
  const temporary = `${target}.tmp`;

  try {
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(temporary, JSON.stringify(doc, null, 2), "utf8");
    await fsp.rename(temporary, target);
  } catch (error) {
    console.error("[store] could not write settings:", error);
  }
}

/**
 * Write anything outstanding, synchronously.
 *
 * Called while the application is quitting, where there is no opportunity to
 * await anything: the process can be gone before a promise resolves. This is
 * the one place a synchronous file write is the right answer.
 */
function flushSync() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (pending === null) return;

  const doc = pending;
  pending = null;

  const target = filePath();
  const temporary = `${target}.tmp`;

  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(temporary, JSON.stringify(doc, null, 2), "utf8");
    fs.renameSync(temporary, target);
  } catch (error) {
    console.error("[store] could not write settings while quitting:", error);
  }
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isNotFound(error) {
  return (
    typeof error === "object" &&
    error !== null &&
    /** @type {{ code?: string }} */ (error).code === "ENOENT"
  );
}

module.exports = { read, write, flushSync, filePath };
