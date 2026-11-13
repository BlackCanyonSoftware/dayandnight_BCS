import test from "node:test";
import assert from "node:assert/strict";

import {
  STYLES,
  isStyle,
  cityActivity,
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

test("a city thins out through the night and stirs again before dawn", () => {
  // Local solar time is UTC plus the longitude over fifteen, so at longitude 0
  // the UTC hour is the solar hour.
  const at = (hour) => cityActivity(Date.UTC(2026, 10, 13) + hour * 3_600_000, 0);

  assert.equal(at(19), 1, "every light is on in the evening");
  assert.equal(at(21), 1);
  assert.ok(at(23) < 1 && at(23) > 0.9, `the first of them go out at eleven: ${at(23)}`);
  assert.ok(Math.abs(at(2) - 0.4) < 1e-9, `a scattering stays lit at two: ${at(2)}`);
  assert.ok(at(4) > at(2), "and the early risers are back by four");
  assert.ok(Math.abs(at(5.5) - 0.7) < 1e-9, `${at(5.5)}`);

  // Never dark: a city has lights in it at every hour of the night.
  for (let h = 0; h < 24; h += 0.25) {
    assert.ok(at(h) >= 0.4 - 1e-9 && at(h) <= 1 + 1e-9, `hour ${h}: ${at(h)}`);
  }
});

test("the city's activity changes smoothly, with no step at midnight", () => {
  const t0 = Date.UTC(2026, 10, 13, 0);
  let previous = cityActivity(t0, 0);
  for (let minute = 1; minute <= 24 * 60; minute += 1) {
    const now = cityActivity(t0 + minute * 60_000, 0);
    assert.ok(Math.abs(now - previous) < 0.01, `a step at minute ${minute}`);
    previous = now;
  }
});

test("the city's hour is local solar time, so it moves with the longitude", () => {
  // Fifteen degrees east is an hour ahead: two in the morning there is one
  // o'clock in UTC.
  const utcOne = Date.UTC(2026, 10, 13, 1);
  assert.ok(Math.abs(cityActivity(utcOne, 15) - cityActivity(utcOne + 3_600_000, 0)) < 1e-9);

  // And it is the same on every day.
  assert.equal(cityActivity(utcOne, 0), cityActivity(utcOne + 86_400_000, 0));
});
