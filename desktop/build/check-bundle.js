// @ts-check
/* electron-builder's afterPack hook.

   Two things a build can silently get wrong, both of which only show up on
   somebody else's machine:

   1. A build without its legal documents is not a release.
   2. koffi's native binary cannot be loaded from inside an asar archive. If
      asarUnpack ever stops matching it, the installer still builds, the
      application still starts, and then it cannot find the desktop - which is
      the entire product. Better to fail here. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

/** Relative to `resources/licenses/`. Every one reaches a customer. */
const REQUIRED_DOCUMENTS = [
  "EULA.md",
  "DISCLAIMER.md",
  "PRIVACY.md",
  "TRADEMARKS.md",
  "THIRD-PARTY-NOTICES.md",
  path.join("third-party", "Electron.MIT.txt"),
  path.join("third-party", "koffi.MIT.txt"),
  // The OFL requires the licence to travel with the font, and both faces are
  // in every build - the brand is named in one and read in the other. See
  // THIRD-PARTY-NOTICES.md.
  path.join("third-party", "Jost.OFL.txt"),
  path.join("third-party", "PublicSans.OFL.txt")
];

/**
 * The part of electron-builder's `AfterPackContext` this hook uses. Typed
 * locally rather than imported, because electron-builder is a development
 * dependency and `maxNodeModuleJsDepth` is 0 on purpose.
 *
 * @typedef {object} AfterPackContext
 * @property {string} appOutDir where the unpacked application was written
 */

/**
 * @param {string} dir
 * @returns {string[]} every file under `dir`, as paths relative to it
 */
function walk(dir) {
  if (!fs.existsSync(dir)) return [];

  /** @type {string[]} */
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const here = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const nested of walk(here)) found.push(path.join(entry.name, nested));
    } else {
      found.push(entry.name);
    }
  }
  return found;
}

/**
 * @param {AfterPackContext} context
 * @returns {Promise<void>}
 */
module.exports = async function checkBundle(context) {
  const out = context.appOutDir;
  const resources = path.join(out, "resources");

  /** @type {string[]} */
  const problems = [];

  for (const document of REQUIRED_DOCUMENTS) {
    if (!fs.existsSync(path.join(resources, "licenses", document))) {
      problems.push(`missing legal document: licenses/${document}`);
    }
  }

  const chromium = [
    path.join(out, "LICENSES.chromium.html"),
    path.join(resources, "LICENSES.chromium.html")
  ].some((candidate) => fs.existsSync(candidate));
  if (!chromium) problems.push("missing legal document: LICENSES.chromium.html (Electron's)");

  // The native binary, which must be OUTSIDE the archive. Found by walking
  // rather than by matching a path, so that a koffi upgrade which moves it
  // still passes and a packaging change which loses it still fails.
  const unpacked = path.join(resources, "app.asar.unpacked");
  const natives = walk(unpacked).filter((file) => file.endsWith(".node"));
  if (natives.length === 0) {
    problems.push(
      "no .node binary under resources/app.asar.unpacked - koffi cannot load from " +
        "inside the asar, so the installed application would not find the desktop. " +
        "Check asarUnpack in electron-builder.yml."
    );
  }

  if (problems.length > 0) {
    throw new Error("This build cannot ship:\n  " + problems.join("\n  "));
  }

  console.log(
    `  • ${REQUIRED_DOCUMENTS.length} legal documents + Chromium's; ` +
      `${natives.length} native binary unpacked (${natives.join(", ")})`
  );
};
