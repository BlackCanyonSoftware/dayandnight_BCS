import test from "node:test";
import assert from "node:assert/strict";

import pause from "../../desktop/pause.js";

const { PauseWatcher, AWAY_SECONDS } = pause;

/**
 * The pause policy, which until now had no tests at all because every branch
 * of it is a fact about somebody's machine - locked, on battery, a game
 * running, nobody in the room - and none of those can be produced from a test.
 * With the two sources injected they are all a table.
 *
 * What is being checked is not that the booleans combine (they obviously do)
 * but the two things that would actually go wrong: that the reason a user is
 * shown is the one that explains the most when several are true at once, and
 * that `onChange` fires on a change and not on a poll. The second matters
 * because the callback tears down render loops; one that fired every two
 * seconds would tear down a loop it had just rebuilt, forever.
 */

/**
 * @param {{ battery?: boolean, idle?: number, notification?: string }} world
 */
function fakeSources(world = {}) {
  /** @type {Map<string, Set<() => void>>} */
  const handlers = new Map();

  return {
    /** Every event the watcher subscribed to, so a test can fire one. */
    fire(event) {
      for (const handler of handlers.get(event) ?? []) handler();
    },
    /** How many handlers are still attached, for the teardown test. */
    get listenerCount() {
      let total = 0;
      for (const set of handlers.values()) total += set.size;
      return total;
    },
    world,
    powerMonitor: {
      isOnBatteryPower: () => world.battery ?? false,
      getSystemIdleTime: () => world.idle ?? 0,
      on(event, handler) {
        if (!handlers.has(event)) handlers.set(event, new Set());
        handlers.get(event).add(handler);
      },
      off(event, handler) {
        handlers.get(event)?.delete(handler);
      }
    },
    host: {
      userNotificationState: () => world.notification ?? "normal"
    }
  };
}

/**
 * A watcher over a fake world, with every state change recorded.
 *
 * `start()` is deliberately not called: it installs a two-second interval, and
 * the policy is `evaluate()`, which needs no clock.
 *
 * @param {{ battery?: boolean, idle?: number, notification?: string }} [world]
 */
function watcherOver(world = {}) {
  const sources = fakeSources(world);
  /** @type {{ paused: boolean, reason: string | null }[]} */
  const changes = [];
  const watcher = new PauseWatcher((state) => changes.push(state), sources);
  return { watcher, sources, changes };
}

test("an ordinary desktop is not paused", () => {
  const { watcher } = watcherOver();
  assert.deepEqual(watcher.evaluate(), { paused: false, reason: null });
});

test("every signal on its own stops the wallpaper", () => {
  const cases = [
    ["a full-screen application", { notification: "fullscreen" }],
    ["a presentation", { notification: "presentation" }],
    ["the shell reporting busy", { notification: "busy" }],
    ["nobody present", { notification: "not-present" }],
    ["battery", { battery: true }],
    ["ten minutes of no input", { idle: AWAY_SECONDS }]
  ];

  for (const [name, world] of cases) {
    const { watcher } = watcherOver(world);
    const state = watcher.evaluate();
    assert.equal(state.paused, true, `${name} should pause the wallpaper`);
    assert.ok(state.reason, `${name} should say why`);
  }
});

test("a state the shell does not block carries on drawing", () => {
  // "quiet" means notifications are suppressed, not that the desktop is
  // hidden. Pausing on it would stop the wallpaper for somebody who had
  // merely turned on Do Not Disturb.
  for (const notification of ["normal", "quiet", "running-d3d-full-screen", "unknown"]) {
    const { watcher } = watcherOver({ notification });
    assert.equal(watcher.evaluate().paused, false, `${notification} should not pause`);
  }
});

test("locking and unlocking the session is an event, not a poll", () => {
  const { sources, changes } = watcherOver();

  sources.fire("lock-screen");
  assert.deepEqual(changes.at(-1), { paused: true, reason: "the session is locked" });

  sources.fire("unlock-screen");
  assert.deepEqual(changes.at(-1), { paused: false, reason: null });
});

test("suspending and resuming the machine likewise", () => {
  const { sources, changes } = watcherOver();

  sources.fire("suspend");
  assert.equal(changes.at(-1).paused, true);
  assert.match(changes.at(-1).reason, /sleep/);

  sources.fire("resume");
  assert.equal(changes.at(-1).paused, false);
});

test("the reason given is the one that explains the most", () => {
  // A locked laptop on battery with a game running and nobody there is four
  // signals at once. Telling somebody "the computer is on battery" when the
  // real answer is that they locked it would be true and useless.
  const { watcher } = watcherOver({
    battery: true,
    idle: 9999,
    notification: "fullscreen"
  });

  watcher.update({ locked: true, suspended: true });
  assert.match(watcher.current().reason, /sleep/, "suspending outranks everything");

  watcher.update({ suspended: false });
  assert.match(watcher.current().reason, /locked/, "locked outranks battery");

  watcher.update({ locked: false });
  assert.match(watcher.current().reason, /battery/, "battery outranks a full-screen game");

  watcher.setPauseOnBattery(false);
  assert.match(watcher.current().reason, /full screen/, "a game outranks being away");

  // And with nothing else true, being away is what is left - the weakest
  // claim, since it is inferred from a lack of typing rather than observed.
  const away = watcherOver({ idle: 1200 });
  assert.match(away.watcher.evaluate().reason, /nobody has touched/);
});

test("the away threshold is a setting, and zero turns it off", () => {
  const { watcher } = watcherOver({ idle: 400 });

  // Below the default, so nothing yet.
  assert.equal(watcher.evaluate().paused, false);

  watcher.setAwaySeconds(300);
  assert.equal(watcher.evaluate().paused, true);

  watcher.setAwaySeconds(0);
  assert.equal(watcher.evaluate().paused, false, "zero should never pause for being away");

  // A nonsense value cannot make the wallpaper stop forever.
  watcher.setAwaySeconds(-60);
  assert.equal(watcher.awaySeconds, 0);
});

test("the away reason counts the real idle time, not the threshold", () => {
  // Somebody back after lunch should be told what happened, and "nobody has
  // touched the computer for 10 minutes" when it was ninety is a worse answer
  // than the truth.
  const { watcher } = watcherOver({ idle: 5400 });
  assert.match(watcher.evaluate().reason, /90 minutes/);
});

test("the default threshold matches when Windows turns the display off", () => {
  // Ten minutes, which is Windows' own default on mains power. The number is
  // pinned because the reasoning depends on it: choosing the same figure is
  // what makes the wallpaper stop at about the moment it stops being visible.
  assert.equal(AWAY_SECONDS, 600);
});

test("onChange fires on a change and never on a poll", () => {
  // This is the one that matters. The callback tears render loops down, so a
  // watcher that announced the same state every two seconds would tear down a
  // loop it had just rebuilt, for as long as the application ran.
  const { watcher, changes } = watcherOver();

  watcher.update({});
  watcher.update({});
  watcher.update({});
  assert.equal(changes.length, 0, "an unchanged state should say nothing");

  watcher.update({ locked: true });
  assert.equal(changes.length, 1);

  watcher.update({});
  watcher.update({});
  assert.equal(changes.length, 1, "still locked is not news");

  watcher.update({ locked: false });
  assert.equal(changes.length, 2);
});

test("a change of reason is a change, even while still paused", () => {
  // Going from "on battery" to "locked" without passing through running: the
  // wallpaper stays stopped, but the editor is showing the old reason and has
  // to be told.
  const { watcher, changes } = watcherOver({ battery: true });

  watcher.update({});
  assert.equal(changes.length, 1);
  assert.match(changes[0].reason, /battery/);

  watcher.update({ locked: true });
  assert.equal(changes.length, 2, "the reason changed, so the editor needs telling");
  assert.match(changes[1].reason, /locked/);
  assert.equal(changes[1].paused, true);
});

test("stopping the watcher lets go of every handler", () => {
  // A watcher that kept its subscriptions would hold the whole object alive
  // and keep answering after the application decided it should not - and
  // NFR-2 asks for thirty days without accumulation.
  const { watcher, sources } = watcherOver();
  assert.ok(sources.listenerCount > 0);

  watcher.stop();
  assert.equal(sources.listenerCount, 0);
});

test("stopping twice is harmless", () => {
  const { watcher } = watcherOver();
  watcher.stop();
  watcher.stop();
});
