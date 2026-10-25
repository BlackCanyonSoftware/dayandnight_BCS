import test from "node:test";
import assert from "node:assert/strict";

import * as history from "../../app/ui/history.js";
import { writeDocument } from "../../app/ui/settings.js";
import { defaultPreset } from "../../app/engine/defaults.js";

/**
 * Undo and redo (US-024).
 *
 * The module knows nothing about the editor - it is a stack of strings and two
 * callbacks - so the whole of it is testable without a page, which is why it
 * was built that way.
 */

/** A little editor: state in a variable, and the two callbacks over it. */
function fakeEditor() {
  let state = {
    preset: defaultPreset(),
    place: { lat: 39.7, lon: -105 },
    fps: 20,
    awaySeconds: 600,
    wallpaperOn: false,
    /** @type {"dark"} */
    theme: "dark"
  };

  let announcements = 0;

  history.connect({
    read: () => writeDocument(state, 0),
    apply: (doc) => {
      state = { ...state, ...doc.cfg };
    },
    changed: () => {
      announcements += 1;
    }
  });

  return {
    /** @param {Partial<typeof state.preset>} patch */
    edit(patch) {
      state = { ...state, preset: { ...state.preset, ...patch } };
      history.record();
    },
    /** @param {{lat: number, lon: number}} place */
    move(place) {
      state = { ...state, place };
      history.record();
    },
    /** @param {"dark" | "light"} next */
    setTheme(next) {
      state = { ...state, theme: next };
      history.record();
    },
    get exposure() {
      return state.preset.exposure;
    },
    get place() {
      return state.place;
    },
    get theme() {
      return state.theme;
    },
    get announcements() {
      return announcements;
    }
  };
}

test("nothing to undo before anything has happened", () => {
  const editor = fakeEditor();
  editor.edit({});

  assert.equal(history.canUndo(), false);
  assert.equal(history.canRedo(), false);
  assert.equal(history.undo(), false);
});

test("the very first edit is undoable", () => {
  // connect() takes the state as it is as the baseline. Without that, the
  // first edit finds no current state, becomes the baseline itself, and is the
  // one change a user cannot take back - which is a poor first impression of a
  // feature whose entire job is taking changes back.
  //
  // These tests hid it at first by calling record() by hand after connecting,
  // which is not what the editor does. They do not any more.
  const editor = fakeEditor();

  editor.edit({ exposure: 2.5 });

  assert.equal(history.canUndo(), true, "the first edit should be undoable");
  history.undo();
  assert.equal(editor.exposure, defaultPreset().exposure);
});

test("a change can be undone and redone", () => {
  const editor = fakeEditor();

  editor.edit({ exposure: 1.5 });
  assert.equal(editor.exposure, 1.5);
  assert.equal(history.canUndo(), true);

  assert.equal(history.undo(), true);
  assert.equal(editor.exposure, defaultPreset().exposure);
  assert.equal(history.canRedo(), true);

  assert.equal(history.redo(), true);
  assert.equal(editor.exposure, 1.5);
});

test("a slider drag is one step, not forty", () => {
  // The whole reason this module is more than a stack. A drag fires an event
  // per pixel; recording each would need forty undos to take back one gesture.
  const editor = fakeEditor();

  for (let i = 1; i <= 40; i += 1) editor.edit({ exposure: i / 10 });
  assert.equal(editor.exposure, 4);

  assert.equal(history.depth().past, 1, "a drag should have left exactly one step");

  history.undo();
  assert.equal(editor.exposure, defaultPreset().exposure, "one undo should take back the drag");
});

test("two different sliders are two steps", () => {
  // Folding on time alone would merge these, which is the mistake the key
  // check exists to prevent.
  const editor = fakeEditor();

  editor.edit({ exposure: 2 });
  editor.edit({ contrast: 1.4 });

  assert.equal(history.depth().past, 2);

  history.undo();
  assert.equal(editor.exposure, 2, "the first change should still be there");

  history.undo();
  assert.equal(editor.exposure, defaultPreset().exposure);
});

test("the same slider after a pause is a new step", async () => {
  // Folding on the key alone would merge two deliberate edits made minutes
  // apart into one, so that undoing the second also undid the first.
  const editor = fakeEditor();

  editor.edit({ exposure: 1 });

  // Longer than the fold window. The module reads the clock itself, so this is
  // the one test that has to wait rather than being handed a time.
  await new Promise((resolve) => setTimeout(resolve, 1300));

  editor.edit({ exposure: 2 });

  assert.equal(history.depth().past, 2, "a pause should have ended the first step");

  history.undo();
  assert.equal(editor.exposure, 1);
});

test("a change that touches several settings at once is one step", () => {
  // Choosing a preset changes a dozen things, and it is one thing the user
  // did. The fold only applies to a single setting changing repeatedly.
  const editor = fakeEditor();

  editor.edit({ exposure: 1, contrast: 1.3, saturation: 0.8, cloudCover: 0.4 });

  assert.equal(history.depth().past, 1);

  history.undo();
  assert.equal(editor.exposure, defaultPreset().exposure);
});

test("undo covers where you are, not only how it looks", () => {
  // US-024 says any change, and dragging the latitude slider by mistake is
  // exactly the change somebody wants back.
  const editor = fakeEditor();

  editor.move({ lat: -33.87, lon: 151.21 });
  assert.equal(editor.place.lat, -33.87);

  history.undo();
  assert.equal(editor.place.lat, 39.7);
});

test("the theme is not an edit, so it is not in the history", () => {
  // A view preference rather than a change to the thing being edited - the
  // same reason a text editor does not undo a change of font size. It also has
  // an obvious toggle, so undo is not the only way back.
  const editor = fakeEditor();

  editor.setTheme("light");

  assert.equal(history.canUndo(), false, "switching theme should not be undoable");
  assert.equal(editor.theme, "light");
});

test("a new change throws away the redo branch", () => {
  const editor = fakeEditor();

  editor.edit({ exposure: 1 });
  editor.edit({ contrast: 1.5 });
  history.undo();

  assert.equal(history.canRedo(), true);

  editor.edit({ saturation: 0.5 });
  assert.equal(history.canRedo(), false, "you cannot redo a future you walked away from");
});

test("undoing does not record itself", () => {
  // Restoring applies a document, which runs the same code a user edit does.
  // Without the guard, undo would push what it had just popped and nothing
  // would ever move.
  const editor = fakeEditor();

  editor.edit({ exposure: 1 });
  editor.edit({ contrast: 1.2 });

  const before = history.depth();
  history.undo();
  const after = history.depth();

  assert.equal(after.past, before.past - 1);
  assert.equal(after.future, before.future + 1);
});

test("a repaint that changed nothing adds no step", () => {
  // Callers are generous about when they call record(), which is only safe
  // because an unchanged state is not a step.
  const editor = fakeEditor();
  editor.edit({ exposure: 1 });

  const before = history.depth().past;
  history.record();
  history.record();
  history.record();

  assert.equal(history.depth().past, before);
});

test("the history does not grow without limit", () => {
  const editor = fakeEditor();

  // Alternating keys so nothing folds, and well past the limit.
  for (let i = 0; i < 260; i += 1) {
    editor.edit(i % 2 === 0 ? { exposure: i } : { contrast: 1 + i / 1000 });
  }

  assert.ok(history.depth().past <= 200, `history grew to ${history.depth().past}`);
  assert.ok(history.depth().past > 150, "and it should still hold plenty");
});
