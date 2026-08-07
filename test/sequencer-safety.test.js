import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_BPM,
  MAX_BPM,
  MIN_BPM,
  getSixteenthNoteDurationSeconds,
  normalizeBpm,
} from "../src/lib/sequencer-safety.js";

test("sequencer safety exposes the agreed BPM contract", () => {
  assert.equal(MIN_BPM, 40);
  assert.equal(MAX_BPM, 300);
  assert.equal(DEFAULT_BPM, 120);
});

test("normalizeBpm clamps finite values and rounds fractional BPM", () => {
  const cases = [
    { input: -1, expected: 40 },
    { input: 0, expected: 40 },
    { input: 39, expected: 40 },
    { input: 40, expected: 40 },
    { input: 120.4, expected: 120 },
    { input: 120.5, expected: 121 },
    { input: "299.8", expected: 300 },
    { input: 300, expected: 300 },
    { input: 301, expected: 300 },
    { input: 100_000_000_000_000_000_000, expected: 300 },
  ];

  cases.forEach(({ input, expected }) => {
    assert.equal(normalizeBpm(input), expected, String(input));
  });
});

test("normalizeBpm defaults non-finite and empty values defensively", () => {
  for (const input of [null, undefined, "", "   ", "fast", Number.NaN, Infinity, -Infinity]) {
    assert.equal(normalizeBpm(input), DEFAULT_BPM, String(input));
  }

  assert.equal(normalizeBpm("fast", 90), 90);
  assert.equal(normalizeBpm("fast", 500), MAX_BPM);
  assert.equal(normalizeBpm("fast", "also-fast"), DEFAULT_BPM);
});

test("sixteenth-note duration is exact at the BPM boundaries", () => {
  assert.equal(getSixteenthNoteDurationSeconds(MIN_BPM), 0.375);
  assert.equal(getSixteenthNoteDurationSeconds(DEFAULT_BPM), 0.125);
  assert.equal(getSixteenthNoteDurationSeconds(MAX_BPM), 0.05);
});

test("sixteenth-note duration normalizes every unsafe input itself", () => {
  const cases = [
    { input: -1, expected: 0.375 },
    { input: 0, expected: 0.375 },
    { input: null, expected: 0.125 },
    { input: undefined, expected: 0.125 },
    { input: "", expected: 0.125 },
    { input: "fast", expected: 0.125 },
    { input: Number.NaN, expected: 0.125 },
    { input: Infinity, expected: 0.125 },
    { input: -Infinity, expected: 0.125 },
  ];

  for (const { input, expected } of cases) {
    const duration = getSixteenthNoteDurationSeconds(input);
    assert.equal(Number.isFinite(duration), true, String(input));
    assert.ok(duration > 0, String(input));
    assert.equal(duration, expected, String(input));
  }
});
