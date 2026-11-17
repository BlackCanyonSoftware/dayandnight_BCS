import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { PANELS, WELCOME_STEPS, guideText } from "../../app/ui/guide.js";

/**
 * The guide is prose, and prose goes stale. These tests are what stops it: they
 * hold it to the panels the page really has, so a panel added without a
 * paragraph, or a paragraph left for a panel that has gone, is a failing test
 * rather than a customer finding out.
 */

const html = readFileSync(new URL("../../app/index.html", import.meta.url), "utf8");

/** The panels' headings, in the order the page has them. */
const panels = [...html.matchAll(/<details class="sec"[^>]*>\s*<summary>([^<]+)<\/summary>/g)].map(
  (m) => m[1].trim()
);

test("the guide has a paragraph for every panel, in the order they appear", () => {
  assert.ok(panels.length >= 10, `found only ${panels.length} panels in the page`);
  assert.deepEqual(
    PANELS.map((p) => p.panel),
    panels
  );
});

test("each paragraph says something, and nothing is a placeholder", () => {
  for (const { panel, text } of PANELS) {
    assert.ok(text.length > 80, `${panel}: too short to explain anything`);
    assert.ok(!/TODO|TBD|lorem|\?\?\?/i.test(text), `${panel}: placeholder text`);
  }
});

test("the guide text carries the welcome, every panel and the parts that are not panels", () => {
  const text = guideText();

  for (const step of WELCOME_STEPS) assert.ok(text.includes(step), "a welcome step is missing");
  for (const { panel } of PANELS) assert.ok(text.includes(panel.toUpperCase()), `${panel} missing`);

  for (const heading of [
    "GETTING STARTED",
    "THE PANELS",
    "THE TIME BAR",
    "REAL WEATHER",
    "KEYBOARD"
  ]) {
    assert.ok(text.includes(heading), `${heading} missing`);
  }

  // The things a person acting on this must be able to rely on.
  assert.ok(text.includes("Nothing is sent while it is off"));
  assert.ok(text.includes("Ctrl+Z"));
  assert.ok(text.includes("settings.json"));
});

test("it names the controls that exist and only those", () => {
  // Every control it mentions by its label must be a label the page has.
  const labels = new Set(
    [...html.matchAll(/<span class="labelleft"\s*><span>([^<]+)<\/span/g)].map((m) => m[1].trim())
  );

  for (const name of ["Use the real weather", "Twinkle", "Planets"]) {
    assert.ok(labels.has(name), `the guide mentions "${name}" but the page has no such control`);
  }
  assert.ok(guideText().includes("Use the real weather"));
});

test("there are three first steps, each one sentence or two", () => {
  assert.equal(WELCOME_STEPS.length, 3);
  for (const step of WELCOME_STEPS) assert.ok(step.length > 40 && step.length < 260);
});
