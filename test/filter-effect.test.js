import assert from "node:assert/strict";
import test from "node:test";

import {
  FILTER_EFFECT_DEFAULT_STATE,
  FILTER_EFFECT_PRESETS,
  FILTER_EFFECT_VERSION,
  FILTER_MACRO_MAX,
  FILTER_MACRO_MIN,
  FILTER_SONG_SCHEMA_VERSION,
  createDefaultFilterEffectState,
  deserializeFilterEffectState,
  formatFilterCutoffValue,
  formatFilterMacroValue,
  getFilterCutoffFrequencyHz,
  getFilterDriveDescriptor,
  getFilterEffectPresetState,
  getFilterGraphicSummary,
  getFilterMixDescriptor,
  isDefaultFilterEffectState,
  normalizeFilterEffectState,
  serializeFilterEffectState,
} from "../src/lib/filter-effect.js";
import {
  FILTER_DRIVE_COMPENSATION_RANGE,
  FILTER_DRIVE_MAX_PRE_GAIN,
  FILTER_MAX_Q,
  FILTER_MIN_Q,
  FILTER_PARAMETER_SMOOTHING_SECONDS,
  mapFilterEffectStateToAudio,
} from "../src/lib/master-filter-graph.js";

const EXPECTED_DEFAULT_STATE = {
  enabled: false,
  cutoff: 100,
  resonance: 0,
  drive: 0,
  mix: 100,
  preset: "clean",
};

const EXPECTED_PRESETS = [
  {
    id: "clean",
    name: "Clean",
    cutoff: 100,
    resonance: 0,
    drive: 0,
    mix: 100,
  },
  {
    id: "warm",
    name: "Warm",
    cutoff: 68,
    resonance: 18,
    drive: 14,
    mix: 78,
  },
  {
    id: "bright",
    name: "Bright",
    cutoff: 90,
    resonance: 10,
    drive: 8,
    mix: 94,
  },
  {
    id: "resonant-sweep",
    name: "Resonant Sweep",
    cutoff: 45,
    resonance: 64,
    drive: 5,
    mix: 72,
  },
  {
    id: "grit",
    name: "Grit",
    cutoff: 60,
    resonance: 28,
    drive: 68,
    mix: 76,
  },
];

function assertApproximately(actual, expected, message) {
  assert.ok(
    Math.abs(actual - expected) <= Number.EPSILON * Math.max(1, Math.abs(expected)) * 8,
    `${message}: expected ${expected}, received ${actual}`
  );
}

test("Filter effect exposes the frozen state, schema, and smoothing contract", () => {
  assert.equal(FILTER_EFFECT_VERSION, 1);
  assert.equal(FILTER_SONG_SCHEMA_VERSION, 5);
  assert.equal(FILTER_MACRO_MIN, 0);
  assert.equal(FILTER_MACRO_MAX, 100);
  assert.equal(FILTER_PARAMETER_SMOOTHING_SECONDS, 0.015);
  assert.equal(FILTER_MIN_Q, Math.SQRT1_2);
  assert.equal(FILTER_MAX_Q, 12);
  assert.equal(FILTER_DRIVE_MAX_PRE_GAIN, 16);
  assert.equal(FILTER_DRIVE_COMPENSATION_RANGE, 3.5);
  assert.deepEqual(FILTER_EFFECT_DEFAULT_STATE, EXPECTED_DEFAULT_STATE);
  assert.equal(Object.isFrozen(FILTER_EFFECT_DEFAULT_STATE), true);
});

test("default and normalized states are fresh and do not mutate their inputs", () => {
  const firstDefault = createDefaultFilterEffectState();
  const secondDefault = createDefaultFilterEffectState();
  assert.deepEqual(firstDefault, EXPECTED_DEFAULT_STATE);
  assert.deepEqual(secondDefault, EXPECTED_DEFAULT_STATE);
  assert.notEqual(firstDefault, secondDefault);
  assert.notEqual(firstDefault, FILTER_EFFECT_DEFAULT_STATE);

  firstDefault.cutoff = 0;
  assert.deepEqual(secondDefault, EXPECTED_DEFAULT_STATE);
  assert.deepEqual(FILTER_EFFECT_DEFAULT_STATE, EXPECTED_DEFAULT_STATE);

  const input = {
    enabled: true,
    cutoff: 68,
    resonance: 18,
    drive: 14,
    mix: 78,
    preset: "warm",
  };
  const snapshot = { ...input };
  const firstNormalized = normalizeFilterEffectState(input);
  const secondNormalized = normalizeFilterEffectState(input);
  assert.deepEqual(input, snapshot);
  assert.deepEqual(firstNormalized, input);
  assert.deepEqual(secondNormalized, input);
  assert.notEqual(firstNormalized, input);
  assert.notEqual(firstNormalized, secondNormalized);
});

test("canonical normalization accepts only finite numbers and real booleans", () => {
  const malformedValues = [
    null,
    undefined,
    "",
    "50",
    true,
    false,
    [],
    [50],
    {},
    Number.NaN,
    Infinity,
    -Infinity,
  ];

  for (const value of malformedValues) {
    const state = normalizeFilterEffectState({
      enabled: "true",
      cutoff: value,
      resonance: value,
      drive: value,
      mix: value,
      preset: "custom",
    });
    assert.deepEqual(
      state,
      { ...EXPECTED_DEFAULT_STATE, preset: "custom" },
      `malformed value ${String(value)}`
    );
  }

  assert.equal(normalizeFilterEffectState({ enabled: true }).enabled, true);
  assert.equal(normalizeFilterEffectState({ enabled: false }).enabled, false);
});

test("macro normalization clamps, rounds once, and is idempotent", () => {
  const cases = [
    { input: -1, expected: 0 },
    { input: 0, expected: 0 },
    { input: 0.49, expected: 0 },
    { input: 0.5, expected: 1 },
    { input: 49.49, expected: 49 },
    { input: 49.5, expected: 50 },
    { input: 99.49, expected: 99 },
    { input: 99.5, expected: 100 },
    { input: 100, expected: 100 },
    { input: 101, expected: 100 },
    { input: Number.MAX_VALUE, expected: 100 },
  ];

  for (const { input, expected } of cases) {
    const normalized = normalizeFilterEffectState({
      cutoff: input,
      resonance: input,
      drive: input,
      mix: input,
      preset: "custom",
    });
    for (const key of ["cutoff", "resonance", "drive", "mix"]) {
      assert.equal(normalized[key], expected, `${key}: ${input}`);
      assert.equal(Number.isInteger(normalized[key]), true, `${key}: ${input}`);
    }
    assert.deepEqual(normalizeFilterEffectState(normalized), normalized);
  }
});

test("normalization ignores inherited and unknown data without prototype pollution", () => {
  const input = Object.create({
    enabled: true,
    cutoff: 0,
    resonance: 100,
    drive: 100,
    mix: 0,
    preset: "grit",
    polluted: true,
  });
  input.extra = { deeply: { nested: new Array(100).fill("junk") } };
  input.constructor = { prototype: { polluted: true } };
  Object.defineProperty(input, "__proto__", {
    configurable: true,
    enumerable: true,
    value: { polluted: true },
  });

  const normalized = normalizeFilterEffectState(input);
  assert.deepEqual(normalized, EXPECTED_DEFAULT_STATE);
  assert.deepEqual(Object.keys(normalized), [
    "enabled",
    "cutoff",
    "resonance",
    "drive",
    "mix",
    "preset",
  ]);
  assert.equal(Object.getPrototypeOf(normalized), Object.prototype);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(normalized.extra, undefined);
});

test("the five preset definitions are exact, ordered, and immutable", () => {
  assert.deepEqual(FILTER_EFFECT_PRESETS, EXPECTED_PRESETS);
  assert.equal(Object.isFrozen(FILTER_EFFECT_PRESETS), true);
  assert.equal(FILTER_EFFECT_PRESETS.every(Object.isFrozen), true);

  for (const expected of EXPECTED_PRESETS) {
    const first = getFilterEffectPresetState(expected.id);
    const second = getFilterEffectPresetState(expected.id);
    assert.deepEqual(first, {
      enabled: true,
      cutoff: expected.cutoff,
      resonance: expected.resonance,
      drive: expected.drive,
      mix: expected.mix,
      preset: expected.id,
    });
    assert.deepEqual(second, first);
    assert.notEqual(first, second);
  }

  assert.equal(getFilterEffectPresetState("unknown"), null);
  assert.equal(getFilterEffectPresetState(null), null);
});

test("preset selection enables while Custom and bypass preserve prepared values", () => {
  const warm = getFilterEffectPresetState("warm");
  assert.equal(warm.enabled, true);

  const manuallyEdited = normalizeFilterEffectState({ ...warm, cutoff: 67 });
  assert.deepEqual(manuallyEdited, {
    ...warm,
    cutoff: 67,
    preset: "custom",
  });

  const bypassed = normalizeFilterEffectState({ ...manuallyEdited, enabled: false });
  assert.deepEqual(bypassed, { ...manuallyEdited, enabled: false });

  const editedWhileBypassed = normalizeFilterEffectState({
    ...bypassed,
    resonance: 19,
    preset: "custom",
  });
  assert.deepEqual(editedWhileBypassed, {
    ...bypassed,
    resonance: 19,
  });
  assert.equal(editedWhileBypassed.enabled, false);

  const manuallyMatchedPreset = normalizeFilterEffectState({
    ...warm,
    preset: "custom",
  });
  assert.equal(manuallyMatchedPreset.preset, "custom");
  assert.equal(normalizeFilterEffectState({ ...warm, mix: 77 }).preset, "custom");
  assert.equal(isDefaultFilterEffectState(EXPECTED_DEFAULT_STATE), true);
  assert.equal(isDefaultFilterEffectState({ ...EXPECTED_DEFAULT_STATE, enabled: true }), false);
});

test("the neutral state is omitted while enabled Clean and bypassed Custom use exact v1 wire data", () => {
  assert.equal(serializeFilterEffectState(EXPECTED_DEFAULT_STATE), null);
  assert.equal(serializeFilterEffectState(createDefaultFilterEffectState()), null);

  assert.deepEqual(
    serializeFilterEffectState({ ...EXPECTED_DEFAULT_STATE, enabled: true }),
    {
      v: 1,
      e: 1,
      c: 100,
      r: 0,
      d: 0,
      m: 100,
      p: "clean",
    }
  );

  assert.deepEqual(
    serializeFilterEffectState({
      enabled: false,
      cutoff: 45,
      resonance: 64,
      drive: 5,
      mix: 72,
      preset: "custom",
    }),
    {
      v: 1,
      e: 0,
      c: 45,
      r: 64,
      d: 5,
      m: 72,
      p: "custom",
    }
  );
});

test("v1 wire data round-trips and accepts only compact e:0|1 enable flags", () => {
  const states = [
    { ...EXPECTED_DEFAULT_STATE, enabled: true },
    {
      enabled: false,
      cutoff: 17,
      resonance: 43,
      drive: 81,
      mix: 29,
      preset: "custom",
    },
  ];

  for (const state of states) {
    const wire = serializeFilterEffectState(state);
    assert.deepEqual(deserializeFilterEffectState(wire), state);
  }

  const baseWire = { v: 1, c: 45, r: 64, d: 5, m: 72, p: "custom" };
  assert.equal(deserializeFilterEffectState({ ...baseWire, e: 1 }).enabled, true);
  assert.equal(deserializeFilterEffectState({ ...baseWire, e: 0 }).enabled, false);
  for (const enabled of [true, false, "1", "0", null, undefined, 2, -1, [], {}]) {
    assert.equal(
      deserializeFilterEffectState({ ...baseWire, e: enabled }).enabled,
      false,
      `wire enable ${String(enabled)}`
    );
  }
});

test("missing, malformed, and unknown Filter versions return fresh neutral state", () => {
  const malformedValues = [
    undefined,
    null,
    false,
    "v1",
    [],
    {},
    { v: 0 },
    { v: 2 },
    { v: "1" },
    { v: Number.NaN },
  ];

  for (const value of malformedValues) {
    const first = deserializeFilterEffectState(value);
    const second = deserializeFilterEffectState(value);
    assert.deepEqual(first, EXPECTED_DEFAULT_STATE, String(value));
    assert.deepEqual(second, EXPECTED_DEFAULT_STATE, String(value));
    assert.notEqual(first, second, String(value));
    assert.notEqual(first, FILTER_EFFECT_DEFAULT_STATE, String(value));
  }
});

test("malformed v1 wire macros default independently without discarding valid neighbors", () => {
  const validWire = { v: 1, e: 1, c: 25, r: 35, d: 45, m: 55, p: "custom" };
  const cases = [
    { key: "c", malformed: "25", field: "cutoff", fallback: 100 },
    { key: "r", malformed: true, field: "resonance", fallback: 0 },
    { key: "d", malformed: [45], field: "drive", fallback: 0 },
    { key: "m", malformed: Number.NaN, field: "mix", fallback: 100 },
  ];

  for (const { key, malformed, field, fallback } of cases) {
    const state = deserializeFilterEffectState({ ...validWire, [key]: malformed });
    assert.equal(state[field], fallback, field);
    for (const [otherField, expected] of [
      ["cutoff", 25],
      ["resonance", 35],
      ["drive", 45],
      ["mix", 55],
    ]) {
      if (otherField !== field) {
        assert.equal(state[otherField], expected, `${field} preserves ${otherField}`);
      }
    }
    assert.equal(state.enabled, true);
    assert.equal(state.preset, "custom");
  }
});

test("preset cutoff formatters expose the exact interaction-spec values", () => {
  const expectedDisplays = ["18 kHz", "3.2 kHz", "10.5 kHz", "915 Hz", "2.1 kHz"];
  const expectedLongDisplays = [
    "18 kilohertz",
    "3.2 kilohertz",
    "10.5 kilohertz",
    "915 hertz",
    "2.1 kilohertz",
  ];

  EXPECTED_PRESETS.forEach((preset, index) => {
    assert.equal(formatFilterCutoffValue(preset.cutoff), expectedDisplays[index], preset.id);
    assert.equal(
      formatFilterCutoffValue(preset.cutoff, true),
      expectedLongDisplays[index],
      `${preset.id} long units`
    );
    assert.equal(formatFilterMacroValue("cutoff", preset.cutoff), expectedDisplays[index]);
  });
  assert.equal(formatFilterCutoffValue("45"), "18 kHz");
});

test("public descriptor and macro formatters bind thresholds and safe fallbacks", () => {
  const driveCases = [
    { value: 0, expected: "Clean" },
    { value: 1, expected: "Gentle" },
    { value: 29, expected: "Gentle" },
    { value: 30, expected: "Warm" },
    { value: 59, expected: "Warm" },
    { value: 60, expected: "Driven" },
    { value: 100, expected: "Driven" },
  ];
  for (const { value, expected } of driveCases) {
    assert.equal(getFilterDriveDescriptor(value), expected);
  }

  const mixCases = [
    { value: 0, expected: "Dry" },
    { value: 1, expected: "Blend" },
    { value: 89, expected: "Blend" },
    { value: 90, expected: "Wet" },
    { value: 100, expected: "Wet" },
  ];
  for (const { value, expected } of mixCases) {
    assert.equal(getFilterMixDescriptor(value), expected);
  }

  assert.equal(getFilterDriveDescriptor("60"), "Clean");
  assert.equal(getFilterMixDescriptor("0"), "Wet");
  assert.equal(formatFilterMacroValue("resonance", 64), "64%");
  assert.equal(formatFilterMacroValue("resonance", 64, true), "64 percent");
  assert.equal(formatFilterMacroValue("drive", 68), "68%, Driven");
  assert.equal(formatFilterMacroValue("drive", 68, true), "68 percent, driven");
  assert.equal(formatFilterMacroValue("mix", 76), "76%, Blend");
  assert.equal(formatFilterMacroValue("mix", 76, true), "76 percent, blend");
  assert.equal(formatFilterMacroValue("drive", "68"), "0%, Clean");
  assert.equal(formatFilterMacroValue("mix", "0"), "100%, Wet");
});

test("graphic summaries are deterministic, redundant, and safe for malformed state", () => {
  const bypassedSummary = {
    label: "Bypassed",
    description: "Filter response: bypassed. Macro settings are preserved.",
  };
  assert.deepEqual(getFilterGraphicSummary(EXPECTED_DEFAULT_STATE), bypassedSummary);
  assert.deepEqual(getFilterGraphicSummary(null), bypassedSummary);
  assert.deepEqual(
    getFilterGraphicSummary({ ...EXPECTED_DEFAULT_STATE, enabled: true }),
    {
      label: "Bright · Calm · Clean · Wet",
      description: "Filter response: bright, calm, clean, fully wet.",
    }
  );
  assert.deepEqual(getFilterGraphicSummary(getFilterEffectPresetState("resonant-sweep")), {
    label: "Dark · Peaked · Gentle · Blend",
    description: "Filter response: dark, peaked, gentle, blend.",
  });
  assert.deepEqual(getFilterGraphicSummary(getFilterEffectPresetState("grit")), {
    label: "Dark · Calm · Driven · Blend",
    description: "Filter response: dark, calm, driven, blend.",
  });
  assert.deepEqual(
    getFilterGraphicSummary({
      enabled: true,
      cutoff: 37,
      resonance: 52,
      drive: 63,
      mix: 41,
      preset: "custom",
    }),
    {
      label: "Custom · Cutoff 37 · Resonance 52 · Drive 63 · Mix 41",
      description:
        "Filter response: custom. cutoff 37, resonance 52, drive 63, mix 41, each out of 100.",
    },
  );
});

test("cutoff follows the exact logarithmic 80 Hz to 18 kHz mapping", () => {
  assert.equal(getFilterCutoffFrequencyHz(0), 80);
  assertApproximately(getFilterCutoffFrequencyHz(50), 1200, "midpoint cutoff");
  assertApproximately(getFilterCutoffFrequencyHz(100), 18000, "maximum cutoff");
  assert.equal(getFilterCutoffFrequencyHz(-1), 80);
  assertApproximately(getFilterCutoffFrequencyHz(101), 18000, "clamped cutoff");
  assertApproximately(getFilterCutoffFrequencyHz("50"), 18000, "malformed cutoff");
});

test("audio mapping bounds cutoff and applies the quadratic resonance curve", () => {
  const minimum = mapFilterEffectStateToAudio({
    enabled: true,
    cutoff: 0,
    resonance: 0,
    preset: "custom",
  });
  assert.equal(minimum.cutoffFrequencyHz, 80);
  assert.equal(minimum.resonanceQ, FILTER_MIN_Q);

  const midpoint = mapFilterEffectStateToAudio({
    enabled: true,
    cutoff: 50,
    resonance: 50,
    preset: "custom",
  });
  assertApproximately(midpoint.cutoffFrequencyHz, 1200, "mapped midpoint cutoff");
  assertApproximately(
    midpoint.resonanceQ,
    FILTER_MIN_Q + 0.25 * (FILTER_MAX_Q - FILTER_MIN_Q),
    "mapped midpoint Q"
  );

  const maximum = mapFilterEffectStateToAudio({
    enabled: true,
    cutoff: 100,
    resonance: 100,
    preset: "custom",
  });
  assertApproximately(maximum.cutoffFrequencyHz, 18000, "mapped maximum cutoff");
  assert.equal(maximum.resonanceQ, FILTER_MAX_Q);

  const lowSampleRate = mapFilterEffectStateToAudio(
    { enabled: true, cutoff: 100, preset: "custom" },
    32000
  );
  assert.equal(lowSampleRate.cutoffFrequencyHz, 14400);
});

test("drive mapping is bounded and uses the frozen output compensation", () => {
  const clean = mapFilterEffectStateToAudio({ enabled: true, drive: 0, preset: "custom" });
  assert.equal(clean.cleanDriveGain, 1);
  assert.equal(clean.drivenGain, 0);
  assert.equal(clean.drivePreGain, 1);

  const midpoint = mapFilterEffectStateToAudio({
    enabled: true,
    drive: 50,
    preset: "custom",
  });
  assert.equal(midpoint.cleanDriveGain, 0.5);
  assertApproximately(
    midpoint.drivenGain,
    0.5 / (1 + 0.5 * FILTER_DRIVE_COMPENSATION_RANGE),
    "midpoint driven gain"
  );
  assert.equal(midpoint.drivePreGain, 8.5);

  const driven = mapFilterEffectStateToAudio({
    enabled: true,
    drive: 100,
    preset: "custom",
  });
  assert.equal(driven.cleanDriveGain, 0);
  assertApproximately(
    driven.drivenGain,
    1 / (1 + FILTER_DRIVE_COMPENSATION_RANGE),
    "maximum driven gain"
  );
  assert.equal(driven.drivePreGain, FILTER_DRIVE_MAX_PRE_GAIN);
});

test("linear dry-wet mapping is neutral while bypassed and exact while enabled", () => {
  const bypassed = mapFilterEffectStateToAudio({
    enabled: false,
    mix: 100,
    cutoff: 45,
    resonance: 64,
    drive: 68,
    preset: "custom",
  });
  assert.equal(bypassed.dryGain, 1);
  assert.equal(bypassed.wetGain, 0);
  assert.equal(bypassed.state.enabled, false);
  assert.equal(bypassed.state.mix, 100);

  const cases = [
    { mix: 0, dryGain: 1, wetGain: 0 },
    { mix: 50, dryGain: 0.5, wetGain: 0.5 },
    { mix: 100, dryGain: 0, wetGain: 1 },
  ];
  for (const expected of cases) {
    const mapped = mapFilterEffectStateToAudio({
      enabled: true,
      mix: expected.mix,
      preset: "custom",
    });
    assert.equal(mapped.dryGain, expected.dryGain);
    assert.equal(mapped.wetGain, expected.wetGain);
    assert.equal(mapped.dryGain + mapped.wetGain, 1);
  }
});
