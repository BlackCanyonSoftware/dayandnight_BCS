import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { MAX_PREVIEW_WIDTH, REFERENCE_SPAN_WIDTH, starScale } from "../../app/ui/scale.js";

test("a picture as wide as its span draws a star at its own size", () => {
  assert.equal(starScale(1920, 1920), 1);
});

test("a smaller picture scales the star down with it, so it keeps its size in the sky", () => {
  // Half the width is half the pixels across the same sky: a star that is
  // twelve pixels across the whole span is six across half of it.
  assert.equal(starScale(960, 1920), 0.5);
  assert.ok(Math.abs(starScale(192, REFERENCE_SPAN_WIDTH) - 0.1) < 1e-9);
});

test("the preview of a wide desktop is drawn narrower than it, and says so", () => {
  // Two 1920 screens: 3840 across, drawn into a buffer capped at 1600. Before
  // 2026-11-12 the stars were drawn as if that buffer were the whole desktop,
  // 2.4 times too big.
  const ratio = starScale(Math.min(MAX_PREVIEW_WIDTH, 3840), 3840);
  assert.ok(ratio < 0.5, `a ratio of ${ratio} would still draw the stars too large`);
});

test("nonsense does not turn a star to nothing or to a monster", () => {
  assert.equal(starScale(0, 1920), 1);
  assert.equal(starScale(1920, 0), 1);
  assert.equal(starScale(NaN, 1920), 1);
  assert.equal(starScale(-5, 1920), 1);
});

test("nothing that draws a picture smaller than the desktop may claim a ratio of one", () => {
  // The wiring, which no pixel test of the engine can see: the engine has
  // always honoured pixelRatio, and the bug was the callers passing a literal 1
  // for a picture a fraction of the desktop's width. A source-level guard is
  // crude, and it is the only thing that fails if somebody puts the literal
  // back.
  for (const file of ["../../app/ui/preview.js", "../../app/ui/thumbnails.js"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.ok(
      !/pixelRatio:\s*1\s*[,}\n]/.test(source),
      `${file} passes a literal pixelRatio of 1; use starScale() (ui/scale.js)`
    );
    assert.ok(source.includes("starScale("), `${file} should size its stars with starScale()`);
  }
});
