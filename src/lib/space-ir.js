const SPACE_IR_VERSION = "space-ir-v1";
const MAX_FRAME_COUNT = 192_000;
const UINT32_RANGE = 4_294_967_296;
const SIGNED_UINT32_RANGE = 2_147_483_648;

function assertNormalizedMacro(name, value) {
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new RangeError(`${name} must be an integer from 0 through 100`);
  }
}

function assertSampleRate(sampleRate) {
  if (typeof sampleRate !== "number" || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError("sampleRate must be a finite positive number");
  }
}

function createChannelSeed(size, decay, sampleRate, channelIndex) {
  const source = `jam-with-music:space-ir-v1:${size}:${decay}:${Math.round(sampleRate)}:${channelIndex}`;
  let seed = 0x811c9dc5;

  for (let index = 0; index < source.length; index += 1) {
    seed = (seed ^ source.charCodeAt(index)) >>> 0;
    seed = Math.imul(seed, 0x01000193) >>> 0;
  }

  return seed === 0 ? 0x6d2b79f5 : seed;
}

function createUint32Generator(initialState) {
  let state = initialState;

  return () => {
    state = (state ^ (state << 13)) >>> 0;
    state = (state ^ (state >>> 17)) >>> 0;
    state = (state ^ (state << 5)) >>> 0;
    return state;
  };
}

function generateChannel({
  size,
  decay,
  sampleRate,
  channelIndex,
  frameCount,
  earlySpanMs,
  diffusionRiseMs,
  earlyTapCount,
  earlyResponseWeight,
}) {
  const samples = new Float64Array(frameCount);
  const weights = new Float64Array(frameCount);
  const nextUint32 = createUint32Generator(
    createChannelSeed(size, decay, sampleRate, channelIndex),
  );
  const tailScale = 4 / Math.sqrt(sampleRate);
  const attackFrames = Math.max(1, Math.round((sampleRate * diffusionRiseMs) / 1000));
  const fadeFrames = Math.min(frameCount, Math.max(2, Math.round(sampleRate * 0.01)));
  const fadeStart = frameCount - fadeFrames;

  for (let index = 0; index < frameCount; index += 1) {
    const envelope = Math.pow(0.001, index / (frameCount - 1));
    const terminalFade =
      index < fadeStart ? 1 : (frameCount - 1 - index) / (fadeFrames - 1);
    weights[index] = envelope * terminalFade;
    samples[index] =
      (nextUint32() / SIGNED_UINT32_RANGE - 1) *
      tailScale *
      envelope *
      Math.min(1, (index + 1) / attackFrames) *
      terminalFade;
  }

  for (let tap = 0; tap < earlyTapCount; tap += 1) {
    const jitterUnit = nextUint32() / UINT32_RANGE;
    const amplitudeUnit = nextUint32() / UINT32_RANGE;
    const signWord = nextUint32();
    const position = (tap + 1) / earlyTapCount;
    const baseSeconds =
      0.001 + (earlySpanMs / 1000 - 0.001) * position * position;
    const jitterSeconds = (jitterUnit - 0.5) * 0.0007;
    const tapSeconds = Math.min(
      earlySpanMs / 1000,
      Math.max(1 / sampleRate, baseSeconds + jitterSeconds),
    );
    const tapIndex = Math.min(
      frameCount - 2,
      Math.max(1, Math.round(sampleRate * tapSeconds)),
    );
    const tapAmplitude =
      earlyResponseWeight *
      (0.9 / Math.sqrt(earlyTapCount)) *
      (1 - 0.55 * position) *
      (0.85 + 0.3 * amplitudeUnit);
    const tapSign = (signWord & 1) === 1 ? 1 : -1;
    samples[tapIndex] += tapSign * tapAmplitude;
  }

  let sampleSum = 0;
  let weightSum = 0;
  for (let index = 0; index < frameCount; index += 1) {
    sampleSum += samples[index];
    weightSum += weights[index];
  }

  if (!Number.isFinite(sampleSum) || !Number.isFinite(weightSum) || weightSum === 0) {
    throw new RangeError("space impulse response produced invalid channel data");
  }

  const correction = sampleSum / weightSum;
  for (let index = 0; index < frameCount; index += 1) {
    samples[index] -= correction * weights[index];
  }

  let energy = 0;
  let peak = 0;
  for (let index = 0; index < frameCount; index += 1) {
    energy += samples[index] * samples[index];
    peak = Math.max(peak, Math.abs(samples[index]));
  }

  if (!Number.isFinite(energy) || energy <= 0 || !Number.isFinite(peak) || peak <= 0) {
    throw new RangeError("space impulse response produced invalid channel energy");
  }

  const rootEnergy = Math.sqrt(energy);
  const scale = Math.min(1 / rootEnergy, 0.95 / peak);
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new RangeError("space impulse response produced an invalid channel scale");
  }

  const channel = new Float32Array(frameCount);
  for (let index = 0; index < frameCount; index += 1) {
    const rounded = Math.fround(
      Math.min(0.95, Math.max(-0.95, samples[index] * scale)),
    );
    channel[index] = rounded === 0 ? 0 : rounded;
  }

  return channel;
}

export function generateSpaceImpulseResponse({ size, decay, sampleRate } = {}) {
  assertNormalizedMacro("size", size);
  assertNormalizedMacro("decay", decay);
  assertSampleRate(sampleRate);

  const earlySpanMs = Math.round(8 + 0.52 * size);
  const diffusionRiseMs = Math.round(4 + 0.16 * size);
  const earlyTapCount = 4 + Math.round(0.08 * size);
  const earlyResponsePercent = Math.round(20 + 0.65 * size);
  const earlyResponseWeight = earlyResponsePercent / 100;
  const irLengthMs = Math.round(250 + 17.5 * decay);
  const uncappedFrames = Math.round((sampleRate * irLengthMs) / 1000);
  const frameCount = Math.min(MAX_FRAME_COUNT, Math.max(3, uncappedFrames));
  const channelOptions = {
    size,
    decay,
    sampleRate,
    frameCount,
    earlySpanMs,
    diffusionRiseMs,
    earlyTapCount,
    earlyResponseWeight,
  };
  const leftFloat32 = generateChannel({ ...channelOptions, channelIndex: 0 });
  const rightFloat32 = generateChannel({ ...channelOptions, channelIndex: 1 });

  return {
    version: SPACE_IR_VERSION,
    size,
    decay,
    sampleRate,
    frameCount,
    durationSeconds: frameCount / sampleRate,
    channels: [leftFloat32, rightFloat32],
  };
}
