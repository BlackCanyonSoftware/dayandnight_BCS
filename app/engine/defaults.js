// @ts-check
/**
 * Every setting and its default, in one place.
 *
 * A new setting is a default here with a comment saying what it is for, a
 * schema row with a hint, and a migration entry if it renames or changes the
 * meaning of an existing key (architecture invariant 6).
 *
 * @module engine/defaults
 */

/** @typedef {import("./types.js").Preset} Preset */

/**
 * A fresh preset.
 *
 * Returns a new object every call, never a shared one: a caller that mutates
 * the defaults would poison every later reset, which is a bug that takes an
 * afternoon to find.
 *
 * @returns {Preset}
 */
export function defaultPreset() {
  return {
    // Exposure in stops, applied to linear light before the transfer
    // function. Negative is darker. Part of the grade in ADR 0004, and the
    // one grade control that exists in Milestone 0.
    exposure: 0
  };
}

/**
 * Keys whose change only affects what is drawn, never what is computed.
 *
 * Milestone 0 has nothing expensive to recompute, so every key is here. The
 * distinction starts to matter in Milestone 1, when a change to a key outside
 * this list has to rebake the sky lookup texture and a change to one inside it
 * does not.
 *
 * @type {ReadonlySet<keyof Preset>}
 */
export const DRAW_KEYS = new Set(/** @type {(keyof Preset)[]} */ (["exposure"]));
