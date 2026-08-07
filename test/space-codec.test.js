import assert from "node:assert/strict";
import test from "node:test";

import {
  SPACE_EFFECT_DEFAULT_STATE,
  SPACE_EFFECT_PRESETS,
  getSpaceEffectPresetState,
} from "../src/lib/space-effect.js";
import {
  LEGACY_PATTERN,
  MALFORMED_SONGS,
  V4_SONG,
  V5_FILTER_SONG,
} from "./fixtures/url-state.js";
import { createInlineHarness } from "./support/index-inline-harness.js";

function decode(encoded) {
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
}

function encode(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

test("neutral Space preserves byte-exact v4 and Tone-only v5 songs", () => {
  const v4 = createInlineHarness();
  assert.equal(v4.api.loadSongStateFromBase64(V4_SONG.encoded), true);
  assert.deepEqual(v4.hostSnapshot().spaceEffectState, SPACE_EFFECT_DEFAULT_STATE);
  assert.equal(v4.api.encodeSongState(), V4_SONG.encoded);

  const tone = createInlineHarness();
  assert.equal(tone.api.loadSongStateFromBase64(V5_FILTER_SONG.encoded), true);
  assert.deepEqual(tone.hostSnapshot().spaceEffectState, SPACE_EFFECT_DEFAULT_STATE);
  assert.equal(tone.api.encodeSongState(), V5_FILTER_SONG.encoded);
});

test("optional v5 s state round-trips without changing music or Tone", () => {
  const source = createInlineHarness();
  assert.equal(source.api.loadSongStateFromBase64(V5_FILTER_SONG.encoded), true);
  source.api.setState({
    spaceEffectState: { enabled: true, size: 82, decay: 78, air: 72, mix: 44, preset: "bloom" },
  });
  const encoded = source.api.encodeSongState();
  const payload = decode(encoded);
  const tonePayload = decode(V5_FILTER_SONG.encoded);
  assert.deepEqual(payload.s, { v: 1, e: 1, s: 82, d: 78, a: 72, m: 44, p: "bloom" });
  assert.deepEqual({ ...payload, s: undefined }, { ...tonePayload, s: undefined });

  const reopened = createInlineHarness();
  assert.equal(reopened.api.loadSongStateFromBase64(encoded), true);
  assert.deepEqual(reopened.hostSnapshot().spaceEffectState, {
    enabled: true, size: 82, decay: 78, air: 72, mix: 44, preset: "bloom",
  });
  assert.equal(reopened.api.encodeSongState(), encoded);
});

test("changed bypassed Space serializes and malformed Space resets independently", () => {
  const source = createInlineHarness();
  assert.equal(source.api.loadSongStateFromBase64(V4_SONG.encoded), true);
  source.api.setState({
    spaceEffectState: { enabled: false, size: 40, decay: 50, air: 60, mix: 70, preset: "custom" },
  });
  const changed = decode(source.api.encodeSongState());
  assert.equal(changed.v, 5);
  assert.deepEqual(changed.s, { v: 1, e: 0, s: 40, d: 50, a: 60, m: 70, p: "custom" });

  for (const invalid of [null, [], { v: "1" }, { v: 2 }]) {
    const payload = { ...decode(V5_FILTER_SONG.encoded), s: invalid };
    const harness = createInlineHarness();
    assert.equal(harness.api.loadSongStateFromBase64(encode(payload)), true);
    assert.deepEqual(harness.hostSnapshot().spaceEffectState, SPACE_EFFECT_DEFAULT_STATE);
    assert.deepEqual(decode(harness.api.encodeSongState()).f, payload.f);
  }
});

test("legacy, malformed song fallback, empty URL, and project reset clear prior Space", () => {
  const harness = createInlineHarness();
  harness.api.setState({
    spaceEffectState: { enabled: true, size: 68, decay: 64, air: 48, mix: 36, preset: "warm-hall" },
  });
  harness.api.loadFromURLParams();
  assert.deepEqual(harness.hostSnapshot().spaceEffectState, SPACE_EFFECT_DEFAULT_STATE);

  harness.api.setState({ spaceEffectState: { enabled: true, size: 56, decay: 42, air: 86, mix: 30, preset: "shimmer" } });
  harness.api.resetProjectState();
  assert.deepEqual(harness.hostSnapshot().spaceEffectState, SPACE_EFFECT_DEFAULT_STATE);
});

test("legacy and malformed-song fallback actively clear primed Space", () => {
  const harness = createInlineHarness();
  const primed = { enabled: true, size: 68, decay: 64, air: 48, mix: 36, preset: "warm-hall" };

  harness.api.setState({ spaceEffectState: primed });
  harness.window.location.search = `?${new URLSearchParams({ b: LEGACY_PATTERN.encoded })}`;
  harness.api.loadFromURLParams();
  assert.deepEqual(harness.hostSnapshot().spaceEffectState, SPACE_EFFECT_DEFAULT_STATE);
  assert.deepEqual(harness.hostSnapshot().patterns[0].slice(0, LEGACY_PATTERN.sourceBytes.length), LEGACY_PATTERN.sourceBytes);

  harness.api.setState({ spaceEffectState: primed });
  harness.window.location.search = `?${new URLSearchParams({
    song: MALFORMED_SONGS.invalidBase64,
    b: LEGACY_PATTERN.encoded,
  })}`;
  harness.api.loadFromURLParams();
  assert.deepEqual(harness.hostSnapshot().spaceEffectState, SPACE_EFFECT_DEFAULT_STATE);
  assert.deepEqual(harness.hostSnapshot().patterns[0].slice(0, LEGACY_PATTERN.sourceBytes.length), LEGACY_PATTERN.sourceBytes);
});

test("sequential v5, v4, legacy, invalid, and no-song loads never leak prior Space", () => {
  const harness = createInlineHarness();
  const primed = { enabled: true, size: 56, decay: 42, air: 86, mix: 30, preset: "shimmer" };
  const withSpace = { ...decode(V5_FILTER_SONG.encoded), s: { v: 1, e: 1, s: 82, d: 78, a: 72, m: 44, p: "bloom" } };

  assert.equal(harness.api.loadSongStateFromBase64(encode(withSpace)), true);
  assert.equal(harness.hostSnapshot().spaceEffectState.preset, "bloom");

  for (const load of [
    () => harness.api.loadSongStateFromBase64(V5_FILTER_SONG.encoded),
    () => harness.api.loadSongStateFromBase64(V4_SONG.encoded),
    () => harness.api.loadSinglePatternFromBase64(LEGACY_PATTERN.encoded),
  ]) {
    harness.api.setState({ spaceEffectState: primed });
    assert.equal(load(), true);
    assert.deepEqual(harness.hostSnapshot().spaceEffectState, SPACE_EFFECT_DEFAULT_STATE);
  }

  for (const search of [
    `?${new URLSearchParams({ song: MALFORMED_SONGS.invalidBase64 })}`,
    "",
  ]) {
    harness.api.setState({ spaceEffectState: primed });
    harness.window.location.search = search;
    harness.api.loadFromURLParams();
    assert.deepEqual(harness.hostSnapshot().spaceEffectState, SPACE_EFFECT_DEFAULT_STATE);
  }
});

test("Space-only omits f and combined songs order f before s", () => {
  const spaceOnly = createInlineHarness();
  assert.equal(spaceOnly.api.loadSongStateFromBase64(V4_SONG.encoded), true);
  spaceOnly.api.setState({ spaceEffectState: getSpaceEffectPresetState("warm-hall") });
  const spaceOnlyPayload = decode(spaceOnly.api.encodeSongState());
  assert.equal(spaceOnlyPayload.v, 5);
  assert.equal(Object.prototype.hasOwnProperty.call(spaceOnlyPayload, "f"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(spaceOnlyPayload, "s"), true);

  const combined = createInlineHarness();
  assert.equal(combined.api.loadSongStateFromBase64(V5_FILTER_SONG.encoded), true);
  combined.api.setState({ spaceEffectState: getSpaceEffectPresetState("bloom") });
  const combinedPayload = decode(combined.api.encodeSongState());
  assert.ok(Object.keys(combinedPayload).indexOf("f") < Object.keys(combinedPayload).indexOf("s"));
});

test("Space Share URLs remain deterministic through four reopen cycles", async () => {
  const states = [
    ...SPACE_EFFECT_PRESETS.map((preset) => getSpaceEffectPresetState(preset.id)),
    { enabled: true, size: 11, decay: 22, air: 33, mix: 44, preset: "custom" },
    { enabled: false, size: 44, decay: 33, air: 22, mix: 11, preset: "custom" },
  ];

  for (const base of [V4_SONG.encoded, V5_FILTER_SONG.encoded]) {
    for (const state of states) {
      const source = createInlineHarness();
      assert.equal(source.api.loadSongStateFromBase64(base), true);
      source.api.syncSelectedPatternToGrid();
      source.api.setState({ spaceEffectState: state });
      const canonicalSong = source.api.encodeSongState();

      await source.dispatchElementEvent(source.ids.get("shareBtn"), { type: "click" });
      assert.equal(source.clipboardWrites.length, 1);
      const canonicalUrl = source.clipboardWrites[0];
      const sourceParams = new URL(canonicalUrl).searchParams;
      assert.equal(sourceParams.getAll("song").length, 1);
      assert.equal(sourceParams.has("s"), false);
      assert.equal(sourceParams.get("song"), canonicalSong);

      let currentUrl = canonicalUrl;
      for (let cycle = 1; cycle <= 4; cycle += 1) {
        const reopened = createInlineHarness();
        reopened.window.location.search = new URL(currentUrl).search;
        reopened.api.loadFromURLParams();
        reopened.api.syncSelectedPatternToGrid();
        assert.deepEqual(reopened.hostSnapshot().spaceEffectState, state);
        assert.equal(reopened.api.encodeSongState(), canonicalSong);

        await reopened.dispatchElementEvent(reopened.ids.get("shareBtn"), {
          type: "click",
        });
        assert.equal(reopened.clipboardWrites.length, 1);
        const sharedUrl = reopened.clipboardWrites[0];
        const sharedParams = new URL(sharedUrl).searchParams;
        const sharedSong = sharedParams.get("song");
        const rawPayload = Buffer.from(sharedSong, "base64").toString("utf8");
        assert.equal(sharedParams.getAll("song").length, 1);
        assert.equal(sharedParams.has("s"), false);
        assert.equal(sharedSong, canonicalSong);
        assert.equal((rawPayload.match(/"s":\{"v":/g) ?? []).length, 1);
        assert.equal(sharedUrl, canonicalUrl);
        currentUrl = sharedUrl;
      }
    }
  }
});

test("FX2-C11 unavailable Space preserves desired state through Share and reopen", async () => {
  const desired = { enabled: true, size: 61, decay: 72, air: 83, mix: 39, preset: "custom" };
  const source = createInlineHarness();
  assert.deepEqual(Array.from(source.api.getSpaceControllerKeys()), ["setState", "replaceWithDefault", "selectPreset",
    "setMacro", "setEnabled", "makeUnavailable", "getState", "render"]);
  assert.equal(source.api.loadSongStateFromBase64(V5_FILTER_SONG.encoded), true);
  source.api.syncSelectedPatternToGrid();
  const toneBefore = source.hostSnapshot().filterEffectState;
  source.api.seedAudioBuffer("kick");
  const started = source.api.startSequencer();
  await started;
  assert.equal(source.hostSnapshot().masterTerminalGateGain, 1);
  source.api.setSpaceEffectStateThroughController(desired, { immediate: true });
  source.api.makeSpaceUnavailableThroughController();
  assert.equal(source.hostSnapshot().spaceEffectAvailable, false);
  assert.deepEqual(source.hostSnapshot().spaceEffectState, desired);
  assert.deepEqual(source.hostSnapshot().filterEffectState, toneBefore);
  assert.equal(source.hostSnapshot().masterEffectsRoute, "tone-gate");
  assert.equal(source.hostSnapshot().masterTerminalGateGain, 1);

  await source.dispatchElementEvent(source.ids.get("shareBtn"), { type: "click" });
  const shared = source.clipboardWrites.at(-1);
  const song = new URL(shared).searchParams.get("song");
  assert.deepEqual(decode(song).s, { v: 1, e: 1, s: 61, d: 72, a: 83, m: 39, p: "custom" });

  const reopened = createInlineHarness();
  reopened.window.location.search = new URL(shared).search;
  reopened.api.loadFromURLParams();
  assert.deepEqual(reopened.hostSnapshot().spaceEffectState, desired);
  assert.deepEqual(reopened.hostSnapshot().filterEffectState, toneBefore);
  assert.equal(reopened.api.encodeSongState(), song);
  const stopped = source.api.stopSequencer(); source.runAllFilterTransportTimeouts(); await stopped;
});

test("valid song wins over b and query junk while top-level mix stays lane-only", () => {
  const source = createInlineHarness();
  assert.equal(source.api.loadSongStateFromBase64(V5_FILTER_SONG.encoded), true);
  source.api.setState({ spaceEffectState: getSpaceEffectPresetState("bloom") });
  const song = source.api.encodeSongState();
  const mixValues = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 90, 80, 70];

  const harness = createInlineHarness();
  harness.window.location.search = `?${new URLSearchParams({
    song,
    b: LEGACY_PATTERN.encoded,
    mix: mixValues.join("."),
    s: JSON.stringify({ v: 1, e: 0, s: 0, d: 0, a: 0, m: 0, p: "custom" }),
  })}`;
  harness.api.loadFromURLParams();
  const snapshot = harness.hostSnapshot();
  assert.deepEqual(snapshot.spaceEffectState, getSpaceEffectPresetState("bloom"));
  assert.deepEqual(snapshot.patternRepeats, V4_SONG.repeats);
  assert.deepEqual(
    Object.values(snapshot.instrumentVolumes),
    mixValues
  );
  assert.deepEqual(decode(harness.api.encodeSongState()).s, decode(song).s);
});
