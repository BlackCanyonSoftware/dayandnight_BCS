/* The light switch.
 *
 * All the theme itself is done in CSS: theme.css follows the reader's system
 * setting through a media query. This only records an override on the root
 * element, which the stylesheet is already written to respect - so the page is
 * the right colour on the first paint whether or not this file ever loads.
 */
const button = document.getElementById("bk-theme");
const root = document.documentElement;

function apply(theme) {
  root.dataset.theme = theme;
  button.setAttribute("aria-pressed", String(theme === "dark"));
  button.setAttribute("aria-label", `Switch to a ${
    theme === "dark" ? "light" : "dark"} background`);
  try { localStorage.setItem("theme", theme); } catch (e) { /* private window */ }
}

try {
  const saved = localStorage.getItem("theme");
  if (saved) apply(saved);
} catch (e) { /* no storage, so the system setting stands */ }

button.addEventListener("click", () => {
  const dark = root.dataset.theme
    ? root.dataset.theme === "dark"
    : matchMedia("(prefers-color-scheme: dark)").matches;
  apply(dark ? "light" : "dark");
});
