// @ts-check
/**
 * Light, dark, or follow Windows, behind one sun/moon button.
 *
 * Dark is the default because this is a tool you reach for in the evening.
 * `system` is the third state rather than the only behaviour, because a user
 * who wants the editor dark while Windows is light should be able to say so.
 *
 * @module ui/theme
 */

import { $ } from "./util.js";

/** @typedef {"system" | "light" | "dark"} Theme */

const KEY = "dayandnight.theme";

/** The order the button cycles through. */
const ORDER = /** @type {Theme[]} */ (["dark", "light", "system"]);

/** @type {Theme} */
let current = "dark";

/** @returns {Theme} */
export function theme() {
  return current;
}

/**
 * Apply a theme and remember it.
 *
 * `system` removes the attribute entirely rather than setting it to anything,
 * which is what lets the `prefers-color-scheme` block in tokens.css take over:
 * that block is guarded against an explicit choice, so an attribute of any
 * value would defeat it.
 *
 * @param {Theme} next
 */
export function setTheme(next) {
  current = next;
  const root = document.documentElement;
  if (next === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", next);

  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Not worth a message: the theme simply will not be remembered.
  }

  paintButton();
}

/** Move to the next theme in the cycle. */
export function cycleTheme() {
  const i = ORDER.indexOf(current);
  setTheme(ORDER[(i + 1) % ORDER.length] ?? "dark");
}

/** Read the remembered choice and apply it. */
export function initTheme() {
  /** @type {Theme} */
  let saved = "dark";
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === "light" || raw === "dark" || raw === "system") saved = raw;
  } catch {
    // Keep the default.
  }
  setTheme(saved);
}

/**
 * The icon shows what you would get, not what you have: a moon when clicking
 * takes you to dark. Which of the two conventions to use is a coin toss, so
 * the title attribute says plainly which theme is active.
 */
function paintButton() {
  const button = $("#themeBtn");
  const sun = button.querySelectorAll(".ico-sun");
  const moon = button.querySelector(".ico-moon");
  if (!moon) return;

  const showMoon = current === "dark";
  for (const node of sun) node.toggleAttribute("hidden", showMoon);
  moon.toggleAttribute("hidden", !showMoon);

  const label = current === "system" ? "following Windows" : current === "dark" ? "dark" : "light";
  button.setAttribute("title", `Theme: ${label}. Click to change.`);
  button.setAttribute("aria-label", `Theme: ${label}. Click to change.`);
}
