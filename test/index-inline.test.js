import assert from "node:assert/strict";
import test from "node:test";

import {
  BPM_QUERY_CASES,
  INSTRUMENTS,
  LEGACY_PATTERN,
  MALFORMED_SONGS,
  V4_SONG,
} from "./fixtures/url-state.js";
import { createInlineHarness } from "./support/index-inline-harness.js";

function assertPitchFixture(state, expectedPatterns) {
  expectedPatterns.forEach((expectedPattern, patternIndex) => {
    Object.entries(expectedPattern).forEach(([instrument, expectedSteps]) => {
      Object.entries(expectedSteps).forEach(([stepIndex, expectedPitch]) => {
        assert.equal(
          state.patternPitchOffsets[patternIndex][instrument][Number(stepIndex)],
          expectedPitch,
        );
      });
    });
  });
}

async function awaitFilterCloseAndPurgeRetiringSource(
  harness,
  source,
  gain,
  closePromise,
) {
  const restartPromise = harness.api.startSequencer();
  const waiting = harness.hostSnapshot();

  assert.equal(waiting.isStartingPlayback, true);
  assert.equal(waiting.isPlaying, false);
  assert.equal(waiting.retiringSourceCount, 1);
  assert.equal(waiting.masterFilterGraphTransportState.closePending, true);

  harness.runAllFilterTransportTimeouts();
  if (closePromise) {
    assert.equal(await closePromise, true);
  }
  await restartPromise;

  const restarted = harness.hostSnapshot();
  assert.equal(restarted.isStartingPlayback, false);
  assert.equal(restarted.isPlaying, true);
  assert.equal(restarted.retiringSourceCount, 0);
  assert.equal(source.connections.length, 0);
  assert.equal(gain.connections.length, 0);

  const cleanupClose = harness.api.stopSequencer();
  harness.runAllFilterTransportTimeouts();
  assert.equal(await cleanupClose, true);
}

test("v4 song state round-trips patterns, repeats, mix, and pitch", () => {
  const harness = createInlineHarness();

  assert.equal(harness.api.loadSongStateFromBase64(V4_SONG.encoded), true);
  const state = harness.hostSnapshot();

  assert.deepEqual(state.instrumentsOrder, INSTRUMENTS);
  assert.deepEqual(state.patterns, V4_SONG.patterns);
  assert.deepEqual(state.patternRepeats, V4_SONG.repeats);
  assert.deepEqual(
    INSTRUMENTS.map((instrument) => state.instrumentVolumes[instrument]),
    V4_SONG.mix,
  );
  assertPitchFixture(state, V4_SONG.pitch);
  assert.equal(harness.api.encodeSongState(), V4_SONG.encoded);
});

test("legacy b state loads from a real catalog URL and zero-pads new lanes", () => {
  const harness = createInlineHarness();
  harness.window.location.search = new URLSearchParams({
    bpm: LEGACY_PATTERN.bpm,
    b: LEGACY_PATTERN.encoded,
  }).toString();
  harness.window.location.search = `?${harness.window.location.search}`;

  harness.api.loadFromURLParams();
  const state = harness.hostSnapshot();

  assert.equal(state.bpm, LEGACY_PATTERN.bpm);
  assert.deepEqual(
    state.patterns[0].slice(0, LEGACY_PATTERN.sourceBytes.length),
    LEGACY_PATTERN.sourceBytes,
  );
  assert.equal(state.patterns[0].length, INSTRUMENTS.length * 2);
  assert.ok(
    state.patterns[0]
      .slice(LEGACY_PATTERN.sourceBytes.length)
      .every((value) => value === 0),
  );
  assert.deepEqual(state.patternRepeats, [1]);
  assert.ok(Object.values(state.instrumentVolumes).every((value) => value === 100));
  assert.ok(
    Object.values(state.patternPitchOffsets[0])
      .flat()
      .every((value) => value === 0),
  );
});

test("malformed song state is rejected and falls back to legacy b state", () => {
  for (const encoded of [
    MALFORMED_SONGS.invalidBase64,
    MALFORMED_SONGS.emptyPatterns,
    MALFORMED_SONGS.invalidPatternsOnly,
  ]) {
    const directHarness = createInlineHarness();
    assert.equal(directHarness.api.loadSongStateFromBase64(encoded), false);

    const fallbackHarness = createInlineHarness();
    const query = new URLSearchParams({
      song: encoded,
      b: LEGACY_PATTERN.encoded,
    });
    fallbackHarness.window.location.search = `?${query.toString()}`;
    fallbackHarness.api.loadFromURLParams();
    assert.deepEqual(
      fallbackHarness.hostSnapshot().patterns[0].slice(0, 12),
      LEGACY_PATTERN.sourceBytes,
    );
  }
});

test("URL BPM values are normalized before they reach scheduling state", () => {
  BPM_QUERY_CASES.forEach(({ label, value, expected }) => {
    const harness = createInlineHarness();
    harness.window.location.search = `?${new URLSearchParams({ bpm: value })}`;
    harness.api.loadFromURLParams();
    assert.equal(harness.hostSnapshot().bpm, expected, label);
  });
});

test("scheduler math leaves an in-progress BPM field unchanged", () => {
  const cases = [
    { value: "8", expectedDelta: 0.375 },
    { value: "-1", expectedDelta: 0.375 },
    { value: "0", expectedDelta: 0.375 },
    { value: "", expectedDelta: 0.125 },
    { value: "fast", expectedDelta: 0.125 },
    { value: "100000000000000000000", expectedDelta: 0.05 },
  ];

  cases.forEach(({ value, expectedDelta }) => {
    const harness = createInlineHarness();
    harness.api.setBpm(value);
    harness.api.setState({ current16th: 0, nextNoteTime: 10 });
    harness.api.nextNote();
    const state = harness.hostSnapshot();

    assert.equal(state.bpm, value, value || "empty input");
    assert.equal(Number.isFinite(state.nextNoteTime), true, value);
    assert.equal(state.nextNoteTime, 10 + expectedDelta, value);
    assert.equal(state.current16th, 1, value);
  });
});

test("BPM change commits the normalized value to the field", () => {
  const cases = [
    { value: "8", expected: "40" },
    { value: "", expected: "120" },
    { value: "301", expected: "300" },
  ];

  cases.forEach(({ value, expected }) => {
    const harness = createInlineHarness();
    harness.api.setBpm(value);
    harness.ids.get("bpm").dispatchEvent({ type: "change" });
    assert.equal(harness.hostSnapshot().bpm, expected, value || "empty input");
  });
});

test("opening and closing Effects has no URL audio playback or Space authority", () => {
  const harness = createInlineHarness();
  harness.api.bindFilterEffectControls();
  harness.api.setSpaceEffectStateThroughController({
    enabled: true, size: 56, decay: 42, air: 86, mix: 30, preset: "shimmer",
  });
  const before = harness.hostSnapshot();
  const searchBefore = harness.window.location.search;
  const audioCountsBefore = Object.fromEntries(
    Object.entries(harness.audioNodes).map(([key, nodes]) => [key, nodes.length]),
  );

  harness.filterElements.toggle.dispatchEvent({ type: "click" });
  harness.filterElements.toggle.dispatchEvent({ type: "click" });

  const after = harness.hostSnapshot();
  assert.deepEqual(after.spaceEffectState, before.spaceEffectState);
  assert.equal(after.isPlaying, before.isPlaying);
  assert.equal(after.isStartingPlayback, before.isStartingPlayback);
  assert.equal(harness.window.location.search, searchBefore);
  assert.deepEqual(Object.fromEntries(
    Object.entries(harness.audioNodes).map(([key, nodes]) => [key, nodes.length]),
  ), audioCountsBefore);
});

test("stop cancels scheduled audio sources and visual callbacks", () => {
  const harness = createInlineHarness();
  harness.api.seedAudioBuffer("kick");
  harness.api.playSound("kick", 1, 0);
  harness.api.scheduleStep(3, 1);

  assert.equal(harness.sources.length, 1);
  assert.equal(harness.timeouts.size, 1);

  harness.api.stopSequencer();

  assert.equal(harness.sources[0].stops.length, 1);
  assert.equal(harness.timeouts.size, 0);
  assert.equal(harness.hostSnapshot().scheduledHighlightTimerCount, 0);
  assert.equal(harness.hostSnapshot().scheduledSourceCount, 0);
  harness.runAllTimeouts();
  assert.ok(harness.steps.every((step) => !step.classList.contains("playing")));
});

test("running-context Stop fades an active source before disconnecting it", async () => {
  const harness = createInlineHarness();
  harness.api.seedAudioBuffer("kick");
  harness.audioCtx.currentTime = 1;
  harness.api.playSound("kick", 0, 0);

  const source = harness.sources[0];
  const gain = source.connections[0];
  assert.equal(source.connections.length, 1);
  assert.equal(gain.connections.length, 1);
  assert.equal(harness.hostSnapshot().scheduledSourceCount, 1);
  assert.equal(harness.hostSnapshot().retiringSourceCount, 0);

  const closePromise = harness.api.stopSequencer();

  assert.equal(source.stops.length, 1);
  assert.ok(source.stops[0] > harness.audioCtx.currentTime);
  assert.equal(source.connections.length, 1);
  assert.equal(gain.connections.length, 1);
  assert.equal(harness.hostSnapshot().scheduledSourceCount, 0);
  assert.equal(harness.hostSnapshot().retiringSourceCount, 1);

  await awaitFilterCloseAndPurgeRetiringSource(
    harness,
    source,
    gain,
    closePromise,
  );
});

test("non-running-context Stop disconnects active sources immediately", () => {
  for (const state of ["suspended", "interrupted"]) {
    const harness = createInlineHarness();
    harness.api.seedAudioBuffer("kick");
    harness.audioCtx.currentTime = 1;
    harness.api.playSound("kick", 0, 0);
    harness.api.scheduleStep(3, 1);

    const source = harness.sources[0];
    const gain = source.connections[0];
    assert.equal(harness.timeouts.size, 1, state);
    harness.audioCtx.state = state;
    harness.api.stopSequencer();

    assert.equal(source.stops.length, 1, state);
    assert.ok(source.stops[0] <= harness.audioCtx.currentTime, state);
    assert.equal(source.connections.length, 0, state);
    assert.equal(gain.connections.length, 0, state);
    assert.equal(harness.timeouts.size, 0, state);
    assert.equal(harness.hostSnapshot().scheduledSourceCount, 0, state);
    assert.equal(harness.hostSnapshot().scheduledHighlightTimerCount, 0, state);
  }
});

test("reset cancels scheduled work and restores safe project defaults", async () => {
  const harness = createInlineHarness();
  harness.api.seedAudioBuffer("kick");
  harness.audioCtx.currentTime = 2;
  harness.api.playSound("kick", 2, 0);
  harness.api.scheduleStep(5, 2);
  harness.api.setState({ isPlaying: true });

  const source = harness.sources[0];
  const gain = source.connections[0];
  assert.equal(harness.hostSnapshot().scheduledSourceCount, 1);
  assert.equal(harness.hostSnapshot().retiringSourceCount, 0);

  harness.api.resetProjectState();
  const state = harness.hostSnapshot();

  assert.equal(harness.sources[0].stops.length, 1);
  assert.equal(harness.timeouts.size, 0);
  assert.equal(state.isPlaying, false);
  assert.equal(state.bpm, "120");
  assert.equal(state.scheduledSourceCount, 0);
  assert.equal(state.retiringSourceCount, 1);
  assert.equal(state.scheduledHighlightTimerCount, 0);
  assert.equal(source.connections.length, 1);
  assert.equal(gain.connections.length, 1);
  assert.deepEqual(state.patternRepeats, [1]);
  assert.ok(state.patterns[0].every((value) => value === 0));

  await awaitFilterCloseAndPurgeRetiringSource(harness, source, gain);
});

test("hiding the document stops and cancels scheduled work", async () => {
  const harness = createInlineHarness();
  harness.api.seedAudioBuffer("kick");
  harness.audioCtx.currentTime = 2;
  harness.api.playSound("kick", 2, 0);
  harness.api.scheduleStep(7, 2);
  harness.api.setState({ isPlaying: true });

  const source = harness.sources[0];
  const gain = source.connections[0];
  assert.equal(harness.hostSnapshot().scheduledSourceCount, 1);
  assert.equal(harness.hostSnapshot().retiringSourceCount, 0);

  harness.dispatchVisibility("hidden");

  assert.equal(harness.hostSnapshot().isPlaying, false);
  assert.equal(harness.sources[0].stops.length, 1);
  assert.equal(harness.timeouts.size, 0);
  assert.equal(harness.hostSnapshot().scheduledSourceCount, 0);
  assert.equal(harness.hostSnapshot().retiringSourceCount, 1);
  assert.equal(harness.hostSnapshot().scheduledHighlightTimerCount, 0);
  assert.equal(source.connections.length, 1);
  assert.equal(gain.connections.length, 1);

  harness.dispatchVisibility("visible");
  await awaitFilterCloseAndPurgeRetiringSource(harness, source, gain);
});

test.todo("malformed mix tokens preserve their instrument lane indexes", () => {
  const harness = createInlineHarness();
  assert.equal(harness.api.loadMixParam("100.bad.0"), true);
  const state = harness.hostSnapshot();
  assert.equal(state.instrumentVolumes.kick, 100);
  assert.equal(state.instrumentVolumes.snare, 100);
  assert.equal(state.instrumentVolumes.hi_hat, 0);
});

test.todo("discarded malformed patterns keep repeat and pitch metadata aligned", () => {
  const harness = createInlineHarness();
  assert.equal(
    harness.api.loadSongStateFromBase64(MALFORMED_SONGS.misalignedMetadata),
    true,
  );
  const state = harness.hostSnapshot();
  assert.deepEqual(state.patternRepeats, [2]);
  assert.equal(state.patternPitchOffsets[0].kick[1], -3);
  assert.equal(state.patternPitchOffsets[0].kick[0], 0);
});
