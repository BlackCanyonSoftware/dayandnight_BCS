// @ts-check
/**
 * Undo and redo, across every change (US-024).
 *
 * The history is a list of settings documents - the whole state at each step,
 * not a diff - so undoing anything is applying the document before it, through
 * the same path a loaded file takes. That is the point of the design rather
 * than a shortcut: a diff-based history needs an inverse for every kind of
 * change, and the first one somebody forgets to write an inverse for becomes a
 * silent corruption. A snapshot has no inverse to get wrong.
 *
 * Snapshots are cheap here because the state is small - a preset, a place and
 * three numbers - so two hundred of them is a few hundred kilobytes.
 *
 * ## A slider drag is one step
 *
 * Dragging a slider fires an event per pixel, and a history that recorded each
 * would need forty presses of Ctrl+Z to undo one drag. So consecutive changes
 * to the *same single setting*, close together in time, replace the last step
 * rather than adding one.
 *
 * Both conditions matter. Only folding on time would merge a slider drag with
 * whatever the user did a moment later; only folding on the key would merge
 * two deliberate edits of the same slider ten minutes apart. The pair means a
 * step ends when you stop, or when you touch something else.
 *
 * ## What is not in the history
 *
 * **The theme**, because it is a view preference rather than an edit - the
 * same reason a text editor does not undo a change of font size. It also has
 * an obvious toggle of its own, so undo is not the only way back.
 *
 * **Whether the wallpaper is on**, because that is not an edit either: it is
 * an action with an effect outside the application, and Ctrl+Z quietly taking
 * somebody's wallpaper off their desktop would be a surprise of a different
 * order from undoing a colour.
 *
 * @module ui/history
 */

/** How many steps to keep. Beyond this the oldest is dropped. */
const LIMIT = 200;

/**
 * How long a pause ends a step, in milliseconds.
 *
 * Long enough that a slow drag with a moment of hesitation stays one step,
 * short enough that two deliberate nudges of the same slider stay two.
 */
const FOLD_MS = 1200;

/** @typedef {import("./settings.js").SettingsDoc} SettingsDoc */

/** @type {string[]} */
let past = [];
/** @type {string[]} */
let future = [];
/** @type {string | null} */
let current = null;

/** The setting the last step changed, and when - for folding a drag. */
let lastKey = "";
let lastAt = 0;

/**
 * True while a restore is in progress.
 *
 * Restoring applies a document, which runs the same code a user edit does and
 * would otherwise record the undo as a new step - so undo would push what it
 * had just popped and nothing would ever move.
 */
let restoring = false;

/** @type {() => SettingsDoc} */
let readState = () => {
  throw new Error("the history was not given a way to read the state");
};

/** @type {(doc: SettingsDoc) => void} */
let writeState = () => {
  throw new Error("the history was not given a way to apply a state");
};

/** @type {() => void} */
let onChange = () => {};

/**
 * Tell the history how to read and apply the state.
 *
 * Injected rather than imported so this module knows nothing about the editor:
 * it is a stack of opaque strings and two callbacks, which is also what makes
 * it testable without a page.
 *
 * @param {object} wiring
 * @param {() => SettingsDoc} wiring.read
 * @param {(doc: SettingsDoc) => void} wiring.apply
 * @param {() => void} [wiring.changed] called when undo or redo availability changes
 */
export function connect({ read, apply, changed }) {
  readState = read;
  writeState = apply;
  onChange = changed ?? (() => {});

  reset();

  // The state as it is now becomes the baseline, and this is not optional.
  // Without it the first edit finds no current state, becomes the baseline
  // itself, and is therefore unundoable - so the first thing a user does after
  // opening the editor is the one thing they cannot take back. It showed up as
  // a slider drag undoing to its second position rather than its first.
  record();
}

/**
 * The part of a document the history cares about, as a string.
 *
 * The theme and the wallpaper's on/off state are left out - see the note at
 * the top - and the timestamp with them, since a document saved a second later
 * is not a change anybody made.
 *
 * @returns {string}
 */
function snapshot() {
  const doc = readState();
  return JSON.stringify({ version: doc.version, cfg: doc.cfg });
}

/**
 * The one setting that differs between two snapshots, or "" if it is not
 * exactly one.
 *
 * Flattened, because the thing a slider changes is `preset.exposure` rather
 * than `preset` - comparing only the top level would see every slider as the
 * same key and fold two different sliders into one step.
 *
 * @param {string} a
 * @param {string} b
 * @returns {string}
 */
function soleDifference(a, b) {
  /** @param {string} json */
  const flatten = (json) => {
    /** @type {Record<string, string>} */
    const flat = {};
    const walk = (/** @type {unknown} */ value, /** @type {string} */ path) => {
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        for (const [key, inner] of Object.entries(value))
          walk(inner, path ? `${path}.${key}` : key);
        return;
      }
      flat[path] = JSON.stringify(value);
    };
    walk(JSON.parse(json), "");
    return flat;
  };

  const before = flatten(a);
  const after = flatten(b);

  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  let found = "";
  let count = 0;

  for (const key of keys) {
    if (before[key] !== after[key]) {
      found = key;
      count += 1;
      if (count > 1) return "";
    }
  }

  return count === 1 ? found : "";
}

/**
 * Record the state as it now is.
 *
 * Called after anything a user did. Doing nothing when the state has not
 * actually changed is what lets callers be generous about when they call it -
 * a repaint that changed no setting adds no step.
 */
export function record() {
  if (restoring) return;

  const now = snapshot();

  if (current === null) {
    current = now;
    onChange();
    return;
  }

  if (now === current) return;

  const key = soleDifference(current, now);
  const at = Date.now();

  if (key !== "" && key === lastKey && at - lastAt < FOLD_MS && past.length > 0) {
    // The same setting, moments later: the same step, further along.
    current = now;
  } else {
    past.push(current);
    if (past.length > LIMIT) past.shift();
    current = now;
  }

  lastKey = key;
  lastAt = at;

  // Anything new ends the redo branch, which is what every editor does and
  // what anybody expects: you cannot redo a future you have walked away from.
  future = [];
  onChange();
}

/** @param {string} json */
function restore(json) {
  restoring = true;
  try {
    const held = JSON.parse(json);
    writeState(held);
  } finally {
    restoring = false;
  }

  // A restore is never part of a drag, so the next edit starts a fresh step
  // rather than folding into whatever was being dragged before the undo.
  lastKey = "";
  onChange();
}

/** @returns {boolean} whether anything happened */
export function undo() {
  if (past.length === 0 || current === null) return false;

  future.push(current);
  current = /** @type {string} */ (past.pop());
  restore(current);
  return true;
}

/** @returns {boolean} whether anything happened */
export function redo() {
  if (future.length === 0 || current === null) return false;

  past.push(current);
  current = /** @type {string} */ (future.pop());
  restore(current);
  return true;
}

/** @returns {boolean} */
export function canUndo() {
  return past.length > 0;
}

/** @returns {boolean} */
export function canRedo() {
  return future.length > 0;
}

/** Forget everything, as at boot. */
export function reset() {
  past = [];
  future = [];
  current = null;
  lastKey = "";
  lastAt = 0;
  onChange();
}

/** How many steps are held each way, for a test or a readout. */
export function depth() {
  return { past: past.length, future: future.length };
}
