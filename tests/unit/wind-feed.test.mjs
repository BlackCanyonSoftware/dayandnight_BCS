import test from "node:test";
import assert from "node:assert/strict";

import feedModule from "../../desktop/wind-feed.js";
import windSource from "../../desktop/wind-source.js";

const { MIN_GAP_MS, REFUSED_MS, RETRY_BASE_MS, SETTLE_MS, TIMEOUT_MS, WindFeed } = feedModule;
const { CONTACT } = windSource;

const START = Date.UTC(2026, 10, 13, 12);
const HOUR = 3_600_000;
const DENVER = { lat: 39.7412, lon: -104.9876 };

/** A forecast with enough steps to be accepted. */
function forecast(speed = 4) {
  const steps = [];
  for (let h = 0; h < 6; h += 1) {
    steps.push({
      time: new Date(START + h * HOUR).toISOString(),
      data: { instant: { details: { wind_speed: speed, wind_from_direction: 270 } } }
    });
  }
  return { properties: { timeseries: steps } };
}

const answer = (body, headers = {}, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Map(Object.entries(headers)),
  json: async () => body
});

/**
 * A feed on a fake clock and a fake network. `replies` are used in order; a
 * function is called with the request and may return a promise, which is how a
 * test holds an answer back.
 */
function rig(replies = []) {
  let now = START;
  let nextId = 1;
  /** @type {{ id: number, at: number, fn: () => void }[]} */
  let timers = [];
  const calls = [];
  const changes = [];
  const queue = [...replies];
  const anchors = [];

  const feed = new WindFeed({
    version: "9.9.9",
    now: () => now,
    random: () => 0,
    setTimer: (fn, ms) => {
      const timer = { id: nextId++, at: now + ms, fn };
      timers.push(timer);
      return timer.id;
    },
    clearTimer: (id) => {
      timers = timers.filter((t) => t.id !== id);
    },
    fetch: async (url, init) => {
      calls.push({ url, headers: init.headers, at: now });
      const next = queue.shift();
      if (next === undefined) throw new Error("no reply was planned for this request");
      return typeof next === "function" ? next(init) : next;
    },
    anchor: (previous, samples, at, place) => {
      anchors.push({ previous, samples, at, place });
      return { samples, origin: { east: previous ? previous.origin.east + 1 : 0, north: 0 } };
    },
    onChange: (payload, status) => changes.push({ payload, status })
  });

  const settle = () => new Promise((resolve) => setImmediate(resolve));

  /** Move the clock on, firing what falls due on the way, in order. */
  async function advance(ms) {
    const until = now + ms;
    for (;;) {
      const due = timers.filter((t) => t.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers = timers.filter((t) => t !== due);
      now = Math.max(now, due.at);
      due.fn();
      await settle();
    }
    now = until;
    await settle();
  }

  return {
    feed,
    calls,
    changes,
    anchors,
    advance,
    settle,
    queue,
    pending: () => timers.length,
    clock: () => now
  };
}

const on = (place = DENVER) => ({ enabled: true, place });

test("nothing is asked until it is switched on, however long it waits", async () => {
  const r = rig();

  r.feed.configure({ enabled: false, place: DENVER });
  await r.advance(24 * HOUR);

  assert.equal(r.calls.length, 0);
  assert.equal(r.feed.status().state, "off");
  assert.equal(r.feed.current(), null);
  assert.equal(r.pending(), 0, "not even a timer");
});

test("switching it on asks at once, with our name and a tenth of a degree", async () => {
  const r = rig([answer(forecast(), { expires: new Date(START + 2 * HOUR).toUTCString() })]);

  r.feed.configure(on());
  await r.advance(0);

  assert.equal(r.calls.length, 1);
  assert.ok(r.calls[0].url.includes("lat=39.7&lon=-104.9"), r.calls[0].url);
  assert.ok(r.calls[0].headers["User-Agent"].includes("DayAndNight/9.9.9"));
  assert.ok(r.calls[0].headers["User-Agent"].includes(CONTACT));

  assert.equal(r.feed.status().state, "live");
  assert.equal(r.feed.status().fetchedAt, START);
  assert.equal(r.feed.current().samples.length, 6);
});

test("it asks again after Expires and not before, asking only for what changed", async () => {
  const expires = new Date(START + 2 * HOUR).toUTCString();
  const r = rig([
    answer(forecast(), { expires, "last-modified": "Fri, 13 Nov 2026 11:58:00 GMT" }),
    answer(forecast(), { expires: new Date(START + 4 * HOUR).toUTCString() }, 304)
  ]);

  r.feed.configure(on());
  await r.advance(0);
  await r.advance(2 * HOUR - 1_000);
  assert.equal(r.calls.length, 1, "not before Expires");

  await r.advance(11 * 60_000);
  assert.equal(r.calls.length, 2);
  assert.equal(r.calls[1].headers["If-Modified-Since"], "Fri, 13 Nov 2026 11:58:00 GMT");

  // "Not modified" keeps what it has and is still live.
  assert.equal(r.feed.status().state, "live");
  assert.equal(r.feed.current().samples.length, 6);
});

test("a new forecast is positioned from the one it replaces, so the clouds do not jump", async () => {
  const r = rig([
    answer(forecast(), { expires: new Date(START + HOUR).toUTCString() }),
    answer(forecast(8), { expires: new Date(START + 5 * HOUR).toUTCString() })
  ]);

  r.feed.configure(on());
  await r.advance(0);
  await r.advance(HOUR + 11 * 60_000);

  assert.equal(r.anchors.length, 2);
  assert.equal(r.anchors[0].previous, null, "the first has nothing to continue");
  assert.ok(r.anchors[1].previous, "the second is told where the first had the clouds");
  assert.equal(r.feed.current().origin.east, 1);
});

test("switching it off forgets the data, stops the timer, and ignores a late answer", async () => {
  /** @type {(value: unknown) => void} */
  let release = () => {};
  const held = () => new Promise((resolve) => (release = resolve));
  const r = rig([held]);

  r.feed.configure(on());
  await r.advance(0);
  assert.equal(r.calls.length, 1, "asked, and not answered yet");

  r.feed.configure({ enabled: false, place: DENVER });
  release(answer(forecast()));
  await r.settle();

  assert.equal(r.feed.current(), null, "the late answer was not kept");
  assert.equal(r.feed.status().state, "off");
  assert.equal(r.pending(), 0);

  await r.advance(24 * HOUR);
  assert.equal(r.calls.length, 1, "and it never asks again");
});

test("switching it off after it had data forgets it", async () => {
  const r = rig([answer(forecast(), {})]);

  r.feed.configure(on());
  await r.advance(0);
  assert.ok(r.feed.current());

  r.feed.configure({ enabled: false, place: DENVER });
  assert.equal(r.feed.current(), null);
  assert.equal(r.feed.status().fetchedAt, null);
  assert.equal(r.changes.at(-1).payload, null, "and everything listening was told");
});

test("a place that truncates to the same tenth of a degree is the same place", async () => {
  const r = rig([answer(forecast(), {})]);

  r.feed.configure(on({ lat: 39.71, lon: -104.91 }));
  await r.advance(0);
  r.feed.configure(on({ lat: 39.79, lon: -104.99 }));
  await r.advance(HOUR / 2);

  assert.equal(r.calls.length, 1);
  assert.ok(r.feed.current(), "and its data was not thrown away");
});

test("dragging the place about asks once, about where it ended, after it settles", async () => {
  const r = rig([answer(forecast(), {}), answer(forecast(), {})]);

  r.feed.configure(on());
  await r.advance(0);
  assert.equal(r.calls.length, 1);

  // A slider drag: twenty places, a second apart.
  for (let i = 1; i <= 20; i += 1) {
    r.feed.configure(on({ lat: 10 + i, lon: 20 }));
    await r.advance(1_000);
  }

  assert.equal(r.feed.current(), null, "data for another place is not shown");
  assert.equal(r.calls.length, 1, "nothing asked while it was still moving");

  await r.advance(MIN_GAP_MS);
  assert.equal(r.calls.length, 2);
  assert.ok(r.calls[1].url.includes("lat=30.0&lon=20.0"), r.calls[1].url);
  assert.ok(r.anchors[1].previous === null, "a different place does not continue the old one");
  assert.ok(!("If-Modified-Since" in r.calls[1].headers));
});

test("a place change is never asked sooner than a minute after the last ask", async () => {
  const r = rig([answer(forecast(), {}), answer(forecast(), {})]);

  r.feed.configure(on());
  await r.advance(0);
  const first = r.clock();

  r.feed.configure(on({ lat: 12, lon: 34 }));
  await r.advance(SETTLE_MS + 1_000);
  assert.equal(r.calls.length, 1, "settled, but too soon after the last one");

  await r.advance(MIN_GAP_MS);
  assert.equal(r.calls.length, 2);
  assert.ok(r.calls[1].at - first >= MIN_GAP_MS);
});

test("a network error keeps what there is and tries again later, waiting longer each time", async () => {
  const boom = () => {
    throw new Error("offline");
  };
  const r = rig([
    answer(forecast(), { expires: new Date(START + HOUR).toUTCString() }),
    boom,
    boom,
    boom
  ]);

  r.feed.configure(on());
  await r.advance(0);
  await r.advance(HOUR + 11 * 60_000);

  assert.equal(r.calls.length, 2);
  assert.equal(r.feed.status().state, "offline");
  assert.ok(
    r.feed.current(),
    "the last good data is still there, and the engine copes with its age"
  );

  const secondAt = r.calls[1].at;
  await r.advance(RETRY_BASE_MS + 1_000);
  assert.equal(r.calls.length, 3);
  assert.ok(r.calls[2].at - secondAt >= RETRY_BASE_MS);

  const thirdAt = r.calls[2].at;
  await r.advance(2 * RETRY_BASE_MS + 1_000);
  assert.equal(r.calls.length, 4);
  assert.ok(r.calls[3].at - thirdAt >= 2 * RETRY_BASE_MS, "twice as long this time");
});

test("being refused or told to slow down waits at least an hour", async () => {
  for (const status of [403, 429]) {
    const r = rig([answer({}, {}, status), answer(forecast(), {})]);

    r.feed.configure(on());
    await r.advance(0);
    assert.equal(r.feed.status().state, "offline");

    await r.advance(REFUSED_MS - 60_000);
    assert.equal(r.calls.length, 1, `${status}: not within the hour`);

    await r.advance(11 * 60_000 + 60_000);
    assert.equal(r.calls.length, 2, `${status}: and then it tries again`);
  }
});

test("an answer that is not a usable forecast is a failure, not data", async () => {
  const r = rig([answer({ properties: { timeseries: [] } }), answer({ nonsense: true })]);

  r.feed.configure(on());
  await r.advance(0);

  assert.equal(r.feed.current(), null);
  assert.equal(r.feed.status().state, "offline");
  assert.equal(r.anchors.length, 0, "nothing was positioned");
});

test("a request that never answers is given up on", async () => {
  const hang = (init) =>
    new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")));
    });
  const r = rig([hang]);

  r.feed.configure(on());
  await r.advance(0);
  assert.equal(r.feed.status().state, "waiting", "still waiting for it");

  await r.advance(TIMEOUT_MS + 1_000);
  assert.equal(r.feed.status().state, "offline");
});

test("changing the place while a request is out asks again for the new one", async () => {
  /** @type {(value: unknown) => void} */
  let release = () => {};
  const held = () => new Promise((resolve) => (release = resolve));
  const r = rig([held, answer(forecast(), {})]);

  r.feed.configure(on());
  await r.advance(0);

  r.feed.configure(on({ lat: -33.8, lon: 151.2 }));
  await r.advance(SETTLE_MS + 1_000); // the new ask comes due while the old is still out
  release(answer(forecast(), {}));
  await r.settle();

  assert.equal(r.feed.current(), null, "the old place's answer is not used");

  await r.advance(MIN_GAP_MS + SETTLE_MS);
  assert.equal(r.calls.length, 2);
  assert.ok(r.calls[1].url.includes("lat=-33.8&lon=151.2"), r.calls[1].url);
  assert.ok(r.feed.current());
});

test("never two requests at once, and never more than one a minute", async () => {
  const r = rig(Array.from({ length: 50 }, () => answer(forecast(), {})));

  r.feed.configure(on());
  for (let i = 0; i < 40; i += 1) {
    r.feed.configure(on({ lat: i, lon: i }));
    await r.advance(5_000);
  }
  await r.advance(HOUR);

  for (let i = 1; i < r.calls.length; i += 1) {
    assert.ok(r.calls[i].at - r.calls[i - 1].at >= MIN_GAP_MS, `request ${i} came too soon`);
  }
});
