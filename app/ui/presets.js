// @ts-check
/**
 * The looks that ship.
 *
 * A preset is a complete appearance laid over the defaults, and nothing else:
 * where you are and how often the wallpaper redraws are not part of it, so
 * switching looks never moves your sky to another country or changes what it
 * costs you. That split is why `Place` and `Performance` sit outside the
 * preset in `defaults.js` - the same reason architecture invariant 5 says a
 * preset describes appearance and never geometry.
 *
 * Every one of these is the same physical sky underneath. None of them paints
 * a sunrise; they adjust haze, a colour cast, exposure and framing over a sky
 * the model has already worked out. That is ADR 0004's bargain, and these are
 * what it buys.
 *
 * @module ui/presets
 */

import { defaultPreset } from "../engine/index.js";

/** @typedef {import("../engine/types.js").Preset} Preset */

/**
 * @typedef {object} Look
 * @property {string} id
 * @property {string} name
 * @property {string} hint one sentence, for the row's `i`
 * @property {Partial<Preset>} preset laid over the defaults
 */

/** @type {readonly Look[]} */
export const LOOKS = [
  {
    id: "clear",
    name: "Clear",
    hint: "The sky as the physics draws it, with no colour cast, nothing exaggerated and no cloud. The one to judge the others against, and the one to start from if you are building your own.",
    preset: {}
  },
  {
    id: "hazy",
    name: "Hazy",
    hint: "More dust and moisture in the air, which whitens the sky, spreads the sun into a broad glow and gives sunsets the deep red that a perfectly clear day never quite manages. A little high cloud comes with it.",
    preset: {
      cloudCover: 0.3,
      cloudSoftness: 0.38,
      cloudScale: 2.6,
      turbidity: 2.8,
      whitePoint: 6,
      saturation: 1.1,
      glare: 1.4,
      twilightTint: "#8f7a6a"
    }
  },
  {
    id: "desert",
    name: "Desert night",
    hint: "A sky far from anywhere: almost no glow of its own, so the stars carry the night. Cool and hard-edged, with the Milky Way's worth of faint stars brought up. No cloud, because that is rather the point of a desert.",
    preset: {
      airglow: 4e-7,
      starBrightness: 1.9,
      starSize: 2.9,
      twinkle: 0.75,
      nightTint: "#6e7fa8",
      contrast: 1.15,
      saturation: 1.1,
      turbidity: 0.7
    }
  },
  {
    id: "town",
    name: "Edge of town",
    hint: "Somebody else's streetlights over the hill. The night sky never goes properly dark and only the brighter stars get through, which is what most people actually see - along with the broken cloud that most people actually have.",
    preset: {
      cloudCover: 0.42,
      cloudScale: 1.4,
      airglow: 3.4e-6,
      starBrightness: 0.65,
      nightTint: "#b08a5e",
      turbidity: 1.6,
      saturation: 0.95
    }
  },
  {
    id: "cinematic",
    name: "Cinematic",
    hint: "Warmer, stronger and larger than life: the sun and moon drawn bigger than they really are, a warm cast through twilight, big cloud to catch that light, and colour pushed the way a film would push it.",
    preset: {
      cloudCover: 0.5,
      cloudScale: 3.4,
      cloudSoftness: 0.16,
      cloudDrift: 16,
      bodyScale: 3.2,
      glare: 1.45,
      turbidity: 1.5,
      twilightTint: "#f7a877",
      dayTint: "#8b8688",
      saturation: 1.18,
      contrast: 1.1,
      whitePoint: 5,
      horizon: 0.74
    }
  },
  {
    id: "quiet",
    name: "Quiet",
    hint: "Softened and dimmed, for a desktop with a lot of icons on it. Low contrast and a high horizon keep the busy part of the sky away from where your files live, and what cloud there is drifts slowly and softly.",
    preset: {
      cloudCover: 0.28,
      cloudSoftness: 0.45,
      cloudScale: 3.0,
      cloudDrift: 7,
      exposure: -0.7,
      contrast: 0.82,
      saturation: 0.85,
      whitePoint: 8,
      glare: 0.6,
      starBrightness: 0.8,
      horizon: 0.92,
      fieldOfView: 120
    }
  },
  {
    id: "weather",
    name: "Big weather",
    hint: "A sky with something happening in it: heavy, large cloud moving at a fair clip, with hard edges that catch the sun along their tops. The most expensive look here, because the more the sky moves the more often it has to be redrawn.",
    preset: {
      cloudCover: 0.72,
      cloudScale: 4.2,
      cloudSoftness: 0.12,
      cloudDrift: 26,
      turbidity: 1.4,
      contrast: 1.12,
      glare: 1.25,
      horizon: 0.78
    }
  },
  {
    id: "widescreen",
    name: "Wide horizon",
    hint: "Almost the whole sky at once, so the sun is in frame from close to sunrise to close to sunset. The trade is that everything looks a little further away. Scattered cloud gives the width something to measure itself against.",
    preset: {
      cloudCover: 0.35,
      cloudScale: 2.2,
      fieldOfView: 190,
      horizon: 0.86,
      glare: 1.2,
      turbidity: 1.3
    }
  }
];

/**
 * A look as a complete preset.
 *
 * @param {string} id
 * @returns {Preset | null}
 */
export function presetFor(id) {
  const look = LOOKS.find((entry) => entry.id === id);
  return look ? { ...defaultPreset(), ...look.preset } : null;
}

/**
 * Which look a preset is, or null if it has been edited away from all of them.
 *
 * Worked out by comparison rather than remembered, so there is no "current
 * look" to fall out of step with what is actually on screen: edit any control
 * and the answer becomes null on its own, and set it back and the name
 * returns.
 *
 * @param {Preset} preset
 * @returns {string | null}
 */
export function lookIdFor(preset) {
  for (const look of LOOKS) {
    const candidate = { ...defaultPreset(), ...look.preset };
    if (samePreset(candidate, preset)) return look.id;
  }
  return null;
}

/**
 * @param {Preset} a
 * @param {Preset} b
 * @returns {boolean}
 */
function samePreset(a, b) {
  const keys = /** @type {(keyof Preset)[]} */ (Object.keys(a));

  return keys.every((key) => {
    const left = a[key];
    const right = b[key];

    // Numbers are compared loosely, because a slider writes back what it can
    // represent: a preset holding 3.2 comes back from a step-0.1 control as
    // 3.2000000000000006, and a strict comparison would make the look appear
    // to have been edited the moment it was applied.
    if (typeof left === "number" && typeof right === "number") {
      return Math.abs(left - right) < 1e-6;
    }
    return left === right;
  });
}
