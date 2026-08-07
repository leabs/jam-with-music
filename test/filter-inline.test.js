import assert from "node:assert/strict";
import test from "node:test";

import {
  FILTER_EFFECT_DEFAULT_STATE,
  FILTER_EFFECT_PRESETS,
  getFilterEffectPresetState,
  serializeFilterEffectState,
} from "../src/lib/filter-effect.js";
import {
  formatSpaceMacroValue,
  getSpaceEffectSummary,
} from "../src/lib/space-effect.js";
import {
  INSTRUMENTS,
  LEGACY_PATTERN,
  MALFORMED_SONGS,
  V4_SONG,
  V5_FILTER_SONG,
} from "./fixtures/url-state.js";
import { createInlineHarness } from "./support/index-inline-harness.js";

const CUSTOM_FILTER_STATE = {
  enabled: true,
  cutoff: 37,
  resonance: 52,
  drive: 63,
  mix: 41,
  preset: "custom",
};

const FILTER_PRESET_CARD_CONTRACT = [
  ["clean", "Clean", "moon rabbit"],
  ["warm", "Warm", "sleepy bear"],
  ["bright", "Bright", "songbird"],
  ["resonant-sweep", "Resonant Sweep", "ribbon snake"],
  ["grit", "Grit", "black-and-white dragon"],
  ["custom", "Custom", "custom patch"],
];

function decodeSongPayload(encoded) {
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
}

function encodeSongPayload(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

function filterSnapshot(harness) {
  return harness.hostSnapshot().filterEffectState;
}

function createSearch(params) {
  const query = new URLSearchParams(params).toString();
  return query ? `?${query}` : "";
}

function getFilterPanelCollapseTimers(harness) {
  return [...harness.timeouts.entries()].filter(([, timer]) => timer.delay === 180);
}

function getTransitionListenerCount(body) {
  return body.listeners.get("transitionend")?.length ?? 0;
}

function assertFilterDisclosure(
  harness,
  expanded,
  label,
  { hidden = !expanded, transitioning } = {},
) {
  const { dialog, body, toggle, toggleLabel } = harness.filterElements;

  assert.equal(
    harness.hostSnapshot().filterPanelExpanded,
    expanded,
    `${label}: controller state`,
  );
  assert.equal(dialog.open, expanded, `${label}: dialog open`);
  assert.equal(body.hidden, false, `${label}: body remains mounted`);
  assert.equal(body.dataset.expanded, "true", `${label}: body data`);
  assert.equal(body.inert, false, `${label}: body remains interactive`);
  assert.equal(body.getAttribute("inert"), null, `${label}: inert attr`);
  assert.equal(body.getAttribute("aria-hidden"), null, `${label}: aria-hidden`);
  assert.equal(
    toggle.getAttribute("aria-expanded"),
    expanded ? "true" : "false",
    `${label}: aria-expanded`,
  );
  assert.equal(
    toggle.getAttribute("aria-label"),
    "Close effects",
    `${label}: aria-label`,
  );
  assert.equal(
    toggleLabel.textContent,
    "Close effects",
    `${label}: visible label`,
  );
  if (transitioning !== undefined) {
    assert.equal(
      body.dataset.transitioning,
      transitioning ? "true" : "false",
      `${label}: transitioning`,
    );
  }
}

function disclosureAuthoritySnapshot(harness) {
  const snapshot = harness.hostSnapshot();
  return {
    filter: {
      state: snapshot.filterEffectState,
      available: snapshot.filterEffectAvailable,
    },
    music: {
      patterns: snapshot.patterns,
      repeats: snapshot.patternRepeats,
      pitch: snapshot.patternPitchOffsets,
      volumes: snapshot.instrumentVolumes,
      selectedPatternIndex: snapshot.selectedPatternIndex,
      playbackPatternIndex: snapshot.playbackPatternIndex,
      bpm: snapshot.bpm,
    },
    codec: harness.api.encodeSongState(),
    url: harness.window.location.search,
    graph: {
      present: snapshot.masterFilterGraphPresent,
      state: snapshot.masterFilterGraphState,
      transport: snapshot.masterFilterGraphTransportState,
      outputGain: snapshot.masterFilterOutputGain,
      filterNodeCount: harness.audioNodes.filters.length,
      waveShaperNodeCount: harness.audioNodes.waveShapers.length,
      masterGainConnectionCount: snapshot.masterGainConnectionCount,
      masterGainConnectedToFilter: snapshot.masterGainConnectedToFilter,
      filterOutputConnectedToProtection: snapshot.filterOutputConnectedToProtection,
    },
    transport: {
      isPlaying: snapshot.isPlaying,
      isStartingPlayback: snapshot.isStartingPlayback,
      current16th: snapshot.current16th,
      nextNoteTime: snapshot.nextNoteTime,
      schedulerIntervalId: snapshot.schedulerIntervalId,
      scheduledSourceCount: snapshot.scheduledSourceCount,
      retiringSourceCount: snapshot.retiringSourceCount,
      scheduledHighlightTimerCount: snapshot.scheduledHighlightTimerCount,
    },
  };
}

function spaceAudioAuthoritySnapshot(harness, identity) {
  const nodes = [
    ...harness.audioNodes.gains, ...harness.audioNodes.filters,
    ...harness.audioNodes.waveShapers, ...harness.audioNodes.compressors,
    ...harness.audioNodes.convolvers, ...harness.audioNodes.delays,
  ];
  const token = (value) => {
    if (value === null || value === undefined) return value;
    if (!identity.has(value)) identity.set(value, identity.size + 1);
    return identity.get(value);
  };
  const paramKeys = ["gain", "frequency", "Q", "delayTime", "threshold", "knee", "ratio", "attack", "release"];
  const automationKeys = [
    "cancelAndHoldAtTimeCalls", "cancelScheduledValuesCalls", "setValueAtTimeCalls",
    "setTargetAtTimeCalls", "linearRampToValueAtTimeCalls",
    "exponentialRampToValueAtTimeCalls", "setValueCurveAtTimeCalls",
  ];
  const cloneCalls = (calls) => calls.map((call) => Object.fromEntries(
    Object.entries(call).map(([key, value]) => [
      key,
      ArrayBuffer.isView(value) ? Array.from(value) : value,
    ])
  ));
  const params = (node) => Object.fromEntries(paramKeys.filter((key) => node[key]?.setValueAtTimeCalls)
    .map((key) => [key, {
      value: node[key].value,
      automation: Object.fromEntries(automationKeys.map((automationKey) => [
        automationKey,
        cloneCalls(node[key][automationKey]),
      ])),
    }]));
  return {
    routes: nodes.map((node) => ({
      node: token(node),
      connections: node.connections.map((value) => token(value)),
      incoming: node.incoming.map((value) => token(value)),
      buffer: token(node.buffer),
      params: params(node),
    })),
    terminalGateGain: harness.hostSnapshot().masterTerminalGateGain,
  };
}

function assertExactSpaceCopy(harness, state, status) {
  for (const control of ["size", "decay", "air", "mix"]) {
    assert.equal(
      harness.spaceElements.macroOutputs[control].textContent,
      formatSpaceMacroValue(control, state[control]),
      `${control}: exact output`,
    );
  }
  assert.equal(harness.spaceElements.status.textContent, status);
  assert.equal(harness.spaceElements.summary.textContent, getSpaceEffectSummary(state));
  assert.equal(
    harness.filterElements.status.textContent,
    `Tone: Bypassed · Space: ${status}`,
  );
  const enabled = status === "On";
  const bypassLabel = enabled ? "Bypass Space" : "Enable Space";
  assert.equal(harness.spaceElements.bypass.textContent, bypassLabel);
  assert.equal(harness.spaceElements.bypass.getAttribute("aria-label"), bypassLabel);
  assert.equal(
    harness.spaceElements.bypass.getAttribute("aria-pressed"),
    enabled ? "true" : "false",
  );
}

function assertFilterPresetCardSelection(harness, presetId, active) {
  const cards = harness.filterElements.presetCards;
  const selectedCards = cards.filter(
    (card) => card.dataset.filterSelected === "true",
  );
  const activeCards = cards.filter(
    (card) => card.dataset.filterActive === "true",
  );

  assert.deepEqual(
    selectedCards.map((card) => card.dataset.filterPresetCard),
    [presetId],
    `${presetId}: one selected card`,
  );
  assert.deepEqual(
    activeCards.map((card) => card.dataset.filterPresetCard),
    active ? [presetId] : [],
    `${presetId}: active card`,
  );
  cards.forEach((card) => {
    const selected = card.dataset.filterPresetCard === presetId;
    assert.equal(
      card.getAttribute("aria-pressed"),
      selected ? "true" : "false",
      `${card.dataset.filterPresetCard}: aria-pressed`,
    );
  });
}

function assertV4MusicPreserved(snapshot, label, expectedMix = V4_SONG.mix) {
  assert.deepEqual(snapshot.patterns, V4_SONG.patterns, `${label}: patterns`);
  assert.deepEqual(snapshot.patternRepeats, V4_SONG.repeats, `${label}: repeats`);
  assert.deepEqual(
    INSTRUMENTS.map((instrument) => snapshot.instrumentVolumes[instrument]),
    expectedMix,
    `${label}: mix`,
  );
  Object.entries(V4_SONG.pitch).forEach(([patternIndex, pattern]) => {
    Object.entries(pattern).forEach(([instrument, steps]) => {
      Object.entries(steps).forEach(([stepIndex, pitch]) => {
        assert.equal(
          snapshot.patternPitchOffsets[Number(patternIndex)][instrument][Number(stepIndex)],
          pitch,
          `${label}: pitch ${patternIndex}/${instrument}/${stepIndex}`,
        );
      });
    });
  });
}

test("neutral Filter state preserves byte-stable v4 with no f payload", () => {
  const harness = createInlineHarness();

  assert.equal(harness.api.loadSongStateFromBase64(V4_SONG.encoded), true);
  assert.deepEqual(filterSnapshot(harness), FILTER_EFFECT_DEFAULT_STATE);
  assert.equal(harness.api.encodeSongState(), V4_SONG.encoded);

  const payload = decodeSongPayload(harness.api.encodeSongState());
  assert.equal(payload.v, 4);
  assert.equal(Object.hasOwn(payload, "f"), false);
});

test("button reorder keeps pattern bundles, selection, and wire order canonical", () => {
  const harness = createInlineHarness();

  assert.equal(harness.api.loadSongStateFromBase64(V4_SONG.encoded), true);
  harness.api.syncSelectedPatternToGrid();
  const initial = harness.hostSnapshot();

  harness.api.movePatternByOffset(0, -1);
  assert.deepEqual(harness.hostSnapshot(), initial, "first-row Up is a no-op");
  assert.equal(harness.api.encodeSongState(), V4_SONG.encoded);

  harness.api.movePatternByOffset(1, 1);
  assert.deepEqual(harness.hostSnapshot(), initial, "last-row Down is a no-op");
  assert.equal(harness.api.encodeSongState(), V4_SONG.encoded);

  harness.api.movePatternByOffset(0, 1);
  const moved = harness.hostSnapshot();
  assert.deepEqual(moved.patterns, initial.patterns.toReversed());
  assert.deepEqual(moved.patternRepeats, initial.patternRepeats.toReversed());
  assert.deepEqual(
    moved.patternPitchOffsets,
    initial.patternPitchOffsets.toReversed(),
  );
  assert.deepEqual(
    moved.patterns[moved.selectedPatternIndex],
    initial.patterns[initial.selectedPatternIndex],
    "the selected pattern follows its content",
  );
  assert.deepEqual(
    moved.patterns[moved.playbackPatternIndex],
    initial.patterns[initial.playbackPatternIndex],
    "the playback pattern follows its content",
  );

  const movedSong = harness.api.encodeSongState();
  const reopened = createInlineHarness();
  assert.equal(reopened.api.loadSongStateFromBase64(movedSong), true);
  assert.deepEqual(reopened.hostSnapshot().patterns, moved.patterns);
  assert.deepEqual(reopened.hostSnapshot().patternRepeats, moved.patternRepeats);
  assert.deepEqual(
    reopened.hostSnapshot().patternPitchOffsets,
    moved.patternPitchOffsets,
  );

  harness.api.movePatternByOffset(1, -1);
  assert.equal(harness.api.encodeSongState(), V4_SONG.encoded);
});

test("independently authored v5 Filter fixture loads and re-encodes byte-identically", () => {
  const harness = createInlineHarness();

  assert.equal(harness.api.loadSongStateFromBase64(V5_FILTER_SONG.encoded), true);
  assertFilterDisclosure(harness, false, "v5 load");
  assertV4MusicPreserved(harness.hostSnapshot(), "frozen v5 Filter fixture");
  assert.deepEqual(filterSnapshot(harness), V5_FILTER_SONG.filter);
  assert.equal(harness.api.encodeSongState(), V5_FILTER_SONG.encoded);
});

test("every preset emits exact v5 f state and round-trips deterministically", () => {
  for (const preset of FILTER_EFFECT_PRESETS) {
    const source = createInlineHarness();
    const expectedState = getFilterEffectPresetState(preset.id);

    assert.equal(source.api.applyFilterEffectPreset(preset.id), true, preset.id);
    assert.deepEqual(filterSnapshot(source), expectedState, preset.id);
    const encoded = source.api.encodeSongState();
    const payload = decodeSongPayload(encoded);
    assert.equal(payload.v, 5, preset.id);
    assert.deepEqual(payload.f, serializeFilterEffectState(expectedState), preset.id);

    const reopened = createInlineHarness();
    assert.equal(reopened.api.loadSongStateFromBase64(encoded), true, preset.id);
    assert.deepEqual(filterSnapshot(reopened), expectedState, preset.id);
    assert.equal(reopened.api.encodeSongState(), encoded, preset.id);
  }
});

test("enabled and bypassed Custom states retain exact dormant values in v5", () => {
  for (const enabled of [true, false]) {
    const expectedState = { ...CUSTOM_FILTER_STATE, enabled };
    const source = createInlineHarness();
    source.api.setFilterEffectState(expectedState);

    const encoded = source.api.encodeSongState();
    const payload = decodeSongPayload(encoded);
    assert.equal(payload.v, 5, enabled ? "enabled" : "bypassed");
    assert.deepEqual(payload.f, {
      v: 1,
      e: enabled ? 1 : 0,
      c: 37,
      r: 52,
      d: 63,
      m: 41,
      p: "custom",
    });

    const reopened = createInlineHarness();
    assert.equal(reopened.api.loadSongStateFromBase64(encoded), true);
    assert.deepEqual(filterSnapshot(reopened), expectedState);
    assert.equal(reopened.api.encodeSongState(), encoded);
  }
});

test("v4 and legacy loads actively replace prior Filter state with neutral", () => {
  const harness = createInlineHarness();
  harness.api.setFilterEffectState(CUSTOM_FILTER_STATE);
  harness.api.setFilterPanelExpanded(false);

  assert.equal(harness.api.loadSongStateFromBase64(V4_SONG.encoded), true);
  assert.deepEqual(filterSnapshot(harness), FILTER_EFFECT_DEFAULT_STATE);
  assertFilterDisclosure(harness, false, "v4 load");
  assert.equal(harness.api.encodeSongState(), V4_SONG.encoded);

  harness.api.setFilterEffectState({ ...CUSTOM_FILTER_STATE, enabled: false });
  harness.api.setFilterPanelExpanded(false);
  assert.equal(harness.api.loadSinglePatternFromBase64(LEGACY_PATTERN.encoded), true);
  assert.deepEqual(filterSnapshot(harness), FILTER_EFFECT_DEFAULT_STATE);
  assertFilterDisclosure(harness, false, "legacy load");
});

test("malformed song fallback and an empty URL clear prior Filter state", () => {
  const harness = createInlineHarness();
  harness.api.setFilterEffectState(CUSTOM_FILTER_STATE);
  harness.api.setFilterPanelExpanded(false);
  harness.window.location.search = `?${new URLSearchParams({
    song: MALFORMED_SONGS.invalidBase64,
    b: LEGACY_PATTERN.encoded,
    f: JSON.stringify({ v: 1, e: 1, c: 0, r: 100, d: 100, m: 100 }),
  })}`;

  harness.api.loadFromURLParams();
  let snapshot = harness.hostSnapshot();
  assert.deepEqual(
    snapshot.patterns[0].slice(0, LEGACY_PATTERN.sourceBytes.length),
    LEGACY_PATTERN.sourceBytes,
  );
  assert.deepEqual(snapshot.filterEffectState, FILTER_EFFECT_DEFAULT_STATE);
  assertFilterDisclosure(harness, false, "malformed song fallback");

  harness.api.setFilterEffectState(CUSTOM_FILTER_STATE);
  harness.api.setFilterPanelExpanded(false);
  harness.window.location.search = "";
  harness.api.loadFromURLParams();
  snapshot = harness.hostSnapshot();
  assert.ok(snapshot.patterns[0].every((value) => value === 0));
  assert.deepEqual(snapshot.filterEffectState, FILTER_EFFECT_DEFAULT_STATE);
  assertFilterDisclosure(harness, false, "empty URL fallback");
  const payload = decodeSongPayload(harness.api.encodeSongState());
  assert.equal(payload.v, 4);
  assert.equal(Object.hasOwn(payload, "f"), false);
});

test("v5 song wins over legacy b while top-level mix leaves Filter mix intact", () => {
  const topLevelMix = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 0, 20, 40];
  const harness = createInlineHarness();
  harness.window.location.search = `?${new URLSearchParams({
    song: V5_FILTER_SONG.encoded,
    b: LEGACY_PATTERN.encoded,
    mix: topLevelMix.join("."),
  })}`;

  harness.api.loadFromURLParams();
  const snapshot = harness.hostSnapshot();
  assertV4MusicPreserved(snapshot, "v5 song precedence", topLevelMix);
  assert.deepEqual(snapshot.filterEffectState, V5_FILTER_SONG.filter);
  assert.equal(snapshot.filterEffectState.mix, 78);
});

test("missing, malformed, and unknown Filter data stays neutral without losing v4 music", () => {
  const basePayload = decodeSongPayload(V4_SONG.encoded);
  const malformedFilters = [
    undefined,
    null,
    false,
    "filter",
    [],
    {},
    { v: 2, e: 1, c: 0, r: 100, d: 100, m: 100, p: "grit" },
    { v: 1, e: "1", c: "0", r: true, d: [100], m: {}, p: [] },
  ];

  malformedFilters.forEach((filter, index) => {
    const payload = { ...basePayload, v: 5, f: filter };
    const harness = createInlineHarness();
    harness.api.setFilterPanelExpanded(false);
    assert.equal(harness.api.loadSongStateFromBase64(encodeSongPayload(payload)), true);
    const snapshot = harness.hostSnapshot();
    assertV4MusicPreserved(snapshot, `malformed Filter ${index}`);
    assert.deepEqual(snapshot.filterEffectState, FILTER_EFFECT_DEFAULT_STATE);
    assertFilterDisclosure(harness, false, `malformed Filter ${index}`);
  });

  const strayV4Filter = {
    ...basePayload,
    f: { v: 1, e: 1, c: 0, r: 100, d: 100, m: 100, p: "custom" },
  };
  const v4Harness = createInlineHarness();
  v4Harness.api.setFilterPanelExpanded(false);
  assert.equal(v4Harness.api.loadSongStateFromBase64(encodeSongPayload(strayV4Filter)), true);
  assertV4MusicPreserved(v4Harness.hostSnapshot(), "v4 stray f");
  assert.deepEqual(filterSnapshot(v4Harness), FILTER_EFFECT_DEFAULT_STATE);
  assertFilterDisclosure(v4Harness, false, "v4 stray f");
  assert.equal(v4Harness.api.encodeSongState(), V4_SONG.encoded);
});

test("six preset cards update one shared Filter graph and retain control focus", () => {
  const harness = createInlineHarness();
  harness.api.bindFilterEffectControls();
  const { bypass, macroInputs, presetCards, reset, selectedLabel } =
    harness.filterElements;
  const graph = harness.api.getMasterFilterGraph();
  const graphNodeCounts = {
    filters: harness.audioNodes.filters.length,
    waveShapers: harness.audioNodes.waveShapers.length,
  };

  assert.deepEqual(
    presetCards.map((card) => [
      card.dataset.filterPresetCard,
      card.getAttribute("aria-label"),
    ]),
    FILTER_PRESET_CARD_CONTRACT.map(([id, name, creature]) => [
      id,
      `Select ${name} Filter preset, ${creature}`,
    ]),
  );
  assert.deepEqual(Object.keys(macroInputs), [
    "cutoff",
    "resonance",
    "drive",
    "mix",
  ]);
  presetCards.forEach((card) => {
    assert.equal(card.disabled, false, card.dataset.filterPresetCard);
  });
  Object.entries(macroInputs).forEach(([control, input]) => {
    assert.equal(input.disabled, false, control);
  });
  assert.ok(graph);
  assert.deepEqual(filterSnapshot(harness), FILTER_EFFECT_DEFAULT_STATE);
  assertFilterPresetCardSelection(harness, "clean", false);
  assert.equal(selectedLabel.textContent, "Clean selected");
  assert.equal(bypass.getAttribute("aria-pressed"), "false");

  for (const [presetId, presetName] of FILTER_PRESET_CARD_CONTRACT.slice(0, 5)) {
    const card = presetCards.find(
      (candidate) => candidate.dataset.filterPresetCard === presetId,
    );
    const expectedState = getFilterEffectPresetState(presetId);
    card.focus();
    harness.clickFilterPresetCard(presetId);

    assert.equal(harness.document.activeElement, card, presetId);
    assert.deepEqual(filterSnapshot(harness), expectedState, presetId);
    assert.deepEqual(graph.getState(), expectedState, `${presetId}: graph state`);
    assert.equal(harness.api.getMasterFilterGraph(), graph, `${presetId}: graph identity`);
    assertFilterPresetCardSelection(harness, presetId, true);
    assert.equal(selectedLabel.textContent, `${presetName} selected`);
    assert.equal(bypass.getAttribute("aria-pressed"), "true", presetId);
    for (const control of Object.keys(macroInputs)) {
      assert.equal(macroInputs[control].value, String(expectedState[control]), presetId);
    }
  }

  const customCard = presetCards.find(
    (card) => card.dataset.filterPresetCard === "custom",
  );
  const beforeCustom = filterSnapshot(harness);
  customCard.focus();
  harness.clickFilterPresetCard("custom");
  assert.equal(harness.document.activeElement, customCard);
  assert.deepEqual(filterSnapshot(harness), {
    ...beforeCustom,
    preset: "custom",
  });
  assertFilterPresetCardSelection(harness, "custom", true);
  assert.equal(selectedLabel.textContent, "Custom selected");

  harness.clickFilterPresetCard("warm");
  const cutoff = macroInputs.cutoff;
  cutoff.focus();
  cutoff.value = "67";
  cutoff.dispatchEvent({ type: "input" });
  const manualState = {
    ...getFilterEffectPresetState("warm"),
    cutoff: 67,
    preset: "custom",
  };
  assert.equal(harness.document.activeElement, cutoff);
  assert.deepEqual(filterSnapshot(harness), manualState);
  assert.deepEqual(graph.getState(), manualState);
  assertFilterPresetCardSelection(harness, "custom", true);

  bypass.dispatchEvent({ type: "click" });
  assert.deepEqual(filterSnapshot(harness), {
    ...manualState,
    enabled: false,
  });
  assertFilterPresetCardSelection(harness, "custom", false);
  assert.equal(bypass.getAttribute("aria-pressed"), "false");

  bypass.dispatchEvent({ type: "click" });
  assert.deepEqual(filterSnapshot(harness), manualState);
  assertFilterPresetCardSelection(harness, "custom", true);
  assert.equal(bypass.getAttribute("aria-pressed"), "true");

  reset.dispatchEvent({ type: "click" });
  assert.deepEqual(filterSnapshot(harness), FILTER_EFFECT_DEFAULT_STATE);
  assert.deepEqual(graph.getState(), FILTER_EFFECT_DEFAULT_STATE);
  assertFilterPresetCardSelection(harness, "clean", false);
  assert.equal(selectedLabel.textContent, "Clean selected");
  assert.equal(bypass.getAttribute("aria-pressed"), "false");
  assertFilterDisclosure(harness, false, "Filter reset");
  assert.equal(harness.api.applyFilterEffectPreset("unknown"), false);
  assert.deepEqual(filterSnapshot(harness), FILTER_EFFECT_DEFAULT_STATE);
  assert.equal(harness.api.getMasterFilterGraph(), graph);
  assert.equal(harness.audioNodes.filters.length, graphNodeCounts.filters);
  assert.equal(harness.audioNodes.waveShapers.length, graphNodeCounts.waveShapers);
});

test("whole-project reset restores neutral Filter state, UI, graph, and v4 codec", () => {
  const harness = createInlineHarness();
  assert.equal(harness.api.loadSongStateFromBase64(V5_FILTER_SONG.encoded), true);
  harness.api.setFilterPanelExpanded(false);
  assert.deepEqual(filterSnapshot(harness), V5_FILTER_SONG.filter);

  harness.api.resetProjectState();
  const snapshot = harness.hostSnapshot();
  const payload = decodeSongPayload(harness.api.encodeSongState());
  assert.deepEqual(snapshot.filterEffectState, FILTER_EFFECT_DEFAULT_STATE);
  assertFilterDisclosure(harness, false, "project reset");
  assert.deepEqual(snapshot.masterFilterGraphState, FILTER_EFFECT_DEFAULT_STATE);
  assert.equal(harness.filterElements.body.hidden, false);
  assert.equal(harness.filterElements.body.dataset.expanded, "true");
  assert.equal(harness.filterElements.panel.dataset.enabled, "false");
  assert.equal(payload.v, 4);
  assert.equal(Object.hasOwn(payload, "f"), false);
});

test("range strings convert and clamp at the UI boundary without auto-enabling", () => {
  const harness = createInlineHarness();
  harness.api.bindFilterEffectControls();
  const { macroInputs } = harness.filterElements;

  const cases = [
    { control: "cutoff", value: "-5", expected: 0 },
    { control: "cutoff", value: "49.5", expected: 50 },
    { control: "cutoff", value: "500", expected: 100 },
    { control: "resonance", value: "101", expected: 100 },
    { control: "drive", value: "40.6", expected: 41 },
    { control: "mix", value: "-1", expected: 0 },
  ];

  for (const { control, value, expected } of cases) {
    macroInputs[control].value = value;
    macroInputs[control].dispatchEvent({ type: "input" });
    const state = filterSnapshot(harness);
    assert.equal(state[control], expected, `${control}: ${value}`);
    assert.equal(state.enabled, false, `${control}: ${value}`);
    assert.equal(state.preset, "custom", `${control}: ${value}`);
  }

  macroInputs.drive.value = "not-a-number";
  macroInputs.drive.dispatchEvent({ type: "input" });
  assert.equal(filterSnapshot(harness).drive, 0);
  assert.equal(macroInputs.drive.value, "0");
  assert.equal(
    macroInputs.drive.getAttribute("aria-valuetext"),
    "0 percent, clean, 0 of 100",
  );
});

test("window-load bootstrap leaves every URL class minimized", async () => {
  const unknownFilterPayload = decodeSongPayload(V5_FILTER_SONG.encoded);
  unknownFilterPayload.f = { ...unknownFilterPayload.f, v: 999 };
  const cases = [
    {
      label: "fresh",
      search: "",
      expectedFilter: FILTER_EFFECT_DEFAULT_STATE,
    },
    {
      label: "v4 song",
      search: createSearch({ song: V4_SONG.encoded }),
      expectedFilter: FILTER_EFFECT_DEFAULT_STATE,
      expectedPatterns: V4_SONG.patterns,
    },
    {
      label: "v5 enabled Filter song",
      search: createSearch({ song: V5_FILTER_SONG.encoded }),
      expectedFilter: V5_FILTER_SONG.filter,
      expectedPatterns: V4_SONG.patterns,
    },
    {
      label: "legacy pattern",
      search: createSearch({ b: LEGACY_PATTERN.encoded, bpm: LEGACY_PATTERN.bpm }),
      expectedFilter: FILTER_EFFECT_DEFAULT_STATE,
      expectedPatternPrefix: LEGACY_PATTERN.sourceBytes,
    },
    {
      label: "malformed song",
      search: createSearch({ song: MALFORMED_SONGS.invalidBase64 }),
      expectedFilter: FILTER_EFFECT_DEFAULT_STATE,
    },
    {
      label: "unknown Filter version",
      search: createSearch({ song: encodeSongPayload(unknownFilterPayload) }),
      expectedFilter: FILTER_EFFECT_DEFAULT_STATE,
      expectedPatterns: V4_SONG.patterns,
    },
  ];

  for (const testCase of cases) {
    const harness = createInlineHarness();
    harness.window.location.search = testCase.search;

    await harness.dispatchWindowLoad();

    const snapshot = harness.hostSnapshot();
    assertFilterDisclosure(harness, false, `${testCase.label} bootstrap`);
    assert.equal(snapshot.filterControlsBound, true, `${testCase.label}: controls bound`);
    assert.deepEqual(
      snapshot.filterEffectState,
      testCase.expectedFilter,
      `${testCase.label}: Filter state`,
    );
    assert.equal(
      harness.filterElements.status.textContent,
      "Tone: " + (testCase.expectedFilter.enabled ? "On" : "Bypassed") + " · Space: Bypassed",
      `${testCase.label}: compact status`,
    );
    if (testCase.expectedPatterns) {
      assert.deepEqual(snapshot.patterns, testCase.expectedPatterns, testCase.label);
    }
    if (testCase.expectedPatternPrefix) {
      assert.deepEqual(
        snapshot.patterns[0].slice(0, testCase.expectedPatternPrefix.length),
        testCase.expectedPatternPrefix,
        `${testCase.label}: pattern bytes`,
      );
    }
  }
});

test("Effects dialog opens and closes without changing audio or song authority", async () => {
  const harness = createInlineHarness();
  const { body, bypass, panel, status, toggle } = harness.filterElements;

  assertFilterDisclosure(harness, false, "synthetic pre-bind fixture");
  assert.equal(harness.document.activeElement, null, "closed Effects bootstrap must not steal focus");
  harness.api.bindFilterEffectControls();
  assert.equal(harness.document.activeElement, null, "binding closed Effects must not steal focus");
  assertFilterDisclosure(harness, false, "bound default");
  assert.equal(bypass.getAttribute("aria-pressed"), "false");
  assert.equal(bypass.getAttribute("aria-label"), "Enable filter");
  assert.equal(status.textContent, "Tone: Bypassed · Space: Bypassed");
  assert.equal(panel.dataset.enabled, "false");

  harness.api.setFilterEffectState(CUSTOM_FILTER_STATE);
  await harness.dispatchElementEvent(harness.ids.get("shareBtn"), { type: "click" });
  harness.window.location.search = new URL(harness.clipboardWrites.at(-1)).search;
  harness.api.seedAudioBuffer("kick");
  await harness.api.startSequencer();
  assert.equal(harness.hostSnapshot().isPlaying, true);
  assertFilterDisclosure(harness, false, "playback while closed");

  const graph = harness.api.getMasterFilterGraph();
  const canonicalAuthority = disclosureAuthoritySnapshot(harness);
  const audioIdentity = new Map();
  const canonicalSpaceAudio = spaceAudioAuthoritySnapshot(harness, audioIdentity);

  harness.api.setFilterPanelExpanded(true);
  assertFilterDisclosure(harness, true, "synchronous open");
  assert.equal(harness.api.getMasterFilterGraph(), graph);
  assert.deepEqual(disclosureAuthoritySnapshot(harness), canonicalAuthority);
  assert.deepEqual(spaceAudioAuthoritySnapshot(harness, audioIdentity), canonicalSpaceAudio);

  harness.filterElements.macroInputs.cutoff.focus();
  toggle.dispatchEvent({ type: "click" });
  assertFilterDisclosure(harness, false, "immediate close");
  assert.equal(harness.api.getMasterFilterGraph(), graph);
  assert.deepEqual(disclosureAuthoritySnapshot(harness), canonicalAuthority);
  assert.deepEqual(spaceAudioAuthoritySnapshot(harness, audioIdentity), canonicalSpaceAudio);

  assert.equal(getFilterPanelCollapseTimers(harness).length, 0);
  assert.equal(getTransitionListenerCount(body), 0);
  assert.equal(harness.api.getMasterFilterGraph(), graph);
  assert.deepEqual(disclosureAuthoritySnapshot(harness), canonicalAuthority);
  assert.deepEqual(spaceAudioAuthoritySnapshot(harness, audioIdentity), canonicalSpaceAudio);

  const closePromise = harness.api.stopSequencer();
  harness.runAllFilterTransportTimeouts();
  assert.equal(await closePromise, true);
});

test("Pattern takeover cancels a queued Effects open before the next frame", () => {
  const harness = createInlineHarness({ deferredEffectsClose: true });
  harness.api.bindFilterEffectControls();
  const effectsTrigger = harness.document.getElementById("effects-menu-trigger");
  const patternsTrigger = harness.document.getElementById("patterns-menu-trigger");
  effectsTrigger.focus();
  const nativeRestoreCountBefore = effectsTrigger.focusCalls;
  harness.window.addEventListener("open-beats:patterns-ready", () => {
    patternsTrigger.focus();
  });

  harness.api.setFilterPanelExpanded(true);
  assert.equal(harness.filterElements.dialog.open, true);
  harness.window.__queueEffectsFrame = true;
  harness.window.dispatchEvent({ type: "open-beats:effects" });
  harness.window.dispatchEvent({ type: "open-beats:patterns" });

  assert.equal(harness.filterElements.dialog.open, false);
  assert.equal(effectsTrigger.focusCalls, nativeRestoreCountBefore + 1);
  assert.equal(harness.document.activeElement, patternsTrigger);

  harness.flushAnimationFrames();

  assert.equal(harness.filterElements.dialog.open, false);
  assert.equal(harness.hostSnapshot().filterPanelExpanded, true);
  assert.equal(harness.filterElements.toggle.getAttribute("aria-expanded"), "true");
  harness.flushDeferredDialogClose();

  assert.equal(harness.filterElements.dialog.open, false);
  assert.equal(harness.hostSnapshot().filterPanelExpanded, false);
  assert.equal(harness.filterElements.toggle.getAttribute("aria-expanded"), "false");
  assert.equal(harness.document.activeElement, patternsTrigger);
});

test("a delayed native Effects close cannot collapse a replacement open", () => {
  const harness = createInlineHarness({ deferredEffectsClose: true });
  harness.api.bindFilterEffectControls();
  harness.api.setFilterPanelExpanded(true);
  harness.api.setFilterPanelExpanded(false);
  harness.api.setFilterPanelExpanded(true);
  harness.flushDeferredDialogClose();

  assert.equal(harness.filterElements.dialog.open, true);
  assert.equal(harness.filterElements.toggle.getAttribute("aria-expanded"), "true");
});

test("a direct native Effects close settles logical and ARIA state", () => {
  const harness = createInlineHarness({ deferredEffectsClose: true });
  harness.api.bindFilterEffectControls();
  harness.api.setFilterPanelExpanded(true);
  harness.filterElements.dialog.close();
  harness.flushDeferredDialogClose();

  assert.equal(harness.filterElements.dialog.open, false);
  assert.equal(harness.hostSnapshot().filterPanelExpanded, false);
  assert.equal(harness.filterElements.toggle.getAttribute("aria-expanded"), "false");
});

test("Space presets macros bypass and unavailable UI preserve desired state independently", () => {
  const harness = createInlineHarness();
  harness.api.bindFilterEffectControls();
  const toneBefore = harness.hostFilterState();
  const { bypass, macroInputs, macroOutputs, panel, presetCards, status, summary } = harness.spaceElements;

  assert.deepEqual(harness.hostSnapshot().spaceEffectState, {
    enabled: false, size: 22, decay: 18, air: 34, mix: 24, preset: "pocket-room",
  });
  assert.equal(status.textContent, "Bypassed");
  assert.equal(summary.textContent, "Space Reverb · Pocket Room · Size 22 · Decay 18 · Air 34 · Mix 24");
  assert.equal(bypass.textContent, "Enable Space");
  assert.equal(bypass.getAttribute("aria-pressed"), "false");

  harness.clickSpacePreset("warm-hall");
  assert.deepEqual(harness.hostSnapshot().spaceEffectState, {
    enabled: true, size: 68, decay: 64, air: 48, mix: 36, preset: "warm-hall",
  });
  assert.equal(panel.dataset.preset, "warm-hall");
  assert.equal(presetCards.find(card => card.dataset.spacePreset === "warm-hall").getAttribute("aria-pressed"), "true");
  assert.equal(bypass.textContent, "Bypass Space");

  harness.setSpaceMacro("decay", 77);
  const custom = harness.hostSnapshot().spaceEffectState;
  assert.deepEqual(custom, { enabled: true, size: 68, decay: 77, air: 48, mix: 36, preset: "custom" });
  assert.equal(macroInputs.decay.value, "77");
  assert.equal(macroOutputs.decay.textContent, "77%");
  harness.clickSpacePreset("custom");
  assert.deepEqual(harness.hostSnapshot().spaceEffectState, custom);

  harness.clickSpaceBypass();
  assert.deepEqual(harness.hostSnapshot().spaceEffectState, { ...custom, enabled: false });
  assert.equal(bypass.textContent, "Enable Space");
  harness.clickSpaceBypass();
  assert.deepEqual(harness.hostSnapshot().spaceEffectState, custom);
  harness.api.makeSpaceUnavailableThroughController();
  assert.deepEqual(harness.hostSnapshot().spaceEffectState, custom);
  assert.deepEqual(harness.hostFilterState(), toneBefore);
  assert.equal(panel.dataset.available, "false");
  assert.equal(status.textContent, "Space unavailable; audio is bypassed.");
  assert.equal(bypass.textContent, "Space unavailable; audio is bypassed.");
  assert.equal(bypass.disabled, true);
  assert.equal(harness.filterElements.status.textContent, "Tone: Bypassed · Space: Unavailable");
});

test("collapsed Effects summary names unavailable Tone and Space independently", () => {
  const toneHarness = createInlineHarness();
  toneHarness.api.bindFilterEffectControls();
  toneHarness.api.makeToneUnavailableThroughController();
  assert.equal(toneHarness.filterElements.status.textContent, "Tone: Unavailable · Space: Bypassed");

  const spaceHarness = createInlineHarness();
  spaceHarness.api.bindFilterEffectControls();
  spaceHarness.api.makeSpaceUnavailableThroughController();
  assert.equal(spaceHarness.filterElements.status.textContent, "Tone: Bypassed · Space: Unavailable");
});

test("Tone bay exposes its own live status alongside the combined Effects summary", () => {
  const harness = createInlineHarness();
  const toneStatus = harness.ids.get("toneFxStatus");
  assert.equal(toneStatus.textContent, "Bypassed");
  harness.api.setFilterEffectState(CUSTOM_FILTER_STATE);
  assert.equal(toneStatus.textContent, "On");
  harness.api.makeToneUnavailableThroughController();
  assert.equal(toneStatus.textContent, "Unavailable");
});

test("Space controls retain focus and closing Effects returns focus to the menu", () => {
  const harness = createInlineHarness();
  harness.api.bindFilterEffectControls();
  const { toggle } = harness.filterElements;
  harness.api.setFilterPanelExpanded(true);

  const preset = harness.spaceElements.presetCards.find(
    (card) => card.dataset.spacePreset === "warm-hall",
  );
  preset.focus();
  harness.clickSpacePreset("warm-hall");
  assert.equal(harness.document.activeElement, preset);
  assert.equal(preset.getAttribute("aria-label"), "Warm Hall, Whale");

  const decay = harness.spaceElements.macroInputs.decay;
  decay.focus();
  harness.setSpaceMacro("decay", 77);
  assert.equal(harness.document.activeElement, decay);

  toggle.dispatchEvent({ type: "click" });
  assert.equal(harness.document.activeElement, harness.ids.get("effects-menu-trigger"));
  assert.equal(harness.ids.get("effects-menu-trigger").focusCalls, 1);
  assert.equal(toggle.getAttribute("aria-label"), "Close effects");
});

test("each Space preset macro and bypass action performs exactly one UI render", () => {
  const presets = [
    ["pocket-room", { size: 22, decay: 18, air: 34, mix: 24 }, "Pocket Room"],
    ["warm-hall", { size: 68, decay: 64, air: 48, mix: 36 }, "Warm Hall"],
    ["shimmer", { size: 56, decay: 42, air: 86, mix: 30 }, "Shimmer"],
    ["bloom", { size: 82, decay: 78, air: 72, mix: 44 }, "Bloom"],
  ];
  for (const [preset, values, label] of presets) {
    const harness = createInlineHarness();
    harness.api.bindFilterEffectControls();
    const before = harness.getSpaceUiRenderCount();
    harness.clickSpacePreset(preset);
    assert.equal(harness.getSpaceUiRenderCount() - before, 1, preset);
    assert.deepEqual(harness.hostSnapshot().spaceEffectState, { enabled: true, ...values, preset });
    assert.equal(getSpaceEffectSummary({ enabled: true, ...values, preset }),
      `Space Reverb · ${label} · Size ${values.size} · Decay ${values.decay} · Air ${values.air} · Mix ${values.mix}`);
    assertExactSpaceCopy(harness, { enabled: true, ...values, preset }, "On");
  }

  for (const control of ["size", "decay", "air", "mix"]) {
    const harness = createInlineHarness();
    harness.api.bindFilterEffectControls();
    harness.clickSpacePreset("bloom");
    const before = harness.getSpaceUiRenderCount();
    harness.setSpaceMacro(control, 77);
    assert.equal(harness.getSpaceUiRenderCount() - before, 1, control);
    assert.equal(harness.hostSnapshot().spaceEffectState.preset, "custom");
    assert.equal(harness.hostSnapshot().spaceEffectState[control], 77);
    const state = harness.hostSnapshot().spaceEffectState;
    assertExactSpaceCopy(harness, state, "On");
  }

  const customHarness = createInlineHarness();
  customHarness.api.bindFilterEffectControls();
  customHarness.clickSpacePreset("bloom");
  const bloomState = customHarness.hostSnapshot().spaceEffectState;
  let before = customHarness.getSpaceUiRenderCount();
  customHarness.clickSpacePreset("custom");
  assert.equal(customHarness.getSpaceUiRenderCount() - before, 1);
  assert.deepEqual(customHarness.hostSnapshot().spaceEffectState, { ...bloomState, preset: "custom" });
  assertExactSpaceCopy(customHarness, { ...bloomState, preset: "custom" }, "On");

  before = customHarness.getSpaceUiRenderCount();
  customHarness.clickSpaceBypass();
  assert.equal(customHarness.getSpaceUiRenderCount() - before, 1);
  assert.equal(customHarness.spaceElements.bypass.textContent, "Enable Space");
  assertExactSpaceCopy(customHarness, { ...bloomState, enabled: false, preset: "custom" }, "Bypassed");
  before = customHarness.getSpaceUiRenderCount();
  customHarness.clickSpaceBypass();
  assert.equal(customHarness.getSpaceUiRenderCount() - before, 1);
  assert.equal(customHarness.spaceElements.bypass.textContent, "Bypass Space");
  assertExactSpaceCopy(customHarness, { ...bloomState, preset: "custom" }, "On");
});

test("open Effects exposes enabled focusable controls in the frozen order", () => {
  const harness = createInlineHarness();
  harness.api.bindFilterEffectControls();
  harness.api.setFilterPanelExpanded(true);
  const controls = [
    ...harness.filterElements.presetCards,
    harness.filterElements.reset,
    ...Object.values(harness.filterElements.macroInputs),
    harness.filterElements.bypass,
    ...harness.spaceElements.presetCards,
    ...Object.values(harness.spaceElements.macroInputs),
    harness.spaceElements.bypass,
  ];
  for (const control of controls) {
    assert.equal(control.disabled, false);
    control.focus();
    assert.equal(harness.document.activeElement, control);
  }
  harness.spaceElements.macroInputs.mix.focus();
  harness.filterElements.toggle.dispatchEvent({ type: "click" });
  assert.equal(harness.document.activeElement, harness.ids.get("effects-menu-trigger"));
});

test("rapid Effects dialog close-open-close remains synchronous and bounded", () => {
  const harness = createInlineHarness();
  harness.api.bindFilterEffectControls();
  const { toggle } = harness.filterElements;

  harness.api.setFilterPanelExpanded(true);
  assertFilterDisclosure(harness, true, "rapid-toggle open");

  toggle.dispatchEvent({ type: "click" });
  assertFilterDisclosure(harness, false, "rapid-toggle close");

  harness.api.setFilterPanelExpanded(true);
  assertFilterDisclosure(harness, true, "rapid reopen");
  assert.equal(getFilterPanelCollapseTimers(harness).length, 0);
  assert.equal(harness.filterElements.dialog.open, true);

  toggle.dispatchEvent({ type: "click" });
  assertFilterDisclosure(harness, false, "rapid reclose");
  assert.equal(getFilterPanelCollapseTimers(harness).length, 0);
});

test("same-state Effects dialog requests stay bounded", () => {
  const harness = createInlineHarness();
  harness.api.bindFilterEffectControls();
  const { toggle } = harness.filterElements;

  harness.api.setFilterPanelExpanded(true, { animate: false });
  const canonicalAuthority = disclosureAuthoritySnapshot(harness);
  harness.api.setFilterPanelExpanded(true, { animate: false });
  assertFilterDisclosure(harness, true, "repeated settled open");
  assert.equal(getFilterPanelCollapseTimers(harness).length, 0);
  assert.deepEqual(disclosureAuthoritySnapshot(harness), canonicalAuthority);

  harness.api.setFilterPanelExpanded(false);
  harness.api.setFilterPanelExpanded(false);
  assertFilterDisclosure(harness, false, "repeated close");
  assert.equal(getFilterPanelCollapseTimers(harness).length, 0);
});

test("state, load, Share, and playback paths preserve the disclosure choice", async () => {
  const actions = [
    {
      label: "preset",
      run(harness) {
        assert.equal(harness.api.applyFilterEffectPreset("warm"), true);
      },
    },
    {
      label: "Custom",
      run(harness) {
        harness.clickFilterPresetCard("custom");
      },
    },
    {
      label: "Filter reset",
      run(harness) {
        harness.api.setFilterEffectState(CUSTOM_FILTER_STATE);
        harness.api.resetFilterEffectState();
      },
    },
    {
      label: "project reset",
      run(harness) {
        harness.api.setFilterEffectState(CUSTOM_FILTER_STATE);
        harness.api.resetProjectState();
      },
    },
    {
      label: "v5 load",
      run(harness) {
        assert.equal(harness.api.loadSongStateFromBase64(V5_FILTER_SONG.encoded), true);
      },
    },
    {
      label: "legacy load",
      run(harness) {
        assert.equal(
          harness.api.loadSinglePatternFromBase64(LEGACY_PATTERN.encoded),
          true,
        );
      },
    },
    {
      label: "malformed URL fallback",
      run(harness) {
        harness.window.location.search = `?song=${MALFORMED_SONGS.invalidBase64}`;
        harness.api.loadFromURLParams();
      },
    },
    {
      label: "Share",
      async run(harness) {
        await harness.dispatchElementEvent(harness.ids.get("shareBtn"), {
          type: "click",
        });
      },
    },
    {
      label: "playback",
      async run(harness) {
        harness.api.seedAudioBuffer("kick");
        await harness.api.startSequencer();
        assert.equal(harness.hostSnapshot().isPlaying, true);
      },
    },
  ];

  for (const expanded of [false, true]) {
    for (const action of actions) {
      const harness = createInlineHarness();
      harness.api.bindFilterEffectControls();
      if (expanded) {
        harness.api.setFilterPanelExpanded(true, { animate: false });
      }

      await action.run(harness);
      assertFilterDisclosure(
        harness,
        expanded,
        `${action.label} preserves ${expanded ? "open" : "closed"}`,
      );
    }
  }
});

test("repeated encode, load, and Share cycles stay canonical for every Filter state", async () => {
  const cases = [
    {
      label: "default",
      expectedState: FILTER_EFFECT_DEFAULT_STATE,
      apply(harness) {
        harness.api.resetFilterEffectState();
      },
    },
    ...FILTER_EFFECT_PRESETS.map((preset) => ({
      label: `preset ${preset.id}`,
      expectedState: getFilterEffectPresetState(preset.id),
      apply(harness) {
        assert.equal(harness.api.applyFilterEffectPreset(preset.id), true, preset.id);
      },
    })),
    {
      label: "custom enabled",
      expectedState: CUSTOM_FILTER_STATE,
      apply(harness) {
        harness.api.setFilterEffectState(CUSTOM_FILTER_STATE);
      },
    },
    {
      label: "custom bypassed",
      expectedState: { ...CUSTOM_FILTER_STATE, enabled: false },
      apply(harness) {
        harness.api.setFilterEffectState({ ...CUSTOM_FILTER_STATE, enabled: false });
      },
    },
  ];

  for (const testCase of cases) {
    const expectedWire = serializeFilterEffectState(testCase.expectedState);
    const expectedSongVersion = expectedWire ? 5 : 4;

    function assertCanonicalSong(encoded, cycleLabel) {
      const rawPayload = Buffer.from(encoded, "base64").toString("utf8");
      const payload = JSON.parse(rawPayload);
      const filterKeyCount = (rawPayload.match(/"f":/g) ?? []).length;

      assert.equal(payload.v, expectedSongVersion, `${cycleLabel}: song version`);
      assert.equal(
        filterKeyCount,
        expectedWire ? 1 : 0,
        `${cycleLabel}: canonical f count`,
      );
      if (!expectedWire) {
        assert.equal(Object.hasOwn(payload, "f"), false, `${cycleLabel}: omitted f`);
        return;
      }

      assert.equal(Array.isArray(payload.f), false, `${cycleLabel}: f is an object`);
      assert.deepEqual(payload.f, expectedWire, `${cycleLabel}: Filter wire state`);
      for (const key of ["v", "e", "c", "r", "d", "m"]) {
        assert.equal(typeof payload.f[key], "number", `${cycleLabel}: numeric ${key}`);
      }
      assert.equal(payload.f.p, testCase.expectedState.preset, `${cycleLabel}: preset`);
    }

    const source = createInlineHarness();
    testCase.apply(source);
    assert.deepEqual(filterSnapshot(source), testCase.expectedState, testCase.label);
    const canonicalSong = source.api.encodeSongState();
    assertCanonicalSong(canonicalSong, `${testCase.label} source`);

    await source.dispatchElementEvent(source.ids.get("shareBtn"), { type: "click" });
    assert.equal(source.clipboardWrites.length, 1, testCase.label);
    const canonicalUrl = source.clipboardWrites[0];
    assert.equal(
      new URL(canonicalUrl).searchParams.get("song"),
      canonicalSong,
      `${testCase.label}: source Share`,
    );

    let currentUrl = canonicalUrl;
    for (let cycle = 1; cycle <= 4; cycle += 1) {
      const cycleLabel = `${testCase.label} cycle ${cycle}`;
      const reopened = createInlineHarness();
      reopened.window.location.search = new URL(currentUrl).search;
      reopened.api.loadFromURLParams();

      assert.deepEqual(filterSnapshot(reopened), testCase.expectedState, cycleLabel);
      const reencoded = reopened.api.encodeSongState();
      assert.equal(reencoded, canonicalSong, `${cycleLabel}: encoded song`);
      assertCanonicalSong(reencoded, cycleLabel);

      await reopened.dispatchElementEvent(reopened.ids.get("shareBtn"), {
        type: "click",
      });
      assert.equal(reopened.clipboardWrites.length, 1, cycleLabel);
      const sharedUrl = reopened.clipboardWrites[0];
      const sharedParams = new URL(sharedUrl).searchParams;
      assert.equal(sharedParams.getAll("song").length, 1, `${cycleLabel}: one song`);
      assert.equal(sharedParams.getAll("f").length, 0, `${cycleLabel}: no top-level f`);
      assert.equal(sharedParams.get("song"), canonicalSong, `${cycleLabel}: shared song`);
      assert.equal(sharedUrl, canonicalUrl, `${cycleLabel}: URL`);
      currentUrl = sharedUrl;
    }
  }
});

test("Stop retires active voices and Play awaits exact Filter close before rebuilding", async () => {
  {
    const harness = createInlineHarness();
    harness.api.seedAudioBuffer("kick");
    harness.audioCtx.currentTime = 1;
    harness.api.playSound("kick", 0, 0);

    const source = harness.sources[0];
    const gain = source.connections[0];
    assert.equal(harness.hostSnapshot().scheduledSourceCount, 1);
    assert.equal(harness.hostSnapshot().retiringSourceCount, 0);

    const closePromise = harness.api.stopSequencer();
    const stopped = harness.hostSnapshot();
    assert.equal(stopped.scheduledSourceCount, 0);
    assert.equal(stopped.retiringSourceCount, 1);
    assert.equal(source.connections.length, 1);
    assert.equal(gain.connections.length, 1);
    assert.equal(
      gain.gain.linearRampToValueAtTimeCalls.at(-1).endTime,
      harness.audioCtx.currentTime + 0.012,
    );
    assert.equal(
      source.stops.at(-1),
      harness.audioCtx.currentTime + 0.015,
    );

    source.emit("ended");
    assert.equal(harness.hostSnapshot().retiringSourceCount, 0);
    assert.equal(source.connections.length, 0);
    assert.equal(gain.connections.length, 0);
    harness.runAllFilterTransportTimeouts();
    assert.equal(await closePromise, true);
  }

  {
    const harness = createInlineHarness();
    harness.api.setFilterEffectState(CUSTOM_FILTER_STATE);
    harness.api.seedAudioBuffer("kick");
    harness.audioCtx.currentTime = 1;
    harness.api.playSound("kick", 0, 0);

    const graph = harness.api.getMasterFilterGraph();
    const retiredSource = harness.sources[0];
    const retiredGain = retiredSource.connections[0];
    const originalFilter = graph.nodes.filter;
    const originalDriveShaper = graph.nodes.driveShaper;
    const originalFilterCount = harness.audioNodes.filters.length;
    const originalDriveShaperCount = harness.audioNodes.waveShapers.length;

    const closePromise = harness.api.stopSequencer();
    const closeTimer = [...harness.filterTransportTimeouts.values()].find(
      (timer) => timer.delay === 20,
    );
    assert.ok(closeTimer, "Stop must schedule the exact-close settle callback");
    assert.equal(harness.hostSnapshot().retiringSourceCount, 1);
    assert.equal(graph.getTransportState().closePending, true);

    const playPromise = harness.api.startSequencer();
    const pendingPlay = harness.hostSnapshot();
    assert.equal(pendingPlay.isStartingPlayback, true);
    assert.equal(pendingPlay.isPlaying, false);
    assert.equal(pendingPlay.schedulerIntervalId, null);
    assert.equal(pendingPlay.retiringSourceCount, 1);
    assert.equal(graph.nodes.filter, originalFilter);
    assert.equal(graph.nodes.driveShaper, originalDriveShaper);

    harness.runAllFilterTransportTimeouts();
    const exactlyClosed = harness.hostSnapshot();
    assert.deepEqual(exactlyClosed.masterFilterGraphTransportState, {
      closed: true,
      needsReset: true,
      closePending: false,
      generation: 1,
    });
    assert.equal(exactlyClosed.masterFilterOutputGain, 0);
    assert.equal(exactlyClosed.retiringSourceCount, 1);
    assert.equal(graph.nodes.filter, originalFilter);
    assert.equal(graph.nodes.driveShaper, originalDriveShaper);

    assert.equal(await closePromise, true);
    await playPromise;
    const playing = harness.hostSnapshot();
    const wakeEvent = harness.filterTransportEvents.find(
      (event) => event.type === "wake",
    );
    assert.ok(wakeEvent);
    assert.equal(wakeEvent.snapshot.retiringSourceCount, 0);
    assert.equal(wakeEvent.snapshot.isPlaying, false);
    assert.equal(wakeEvent.snapshot.schedulerIntervalId, null);
    assert.equal(wakeEvent.transportState.closed, true);
    assert.equal(wakeEvent.outputGain, 0);
    assert.ok(wakeEvent.filterNodeCount >= originalFilterCount);
    assert.ok(wakeEvent.waveShaperNodeCount >= originalDriveShaperCount);

    assert.equal(playing.retiringSourceCount, 0);
    assert.equal(playing.isStartingPlayback, false);
    assert.equal(playing.isPlaying, true);
    assert.notEqual(playing.schedulerIntervalId, null);
    assert.equal(playing.masterFilterOutputGain, 1);
    assert.deepEqual(playing.filterEffectState, CUSTOM_FILTER_STATE);
    assert.equal(retiredSource.connections.length, 0);
    assert.equal(retiredGain.connections.length, 0);

    assert.notEqual(graph.nodes.filter, originalFilter);
    assert.notEqual(graph.nodes.driveShaper, originalDriveShaper);
    assert.ok(harness.audioNodes.filters.length >= originalFilterCount + 1);
    assert.equal(
      harness.audioNodes.waveShapers.length,
      originalDriveShaperCount + 1,
    );
    assert.equal(originalFilter.connections.length, 0);
    assert.equal(originalDriveShaper.connections.length, 0);
    assert.ok(originalFilter.disconnectCalls >= 1);
    assert.ok(originalDriveShaper.disconnectCalls >= 1);
    assert.equal(graph.nodes.filter.type, "lowpass");
    assert.equal(graph.nodes.driveShaper.oversample, "2x");
    assert.equal(graph.nodes.filter.connections[0], graph.nodes.wetGain);
    assert.equal(graph.nodes.driveShaper.connections[0], graph.nodes.drivenGain);

    const schedulerTick = harness.intervals.get(playing.schedulerIntervalId);
    assert.ok(schedulerTick);
    schedulerTick();
    assert.ok(harness.hostSnapshot().scheduledHighlightTimerCount > 0);

    const openTransportState = graph.getTransportState();
    closeTimer.callback();
    assert.deepEqual(graph.getTransportState(), openTransportState);
    assert.equal(graph.nodes.output.gain.value, 1);
    assert.equal(harness.hostSnapshot().isPlaying, true);

    const cleanupClose = harness.api.stopSequencer();
    harness.runAllFilterTransportTimeouts();
    assert.equal(await cleanupClose, true);
  }

  for (const contextState of ["suspended", "interrupted"]) {
    const harness = createInlineHarness();
    harness.api.seedAudioBuffer("kick");
    harness.audioCtx.currentTime = 1;
    harness.api.playSound("kick", 0, 0);
    const retiringSource = harness.sources[0];
    const retiringGain = retiringSource.connections[0];
    const pendingClose = harness.api.stopSequencer();
    assert.equal(harness.hostSnapshot().retiringSourceCount, 1, contextState);

    harness.api.playSound("kick", 0, 0);
    const scheduledSource = harness.sources[1];
    const scheduledGain = scheduledSource.connections[0];
    assert.equal(harness.hostSnapshot().scheduledSourceCount, 1, contextState);

    harness.audioCtx.state = contextState;
    const immediateClose = harness.api.stopSequencer();
    const stopped = harness.hostSnapshot();
    assert.equal(stopped.scheduledSourceCount, 0, contextState);
    assert.equal(stopped.retiringSourceCount, 0, contextState);
    assert.equal(stopped.masterFilterGraphTransportState.closed, true, contextState);
    assert.equal(stopped.masterFilterGraphTransportState.closePending, false, contextState);
    assert.equal(stopped.masterFilterOutputGain, 0, contextState);
    assert.equal(harness.timeouts.size, 0, contextState);
    assert.equal(harness.filterTransportTimeouts.size, 0, contextState);
    for (const node of [retiringSource, retiringGain, scheduledSource, scheduledGain]) {
      assert.equal(node.connections.length, 0, contextState);
    }
    assert.equal(await pendingClose, false, contextState);
    assert.equal(await immediateClose, true, contextState);
    assert.equal(harness.hostSnapshot().filterEffectAvailable, true, contextState);
  }
});

test("unavailable Tone retains protected Space-to-gate transport authority", async () => {
  const harness = createInlineHarness({
    audioFailures: { createBiquadFilter: 1 },
  });
  const routeSnapshot = harness.hostSnapshot();
  assert.equal(routeSnapshot.masterEffectsChainPresent, true);
  assert.equal(routeSnapshot.masterEffectsRoute, "space-gate");
  assert.equal(routeSnapshot.masterTerminalGateGain, 0);
  harness.api.seedAudioBuffer("kick");
  harness.audioCtx.currentTime = 1;
  harness.api.playSound("kick", 0, 0);

  const source = harness.sources[0];
  const gain = source.connections[0];
  const disconnectEvents = [];
  for (const [kind, node] of [
    ["source", source],
    ["gain", gain],
  ]) {
    const disconnect = node.disconnect.bind(node);
    node.disconnect = () => {
      disconnect();
      disconnectEvents.push({
        kind,
        snapshot: harness.hostSnapshot(),
      });
    };
  }

  assert.equal(harness.hostSnapshot().masterFilterGraphPresent, false);
  assert.equal(harness.hostSnapshot().filterEffectAvailable, false);
  assert.equal(harness.hostSnapshot().scheduledSourceCount, 1);

  const stopPromise = harness.api.stopSequencer();
  const stopped = harness.hostSnapshot();
  assert.equal(stopped.scheduledSourceCount, 0);
  assert.equal(stopped.retiringSourceCount, 1);
  assert.equal(source.connections.length, 1);
  assert.equal(gain.connections.length, 1);
  assert.deepEqual(disconnectEvents, []);

  const playPromise = harness.api.startSequencer();
  harness.runAllFilterTransportTimeouts();
  await playPromise;
  assert.deepEqual(
    disconnectEvents.map((event) => event.kind),
    ["source", "gain"],
  );
  for (const event of disconnectEvents) {
    assert.equal(event.snapshot.retiringSourceCount, 0, event.kind);
    assert.equal(event.snapshot.isPlaying, false, event.kind);
    assert.equal(event.snapshot.schedulerIntervalId, null, event.kind);
  }
  assert.equal(source.connections.length, 0);
  assert.equal(gain.connections.length, 0);

  assert.equal(await stopPromise, true);
  await playPromise;
  const playing = harness.hostSnapshot();
  assert.equal(playing.retiringSourceCount, 0);
  assert.equal(playing.isPlaying, true);
  assert.notEqual(playing.schedulerIntervalId, null);
  assert.equal(playing.masterFilterGraphPresent, false);
  assert.equal(playing.filterEffectAvailable, false);
  assert.equal(
    harness.filterTransportEvents.filter((event) => event.type === "wake").length,
    0,
  );

  const finalStop = harness.api.stopSequencer();
  harness.runAllFilterTransportTimeouts();
  assert.equal(await finalStop, true);
});

test("T06 settles 30 rapid Stop Play cycles with concurrent Space preset Size and Decay changes", async () => {
  const harness = createInlineHarness();
  harness.api.bindFilterEffectControls();
  harness.api.seedAudioBuffer("kick");
  const chain = harness.api.getMasterEffectsChain();
  const spaceGraph = chain.spaceGraph;
  harness.instrumentStepContainers.get("kick").childNodes[0].classList.add("active");
  const presets = ["pocket-room", "warm-hall", "shimmer", "bloom"];
  for (let cycle = 0; cycle < 30; cycle += 1) {
    harness.clickSpacePreset(presets[cycle % presets.length]);
    harness.setSpaceMacro("size", (cycle * 17) % 101);
    harness.setSpaceMacro("decay", (cycle * 29) % 101);
    assert.deepEqual(harness.hostSnapshot().spaceEffectState, {
      ...harness.hostSnapshot().spaceEffectState,
      enabled: true,
      size: (cycle * 17) % 101,
      decay: (cycle * 29) % 101,
      preset: "custom",
    }, `cycle ${cycle}: concurrent Space churn must be live`);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    harness.runAllTimeouts();
    const stop = harness.api.stopSequencer();
    harness.runAllFilterTransportTimeouts();
    assert.equal(await stop, true, `cycle ${cycle}: Stop`);
    await harness.api.startSequencer();
    assert.equal(harness.hostSnapshot().isPlaying, true, `cycle ${cycle}: Play`);
    if (cycle === 29) {
      const schedulerTick = harness.intervals.get(harness.hostSnapshot().schedulerIntervalId);
      assert.ok(schedulerTick, "T06 must execute a real scheduler tick");
      schedulerTick();
    }
  }
  const finalStop = harness.api.stopSequencer();
  harness.runAllFilterTransportTimeouts();
  assert.equal(await finalStop, true);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  harness.runAllTimeouts();
  harness.sources.forEach(source => source.emit("ended"));
  assert.equal(harness.audioNodes.convolvers.filter(node => node.buffer !== null).length, 1);
  assert.equal(harness.timeouts.size, 0);
  assert.equal(harness.filterTransportTimeouts.size, 0);
  assert.equal(harness.hostSnapshot().masterEffectsRoute, "tone-space-gate");
  assert.equal(harness.api.getMasterEffectsChain(), chain);
  assert.equal(harness.api.getMasterEffectsChain().spaceGraph, spaceGraph);
  assert.deepEqual(harness.hostSnapshot().spaceEffectState, {
    enabled: true, size: 89, decay: 33, air: 48, mix: 36, preset: "custom",
  });
  assert.deepEqual(harness.hostSnapshot().spaceEffectState, spaceGraph.getState());
  const liveBank = spaceGraph.nodes.currentBank;
  const registeredLiveBanks = harness.spaceBanks.filter(
    bank => bank.convolver === liveBank.convolver,
  );
  const retiredBanks = harness.spaceBanks.filter(
    bank => bank.convolver !== liveBank.convolver,
  );
  assert.equal(harness.spaceBanks.length, harness.audioNodes.convolvers.length);
  assert.equal(harness.spaceBanks.length, 61);
  assert.equal(registeredLiveBanks.length, 1);
  assert.equal(retiredBanks.length, 60);
  assert.equal(retiredBanks.length, harness.spaceBanks.length - 1);
  for (const bank of retiredBanks) {
    assert.equal(bank.convolver.buffer, null);
    for (const node of [bank.delay, bank.convolver, bank.filter, bank.gain]) {
      assert.equal(node.incoming.length, 0);
      assert.equal(node.connections.length, 0);
    }
  }
  const terminal = harness.hostSnapshot();
  assert.equal(terminal.isPlaying, false);
  assert.equal(terminal.isStartingPlayback, false);
  assert.equal(terminal.schedulerIntervalId, null);
  assert.equal(harness.intervals.size, 0);
  assert.equal(terminal.scheduledSourceCount, 0);
  assert.equal(terminal.retiringSourceCount, 0);
  assert.equal(terminal.scheduledHighlightTimerCount, 0);
  assert.ok(harness.sources.length > 0, "T06 scheduler tick must create historical sources");
  for (const source of harness.sources) {
    const historicalGains = source.connectCalls.filter(node => node.kind === "gain");
    assert.equal(source.incoming.length, 0);
    assert.equal(source.connections.length, 0);
    assert.ok(historicalGains.length > 0);
    for (const gain of historicalGains) {
      assert.equal(gain.incoming.length, 0);
      assert.equal(gain.connections.length, 0);
    }
  }
});

test("master Filter routing stays protected when compression is unavailable", () => {
  const harness = createInlineHarness({ omitDynamicsCompressor: true });
  const snapshot = harness.hostSnapshot();
  assert.equal(harness.audioNodes.compressors.length, 0);
  assert.equal(snapshot.masterFilterGraphPresent, true);
  assert.equal(snapshot.masterEffectsChainPresent, true);
  assert.equal(snapshot.masterEffectsRoute, "tone-space-gate");
  assert.equal(snapshot.masterGainConnectedToFilter, false);
  assert.equal(snapshot.masterProtectionConnectedToDestination, false);
  const destinationFeeders = harness.audioNodes.gains.filter((node) =>
    node.connections.includes(harness.audioCtx.destination));
  assert.equal(destinationFeeders.length, 1);
});

test("source.start failure releases the voice while persistent Filter state survives", () => {
  const harness = createInlineHarness();
  harness.api.setFilterEffectState(CUSTOM_FILTER_STATE);
  harness.api.seedAudioBuffer("kick");
  const graph = harness.api.getMasterFilterGraph();
  const gainCount = harness.audioNodes.gains.length;
  harness.setAudioFailure("sourceStart");

  harness.api.playSound("kick", 0, 0);
  const source = harness.sources[0];
  const voiceGain = harness.audioNodes.gains[gainCount];
  const snapshot = harness.hostSnapshot();

  assert.ok(source);
  assert.ok(voiceGain);
  assert.equal(source.starts.length, 0);
  assert.equal(source.connections.length, 0);
  assert.equal(voiceGain.connections.length, 0);
  assert.ok(source.disconnectCalls >= 1);
  assert.ok(voiceGain.disconnectCalls >= 1);
  assert.equal(snapshot.scheduledSourceCount, 0);
  assert.equal(snapshot.retiringSourceCount, 0);
  assert.equal(snapshot.masterFilterGraphPresent, true);
  assert.equal(snapshot.filterEffectAvailable, true);
  assert.deepEqual(snapshot.filterEffectState, CUSTOM_FILTER_STATE);
  assert.equal(harness.api.getMasterFilterGraph(), graph);
  assert.deepEqual(graph.getState(), CUSTOM_FILTER_STATE);
});

test("Filter-node construction failure selects the protected Space-to-gate route", () => {
  const harness = createInlineHarness({ audioFailures: { createBiquadFilter: 1 } });
  harness.api.bindFilterEffectControls();
  const snapshot = harness.hostSnapshot();

  assert.equal(snapshot.filterEffectAvailable, false);
  assert.equal(snapshot.masterFilterGraphPresent, false);
  assert.equal(harness.api.getMasterFilterGraph(), null);
  assert.equal(harness.filterElements.panel.dataset.available, "false");
  assert.equal(harness.filterElements.bypass.disabled, true);
  assert.equal(harness.filterElements.preset.disabled, true);
  assert.equal(harness.filterElements.reset.disabled, true);

  assert.equal(snapshot.audioInitializationError, null);
  assert.equal(snapshot.masterProtectionConnectedToDestination, true);
  assert.equal(snapshot.masterGainConnectionCount, 1);
});

test("outer audio construction failure clears both effect availability flags", () => {
  const harness = createInlineHarness({ audioFailures: { createGain: 1 } });
  const snapshot = harness.hostSnapshot();
  assert.equal(snapshot.masterEffectsChainPresent, false);
  assert.equal(snapshot.filterEffectAvailable, false);
  assert.equal(snapshot.spaceEffectAvailable, false);
  assert.match(snapshot.audioInitializationError, /createGain/);
});

test("runtime Space removal failure releases page graph ownership and preserves desired state", async () => {
  const harness = createInlineHarness({ spaceDisconnectFailure: "inlet-disconnect" });
  const desired = { enabled: true, size: 61, decay: 72, air: 83, mix: 39, preset: "custom" };
  harness.api.setSpaceEffectStateThroughController(desired, { immediate: true });
  await Promise.resolve(); await Promise.resolve();
  harness.api.makeSpaceUnavailableThroughController();
  const snapshot = harness.hostSnapshot();
  assert.deepEqual(snapshot.spaceEffectState, desired);
  assert.equal(snapshot.masterEffectsChainPresent, false);
  assert.equal(snapshot.masterFilterGraphPresent, false);
  assert.equal(snapshot.filterEffectAvailable, false);
  assert.equal(snapshot.spaceEffectAvailable, false);
  assert.equal(snapshot.masterGainConnectionCount, 0);
  assert.equal(snapshot.masterEffectsRoute, null);
  assert.equal(snapshot.blockedMasterEffectsChainPresent, true);
});

test("automatic Space apply failure has one removal owner and reconciles desired state without rejection", async () => {
  const harness = createInlineHarness();
  const desired = { enabled: true, size: 77, decay: 66, air: 55, mix: 44, preset: "custom" };
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  harness.runAllTimeouts();
  harness.setAudioFailure("createConvolver");
  harness.api.setSpaceEffectStateThroughController(desired, { immediate: false });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  const snapshot = harness.hostSnapshot();
  assert.deepEqual(snapshot.spaceEffectState, desired);
  assert.equal(snapshot.masterEffectsChainPresent, true);
  assert.equal(snapshot.spaceEffectAvailable, false);
  assert.equal(snapshot.filterEffectAvailable, true);
  assert.equal(snapshot.masterEffectsRoute, "tone-gate");
  assert.equal(harness.spaceElements.status.textContent, "Space unavailable; audio is bypassed.");
});

for (const failureKind of ["inlet-disconnect", "buffer-null"]) {
  test(`compound automatic Space apply and ${failureKind} cleanup recovers through blocked ownership`, async () => {
    const harness = createInlineHarness({ spaceDisconnectFailure: failureKind });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    harness.runAllTimeouts();
    const oldConvolvers = [...harness.audioNodes.convolvers];
    const oldDelays = [...harness.audioNodes.delays];
    const before = {
      convolvers: harness.audioNodes.convolvers.length,
      compressors: harness.audioNodes.compressors.length,
    };
    harness.setAudioFailure("createConvolver");
    const desired = { enabled: true, size: 79, decay: 67, air: 53, mix: 41, preset: "custom" };
    harness.api.setSpaceEffectStateThroughController(desired, { immediate: false });
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
    let snapshot = harness.hostSnapshot();
    assert.deepEqual(snapshot.spaceEffectState, desired);
    assert.equal(snapshot.masterEffectsChainPresent, false);
    assert.equal(snapshot.blockedMasterEffectsChainPresent, true);
    assert.equal(snapshot.filterEffectAvailable, false);
    assert.equal(snapshot.spaceEffectAvailable, false);
    harness.api.initializeMasterOutput();
    harness.api.initializeMasterOutput();
    assert.equal(harness.audioNodes.convolvers.length, before.convolvers);
    assert.equal(harness.audioNodes.compressors.length, before.compressors);
    assert.equal(harness.audioCtx.destination.incoming.length, 0);
    harness.clearSpaceDisconnectFailure();
    harness.api.initializeMasterOutput();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    snapshot = harness.hostSnapshot();
    assert.equal(snapshot.blockedMasterEffectsChainPresent, false);
    assert.equal(snapshot.masterEffectsChainPresent, true);
    assert.equal(snapshot.filterEffectAvailable, true);
    assert.equal(snapshot.spaceEffectAvailable, true);
    assert.ok(oldConvolvers.every(node => node.buffer === null));
    assert.ok(oldDelays.every(node => node.incoming.length === 0));
    assert.equal(harness.audioNodes.convolvers.length, before.convolvers + 1);
    assert.equal(harness.audioNodes.compressors.length, before.compressors + 1);
    assert.equal(harness.audioNodes.convolvers.filter(node => node.buffer !== null).length, 1);
    const recoveredChain = harness.api.getMasterEffectsChain();
    harness.api.initializeMasterOutput();
    assert.equal(harness.api.getMasterEffectsChain(), recoveredChain);
    assert.equal(harness.audioNodes.convolvers.length, before.convolvers + 1);
    assert.equal(harness.audioNodes.compressors.length, before.compressors + 1);
  });
}

for (const failureKind of ["buffer-null", "inlet-disconnect"]) {
  test(`blocked ${failureKind} cleanup prevents cross-instance allocation until retry succeeds`, async () => {
    const options = { spaceDisconnectFailure: failureKind };
    const harness = createInlineHarness(options);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    assert.equal(harness.audioNodes.convolvers.length, 1);
    harness.api.setSpaceEffectStateThroughController(
      { enabled: true, size: 72, decay: 64, air: 55, mix: 44, preset: "custom" },
      { immediate: false },
    );
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const oldConvolvers = [...harness.audioNodes.convolvers];
    const oldDelays = [...harness.audioNodes.delays];
    assert.equal(oldConvolvers.length, 2);
    assert.equal(oldDelays.length, 2);
    assert.ok(oldConvolvers.every(node => node.buffer !== null));
    assert.ok(oldDelays.every(node => node.incoming.length === 1));
    const before = {
      convolvers: harness.audioNodes.convolvers.length,
      compressors: harness.audioNodes.compressors.length,
      destinationFeeders: harness.audioCtx.destination.incoming.length,
    };
    harness.api.makeSpaceUnavailableThroughController();
    let snapshot = harness.hostSnapshot();
    assert.equal(snapshot.blockedMasterEffectsChainPresent, true);
    assert.equal(snapshot.masterEffectsChainPresent, false);
    assert.equal(snapshot.filterEffectAvailable, false);
    assert.equal(snapshot.spaceEffectAvailable, false);
    if (failureKind === "buffer-null") {
      assert.ok(harness.audioNodes.convolvers.some(node => node.buffer !== null));
    } else {
      assert.ok(harness.audioNodes.delays.some(node => node.incoming.length > 0));
    }

    harness.api.initializeMasterOutput();
    snapshot = harness.hostSnapshot();
    assert.equal(snapshot.blockedMasterEffectsChainPresent, true);
    assert.equal(harness.audioNodes.convolvers.length, before.convolvers);
    assert.equal(harness.audioNodes.compressors.length, before.compressors);
    assert.equal(harness.audioCtx.destination.incoming.length, 0);

    harness.clearSpaceDisconnectFailure();
    harness.api.initializeMasterOutput();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    snapshot = harness.hostSnapshot();
    assert.equal(snapshot.blockedMasterEffectsChainPresent, false);
    assert.equal(snapshot.masterEffectsChainPresent, true);
    assert.equal(snapshot.filterEffectAvailable, true);
    assert.equal(snapshot.spaceEffectAvailable, true);
    assert.ok(oldConvolvers.every(node => node.buffer === null));
    assert.ok(oldDelays.every(node => node.incoming.length === 0));
    assert.equal(harness.audioNodes.convolvers.length, before.convolvers + 1);
    assert.equal(harness.audioNodes.compressors.length, before.compressors + 1);
    assert.equal(harness.audioNodes.convolvers.filter(node => node.buffer).length, 1);
    assert.equal(harness.audioNodes.delays.filter(node => node.incoming.length > 0).length, 1);
    assert.equal(harness.audioCtx.destination.incoming.length, 1);
    const recoveredCounts = {
      convolvers: harness.audioNodes.convolvers.length,
      compressors: harness.audioNodes.compressors.length,
      destinationFeeders: harness.audioCtx.destination.incoming.length,
    };
    harness.api.initializeMasterOutput();
    assert.equal(harness.audioNodes.convolvers.length, recoveredCounts.convolvers);
    assert.equal(harness.audioNodes.compressors.length, recoveredCounts.compressors);
    assert.equal(harness.audioCtx.destination.incoming.length, recoveredCounts.destinationFeeders);
  });
}

test("final master-to-chain connection failure fails closed without a protection shortcut", () => {
  const harness = createInlineHarness();
  const initialGraph = harness.api.getMasterFilterGraph();
  assert.ok(initialGraph);

  // initializeMasterOutput() normally runs once. Retire that initial topology so this
  // focused re-entry can isolate the final masterGain -> Filter input failure path.
  harness.api.retireMasterEffectsChainForTest();
  [
    ...harness.audioNodes.gains,
    ...harness.audioNodes.filters,
    ...harness.audioNodes.waveShapers,
    ...harness.audioNodes.compressors,
  ].forEach((node) => node.disconnect());

  const initialCounts = {
    gains: harness.audioNodes.gains.length,
    filters: harness.audioNodes.filters.length,
    waveShapers: harness.audioNodes.waveShapers.length,
    compressors: harness.audioNodes.compressors.length,
  };
  const createGain = harness.audioCtx.createGain.bind(harness.audioCtx);
  let newMasterGain = null;
  harness.audioCtx.createGain = () => {
    const node = createGain();
    if (newMasterGain) return node;

    newMasterGain = node;
    const connect = node.connect.bind(node);
    let failFilterConnection = true;
    node.connect = (destination) => {
      if (failFilterConnection) {
        failFilterConnection = false;
        throw new Error("fake final master-to-Filter connection failure");
      }
      return connect(destination);
    };
    return node;
  };

  harness.api.initializeMasterOutput();

  const snapshot = harness.hostSnapshot();
  const graphGains = harness.audioNodes.gains.slice(initialCounts.gains + 1);
  const graphFilters = harness.audioNodes.filters.slice(initialCounts.filters);
  const graphWaveShapers = harness.audioNodes.waveShapers.slice(
    initialCounts.waveShapers,
  );
  const newProtection = harness.audioNodes.compressors[initialCounts.compressors];
  const attemptedGraphNodes = [...graphGains, ...graphFilters, ...graphWaveShapers];

  assert.ok(newMasterGain);
  assert.ok(newProtection);
  assert.equal(snapshot.filterEffectAvailable, false);
  assert.equal(snapshot.masterFilterGraphPresent, false);
  assert.match(snapshot.audioInitializationError, /fake final master-to-Filter connection failure/);
  assert.equal(harness.api.getMasterFilterGraph(), null);
  assert.equal(newMasterGain.connections.length, 0);
  assert.ok(newProtection.disconnectCalls >= 1);
  attemptedGraphNodes.forEach((node) => {
    assert.equal(
      node.connections.length,
      0,
      `${node.kind} must not retain an orphan route`,
    );
    assert.ok(node.disconnectCalls >= 1, `${node.kind} must be disconnected`);
  });

  const nodesFeedingProtection = [
    ...harness.audioNodes.gains,
    ...harness.audioNodes.filters,
    ...harness.audioNodes.waveShapers,
  ].filter((node) => node.connections.includes(newProtection));
  assert.equal(nodesFeedingProtection.length, 0);

  const nodesFeedingDestination = [
    ...harness.audioNodes.gains,
    ...harness.audioNodes.filters,
    ...harness.audioNodes.waveShapers,
    ...harness.audioNodes.compressors,
  ].filter((node) => node.connections.includes(harness.audioCtx.destination));
  assert.equal(nodesFeedingDestination.length, 0);
});

test("unavailable Filter preserves desired share state but renders effective bypass", async () => {
  const harness = createInlineHarness({ audioFailures: { createBiquadFilter: 1 } });
  harness.api.bindFilterEffectControls();
  harness.api.setFilterEffectState(CUSTOM_FILTER_STATE);

  const snapshot = harness.hostSnapshot();
  const { bypass, graphic, graphicState, macroInputs, panel, preset, reset, status } =
    harness.filterElements;

  assert.deepEqual(snapshot.filterEffectState, CUSTOM_FILTER_STATE);
  assert.equal(snapshot.filterEffectAvailable, false);
  assert.equal(snapshot.masterFilterGraphPresent, false);
  assert.equal(panel.dataset.available, "false");
  assert.equal(panel.dataset.enabled, "false");
  assert.equal(status.textContent, "Tone: Unavailable · Space: Bypassed");
  assert.equal(
    graphic.getAttribute("aria-label"),
    "Filter unavailable. Audio is using the neutral protected path.",
  );
  assert.equal(graphicState.textContent, "Filter unavailable · Neutral audio");
  assert.equal(bypass.disabled, true);
  assert.equal(bypass.getAttribute("aria-pressed"), "false");
  assert.equal(
    bypass.getAttribute("aria-label"),
    "Filter unavailable; audio is bypassed",
  );
  assert.equal(preset.disabled, true);
  assert.equal(reset.disabled, true);
  assertFilterPresetCardSelection(harness, "custom", false);
  harness.filterElements.presetCards.forEach((card) => {
    assert.equal(card.disabled, true);
  });
  Object.values(macroInputs).forEach((input) => {
    assert.equal(input.disabled, true);
  });

  const encoded = harness.api.encodeSongState();
  assert.deepEqual(decodeSongPayload(encoded).f, {
    v: 1,
    e: 1,
    c: 37,
    r: 52,
    d: 63,
    m: 41,
    p: "custom",
  });

  await harness.dispatchElementEvent(harness.ids.get("shareBtn"), { type: "click" });
  assert.equal(harness.clipboardWrites.length, 1);
  const sharedSong = new URL(harness.clipboardWrites[0]).searchParams.get("song");
  assert.deepEqual(decodeSongPayload(sharedSong).f, decodeSongPayload(encoded).f);
  assert.deepEqual(filterSnapshot(harness), CUSTOM_FILTER_STATE);
});
