// @ts-check
/**
 * Boot, and the wiring of every control.
 *
 * The only module that touches the DOM broadly. It reads the saved document,
 * puts the state together, starts the preview loop, and connects each control
 * to a setter in `state.js`. Nothing here computes anything about the sky.
 *
 * @module ui/index
 */

import { defaultPreset, resolveBearing, twilightBand } from "../engine/index.js";
import * as timeline from "./clock.js";
import * as shell from "./desktop.js";
import { createPreview } from "./preview.js";
import { drawBands } from "./scrubber.js";
import { guessPlace, labelFor, nearestCity, resolveCity, suggest } from "./place.js";
import { LOOKS, lookIdFor, presetFor } from "./presets.js";
import { STYLES as SKYLINE_STYLES } from "../engine/sky/skyline.js";
import { readDocument, writeDocument } from "./settings.js";
import {
  arrangement,
  awaySeconds,
  clock,
  cropFor,
  fps,
  monitors,
  place,
  preset,
  replacePreset,
  setAwaySeconds,
  setFps,
  setMonitors,
  setPlace,
  setPreset,
  setWallpaperOn,
  span,
  wallpaperOn
} from "./state.js";
import { cycleTheme, initTheme, setTheme, theme } from "./theme.js";
import {
  $,
  fmtBearing,
  fmtDegrees,
  fmtExposure,
  fmtTime,
  input,
  notice,
  select,
  toDateInputValue
} from "./util.js";

/** @typedef {import("../engine/types.js").FrameInfo} FrameInfo */

const previewCanvas = /** @type {HTMLCanvasElement} */ ($("#preview"));
const bandsCanvas = /** @type {HTMLCanvasElement} */ ($("#scrubBands"));

/** @type {ReturnType<typeof createPreview> | null} */
let preview = null;

/**
 * The scrubber bands are a few hundred evaluations, so they are repainted at
 * the end of a burst of changes rather than on every input event of a drag.
 */
let bandsDirty = true;

/* ------------------------------------------------------------------- boot */

async function boot() {
  initTheme();

  await loadSaved();
  setMonitors(await shell.getMonitors());
  paintMonitors();

  try {
    preview = createPreview(previewCanvas, onFrame);
  } catch (error) {
    // No WebGL2 is the one failure that stops the product working, so it is
    // said plainly rather than logged. The message comes from the engine and
    // is written for a user.
    notice(error instanceof Error ? error.message : String(error));
    return;
  }

  wireControls();
  void wireAbout();
  timeline.snapToNow(Date.now());
  paintFromState();
  syncClockControls();

  preview.start();
  void refreshWallpaperState();

  // Put the sky back if it was up when the application last closed. Without
  // this, a restart leaves somebody looking at their old wallpaper wondering
  // where theirs went, and reaching for a button they should not have to press
  // twice. The shell is the authority on whether it is on, so this asks first
  // and then lets the ordinary state message paint the answer.
  if (wallpaperOn && shell.hasShell()) {
    const current = await shell.getWallpaperState();
    if (!current.on) paintWallpaperState(await shell.setWallpaper(true));
  }

  shell.onMonitorsChanged((next) => {
    setMonitors(next);
    paintMonitors();
    preview?.resize();
    bandsDirty = true;
  });

  shell.onWallpaperState(paintWallpaperState);

  // Invariant 7: a preview nobody can see is torn down, not left spinning.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) preview?.stop();
    else preview?.start();
  });

  window.addEventListener("resize", () => preview?.resize());
}

async function loadSaved() {
  const { doc, problem } = readDocument(await shell.loadSettings());
  if (problem) notice(problem);

  if (!doc) {
    // Nothing saved, so this is a first run. Guess where we are rather than
    // opening on a default somebody else chose - a sky for the wrong
    // continent is the first thing a new user would see, and the worst
    // possible first impression for a product whose whole claim is that it
    // matches the window (US-010).
    //
    // From the time zone, which the machine already knows. Nothing is asked
    // for and nothing is sent (NFR-5).
    const guess = guessPlace();
    if (guess) {
      setPlace(guess.place);
      $("#guessNote").textContent = `Set to ${guess.description}.`;
    }
    return;
  }

  replacePreset(doc.cfg.preset);
  setPlace(doc.cfg.place);
  setFps(doc.cfg.fps);
  setAwaySeconds(doc.cfg.awaySeconds);
  setTheme(doc.ui.theme);
}

/* --------------------------------------------------------------- controls */

function wireControls() {
  fillLookList();

  select("look").addEventListener("change", (event) => {
    const chosen = presetFor(/** @type {HTMLSelectElement} */ (event.target).value);
    if (!chosen) return;

    // A look replaces the whole appearance rather than patching it, so
    // switching away from an edited preset does not leave fragments of the
    // old one behind.
    replacePreset(chosen);
    bandsDirty = true;
    paintFromState();
    save();
  });

  bindRange("lat", (v) => {
    setPlace({ lat: v });
    bandsDirty = true;
  });
  bindRange("lon", (v) => {
    setPlace({ lon: v });
    bandsDirty = true;
  });
  bindRange("exposure", (v) => {
    setPreset({ exposure: v });
    bandsDirty = true;
  });
  bindRange("whitePoint", (v) => {
    setPreset({ whitePoint: v });
    bandsDirty = true;
  });
  // -1 on the slider is "auto": face whichever side of the sky the sun
  // crosses. It is the leftmost position rather than a separate control,
  // because a checkbox beside a slider for the same setting reads as two
  // settings.
  bindRange("bearing", (v) => {
    setPreset({ bearing: v < 0 ? null : v });
    bandsDirty = true;
  });
  bindRange("horizon", (v) => setPreset({ horizon: v }));
  bindRange("turbidity", (v) => {
    setPreset({ turbidity: v });
    bandsDirty = true;
  });
  bindRange("saturation", (v) => setPreset({ saturation: v }));
  bindRange("contrast", (v) => setPreset({ contrast: v }));

  bindColour("dayTint", (v) => setPreset({ dayTint: v }));
  bindColour("twilightTint", (v) => setPreset({ twilightTint: v }));
  bindColour("nightTint", (v) => setPreset({ nightTint: v }));

  bindRange("glare", (v) => setPreset({ glare: v }));
  bindRange("bodyScale", (v) => setPreset({ bodyScale: v }));
  bindRange("starBrightness", (v) => setPreset({ starBrightness: v }));
  bindRange("starSize", (v) => setPreset({ starSize: v }));
  bindRange("twinkle", (v) => setPreset({ twinkle: v }));
  // The slider is in units of 1e-6 radiance, because a control whose numbers
  // run from 0 to 0.0000066 tells the user nothing.
  bindRange("airglow", (v) => {
    setPreset({ airglow: v * 1e-6 });
    bandsDirty = true;
  });
  bindRange("fieldOfView", (v) => setPreset({ fieldOfView: v }));
  $("#readerClose").addEventListener("click", closeDocument);

  $("#reader").addEventListener("click", (event) => {
    // Clicking the backdrop closes it; clicking the document does not.
    if (event.target === $("#reader")) closeDocument();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("#reader").hidden) closeDocument();
  });

  fillSkylineList();
  select("skyline").addEventListener("change", () => {
    setPreset({ skyline: select("skyline").value });
    paintFromState();
  });

  bindRange("skylineHeight", (v) => setPreset({ skylineHeight: v }));
  bindRange("skylineSeed", (v) => setPreset({ skylineSeed: Math.round(v) }));
  bindRange("skylineLights", (v) => setPreset({ skylineLights: v }));

  bindRange("cloudCover", (v) => setPreset({ cloudCover: v }));
  bindRange("cloudDrift", (v) => setPreset({ cloudDrift: v }));
  bindRange("cloudScale", (v) => setPreset({ cloudScale: v }));
  bindRange("cloudSoftness", (v) => setPreset({ cloudSoftness: v }));

  bindRange("fps", (v) => setFps(Math.round(v)));

  // Not part of the settings document: it is a fact about the machine, which
  // Windows owns and which a settings file copied to another computer has no
  // business carrying with it.
  const startup = /** @type {HTMLInputElement} */ ($("#startup"));
  startup.disabled = !shell.hasShell();
  startup.addEventListener("change", () => shell.setStartWithWindows(startup.checked));
  void shell.getStartWithWindows().then((on) => {
    startup.checked = on;
  });

  // Shown and set in minutes, kept in seconds: a slider with 3,600 positions
  // on it is not a control, and nobody wants to stop the wallpaper after 437
  // seconds.
  bindRange("away", (v) => setAwaySeconds(Math.round(v) * 60));

  // The city field. `input` rather than `change`, so picking from the
  // suggestion list takes effect at once rather than on blur.
  const city = input("city");
  city.addEventListener("input", () => {
    refreshCitySuggestions(city.value);

    const match = resolveCity(city.value);
    if (!match) return;

    setPlace({ lat: match.lat, lon: match.lon });
    bandsDirty = true;
    paintFromState();
    save();
  });

  bindNumber("latNum", (v) => {
    setPlace({ lat: v });
    bandsDirty = true;
  });
  bindNumber("lonNum", (v) => {
    setPlace({ lon: v });
    bandsDirty = true;
  });

  input("scrub").addEventListener("input", (event) => {
    timeline.setMinute(Number(/** @type {HTMLInputElement} */ (event.target).value));
    syncClockControls();
  });

  input("date").addEventListener("change", (event) => {
    if (!timeline.setDate(/** @type {HTMLInputElement} */ (event.target).value)) return;
    bandsDirty = true;
    syncClockControls();
  });

  $("#nowBtn").addEventListener("click", () => {
    timeline.snapToNow(Date.now());
    bandsDirty = true;
    syncClockControls();
  });

  $("#playBtn").addEventListener("click", togglePlay);
  $("#ffBtn").addEventListener("click", togglePlay);

  $("#themeBtn").addEventListener("click", () => {
    cycleTheme();
    save();
  });

  $("#guessBtn").addEventListener("click", guessFromTimeZone);
  $("#wallBtn").addEventListener("click", toggleWallpaper);
  $("#resetBtn").addEventListener("click", resetAll);
  $("#saveBtn").addEventListener("click", downloadSettings);
  $("#loadBtn").addEventListener("click", () => {
    notice(
      "Loading a settings file arrives with the preset library in Milestone 5. Save already writes a file you can keep."
    );
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === " " && !(event.target instanceof HTMLInputElement)) {
      event.preventDefault();
      togglePlay();
    }
  });
}

/**
 * Fill the look list, once.
 *
 * "Custom" is the first entry and is what the list shows whenever the preset
 * matches none of the shipped looks - which is worked out by comparison, so it
 * cannot fall out of step with what is on screen.
 */
/**
 * The horizon styles, with the hint moving to match the choice.
 *
 * Built from STYLES rather than written into the markup, for the same reason
 * the look list is: a style added to the engine should appear here without
 * anybody remembering to add it twice.
 */
function fillSkylineList() {
  const list = select("skyline");
  list.replaceChildren();

  for (const style of SKYLINE_STYLES) {
    const option = document.createElement("option");
    option.value = style.id;
    option.textContent = style.name;
    list.append(option);
  }
}

function fillLookList() {
  const list = select("look");
  list.replaceChildren();

  const custom = document.createElement("option");
  custom.value = "";
  custom.textContent = "Custom";
  list.append(custom);

  for (const look of LOOKS) {
    const option = document.createElement("option");
    option.value = look.id;
    option.textContent = look.name;
    list.append(option);
  }
}

/**
 * Wire a number input to a setter.
 *
 * Separate from bindRange because a half-typed number is not a number: "-" on
 * the way to "-33" parses as NaN, and feeding that to the engine would blank
 * the sky while somebody was still typing.
 *
 * @param {string} id
 * @param {(value: number) => void} set
 */
function bindNumber(id, set) {
  const element = input(id);
  element.addEventListener("input", () => {
    const value = Number(element.value);
    if (element.value.trim() === "" || !Number.isFinite(value)) return;
    set(value);
    paintFromState();
    save();
  });
}

/**
 * Refill the suggestion list for what has been typed.
 *
 * A native datalist, so it is keyboard-navigable and styled by the platform
 * rather than by us - which for a search field is the right trade.
 *
 * @param {string} query
 */
function refreshCitySuggestions(query) {
  const list = $("#cityList");
  list.replaceChildren();

  for (const match of suggest(query)) {
    const option = document.createElement("option");
    option.value = labelFor(match);
    list.append(option);
  }
}

/**
 * Wire a colour input to a setter.
 *
 * Separate from bindRange because the value is a string and because a colour
 * picker fires continuously while it is open, which is what `input` is for -
 * the sky follows the swatch as it is dragged.
 *
 * @param {string} id
 * @param {(value: string) => void} set
 */
function bindColour(id, set) {
  const element = input(id);
  element.addEventListener("input", () => {
    set(element.value);
    bandsDirty = true;
    paintFromState();
    save();
  });
}

/**
 * Wire a range input to a setter, keeping its readout and the saved document
 * in step.
 *
 * @param {string} id
 * @param {(value: number) => void} set
 */
function bindRange(id, set) {
  const element = input(id);
  element.addEventListener("input", () => {
    set(Number(element.value));
    paintFromState();
    save();
  });
}

function togglePlay() {
  timeline.setPlaying(!clock.playing, Date.now());
  syncClockControls();
}

/**
 * Longitude from the system time zone: each hour of offset is 15 degrees.
 *
 * This is a guess and is labelled as one. It is right to within half a time
 * zone - a few hundred kilometres, enough to put sunrise within a few minutes
 * - and it is free. Latitude cannot be guessed this way at all, so it is left
 * alone and the note says so. The searchable city picker and the optional
 * lookup that is the only thing in the application to touch the network arrive
 * in Milestone 1 (US-010).
 */
/**
 * Set the place from this computer's time zone.
 *
 * A zone name is a place name, so this gives a latitude as well as a
 * longitude - which the first version of this could not do, because it worked
 * from the offset from UTC and every point on a meridian shares one.
 *
 * Nothing here touches the network (NFR-5): the zone is already on the
 * machine.
 */
function guessFromTimeZone() {
  const guess = guessPlace();

  if (!guess) {
    $("#guessNote").textContent =
      "Your time zone is not one this build knows a city for. Search for a city, or type the numbers in.";
    return;
  }

  setPlace(guess.place);
  bandsDirty = true;
  paintFromState();
  save();

  $("#guessNote").textContent = `Set to ${guess.description}.`;
}

async function toggleWallpaper() {
  const state = await shell.getWallpaperState();
  const next = await shell.setWallpaper(!state.on);

  paintWallpaperState(next);
  notice(next.reason && !next.on ? next.reason : null);
  pushRuntime();
}

function resetAll() {
  replacePreset(defaultPreset());
  setFps(20);
  timeline.snapToNow(Date.now());

  bandsDirty = true;
  paintFromState();
  syncClockControls();
  save();
  notice(null);
}

/**
 * The current settings as a file the user keeps (US-022). The preset library
 * lands in Milestone 5; this is the honest minimum until then.
 */
function downloadSettings() {
  const doc = writeDocument(
    { preset, place, fps, awaySeconds, wallpaperOn, theme: theme() },
    Date.now()
  );
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `dayandnight-${toDateInputValue(Date.now())}.json`;
  link.click();

  URL.revokeObjectURL(url);
}

/* ---------------------------------------------------------------- painting */

/** Push every state value into the controls and their readouts. */
function paintFromState() {
  input("lat").value = String(place.lat);
  input("lon").value = String(place.lon);
  input("latNum").value = place.lat.toFixed(2);
  input("lonNum").value = place.lon.toFixed(2);
  input("exposure").value = String(preset.exposure);
  input("whitePoint").value = String(preset.whitePoint);
  input("bearing").value = String(preset.bearing === null ? -1 : preset.bearing);
  input("horizon").value = String(preset.horizon);
  input("fieldOfView").value = String(preset.fieldOfView);

  input("cloudCover").value = String(preset.cloudCover);
  input("cloudDrift").value = String(preset.cloudDrift);
  input("cloudScale").value = String(preset.cloudScale);
  input("cloudSoftness").value = String(preset.cloudSoftness);
  input("turbidity").value = String(preset.turbidity);
  input("saturation").value = String(preset.saturation);
  input("contrast").value = String(preset.contrast);
  input("dayTint").value = preset.dayTint;
  input("twilightTint").value = preset.twilightTint;
  input("nightTint").value = preset.nightTint;
  input("glare").value = String(preset.glare);
  input("bodyScale").value = String(preset.bodyScale);
  input("starBrightness").value = String(preset.starBrightness);
  input("starSize").value = String(preset.starSize);
  input("twinkle").value = String(preset.twinkle);
  input("airglow").value = String(preset.airglow * 1e6);
  input("fps").value = String(fps);
  input("away").value = String(Math.round(awaySeconds / 60));

  $("#latVal").textContent = fmtDegrees(place.lat);
  $("#lonVal").textContent = fmtDegrees(place.lon);

  // Name the place if a city is close enough to be worth naming. Two numbers
  // say nothing; "near Denver" is checkable against a window.
  const near = nearestCity(place);
  const field = input("city");
  if (document.activeElement !== field) field.value = near ? labelFor(near) : "";
  $("#exposureVal").textContent = `${preset.exposure.toFixed(1)} EV`;
  $("#whitePointVal").textContent = preset.whitePoint.toFixed(1);
  $("#bearingVal").textContent =
    preset.bearing === null
      ? `Auto (${compass(resolveBearing(preset, place))})`
      : compass(preset.bearing);
  $("#horizonVal").textContent = `${Math.round(preset.horizon * 100)}%`;
  $("#fieldOfViewVal").textContent = `${Math.round(preset.fieldOfView)}°`;

  select("skyline").value = preset.skyline;
  input("skylineHeight").value = String(preset.skylineHeight);
  input("skylineSeed").value = String(preset.skylineSeed);
  input("skylineLights").value = String(preset.skylineLights);

  $("#skylineHeightVal").textContent = `${preset.skylineHeight.toFixed(1)}°`;
  $("#skylineSeedVal").textContent = String(preset.skylineSeed);
  $("#skylineLightsVal").textContent = `${Math.round(preset.skylineLights * 100)}%`;

  $("#cloudCoverVal").textContent = `${Math.round(preset.cloudCover * 100)}%`;
  $("#cloudDriftVal").textContent = `${Math.round(preset.cloudDrift)} km/h`;
  $("#cloudScaleVal").textContent = `${preset.cloudScale.toFixed(1)} km`;
  $("#cloudSoftnessVal").textContent = preset.cloudSoftness.toFixed(2);
  $("#turbidityVal").textContent = `${preset.turbidity.toFixed(1)}×`;
  $("#saturationVal").textContent = preset.saturation.toFixed(1);
  $("#contrastVal").textContent = preset.contrast.toFixed(1);
  $("#glareVal").textContent = `${preset.glare.toFixed(1)}×`;
  $("#bodyScaleVal").textContent = `${preset.bodyScale.toFixed(1)}×`;
  $("#starBrightnessVal").textContent = `${preset.starBrightness.toFixed(1)}×`;
  $("#starSizeVal").textContent = `${preset.starSize.toFixed(1)} px`;
  $("#twinkleVal").textContent = `${Math.round(preset.twinkle * 100)}%`;
  $("#airglowVal").textContent = (preset.airglow * 1e6).toFixed(1);
  $("#fpsVal").textContent = `${fps} fps`;
  $("#awayVal").textContent = awaySeconds === 0 ? "never" : `${Math.round(awaySeconds / 60)} min`;

  // Which look this is, by comparison rather than by memory.
  const look = lookIdFor(preset);
  select("look").value = look ?? "";

  const described = LOOKS.find((entry) => entry.id === look);
  $("#lookHint").setAttribute(
    "data-tip",
    described
      ? `${described.hint} Change any control and this returns to Custom.`
      : "A complete look, laid over the defaults. Where you are and how often the wallpaper redraws are not part of it, so switching never moves your sky or changes what it costs. Change any control afterwards and this returns to Custom."
  );

  pushRuntime();
}

function paintMonitors() {
  const s = span();

  $("#monList").textContent =
    monitors.length === 0
      ? "none reported"
      : monitors
          .map(
            (m) =>
              `${m.bounds.w}×${m.bounds.h}` +
              (m.scale === 1 ? "" : ` @${m.scale}×`) +
              (m.primary ? " (primary)" : "")
          )
          .join(", ");

  $("#spanNote").textContent = `span ${s.w}×${s.h}`;

  paintArrangement(s);

  // Monitor boundaries over the preview, so a span reads as screens rather
  // than as one wide picture. The bar is drawn at a crop's left edge, and the
  // one at x = 0 is skipped because it would sit on the frame.
  const splits = $("#previewSplits");
  splits.replaceChildren();
  for (const monitor of monitors) {
    const crop = cropFor(monitor);
    if (crop.x <= 0) continue;
    const bar = document.createElement("span");
    bar.style.left = `${(crop.x / s.w) * 100}%`;
    splits.append(bar);
  }
}

/**
 * The screens, drawn to scale inside a fixed box.
 *
 * Read-only, and that is a decision rather than a shortcut. Pixel Galaxy
 * Studio's equivalent panel lets you drag screens around, because there the
 * layout is the user's choice about how a video maps onto them. Here the
 * arrangement belongs to Windows: the sky is placed by real azimuth across
 * whatever Windows reports, so a drag in this panel could only either lie
 * about what it did or move the sun somewhere it is not, and architecture
 * invariant 5 forbids the second.
 *
 * What it is for is the thing a list of resolutions cannot show: that the
 * screens sit in an L, or that one is rotated, or that there is a gap between
 * them which the sky fills and nobody sees.
 *
 * @param {{ w: number, h: number }} s the span
 */
function paintArrangement(s) {
  const map = $("#monMap");
  map.replaceChildren();

  for (const monitor of monitors) {
    const crop = cropFor(monitor);
    const box = document.createElement("span");

    // Percentages of the span, so the map is the arrangement's own shape
    // letterboxed into the panel rather than a stretched version of it.
    box.style.left = `${(crop.x / s.w) * 100}%`;
    box.style.top = `${(crop.y / s.h) * 100}%`;
    box.style.width = `${(crop.w / s.w) * 100}%`;
    box.style.height = `${(crop.h / s.h) * 100}%`;
    box.dataset.primary = monitor.primary ? "yes" : "no";
    box.textContent = `${monitor.bounds.w}×${monitor.bounds.h}`;
    map.append(box);
  }

  // The panel is a fixed 16:9 box, so an arrangement of another shape has to
  // be letterboxed inside it or the screens would be drawn the wrong shape.
  map.style.aspectRatio = `${s.w} / ${s.h}`;

  const facts = arrangement();
  const note = $("#monNote");

  if (monitors.length === 0) {
    note.textContent = "No screens reported, so the preview assumes one 1080p screen.";
  } else if (facts.overlaps) {
    note.textContent =
      "Two of your screens overlap, which Windows allows. Each still shows its own " +
      "slice of the sky, so the overlapping part is drawn twice.";
  } else if (facts.gapFraction > 0.02) {
    note.textContent =
      `${Math.round(facts.gapFraction * 100)}% of the sky falls in the gaps between ` +
      "your screens and is never shown. The sun still crosses it at the right time, " +
      "so it can be out of sight for a while.";
  } else {
    note.textContent = "Your screens cover the whole sky the wallpaper composes.";
  }
}

/**
 * The About panel: which build this is, and the documents it ships.
 *
 * In a browser there is no build and no documents, so the list says so rather
 * than offering buttons that cannot do anything.
 */
async function wireAbout() {
  const list = $("#legalList");
  const version = await shell.getVersion();
  $("#aboutVersion").textContent = version ? `v${version}` : "browser preview";

  const documents = await shell.listLegal();
  list.replaceChildren();

  if (documents.length === 0) {
    const note = document.createElement("span");
    note.className = "meta";
    note.textContent = "The shipped documents are part of the application, not of this page.";
    list.append(note);
    return;
  }

  for (const entry of documents) {
    const button = document.createElement("button");
    button.className = "ghost";
    button.type = "button";
    button.textContent = entry.title;
    button.addEventListener("click", () => void openDocument(entry.id, entry.title));
    list.append(button);
  }
}

/** What had focus before the reader opened, so it can be given back. */
let readerReturn = /** @type {HTMLElement | null} */ (null);

/**
 * @param {string} id
 * @param {string} title
 */
async function openDocument(id, title) {
  const text = await shell.readLegal(id);

  $("#readerTitle").textContent = title;
  $("#readerText").textContent =
    text ?? "That document is missing from this build, which is a packaging fault.";

  readerReturn = /** @type {HTMLElement | null} */ (document.activeElement);
  $("#reader").hidden = false;

  // Focus moves into the dialog, and Escape closes it: NFR-6 asks for the
  // editor to be keyboard operable throughout, and a modal that traps you is
  // the usual way that stops being true.
  /** @type {HTMLElement} */ ($("#readerClose")).focus();
}

function closeDocument() {
  $("#reader").hidden = true;
  readerReturn?.focus();
  readerReturn = null;
}

/** @param {import("./desktop.js").WallpaperState} state */
function paintWallpaperState(state) {
  // Mirrored rather than decided here: the wallpaper can be turned on and off
  // from the tray as well, and a flag the editor kept for itself would be
  // wrong the moment somebody used it.
  setWallpaperOn(state.on);
  $("#wallBtn").textContent = state.on ? "Turn the wallpaper off" : "Turn the wallpaper on";

  const box = $("#wallState");
  box.replaceChildren();

  if (!state.on) {
    box.textContent = shell.hasShell()
      ? "Not running."
      : "Not available: this is a browser, not the application.";
    $("#hostNote").textContent = shell.hasShell() ? "wallpaper off" : "browser preview";
    return;
  }

  const screens = `${state.screens} screen${state.screens === 1 ? "" : "s"}`;
  const paused = state.paused ? ", paused" : "";

  const line = document.createElement("span");

  if (state.host === "starting") {
    line.textContent = `Starting on ${screens}…`;
    box.append(line);
    $("#hostNote").textContent = "host: starting";
    return;
  }

  if (state.host === "fallback") {
    line.className = "host-fallback";
    line.textContent = `Running on ${screens}${paused}, in front of the desktop wallpaper rather than behind the icons.`;
    $("#hostNote").textContent = "host: fallback";
  } else {
    line.className = "host-ok";
    line.textContent = `Running on ${screens}${paused}, behind the desktop icons.`;
    $("#hostNote").textContent = "host: WorkerW";
  }
  box.append(line);

  // Two separate facts, and both are worth saying: why the host is what it is,
  // and why nothing is being drawn. A machine that fell back AND is paused for
  // a game has two things wrong with it, and showing one left the other to be
  // guessed at.
  if (state.reason) box.append(` ${state.reason}`);

  if (state.paused && state.pausedBecause) {
    const why = document.createElement("span");
    why.className = "meta";
    why.textContent = ` Stopped because ${state.pausedBecause}. It starts again on its own.`;
    box.append(why);
  }
}

async function refreshWallpaperState() {
  paintWallpaperState(await shell.getWallpaperState());
}

/** Keep the scrubber, the date and the play button in step with the clock. */
function syncClockControls() {
  const realNow = Date.now();

  input("scrub").value = String(Math.round(timeline.scrubValue(realNow)));
  input("date").value = timeline.dateInputValue(realNow);

  const button = $("#playBtn");
  button.textContent = clock.playing ? "⏸" : "▶";
  button.setAttribute("aria-label", clock.playing ? "Pause" : "Play");
  $("#ffBtn").setAttribute("aria-pressed", clock.playing ? "true" : "false");
}

/**
 * Called after every frame.
 *
 * @param {FrameInfo} info
 * @param {number} t
 */
function onFrame(info, t) {
  $("#readout").textContent = [
    fmtTime(t),
    `alt ${fmtDegrees(info.sunAltitude)}`,
    `az ${fmtBearing(info.sunAzimuth)}`,
    twilightBand(info.sunAltitude),
    `${fmtExposure(info.exposure)} EV`
  ].join("  ·  ");

  if (bandsDirty) {
    bandsDirty = false;
    redrawBands();
  }

  // While fast-forward runs, the scrubber follows it rather than sitting still.
  if (clock.playing) {
    input("scrub").value = String(Math.round(clock.minute));
  }
}

function redrawBands() {
  const width = Math.max(1, bandsCanvas.clientWidth || 600);
  if (bandsCanvas.width !== width) bandsCanvas.width = width;
  drawBands(bandsCanvas, clock.dayStart, place, preset);
}

/** Hand the wallpaper windows what they need in order to draw. */
function pushRuntime() {
  shell.pushConfig({ preset, place, fps, awaySeconds });
}

/**
 * A bearing as a compass direction with its number.
 *
 * "SW 225" rather than "225": a bearing is a direction, and most people read
 * the letters faster than the degrees.
 *
 * @param {number} degrees
 * @returns {string}
 */
function compass(degrees) {
  const points = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const index = Math.round((((degrees % 360) + 360) % 360) / 45) % 8;
  return `${points[index]} ${Math.round(degrees)}°`;
}

let saveTimer = 0;

/** Debounced, so a slider drag is one write rather than one per pixel. */
function save() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    shell.saveSettings(
      writeDocument({ preset, place, fps, awaySeconds, wallpaperOn, theme: theme() }, Date.now())
    );
  }, 400);
}

/* --------------------------------------------------------------- page API */

/**
 * The small set of things a test or a script may ask of the editor without
 * clicking. The browser tests hold it to these promises.
 */
Object.defineProperty(window, "DayAndNight", {
  value: Object.freeze({
    /** @returns {FrameInfo | null} */
    lastFrame: () => preview?.lastFrame() ?? null,

    /** @returns {import("./settings.js").SettingsDoc} */
    document: () =>
      writeDocument({ preset, place, fps, awaySeconds, wallpaperOn, theme: theme() }, Date.now()),

    /**
     * @param {unknown} raw
     * @returns {string | null} a problem, or null on success
     */
    apply: (raw) => {
      const { doc, problem } = readDocument(raw);
      if (!doc) return problem ?? "That is not a settings document.";

      replacePreset(doc.cfg.preset);
      setPlace(doc.cfg.place);
      setFps(doc.cfg.fps);
      setAwaySeconds(doc.cfg.awaySeconds);
      setTheme(doc.ui.theme);

      bandsDirty = true;
      paintFromState();
      return null;
    },

    /**
     * Open one of the shipped documents, as clicking its button would.
     *
     * The same door a test uses for the screens: there is no way to click the
     * real button in a browser, because a browser ships no documents and the
     * panel correctly offers nothing - and the behaviour around the dialog,
     * which is what NFR-6 cares about, is the same however it was opened.
     *
     * @param {string} id
     * @param {string} title
     * @returns {Promise<void>}
     */
    showDocument: (id, title) => openDocument(id, title),

    /**
     * Pretend the machine has these screens.
     *
     * The shell pushes the real list over IPC; this is the same door for a
     * test or a script, and it is the only way to see what the editor does
     * with an arrangement the developer does not own - a rotated screen, an
     * L-shape with a gap, two screens that overlap.
     *
     * @param {import("../engine/span.js").Monitor[]} list
     */
    setScreens: (list) => {
      // The same two calls the shell makes when Windows reports a change, so
      // a test drives the editor down the real path rather than a parallel one
      // that could keep working after that path broke.
      setMonitors(list);
      paintMonitors();
      preview?.resize();
      bandsDirty = true;
    },

    /** @param {number} minute */
    scrubTo: (minute) => {
      timeline.setMinute(minute);
      syncClockControls();
    },

    /** @param {string} value `YYYY-MM-DD` */
    dateTo: (value) => {
      if (!timeline.setDate(value)) return;
      bandsDirty = true;
      syncClockControls();
    },

    version: () => shell.version()
  }),
  writable: false
});

boot().catch((error) => {
  notice(error instanceof Error ? error.message : String(error));
});
