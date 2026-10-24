import test from "node:test";
import assert from "node:assert/strict";

import { PREFIX, decodeLook, encodeLook } from "../../app/ui/share-code.js";
import { defaultPreset } from "../../app/engine/defaults.js";
import { presetFor } from "../../app/ui/presets.js";

/**
 * A look as a short string (US-033).
 *
 * The tests that matter are not the round trip - that is arithmetic and would
 * be hard to get wrong. They are about what a code must NOT carry, and what
 * happens when one arrives from somebody else's machine, which is the only way
 * a code ever arrives.
 */

test("a look survives the round trip exactly", () => {
  return (async () => {
    for (const id of ["clear", "cinematic", "weather", "town"]) {
      const preset = presetFor(id);
      assert.ok(preset, `${id} should exist`);

      const code = await encodeLook(preset);
      const { preset: back, problem } = await decodeLook(code);

      assert.equal(problem, null, `${id} should decode cleanly`);
      assert.deepEqual(back, preset, `${id} did not survive`);
    }
  })();
});

test("a code does not carry where you are", async () => {
  // The one that matters most. A preset describes appearance and never
  // geometry (architecture invariant 5), so a code made from one cannot move
  // somebody's sky - and if it ever could, the product's whole claim would
  // quietly stop being true for anybody who pasted one.
  const preset = presetFor("cinematic");
  assert.ok(preset);

  const code = await encodeLook(preset);
  const decoded = await decodeLook(code);
  assert.ok(decoded.preset);

  // Nothing resembling a place, a frame rate or a theme is in the decoded
  // object - it has exactly the keys a preset has and no others.
  assert.deepEqual(Object.keys(decoded.preset).sort(), Object.keys(defaultPreset()).sort());

  // And the encoded text contains no coordinate. Checked on the text as well
  // as the result, because "it decoded to a preset" would still be true if a
  // latitude were riding along in a field nobody read.
  const json = JSON.stringify(decoded.preset);
  for (const word of ["lat", "lon", "fps", "theme", "place", "away"]) {
    assert.ok(!json.includes(word), `a code should not mention ${word}`);
  }
});

test("a code for the defaults is tiny, because it is a difference", async () => {
  // Only what differs from the defaults goes in, which is what keeps a code
  // short enough to paste into a message.
  const bare = await encodeLook(defaultPreset());
  const busy = await encodeLook(presetFor("weather"));

  assert.ok(bare.length < 40, `a default look came to ${bare.length} characters`);
  assert.ok(busy.length > bare.length, "a look with settings in it should be longer");
  assert.ok(busy.length < 400, `a full look came to ${busy.length} characters`);
});

test("a code survives being pasted out of a chat window", async () => {
  // Every messenger wraps text, every forum adds punctuation, and people
  // retype the prefix in the wrong case. None of that should lose a look.
  const code = await encodeLook(presetFor("hazy"));
  const expected = (await decodeLook(code)).preset;

  const mangled = [
    code.replace(/(.{10})/g, "$1\n"),
    `  ${code}  `,
    code.toLowerCase().startsWith("dan1-") ? `dan1-${code.slice(PREFIX.length)}` : code,
    `"${code}."`,
    code.slice(PREFIX.length)
  ];

  for (const text of mangled) {
    const { preset, problem } = await decodeLook(text);
    assert.equal(problem, null, `this should still read: ${text.slice(0, 24)}...`);
    assert.deepEqual(preset, expected);
  }
});

test("nonsense is refused rather than guessed at", async () => {
  for (const text of ["", "   ", "hello", "DAN1-", "DAN1-!!!!", "not a code at all"]) {
    const { preset, problem } = await decodeLook(text);
    assert.equal(preset, null, `"${text}" should not decode`);
    assert.ok(problem, `"${text}" should say why`);
  }
});

test("a code from a newer build is refused, and says so", async () => {
  // Same rule as a settings file: a document from the future is not guessed
  // at. The message has to distinguish it from a broken code, because the two
  // call for completely different things from the user.
  const code = await encodeLook(presetFor("quiet"));

  const { preset, problem } = await decodeLook(code, 0);
  assert.equal(preset, null);
  assert.match(problem ?? "", /newer version/);
});

test("a hostile code cannot reach a shader with a value out of range", async () => {
  // A code comes from somebody else. A cloud cover of a million, or a string
  // where a number belongs, would otherwise arrive at the renderer exactly as
  // fast as a good one - so a decoded code goes through the same validator a
  // settings file does.
  const nasty = {
    v: 1,
    p: {
      cloudCover: 1e9,
      turbidity: -400,
      exposure: "eight",
      fieldOfView: Number.POSITIVE_INFINITY,
      skyline: "citty",
      starSize: Number.NaN
    }
  };

  const packed = await new Response(
    new Blob([new TextEncoder().encode(JSON.stringify(nasty))])
      .stream()
      .pipeThrough(new CompressionStream("deflate-raw"))
  ).arrayBuffer();

  let base64 = "";
  for (const byte of new Uint8Array(packed)) base64 += String.fromCharCode(byte);
  const code = PREFIX + btoa(base64).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const { preset, problem } = await decodeLook(code);
  assert.equal(problem, null, "it is a well-formed code, just a dishonest one");
  assert.ok(preset);

  const defaults = defaultPreset();
  assert.ok(preset.cloudCover <= 1, `cloudCover came through as ${preset.cloudCover}`);
  assert.ok(preset.turbidity >= 0.2, `turbidity came through as ${preset.turbidity}`);
  assert.ok(Number.isFinite(preset.fieldOfView));
  assert.ok(Number.isFinite(preset.starSize));
  assert.equal(preset.exposure, defaults.exposure, "a string becomes the default");
  assert.equal(preset.skyline, defaults.skyline, "an unknown style becomes the default");
});

test("a code made before a setting existed takes its default", async () => {
  // Forward compatibility, which is the whole reason a code is a difference
  // rather than a snapshot. A code from before clouds existed has no cloud
  // keys in it, and should open as a clear sky rather than as undefined.
  const old = { v: 1, p: { exposure: 0.5, contrast: 1.1 } };

  const packed = await new Response(
    new Blob([new TextEncoder().encode(JSON.stringify(old))])
      .stream()
      .pipeThrough(new CompressionStream("deflate-raw"))
  ).arrayBuffer();

  let base64 = "";
  for (const byte of new Uint8Array(packed)) base64 += String.fromCharCode(byte);
  const code = PREFIX + btoa(base64).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const { preset, problem } = await decodeLook(code);
  assert.equal(problem, null);
  assert.ok(preset);

  const defaults = defaultPreset();
  assert.equal(preset.exposure, 0.5, "what the code carried");
  assert.equal(preset.contrast, 1.1);
  assert.equal(preset.cloudCover, defaults.cloudCover, "what it did not");
  assert.equal(preset.skyline, defaults.skyline);
});
