// @ts-check
"use strict";

/**
 * The documents a build ships, read back for the About panel.
 *
 * `electron-builder.yml` copies `licenses/` next to the application and
 * `desktop/build/check-bundle.js` fails the build without them, so by the time
 * anything runs they are there. Until now nothing opened them, which made the
 * whole arrangement a promise to a customer that the product could not keep.
 *
 * They are read here rather than sent to the shell's file handler on purpose.
 * A `.md` file has no reliable association on Windows - it may open in an
 * editor, in a browser, or not at all - and "your licence is in a file you may
 * not be able to open" is not an answer. They are also written in plain
 * language specifically to be read, so showing them as text loses nothing.
 *
 * @module desktop/legal
 */

const fsp = require("node:fs/promises");
const path = require("node:path");
const { app } = require("electron");

/**
 * What may be asked for, and what to call it.
 *
 * A fixed list rather than a directory listing, which is what makes a name
 * arriving over IPC harmless: the renderer picks an index into this, and a
 * path never crosses the boundary in either direction. `SOURCE-LICENSE.md` is
 * absent because it is not shipped - it governs the repository, not a build.
 *
 * @type {readonly { id: string, title: string, file: string }[]}
 */
const DOCUMENTS = [
  { id: "eula", title: "Licence agreement", file: "EULA.md" },
  { id: "disclaimer", title: "Disclaimers", file: "DISCLAIMER.md" },
  { id: "privacy", title: "Privacy", file: "PRIVACY.md" },
  { id: "trademarks", title: "Names and marks", file: "TRADEMARKS.md" },
  { id: "notices", title: "Third-party notices", file: "THIRD-PARTY-NOTICES.md" }
];

/**
 * Where the documents are.
 *
 * Two answers, because a packaged application and a checkout keep them in
 * different places, and the one that only works in development is the one that
 * passes every test and then ships broken.
 *
 * @returns {string}
 */
function folder() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "licenses")
    : path.join(__dirname, "..", "licenses");
}

/** @returns {{ id: string, title: string }[]} */
function list() {
  return DOCUMENTS.map(({ id, title }) => ({ id, title }));
}

/**
 * One document's text, or null if it is not one of ours or is not there.
 *
 * @param {unknown} id
 * @returns {Promise<string | null>}
 */
async function read(id) {
  const found = DOCUMENTS.find((entry) => entry.id === id);
  if (!found) return null;

  try {
    return await fsp.readFile(path.join(folder(), found.file), "utf8");
  } catch (error) {
    // A build missing a document is a packaging fault that check-bundle.js is
    // there to prevent, so if it happens it is worth a line in the log rather
    // than a silent empty panel.
    console.error(`[legal] could not read ${found.file}`, error);
    return null;
  }
}

module.exports = { DOCUMENTS, folder, list, read };
