/**
 * A static file server for `app/`, used by the browser tests and for poking at
 * the editor without the Electron shell.
 *
 * The packaged application does not use this: it serves `app/` from its own
 * `dayandnight://` scheme (see desktop/main.js). This exists because WebGL2 and
 * ES modules both want a real origin, and `file://` is not one.
 *
 *   node tools/serve.js [port] [--open] [--auto-exit]
 *
 * --auto-exit stops the server once the last client has been gone for a few
 * seconds, so `npm start` does not leave a process behind.
 */

"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.join(__dirname, "..", "app");
const PORT = Number(process.argv[2]) || 5178;
const OPEN = process.argv.includes("--open");
const AUTO_EXIT = process.argv.includes("--auto-exit");
const IDLE_MS = 8000;

/** @type {Record<string, string>} */
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
  ".bin": "application/octet-stream"
};

/**
 * Resolve a request path to a file inside ROOT, or null if it escapes.
 * @param {string} urlPath
 * @returns {string | null}
 */
function resolveInRoot(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  const rel = clean === "/" ? "index.html" : clean.replace(/^\/+/, "");
  const abs = path.resolve(ROOT, rel);
  // path.relative is the check: anything starting with ".." is outside ROOT.
  const inside = path.relative(ROOT, abs);
  if (inside.startsWith("..") || path.isAbsolute(inside)) return null;
  return abs;
}

/** @type {NodeJS.Timeout | null} */
let idleTimer = null;
let openRequests = 0;

function armIdleExit() {
  if (!AUTO_EXIT) return;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (openRequests === 0) {
      console.log("No clients for a while; stopping.");
      process.exit(0);
    }
  }, IDLE_MS);
}

const server = http.createServer((req, res) => {
  openRequests += 1;
  res.on("finish", () => {
    openRequests -= 1;
    armIdleExit();
  });

  const file = resolveInRoot(req.url ?? "/");
  if (!file) {
    res.writeHead(403, { "content-type": "text/plain" }).end("Forbidden");
    return;
  }

  fs.readFile(file, (err, body) => {
    if (err) {
      res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
      return;
    }
    res.writeHead(200, {
      "content-type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(body);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${PORT}/`;
  console.log(`Serving ${ROOT}\n  at ${url}`);
  armIdleExit();
  if (OPEN) spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
});
