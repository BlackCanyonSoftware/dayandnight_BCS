import test from "node:test";
import assert from "node:assert/strict";

import {
  STYLES,
  isStyle,
  lightsOn,
  skylineVisible,
  styleIndex
} from "../../app/engine/sky/skyline.js";

/**
 * The skyline, which is almost all shader - the shape never moves, so unlike
 * the clouds there is no CPU half to keep in step with it. What is here is the
 * boundary: which styles exist, whether the pass runs at all, and the one
 * number the frame signature needs, which is how lit the windows are.
 */

test("every style has an id, a name and a hint that says why you would pick it", () => {
  const ids = new Set();

  for (const style of STYLES) {
    assert.ok(!ids.has(style.id), `${style.id} appears twice`);
    ids.add(style.id);

    assert.ok(style.name.length > 0, `${style.id} needs a name`);
    assert.ok(
      style.hint.length > 60,
      `${style.id} needs a hint that says what it is for, not what it is called`
    );
  }
});

test("nothing is the first style, because it is the one the shader skips", () => {
  // styleIndex is the uniform the shader branches on, and zero is its "do
  // nothing" branch. If "none" ever stopped being first, every other style
  // would shift and the shader would draw the wrong one.
  assert.equal(STYLES[0].id, "none");
  assert.equal(styleIndex("none"), 0);
});

test("a style this build does not know becomes nothing, rather than something", () => {
  // A settings file is a file and can say anything. Guessing which style was
  // meant would put a city on somebody's desktop because they typed "citty".
  assert.equal(styleIndex("citty"), 0);
  assert.equal(styleIndex(""), 0);
  assert.equal(isStyle("citty"), false);
  assert.equal(isStyle(7), false);
  assert.equal(isStyle("city"), true);
});

test("the pass is skipped for nothing, and for a height of nothing", () => {
  // Both matter. "None" is the choice; a height of zero is somebody dragging
  // the slider to the bottom, and drawing a zero-height silhouette would cost
  // a full-screen pass to draw nothing at all.
  assert.equal(skylineVisible("none", 10), false);
  assert.equal(skylineVisible("city", 0), false);
  assert.equal(skylineVisible("city", 0.001), false);
  assert.equal(skylineVisible("city", 8), true);
  assert.equal(skylineVisible("mountains", 8), true);
});

test("the lights are off in daylight and on at night", () => {
  assert.equal(lightsOn(45), 0, "nothing is lit at midday");
  assert.equal(lightsOn(2), 0, "nor with the sun still up");
  assert.equal(lightsOn(-8), 1, "and everything is by the end of civil twilight");
  assert.equal(lightsOn(-30), 1);
});

test("the lights come on gradually, not all at once", () => {
  // The curve is what makes windows appear a few at a time through dusk: the
  // shader compares a hash per window against this, so a step function would
  // switch a whole city on in one frame.
  let previous = -1;
  for (let altitude = 6; altitude >= -14; altitude -= 0.5) {
    const now = lightsOn(altitude);
    assert.ok(now >= previous, `the lights went out again at ${altitude} degrees`);
    assert.ok(now >= 0 && now <= 1, `lights at ${now} is outside 0 to 1`);
    previous = now;
  }

  // And it really is gradual: halfway through the band, about half of them.
  assert.ok(Math.abs(lightsOn(-3) - 0.5) < 0.01);
});

test("the lights follow the sun rather than the clock", () => {
  // Which is the whole point of computing them: a city on a December evening
  // lights up hours before one in June, because the sun decides and not the
  // hour. Checked as the property rather than with two dates - the altitude is
  // the only input, so this is what that means.
  assert.ok(lightsOn(-5) > lightsOn(0));
  assert.ok(lightsOn(0) > lightsOn(5));
});
