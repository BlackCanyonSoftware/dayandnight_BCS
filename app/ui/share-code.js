// @ts-check
/**
 * A look as a short string.
 *
 * US-033, and the same shape as Pixel Galaxy Studio's: a prefix, then
 * base64url of deflate-raw of a small JSON document. Short enough to paste
 * into a message, and written in letters that survive a chat window, a forum
 * post and a phone keyboard.
 *
 * ## What a code carries, and what it must not
 *
 * **Only the preset.** Not where you are, not how often your wallpaper
 * redraws, not your theme. That is architecture invariant 5 arriving at its
 * conclusion: a preset describes appearance and never geometry, so a code made
 * from one cannot move anybody's sky to another country. It would be the worst
 * bug this product could have - somebody pastes a code from a stranger and
 * their sunrise is suddenly two time zones out, with the application still
 * insisting it shows the real sky.
 *
 * The frame rate is left out for the same kind of reason, if a smaller one: it
 * is a cost somebody chose for their own machine, and a code from a desktop
 * should not quietly triple what a laptop spends.
 *
 * ## Why it is a diff
 *
 * Only the settings that differ from the defaults go in. A look that changes
 * four things is a code of about forty characters rather than four hundred,
 * and - more usefully - a setting added to the engine later does not appear in
 * an old code, so it takes its new default instead of being absent and
 * undefined.
 *
 * ## Why it carries a version
 *
 * The same reason a settings file does. A code is a document, it goes through
 * the same validation a file does, and a code from a newer build is refused
 * rather than guessed at.
 *
 * @module ui/share-code
 */

import { APP, VERSION, readDocument } from "./settings.js";
import { defaultPreset } from "../engine/index.js";

/** @typedef {import("../engine/types.js").Preset} Preset */

/**
 * What a code starts with.
 *
 * Named rather than numbered so that a code is recognisable as belonging to
 * this application when somebody finds one with no context - which, for a
 * string people paste into messages, is most of the time.
 */
export const PREFIX = "DAN1-";

/**
 * @param {Uint8Array} bytes
 * @param {boolean} expand
 * @returns {Promise<Uint8Array>}
 */
async function pump(bytes, expand) {
  const stream = expand
    ? new DecompressionStream("deflate-raw")
    : new CompressionStream("deflate-raw");

  const out = new Blob([/** @type {BlobPart} */ (bytes)]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** @param {Uint8Array} bytes */
function toBase64url(bytes) {
  let s = "";
  for (const byte of bytes) s += String.fromCharCode(byte);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** @param {string} text */
function fromBase64url(text) {
  let b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";

  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
}

/**
 * The code for a look.
 *
 * @param {Preset} preset
 * @returns {Promise<string>}
 */
export async function encodeLook(preset) {
  const defaults = defaultPreset();

  /** @type {Record<string, unknown>} */
  const diff = {};
  for (const key of /** @type {(keyof Preset)[]} */ (Object.keys(defaults))) {
    if (preset[key] !== defaults[key]) diff[key] = preset[key];
  }

  const json = JSON.stringify({ v: VERSION, p: diff });
  const packed = await pump(new TextEncoder().encode(json), false);
  return PREFIX + toBase64url(packed);
}

/**
 * @typedef {object} DecodedLook
 * @property {Preset | null} preset null when the text was not a code
 * @property {string | null} problem what to tell the user, or null
 */

/**
 * The look a code carries, laid over the current defaults.
 *
 * Never throws. A code arrives from outside - a message, a forum, somebody's
 * clipboard - so being handed nonsense is the ordinary case rather than an
 * exceptional one, and the caller always has something to show the user.
 *
 * @param {string} text
 * @param {number} [version] the document version this build writes
 * @returns {Promise<DecodedLook>}
 */
export async function decodeLook(text, version = VERSION) {
  // Whitespace anywhere, because every messenger wraps text, and anything that
  // is not a base64url character, because a pasted code collects quotation
  // marks and full stops on the way.
  //
  // The cleaning happens BEFORE the prefix is looked for, which is the order
  // that matters: a code pasted as `"DAN1-abc."` does not start with the
  // prefix until the quotation mark has gone, and stripping in the other order
  // left the prefix in the body, where it is itself valid base64url and
  // decoded to nonsense.
  const cleaned = String(text ?? "")
    .replace(/\s+/g, "")
    .replace(/[^A-Za-z0-9\-_:]/g, "");

  if (!cleaned) return { preset: null, problem: "That is not a look code." };

  // Both readings are tried rather than one chosen, because base64url can
  // itself produce the four letters of the prefix followed by a dash - so
  // "starts with dan1-" is a guess, and trying both costs one inflate of a
  // few dozen bytes.
  const candidates = [cleaned.replace(/^dan1[-:]/i, ""), cleaned].filter(
    (candidate) => candidate.length > 0
  );

  /** @type {unknown} */
  let parsed;
  for (const candidate of candidates) {
    try {
      const bytes = await pump(fromBase64url(candidate.replace(/:/g, "")), true);
      parsed = JSON.parse(new TextDecoder().decode(bytes));
      break;
    } catch {
      parsed = undefined;
    }
  }

  if (parsed === undefined) {
    return { preset: null, problem: "That is not a look code." };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { preset: null, problem: "That is not a look code." };
  }

  const record = /** @type {Record<string, unknown>} */ (parsed);
  if (typeof record["v"] !== "number" || typeof record["p"] !== "object") {
    return { preset: null, problem: "That is not a look code." };
  }

  if (record["v"] > version) {
    return {
      preset: null,
      problem: "That code was made by a newer version of Day and Night."
    };
  }

  // Laid over the current defaults, so a setting that did not exist when the
  // code was made takes its default rather than arriving undefined and
  // reaching a shader as NaN.
  const carried = /** @type {Partial<Preset>} */ (record["p"] ?? {});

  // And then through the settings validator, which is the point: a code comes
  // from outside - a message, a forum, somebody else entirely - and a number
  // out of range in one reaches a shader exactly as fast as a number out of
  // range in a file does. Rather than clamp it again here, the code is made
  // into the smallest honest settings document and read back through the one
  // validator, so a value can only be wrong in one place and is fixed in one
  // place.
  const { doc } = readDocument({
    app: APP,
    version: VERSION,
    savedAt: new Date(0).toISOString(),
    cfg: { preset: { ...defaultPreset(), ...carried } },
    ui: {}
  });

  if (!doc) return { preset: null, problem: "That code could not be read." };
  return { preset: doc.cfg.preset, problem: null };
}
