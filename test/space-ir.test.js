import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as spaceIr from "../src/lib/space-ir.js";
import { SPACE_IR_V1_CASES } from "./fixtures/space-ir-v1.js";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED_PRESETS = [
  { id: "pocket-room", name: "Pocket Room", size: 22, decay: 18 },
  { id: "warm-hall", name: "Warm Hall", size: 68, decay: 64 },
  { id: "shimmer", name: "Shimmer", size: 56, decay: 42 },
  { id: "bloom", name: "Bloom", size: 82, decay: 78 },
];
const FIXTURE_SAMPLE_RATES = [44_100, 48_000, 96_000];

function serializeFloat32LittleEndian(channel) {
  const bytes = new Uint8Array(channel.length * Float32Array.BYTES_PER_ELEMENT);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < channel.length; index += 1) {
    view.setFloat32(index * Float32Array.BYTES_PER_ELEMENT, channel[index], true);
  }
  return bytes;
}

function digestChannel(channel) {
  return createHash("sha256")
    .update(serializeFloat32LittleEndian(channel))
    .digest("hex");
}

function getFloat32Word(channel, index) {
  const bytes = new ArrayBuffer(Float32Array.BYTES_PER_ELEMENT);
  const view = new DataView(bytes);
  view.setFloat32(0, channel[index], true);
  return view.getUint32(0, true);
}

function deriveFixtureShape(size, decay, sampleRate) {
  const preDelayMs = Math.round(2 + 0.28 * size);
  const earlySpanMs = Math.round(8 + 0.52 * size);
  const diffusionRiseMs = Math.round(4 + 0.16 * size);
  const earlyTapCount = 4 + Math.round(0.08 * size);
  const earlyResponsePercent = Math.round(20 + 0.65 * size);
  const irLengthMs = Math.round(250 + 17.5 * decay);
  const uncappedFrames = Math.round((sampleRate * irLengthMs) / 1000);
  const frameCount = Math.min(192_000, Math.max(3, uncappedFrames));
  const attackFrames = Math.max(1, Math.round((sampleRate * diffusionRiseMs) / 1000));
  const fadeFrames = Math.min(frameCount, Math.max(2, Math.round(sampleRate * 0.01)));
  return {
    preDelayMs,
    earlySpanMs,
    diffusionRiseMs,
    earlyTapCount,
    earlyResponsePercent,
    irLengthMs,
    uncappedFrames,
    attackFrames,
    fadeFrames,
    fadeStart: frameCount - fadeFrames,
  };
}

function deriveSeed(size, decay, sampleRate, channelIndex) {
  const source = `jam-with-music:space-ir-v1:${size}:${decay}:${Math.round(sampleRate)}:${channelIndex}`;
  let seed = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    seed = (seed ^ source.charCodeAt(index)) >>> 0;
    seed = Math.imul(seed, 0x01000193) >>> 0;
  }
  return seed === 0 ? 0x6d2b79f5 : seed;
}

function createTraceGenerator(initialState) {
  let state = initialState;
  return () => {
    state = (state ^ (state << 13)) >>> 0;
    state = (state ^ (state >>> 17)) >>> 0;
    state = (state ^ (state << 5)) >>> 0;
    return state;
  };
}

function deriveChannelTrace(caseDefinition, channelIndex) {
  const { size, decay, sampleRate, frameCount } = caseDefinition;
  const seed = deriveSeed(size, decay, sampleRate, channelIndex);
  const prefixGenerator = createTraceGenerator(seed);
  const prngPrefix = Array.from({ length: 4 }, () => prefixGenerator());
  const nextUint32 = createTraceGenerator(seed);
  for (let index = 0; index < frameCount; index += 1) nextUint32();

  const tapIndices = [];
  const earlyTapCount = 4 + Math.round(0.08 * size);
  const earlySpanMs = Math.round(8 + 0.52 * size);
  for (let tap = 0; tap < earlyTapCount; tap += 1) {
    const jitterUnit = nextUint32() / 4_294_967_296;
    nextUint32();
    nextUint32();
    const position = (tap + 1) / earlyTapCount;
    const baseSeconds =
      0.001 + (earlySpanMs / 1000 - 0.001) * position * position;
    const jitterSeconds = (jitterUnit - 0.5) * 0.0007;
    const tapSeconds = Math.min(
      earlySpanMs / 1000,
      Math.max(1 / sampleRate, baseSeconds + jitterSeconds),
    );
    tapIndices.push(
      Math.min(frameCount - 2, Math.max(1, Math.round(sampleRate * tapSeconds))),
    );
  }

  return { seed, prngPrefix, tapIndices };
}

test("Space IR pins the exact runtime and exposes only the frozen generator", async () => {
  assert.equal(process.version, "v22.14.0");
  assert.equal(process.versions.v8, "12.4.254.21-node.22");
  assert.equal(await readFile(path.join(REPOSITORY_ROOT, ".nvmrc"), "utf8"), "22.14.0\n");

  const packageJson = JSON.parse(
    await readFile(path.join(REPOSITORY_ROOT, "package.json"), "utf8"),
  );
  assert.deepEqual(packageJson.engines, { node: "22.14.0" });
  assert.deepEqual(Object.keys(spaceIr), ["generateSpaceImpulseResponse"]);
});

test("Space IR source stays pure and fixtures remain literal independent data", async () => {
  const generatorSource = await readFile(
    path.join(REPOSITORY_ROOT, "src/lib/space-ir.js"),
    "utf8",
  );
  const fixtureSource = await readFile(
    path.join(REPOSITORY_ROOT, "test/fixtures/space-ir-v1.js"),
    "utf8",
  );

  assert.doesNotMatch(generatorSource, /^\s*import\s|\bimport\s*\(|\brequire\s*\(/m);
  assert.doesNotMatch(
    generatorSource,
    /\b(?:AudioBuffer|AudioContext|ConvolverNode|createHash|crypto|document|fetch|globalThis|window|Tone)\b/,
  );
  assert.equal((generatorSource.match(/\bexport\s+/g) || []).length, 1);
  assert.equal((generatorSource.match(/new Float64Array\(/g) || []).length, 2);
  assert.equal((generatorSource.match(/Math\.fround\(/g) || []).length, 1);
  assert.equal((generatorSource.match(/Math\.round\(sampleRate\)/g) || []).length, 1);

  assert.doesNotMatch(fixtureSource, /\.\.\/src|space-ir\.js|generateSpaceImpulseResponse/);
  assert.doesNotMatch(
    fixtureSource,
    /\b(?:Math|DataView|Float32Array|createHash|Buffer|crypto)\b/,
  );
  assert.equal((fixtureSource.match(/\bexport\s+/g) || []).length, 1);
});

test("literal fixtures exhaust every preset and reference rate with independent traces", () => {
  assert.equal(
    SPACE_IR_V1_CASES.length,
    EXPECTED_PRESETS.length * FIXTURE_SAMPLE_RATES.length + 1,
  );
  assert.equal(new Set(SPACE_IR_V1_CASES.map(({ id }) => id)).size, SPACE_IR_V1_CASES.length);

  for (const preset of EXPECTED_PRESETS) {
    const presetCases = SPACE_IR_V1_CASES.filter(
      ({ id }) => id.startsWith(`${preset.id}-`),
    );
    assert.deepEqual(
      presetCases.map(({ sampleRate }) => sampleRate),
      FIXTURE_SAMPLE_RATES,
    );

    for (const caseDefinition of presetCases) {
      assert.equal(caseDefinition.name, preset.name);
      assert.equal(caseDefinition.size, preset.size);
      assert.equal(caseDefinition.decay, preset.decay);
      assert.equal(
        caseDefinition.frameCount,
        Math.min(
          192_000,
          Math.max(
            3,
            Math.round(
              (caseDefinition.sampleRate * Math.round(250 + 17.5 * preset.decay)) /
                1000,
            ),
          ),
        ),
      );
      assert.deepEqual(
        caseDefinition.derived,
        deriveFixtureShape(preset.size, preset.decay, caseDefinition.sampleRate),
      );
      assert.equal(caseDefinition.channels.length, 2);

      for (let channelIndex = 0; channelIndex < 2; channelIndex += 1) {
        const expectedTrace = deriveChannelTrace(caseDefinition, channelIndex);
        const fixtureChannel = caseDefinition.channels[channelIndex];
        assert.equal(fixtureChannel.seed, expectedTrace.seed);
        assert.deepEqual(fixtureChannel.prngPrefix, expectedTrace.prngPrefix);
        assert.deepEqual(fixtureChannel.tapIndices, expectedTrace.tapIndices);
        assert.ok(
          fixtureChannel.diagnosticWords.some(
            ([index]) => index === caseDefinition.frameCount - 1,
          ),
        );
        assert.equal(
          fixtureChannel.diagnosticWords.find(
            ([index]) => index === caseDefinition.frameCount - 1,
          )[1],
          0,
        );
      }
    }
  }

  const boundaryCase = SPACE_IR_V1_CASES.find(
    ({ id }) => id === "g02-collision-peak-93",
  );
  assert.ok(boundaryCase);
  assert.deepEqual(
    boundaryCase.derived,
    deriveFixtureShape(
      boundaryCase.size,
      boundaryCase.decay,
      boundaryCase.sampleRate,
    ),
  );
  for (let channelIndex = 0; channelIndex < 2; channelIndex += 1) {
    const expectedTrace = deriveChannelTrace(boundaryCase, channelIndex);
    const fixtureChannel = boundaryCase.channels[channelIndex];
    assert.equal(fixtureChannel.seed, expectedTrace.seed);
    assert.deepEqual(fixtureChannel.prngPrefix, expectedTrace.prngPrefix);
    assert.deepEqual(fixtureChannel.tapIndices, expectedTrace.tapIndices);
    assert.ok(
      fixtureChannel.diagnosticWords.some(
        ([index, word]) => index === boundaryCase.frameCount - 1 && word === 0,
      ),
    );
  }
});

test("every fixture is byte-exact SHA-256 over explicit Float32LE channel bytes", () => {
  for (const caseDefinition of SPACE_IR_V1_CASES) {
    const generatorInput = Object.freeze({
      size: caseDefinition.size,
      decay: caseDefinition.decay,
      sampleRate: caseDefinition.sampleRate,
    });
    const result = spaceIr.generateSpaceImpulseResponse(generatorInput);
    assert.deepEqual(Object.keys(result), [
      "version",
      "size",
      "decay",
      "sampleRate",
      "frameCount",
      "durationSeconds",
      "channels",
    ]);
    assert.equal(result.version, "space-ir-v1");
    assert.equal(result.size, caseDefinition.size);
    assert.equal(result.decay, caseDefinition.decay);
    assert.equal(result.sampleRate, caseDefinition.sampleRate);
    assert.equal(result.frameCount, caseDefinition.frameCount);
    assert.equal(result.durationSeconds, result.frameCount / result.sampleRate);
    assert.equal(result.channels.length, 2);
    assert.notEqual(result.channels[0], result.channels[1]);

    for (let channelIndex = 0; channelIndex < 2; channelIndex += 1) {
      const channel = result.channels[channelIndex];
      const fixtureChannel = caseDefinition.channels[channelIndex];
      assert.ok(channel instanceof Float32Array);
      assert.equal(channel.length, result.frameCount);
      assert.equal(channel.byteLength, result.frameCount * Float32Array.BYTES_PER_ELEMENT);
      assert.equal(digestChannel(channel), fixtureChannel.sha256);

      for (const [index, word] of fixtureChannel.diagnosticWords) {
        assert.equal(
          getFloat32Word(channel, index),
          word,
          `${caseDefinition.id} channel ${channelIndex} word ${index}`,
        );
      }

      let energy = 0;
      let peak = 0;
      let sum = 0;
      for (let index = 0; index < channel.length; index += 1) {
        const sample = channel[index];
        assert.ok(Number.isFinite(sample));
        energy += sample * sample;
        peak = Math.max(peak, Math.abs(sample));
        sum += sample;
      }
      assert.ok(energy > 0 && energy <= 1.000_001);
      assert.ok(peak > 0 && peak <= 0.95);
      assert.ok(Math.abs(sum / channel.length) < 1e-7);
      assert.ok(Object.is(channel[channel.length - 1], 0));
      assert.equal(1 / channel[channel.length - 1], Infinity);
    }
  }
});

test("colliding taps and the peak-limited scaling branch are byte-pinned", () => {
  const caseDefinition = SPACE_IR_V1_CASES.find(
    ({ id }) => id === "g02-collision-peak-93",
  );
  const result = spaceIr.generateSpaceImpulseResponse({
    size: caseDefinition.size,
    decay: caseDefinition.decay,
    sampleRate: caseDefinition.sampleRate,
  });

  for (const fixtureChannel of caseDefinition.channels) {
    assert.ok(new Set(fixtureChannel.tapIndices).size < fixtureChannel.tapIndices.length);
  }
  assert.deepEqual(caseDefinition.channels[1].scaleEvidence, {
    rootEnergy: 0.3636393323714272,
    peak: 0.34554503416121046,
    energyScale: 2.749977549124371,
    peakScale: 2.74927985090588,
  });
  assert.ok(
    caseDefinition.channels[1].scaleEvidence.peakScale <
      caseDefinition.channels[1].scaleEvidence.energyScale,
  );

  const limitedChannel = result.channels[1];
  let energy = 0;
  let peak = 0;
  for (const sample of limitedChannel) {
    energy += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  assert.equal(peak, Math.fround(0.95));
  assert.equal(energy, 0.9994926188927163);
  assert.equal(digestChannel(limitedChannel), caseDefinition.channels[1].sha256);
});

test("repeated input is deterministic, fresh, isolated, and ignores non-IR state", () => {
  const input = Object.freeze({
    size: 22,
    decay: 18,
    sampleRate: 48_000,
    air: 100,
    mix: 100,
    enabled: true,
    preset: "not-a-seed",
    availability: "unavailable",
  });
  const first = spaceIr.generateSpaceImpulseResponse(input);
  const second = spaceIr.generateSpaceImpulseResponse(input);
  const baselineHashes = first.channels.map(digestChannel);

  assert.notEqual(first, second);
  assert.notEqual(first.channels, second.channels);
  assert.notEqual(first.channels[0], second.channels[0]);
  assert.notEqual(first.channels[1], second.channels[1]);
  assert.deepEqual(first.channels, second.channels);
  assert.deepEqual(baselineHashes, second.channels.map(digestChannel));

  first.channels[0][0] = 0.5;
  first.channels[1][1] = -0.5;
  const third = spaceIr.generateSpaceImpulseResponse({
    size: 22,
    decay: 18,
    sampleRate: 48_000,
  });
  assert.deepEqual(third.channels.map(digestChannel), baselineHashes);

  const changedSize = spaceIr.generateSpaceImpulseResponse({
    size: 23,
    decay: 18,
    sampleRate: 48_000,
  });
  const changedDecay = spaceIr.generateSpaceImpulseResponse({
    size: 22,
    decay: 19,
    sampleRate: 48_000,
  });
  assert.notDeepEqual(changedSize.channels.map(digestChannel), baselineHashes);
  assert.notDeepEqual(changedDecay.channels.map(digestChannel), baselineHashes);
});

test("generator rejects non-normalized macros and invalid rates without poisoning later calls", () => {
  const invalidMacros = [undefined, null, -1, 101, 1.5, NaN, Infinity, "22", true, [], {}, 1n, Symbol("macro")];
  for (const value of invalidMacros) {
    assert.throws(() =>
      spaceIr.generateSpaceImpulseResponse({ size: value, decay: 18, sampleRate: 48_000 }),
    );
    assert.throws(() =>
      spaceIr.generateSpaceImpulseResponse({ size: 22, decay: value, sampleRate: 48_000 }),
    );
  }

  for (const sampleRate of [undefined, null, 0, -1, NaN, Infinity, -Infinity, "48000", true, [], {}]) {
    assert.throws(() =>
      spaceIr.generateSpaceImpulseResponse({ size: 22, decay: 18, sampleRate }),
    );
  }
  assert.throws(() => spaceIr.generateSpaceImpulseResponse());
  assert.throws(() =>
    spaceIr.generateSpaceImpulseResponse({ size: 22, decay: 18, sampleRate: Number.MIN_VALUE }),
  );

  const fractionalRate = spaceIr.generateSpaceImpulseResponse({
    size: 22,
    decay: 18,
    sampleRate: 48_000.25,
  });
  assert.equal(fractionalRate.sampleRate, 48_000.25);
  assert.ok(fractionalRate.channels.every((channel) => channel instanceof Float32Array));

  const canonical = spaceIr.generateSpaceImpulseResponse({
    size: 22,
    decay: 18,
    sampleRate: 48_000,
  });
  assert.equal(
    digestChannel(canonical.channels[0]),
    "7a8cfacf2df70455798f6ad1c74c381d8774ffe1e8f2ed1a8cd2427a7885483b",
  );
});

test("minimum, maximum, cap, duration, and raw allocation arithmetic stay bounded", () => {
  const minimum = spaceIr.generateSpaceImpulseResponse({ size: 0, decay: 0, sampleRate: 1 });
  assert.equal(minimum.frameCount, 3);
  assert.equal(minimum.durationSeconds, 3);
  assert.ok(minimum.channels.every(({ byteLength }) => byteLength === 12));

  const maximumCases = [
    [44_100, 88_200, 2],
    [48_000, 96_000, 2],
    [96_000, 192_000, 2],
    [192_000, 192_000, 1],
    [384_000, 192_000, 0.5],
  ];
  let cappedResult;
  for (const [sampleRate, frameCount, durationSeconds] of maximumCases) {
    const result = spaceIr.generateSpaceImpulseResponse({
      size: 100,
      decay: 100,
      sampleRate,
    });
    assert.equal(result.frameCount, frameCount);
    assert.equal(result.durationSeconds, durationSeconds);
    if (frameCount === 192_000) cappedResult = result;
  }

  const presetFramesAt192k = [
    [22, 18, 108_480],
    [68, 64, 192_000],
    [56, 42, 189_120],
    [82, 78, 192_000],
  ];
  for (const [size, decay, frameCount] of presetFramesAt192k) {
    assert.equal(
      spaceIr.generateSpaceImpulseResponse({ size, decay, sampleRate: 192_000 })
        .frameCount,
      frameCount,
    );
  }

  const stereoFloat32Bytes = cappedResult.channels.reduce(
    (total, channel) => total + channel.byteLength,
    0,
  );
  assert.equal(stereoFloat32Bytes, 1_536_000);
  assert.equal(stereoFloat32Bytes * 2, 3_072_000);
  const fourFloat64ScratchArrays = 192_000 * Float64Array.BYTES_PER_ELEMENT * 4;
  assert.equal(fourFloat64ScratchArrays, 6_144_000);
  assert.equal(stereoFloat32Bytes * 2 + fourFloat64ScratchArrays, 9_216_000);
  assert.equal(
    stereoFloat32Bytes * 3 + fourFloat64ScratchArrays,
    10_752_000,
  );
});
