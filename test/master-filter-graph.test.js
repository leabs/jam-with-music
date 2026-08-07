import assert from "node:assert/strict";
import test from "node:test";

import {
  FILTER_DRIVE_CURVE_SAMPLE_COUNT,
  FILTER_DRIVE_MAX_PRE_GAIN,
  FILTER_MAX_Q,
  FILTER_MIN_Q,
  FILTER_PARAMETER_SMOOTHING_SECONDS,
  FILTER_TRANSPORT_FADE_SECONDS,
  FILTER_TRANSPORT_SETTLE_MILLISECONDS,
  createFilterDriveCurve,
  createMasterFilterGraph,
  mapFilterEffectStateToAudio,
} from "../src/lib/master-filter-graph.js";

const DEFAULT_STATE = {
  enabled: false,
  cutoff: 100,
  resonance: 0,
  drive: 0,
  mix: 100,
  preset: "clean",
};

function createAudioParam(initialValue, methods = {}) {
  const audioParam = {
    value: initialValue,
    cancelCalls: [],
    holdCalls: [],
    linearRampCalls: [],
    targetCalls: [],
    valueCalls: [],
  };

  if (methods.hold === true) {
    audioParam.cancelAndHoldAtTime = function (time) {
      this.holdCalls.push(time);
      if (methods.holdThrows) {
        throw new Error("cancel and hold failed");
      }
    };
  }
  if (methods.cancel !== false) {
    audioParam.cancelScheduledValues = function (time) {
      this.cancelCalls.push(time);
    };
  }
  if (methods.target !== false) {
    audioParam.setTargetAtTime = function (value, time, timeConstant) {
      this.value = value;
      this.targetCalls.push({ value, time, timeConstant });
    };
  }
  if (methods.ramp !== false) {
    audioParam.linearRampToValueAtTime = function (value, endTime) {
      this.value = value;
      this.linearRampCalls.push({ value, endTime });
    };
  }
  if (methods.value !== false) {
    audioParam.setValueAtTime = function (value, time) {
      if (methods.throwOnSetValue) {
        throw new Error("parameter initialization failed");
      }
      this.value = value;
      this.valueCalls.push({ value, time });
    };
  }

  return audioParam;
}

function createNode(kind, properties = {}, hooks = {}) {
  return {
    kind,
    connections: [],
    incoming: [],
    connectCalls: 0,
    disconnectCalls: 0,
    connect(destination) {
      if (hooks.beforeConnect) hooks.beforeConnect(this, destination);
      this.connectCalls += 1;
      this.connections.push(destination);
      destination.incoming.push(this);
      return destination;
    },
    disconnect() {
      this.disconnectCalls += 1;
      this.connections.forEach((destination) => {
        destination.incoming = destination.incoming.filter((node) => node !== this);
      });
      this.connections = [];
    },
    ...properties,
  };
}

function createFakeAudioContext(options = {}) {
  const paramMethods = options.paramMethods ?? {};
  const context = {
    currentTime: options.currentTime ?? 4.25,
    sampleRate: options.sampleRate ?? 48_000,
    state: options.state ?? "running",
    gains: [],
    filters: [],
    shapers: [],
    createdNodes: [],
    connectAttempts: 0,
    createGain() {
      if (options.throwOn === `gain-${this.gains.length + 1}`) {
        throw new Error("gain construction failed");
      }
      const node = this.createNode("gain", {
        gain: createAudioParam(1, paramMethods),
      });
      this.gains.push(node);
      this.createdNodes.push(node);
      return node;
    },
    createBiquadFilter() {
      if (options.throwOn === "biquad") {
        throw new Error("biquad construction failed");
      }
      const node = this.createNode("biquad", {
        type: "allpass",
        frequency: createAudioParam(350, paramMethods),
        Q: createAudioParam(1, paramMethods),
      });
      this.filters.push(node);
      this.createdNodes.push(node);
      return node;
    },
    createWaveShaper() {
      if (options.throwOn === "waveshaper") {
        throw new Error("waveshaper construction failed");
      }
      const node = this.createNode("waveshaper", {
        curve: null,
        oversample: "none",
      });
      this.shapers.push(node);
      this.createdNodes.push(node);
      return node;
    },
    createNode(kind, properties) {
      return createNode(kind, properties, {
        beforeConnect: () => {
          this.connectAttempts += 1;
          if (this.connectAttempts === options.throwOnConnectAttempt) {
            throw new Error("connection failed");
          }
        },
      });
    },
  };
  return context;
}

function createGraph(options = {}, initialState) {
  const audioContext = createFakeAudioContext(options);
  const protectionInput = createNode("master-protection-input");
  const graph = createMasterFilterGraph(audioContext, protectionInput, initialState);
  return { audioContext, graph, protectionInput };
}

function installFakeTimers(testContext) {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let nextTimerId = 1;
  const allTimers = new Map();
  const pendingTimers = new Map();

  globalThis.setTimeout = function (callback, delay) {
    const id = nextTimerId++;
    const timer = { callback, delay };
    allTimers.set(id, timer);
    pendingTimers.set(id, timer);
    return id;
  };
  globalThis.clearTimeout = function (id) {
    pendingTimers.delete(id);
  };

  testContext.after(() => {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  });

  return {
    allTimers,
    pendingTimers,
    latestTimerId() {
      return Math.max(...allTimers.keys());
    },
    run(id, options = {}) {
      const timer = allTimers.get(id);
      assert.ok(timer, `unknown fake timer: ${id}`);
      if (!options.allowCleared) {
        assert.equal(pendingTimers.has(id), true, `fake timer ${id} was cleared`);
      }
      pendingTimers.delete(id);
      timer.callback();
    },
  };
}

function graphAudioParams(graph) {
  return [
    graph.nodes.filter.frequency,
    graph.nodes.filter.Q,
    graph.nodes.cleanDriveGain.gain,
    graph.nodes.drivePreGain.gain,
    graph.nodes.drivenGain.gain,
    graph.nodes.dryGain.gain,
    graph.nodes.wetGain.gain,
  ];
}

function clearAutomationHistory(graph) {
  graphAudioParams(graph).forEach((audioParam) => {
    audioParam.cancelCalls.length = 0;
    audioParam.holdCalls.length = 0;
    audioParam.linearRampCalls.length = 0;
    audioParam.targetCalls.length = 0;
    audioParam.valueCalls.length = 0;
  });
}

function assertSingleConnection(source, destination) {
  assert.equal(source.connections.length, 1, source.kind);
  assert.equal(source.connections[0], destination, source.kind);
}

function assertTopology(graph, protectionInput) {
  const { nodes } = graph;
  assert.deepEqual(nodes.input.connections, [
    nodes.dryGain,
    nodes.cleanDriveGain,
    nodes.drivePreGain,
  ]);
  assertSingleConnection(nodes.dryGain, nodes.output);
  assertSingleConnection(nodes.cleanDriveGain, nodes.filter);
  assertSingleConnection(nodes.drivePreGain, nodes.driveShaper);
  assertSingleConnection(nodes.driveShaper, nodes.drivenGain);
  assertSingleConnection(nodes.drivenGain, nodes.filter);
  assertSingleConnection(nodes.filter, nodes.wetGain);
  assertSingleConnection(nodes.wetGain, nodes.output);
  assertSingleConnection(nodes.output, protectionInput);
  assert.deepEqual(protectionInput.incoming, [nodes.output]);

  Object.values(nodes)
    .filter((node) => node !== nodes.output)
    .forEach((node) => {
      assert.equal(node.connections.includes(protectionInput), false, node.kind);
    });
}

test("master Filter graph has one persistent dry/driven-low-pass topology upstream of protection", () => {
  const { audioContext, graph, protectionInput } = createGraph();

  assert.equal(audioContext.gains.length, 7);
  assert.equal(audioContext.filters.length, 1);
  assert.equal(audioContext.shapers.length, 1);
  assert.equal(graph.input, graph.nodes.input);
  assert.equal(graph.output, graph.nodes.output);
  assert.equal(Object.isFrozen(graph.nodes), true);
  assertTopology(graph, protectionInput);

  assert.equal(graph.nodes.filter.type, "lowpass");
  assert.equal(graph.nodes.driveShaper.oversample, "2x");
  assert.equal(
    graph.nodes.driveShaper.curve.length,
    FILTER_DRIVE_CURVE_SAMPLE_COUNT,
  );
});

test("default and bypassed state are neutral dry-only without discarding macro state", () => {
  const { graph } = createGraph();

  assert.deepEqual(graph.getState(), DEFAULT_STATE);
  assert.equal(graph.nodes.dryGain.gain.value, 1);
  assert.equal(graph.nodes.wetGain.gain.value, 0);
  assert.equal(graph.nodes.cleanDriveGain.gain.value, 1);
  assert.equal(graph.nodes.drivePreGain.gain.value, 1);
  assert.equal(graph.nodes.drivenGain.gain.value, 0);
  assert.equal(graph.nodes.filter.frequency.value, 18_000);
  assert.equal(graph.nodes.filter.Q.value, FILTER_MIN_Q);

  const bypassed = graph.applyState(
    {
      enabled: false,
      cutoff: 45,
      resonance: 64,
      drive: 68,
      mix: 72,
      preset: "custom",
    },
    { immediate: true },
  );

  assert.equal(bypassed.dryGain, 1);
  assert.equal(bypassed.wetGain, 0);
  assert.deepEqual(graph.getState(), bypassed.state);
  assert.equal(graph.getState().cutoff, 45);
  assert.equal(graph.getState().drive, 68);
  assert.notEqual(graph.nodes.filter.frequency.value, 18_000);
});

test("returned mapping state cannot mutate the graph's internal canonical state", () => {
  const { graph } = createGraph();
  const applied = graph.applyState({
    enabled: true,
    cutoff: 68,
    resonance: 18,
    drive: 14,
    mix: 78,
    preset: "warm",
  });
  const expectedState = { ...applied.state };
  const expectedFrequency = graph.nodes.filter.frequency.value;
  const expectedDryGain = graph.nodes.dryGain.gain.value;

  applied.state.enabled = false;
  applied.state.cutoff = 0;
  applied.state.mix = 0;

  assert.deepEqual(graph.getState(), expectedState);
  assert.equal(graph.nodes.filter.frequency.value, expectedFrequency);
  assert.equal(graph.nodes.dryGain.gain.value, expectedDryGain);
});

test("state mapping clamps parameters and uses the frozen linear dry/wet law", () => {
  const minimum = mapFilterEffectStateToAudio({
    enabled: true,
    cutoff: -100,
    resonance: -100,
    drive: -100,
    mix: -100,
    preset: "custom",
  });
  assert.equal(minimum.cutoffFrequencyHz, 80);
  assert.equal(minimum.resonanceQ, FILTER_MIN_Q);
  assert.equal(minimum.cleanDriveGain, 1);
  assert.equal(minimum.drivePreGain, 1);
  assert.equal(minimum.drivenGain, 0);
  assert.equal(minimum.dryGain, 1);
  assert.equal(minimum.wetGain, 0);

  const midpoint = mapFilterEffectStateToAudio({
    enabled: true,
    cutoff: 50,
    resonance: 50,
    drive: 50,
    mix: 50,
    preset: "custom",
  });
  assert.equal(midpoint.dryGain, 0.5);
  assert.equal(midpoint.wetGain, 0.5);
  assert.ok(midpoint.cutoffFrequencyHz >= 80);
  assert.ok(midpoint.cutoffFrequencyHz <= 18_000);
  assert.ok(midpoint.resonanceQ >= FILTER_MIN_Q);
  assert.ok(midpoint.resonanceQ <= FILTER_MAX_Q);

  const maximum = mapFilterEffectStateToAudio({
    enabled: true,
    cutoff: 1_000,
    resonance: 1_000,
    drive: 1_000,
    mix: 1_000,
    preset: "custom",
  });
  assert.equal(maximum.cutoffFrequencyHz, 18_000);
  assert.equal(maximum.resonanceQ, FILTER_MAX_Q);
  assert.equal(maximum.cleanDriveGain, 0);
  assert.equal(maximum.drivePreGain, FILTER_DRIVE_MAX_PRE_GAIN);
  assert.equal(maximum.drivenGain, 1 / 4.5);
  assert.equal(maximum.dryGain, 0);
  assert.equal(maximum.wetGain, 1);

  const lowSampleRate = mapFilterEffectStateToAudio(
    { ...maximum.state, cutoff: 100 },
    8_000,
  );
  assert.equal(lowSampleRate.cutoffFrequencyHz, 3_600);

  for (const values of [minimum, midpoint, maximum, lowSampleRate]) {
    for (const value of [
      values.cutoffFrequencyHz,
      values.resonanceQ,
      values.cleanDriveGain,
      values.drivePreGain,
      values.drivenGain,
      values.dryGain,
      values.wetGain,
    ]) {
      assert.equal(Number.isFinite(value), true);
    }
  }
});

test("invalid sample rates still produce a finite, bounded cutoff", () => {
  const results = [Number.NaN, "not-a-rate"].map((sampleRate) =>
    mapFilterEffectStateToAudio(
      {
        enabled: true,
        cutoff: 100,
        resonance: 0,
        drive: 0,
        mix: 100,
        preset: "clean",
      },
      sampleRate,
    ).cutoffFrequencyHz,
  );

  assert.deepEqual(
    results.map((value) => Number.isFinite(value) && value >= 80 && value <= 18_000),
    [true, true],
  );
});

test("runtime updates cancel stale automation and smooth all seven parameters over 15 ms", () => {
  const { audioContext, graph } = createGraph({ currentTime: 12.5 });
  clearAutomationHistory(graph);

  const mapped = graph.applyState({
    enabled: true,
    cutoff: 68,
    resonance: 18,
    drive: 14,
    mix: 78,
    preset: "warm",
  });
  const expectedValues = [
    mapped.cutoffFrequencyHz,
    mapped.resonanceQ,
    mapped.cleanDriveGain,
    mapped.drivePreGain,
    mapped.drivenGain,
    mapped.dryGain,
    mapped.wetGain,
  ];

  graphAudioParams(graph).forEach((audioParam, index) => {
    assert.deepEqual(audioParam.cancelCalls, [12.5]);
    assert.deepEqual(audioParam.targetCalls, [
      {
        value: expectedValues[index],
        time: 12.5,
        timeConstant: FILTER_PARAMETER_SMOOTHING_SECONDS,
      },
    ]);
    assert.deepEqual(audioParam.valueCalls, []);
  });
  assert.equal(FILTER_PARAMETER_SMOOTHING_SECONDS, 0.015);

  audioContext.currentTime = 13;
  graph.applyState({ ...mapped.state, mix: 15, preset: "custom" });
  graphAudioParams(graph).forEach((audioParam) => {
    assert.deepEqual(audioParam.cancelCalls, [12.5, 13]);
    assert.equal(audioParam.targetCalls.length, 2);
    assert.equal(audioParam.targetCalls[1].time, 13);
    assert.equal(audioParam.targetCalls[1].timeConstant, 0.015);
  });
});

test("initialization is immediate and runtime updates fall back through supported AudioParam APIs", () => {
  const withValueSetter = createGraph({
    currentTime: Number.NaN,
    state: "suspended",
    paramMethods: { target: false },
  });
  const valueParams = graphAudioParams(withValueSetter.graph);
  valueParams.forEach((audioParam) => {
    assert.equal(audioParam.targetCalls.length, 0);
    assert.deepEqual(audioParam.valueCalls.map((call) => call.time), [0]);
  });

  clearAutomationHistory(withValueSetter.graph);
  withValueSetter.graph.applyState({
    enabled: true,
    cutoff: 50,
    resonance: 50,
    drive: 50,
    mix: 50,
    preset: "custom",
  });
  valueParams.forEach((audioParam) => {
    assert.deepEqual(audioParam.cancelCalls, [0]);
    assert.equal(audioParam.valueCalls.length, 1);
    assert.equal(audioParam.valueCalls[0].time, 0);
  });

  const directValue = createGraph({
    paramMethods: { cancel: false, target: false, value: false },
  });
  const applied = directValue.graph.applyState({
    enabled: true,
    cutoff: 0,
    resonance: 100,
    drive: 100,
    mix: 25,
    preset: "custom",
  });
  assert.equal(directValue.graph.nodes.filter.frequency.value, applied.cutoffFrequencyHz);
  assert.equal(directValue.graph.nodes.filter.Q.value, applied.resonanceQ);
  assert.equal(directValue.graph.nodes.dryGain.gain.value, 0.75);
  assert.equal(directValue.graph.nodes.wetGain.gain.value, 0.25);
});

test("cancel-and-hold is preferred for smoothing and safely falls back when unsupported", () => {
  const preferred = createGraph({
    currentTime: 7,
    paramMethods: { hold: true },
  });
  clearAutomationHistory(preferred.graph);
  preferred.graph.applyState({ ...DEFAULT_STATE, enabled: true });
  graphAudioParams(preferred.graph).forEach((audioParam) => {
    assert.deepEqual(audioParam.holdCalls, [7]);
    assert.deepEqual(audioParam.cancelCalls, []);
    assert.equal(audioParam.targetCalls.length, 1);
  });

  const throwingHold = createGraph({
    currentTime: 8,
    paramMethods: { hold: true, holdThrows: true },
  });
  clearAutomationHistory(throwingHold.graph);
  throwingHold.graph.applyState({ ...DEFAULT_STATE, enabled: true });
  graphAudioParams(throwingHold.graph).forEach((audioParam) => {
    assert.deepEqual(audioParam.holdCalls, [8]);
    assert.deepEqual(audioParam.cancelCalls, [8]);
    assert.equal(audioParam.targetCalls.length, 1);
  });
});

test("running silence tracks a 10 ms close before replacing nodes and waking", async (testContext) => {
  const timers = installFakeTimers(testContext);
  const { audioContext, graph, protectionInput } = createGraph({
    currentTime: 9,
    state: "running",
  });
  const oldFilter = graph.nodes.filter;
  const oldDriveShaper = graph.nodes.driveShaper;
  const outputGain = graph.nodes.output.gain;
  outputGain.cancelCalls.length = 0;
  outputGain.holdCalls.length = 0;
  outputGain.linearRampCalls.length = 0;
  outputGain.targetCalls.length = 0;
  outputGain.valueCalls.length = 0;

  const closePromise = graph.silence();
  let trackedCloseResult = "pending";
  void closePromise.then((result) => {
    trackedCloseResult = result;
  });
  await Promise.resolve();

  assert.equal(FILTER_TRANSPORT_FADE_SECONDS, 0.01);
  assert.equal(FILTER_TRANSPORT_SETTLE_MILLISECONDS, 20);
  assert.equal(closePromise instanceof Promise, true);
  assert.equal(trackedCloseResult, "pending");
  assert.deepEqual(graph.getTransportState(), {
    closed: false,
    needsReset: true,
    closePending: true,
    generation: 1,
  });
  assert.deepEqual(outputGain.cancelCalls, [9]);
  assert.deepEqual(outputGain.valueCalls, [{ value: 1, time: 9 }]);
  assert.deepEqual(outputGain.linearRampCalls, [{ value: 0, endTime: 9.01 }]);
  assert.deepEqual(outputGain.targetCalls, []);
  assert.equal(timers.pendingTimers.size, 1);
  const closeTimerId = timers.latestTimerId();
  assert.equal(timers.pendingTimers.get(closeTimerId).delay, 20);
  assert.equal(graph.nodes.filter, oldFilter);
  assert.equal(graph.nodes.driveShaper, oldDriveShaper);
  assert.equal(audioContext.filters.length, 1);
  assert.equal(audioContext.shapers.length, 1);
  assertTopology(graph, protectionInput);

  audioContext.currentTime = 9.02;
  timers.run(closeTimerId);
  assert.equal(await closePromise, true);
  assert.equal(trackedCloseResult, true);
  assert.equal(outputGain.value, 0);
  assert.deepEqual(outputGain.valueCalls.at(-1), { value: 0, time: 9.02 });
  assert.deepEqual(graph.getTransportState(), {
    closed: true,
    needsReset: true,
    closePending: false,
    generation: 1,
  });
  assert.equal(graph.nodes.filter, oldFilter);
  assert.equal(graph.nodes.driveShaper, oldDriveShaper);

  audioContext.currentTime = 9.03;
  const wakePromise = graph.wake();
  assert.equal(wakePromise instanceof Promise, true);
  assert.equal(graph.nodes.filter, oldFilter);
  assert.equal(graph.nodes.driveShaper, oldDriveShaper);
  assert.equal(await wakePromise, true);
  assert.notEqual(graph.nodes.filter, oldFilter);
  assert.notEqual(graph.nodes.driveShaper, oldDriveShaper);
  assert.equal(audioContext.filters.length, 2);
  assert.equal(audioContext.shapers.length, 2);
  assert.equal(oldFilter.connections.length, 0);
  assert.equal(oldDriveShaper.connections.length, 0);
  assert.equal(outputGain.value, 1);
  assert.deepEqual(graph.getTransportState(), {
    closed: false,
    needsReset: false,
    closePending: false,
    generation: 2,
  });
  assertTopology(graph, protectionInput);

  audioContext.currentTime = 10;
  const staleClose = graph.silence();
  const staleTimerId = timers.latestTimerId();
  const staleWake = graph.wake();
  audioContext.currentTime = 10.1;
  const currentClose = graph.silence();
  const currentTimerId = timers.latestTimerId();
  assert.notEqual(currentTimerId, staleTimerId);
  assert.equal(await staleClose, false);
  assert.equal(await staleWake, false);

  timers.run(staleTimerId, { allowCleared: true });
  assert.equal(graph.getTransportState().closed, false);
  const currentWake = graph.wake();
  audioContext.currentTime = 10.12;
  timers.run(currentTimerId);
  assert.equal(await currentClose, true);
  assert.equal(await currentWake, true);
  assert.equal(outputGain.value, 1);
  assert.equal(graph.getTransportState().closed, false);

  timers.run(currentTimerId, { allowCleared: true });
  assert.equal(outputGain.value, 1);
  assert.equal(graph.getTransportState().closed, false);
  assertTopology(graph, protectionInput);
});

test("non-running silence closes immediately and replaces nodes only after wake", async () => {
  for (const state of ["suspended", "interrupted", "closed"]) {
    const { audioContext, graph, protectionInput } = createGraph({
      currentTime: 11,
      state,
    });
    const oldFilter = graph.nodes.filter;
    const oldDriveShaper = graph.nodes.driveShaper;
    const outputGain = graph.nodes.output.gain;
    outputGain.cancelCalls.length = 0;
    outputGain.linearRampCalls.length = 0;
    outputGain.targetCalls.length = 0;
    outputGain.valueCalls.length = 0;

    const closePromise = graph.silence();

    assert.equal(closePromise instanceof Promise, true, state);
    assert.equal(await closePromise, true, state);
    assert.deepEqual(outputGain.targetCalls, [], state);
    assert.deepEqual(outputGain.valueCalls, [{ value: 0, time: 11 }], state);
    assert.deepEqual(outputGain.linearRampCalls, [], state);
    assert.equal(outputGain.value, 0, state);
    assert.deepEqual(
      graph.getTransportState(),
      {
        closed: true,
        needsReset: true,
        closePending: false,
        generation: 1,
      },
      state,
    );
    assert.equal(graph.nodes.filter, oldFilter, state);
    assert.equal(graph.nodes.driveShaper, oldDriveShaper, state);
    assert.equal(audioContext.filters.length, 1, state);
    assert.equal(audioContext.shapers.length, 1, state);
    assertTopology(graph, protectionInput);

    audioContext.state = "running";
    assert.equal(await graph.wake(), true, state);
    assert.notEqual(graph.nodes.filter, oldFilter, state);
    assert.notEqual(graph.nodes.driveShaper, oldDriveShaper, state);
    assert.equal(audioContext.filters.length, 2, state);
    assert.equal(audioContext.shapers.length, 2, state);
    assert.equal(oldFilter.connections.length, 0, state);
    assert.equal(oldDriveShaper.connections.length, 0, state);
    assert.equal(outputGain.value, 1, state);
    assertTopology(graph, protectionInput);
  }
});

test("wet-path reset failures stay closed, dry-only, protected, and recoverable", async () => {
  for (const failingFactory of ["createWaveShaper", "createBiquadFilter"]) {
    const { audioContext, graph, protectionInput } = createGraph({
      currentTime: 12,
      state: "running",
    });
    const originalFactory = audioContext[failingFactory].bind(audioContext);
    const previousFilter = graph.nodes.filter;
    const previousDriveShaper = graph.nodes.driveShaper;
    let shouldFail = true;
    audioContext[failingFactory] = function () {
      if (shouldFail) {
        shouldFail = false;
        throw new Error(`${failingFactory} replacement failed`);
      }
      return originalFactory();
    };

    assert.equal(await graph.silence({ immediate: true }), true, failingFactory);
    assert.equal(graph.getTransportState().closed, true, failingFactory);
    assert.equal(await graph.wake(), false, failingFactory);
    assert.equal(graph.getTransportState().closed, true, failingFactory);
    assert.equal(graph.getTransportState().needsReset, true, failingFactory);
    assert.equal(graph.nodes.output.gain.value, 0, failingFactory);
    assert.equal(previousFilter.connections.length, 0, failingFactory);
    assert.equal(previousDriveShaper.connections.length, 0, failingFactory);
    assert.equal(graph.nodes.cleanDriveGain.connections.length, 0, failingFactory);
    assert.equal(graph.nodes.drivePreGain.connections.length, 0, failingFactory);
    assert.equal(graph.nodes.drivenGain.connections.length, 0, failingFactory);
    assert.equal(graph.nodes.dryGain.gain.value, 1, failingFactory);
    assert.equal(graph.nodes.wetGain.gain.value, 0, failingFactory);
    assertSingleConnection(graph.nodes.dryGain, graph.nodes.output);
    assertSingleConnection(graph.nodes.output, protectionInput);

    const unavailableMapping = graph.applyState(
      {
        enabled: true,
        cutoff: 45,
        resonance: 64,
        drive: 68,
        mix: 100,
        preset: "custom",
      },
      { immediate: true },
    );
    assert.equal(unavailableMapping.dryGain, 1, failingFactory);
    assert.equal(unavailableMapping.wetGain, 0, failingFactory);
    assert.equal(graph.getState().enabled, true, failingFactory);

    assert.equal(await graph.wake(), true, failingFactory);
    assert.equal(graph.nodes.output.gain.value, 1, failingFactory);
    assert.equal(graph.getTransportState().closed, false, failingFactory);
    assertTopology(graph, protectionInput);
  }
});

test("thirty tracked silence and wake cycles retain one active protected topology", async (testContext) => {
  const timers = installFakeTimers(testContext);
  const { audioContext, graph, protectionInput } = createGraph({
    currentTime: 20,
    state: "running",
  });

  for (let index = 0; index < 30; index++) {
    audioContext.currentTime += 0.1;
    const closePromise = graph.silence();
    const timerId = timers.latestTimerId();
    assert.equal(timers.pendingTimers.get(timerId).delay, 20);
    audioContext.currentTime += 0.02;
    timers.run(timerId);
    assert.equal(await closePromise, true);
    assert.equal(graph.getTransportState().closed, true);
    assert.equal(await graph.wake(), true);
    assert.equal(graph.getTransportState().closed, false);
    assertTopology(graph, protectionInput);
  }

  assert.equal(timers.pendingTimers.size, 0);
  assert.equal(audioContext.filters.length, 31);
  assert.equal(audioContext.shapers.length, 31);
  audioContext.filters.slice(0, -1).forEach((filter) => {
    assert.equal(filter.connections.length, 0);
  });
  audioContext.shapers.slice(0, -1).forEach((shaper) => {
    assert.equal(shaper.connections.length, 0);
  });
  assert.equal(
    audioContext.filters.filter((filter) => filter.connections.length > 0).length,
    1,
  );
  assert.equal(
    audioContext.shapers.filter((shaper) => shaper.connections.length > 0).length,
    1,
  );
  assert.equal(graph.nodes.filter, audioContext.filters.at(-1));
  assert.equal(graph.nodes.driveShaper, audioContext.shapers.at(-1));
  assertSingleConnection(graph.nodes.cleanDriveGain, graph.nodes.filter);
  assertSingleConnection(graph.nodes.drivePreGain, graph.nodes.driveShaper);
  assertSingleConnection(graph.nodes.driveShaper, graph.nodes.drivenGain);
  assertSingleConnection(graph.nodes.drivenGain, graph.nodes.filter);
  assertSingleConnection(graph.nodes.filter, graph.nodes.wetGain);
  assertSingleConnection(graph.nodes.output, protectionInput);
});

test("rapid malformed updates and bypass toggles reuse the same nodes and connections", () => {
  const { audioContext, graph, protectionInput } = createGraph();
  const nodeReferences = [...audioContext.createdNodes];
  const creationCounts = {
    gains: audioContext.gains.length,
    filters: audioContext.filters.length,
    shapers: audioContext.shapers.length,
  };

  for (let index = 0; index < 1_000; index++) {
    graph.applyState({
      enabled: index % 2 === 0,
      cutoff: index % 3 === 0 ? -1_000 : index % 3 === 1 ? 1_000 : Number.NaN,
      resonance: index % 2 === 0 ? -Infinity : 1_000,
      drive: index % 4 === 0 ? true : index * 0.75,
      mix: index % 5 === 0 ? [] : 100 - (index % 101),
      preset: "custom",
    });
  }
  for (let index = 0; index < 101; index++) {
    graph.applyState({
      enabled: index % 2 === 0,
      cutoff: 60,
      resonance: 28,
      drive: 68,
      mix: 76,
      preset: "custom",
    });
  }

  assert.deepEqual(
    {
      gains: audioContext.gains.length,
      filters: audioContext.filters.length,
      shapers: audioContext.shapers.length,
    },
    creationCounts,
  );
  assert.deepEqual(audioContext.createdNodes, nodeReferences);
  assertTopology(graph, protectionInput);
  assert.deepEqual(graph.getState(), {
    enabled: true,
    cutoff: 60,
    resonance: 28,
    drive: 68,
    mix: 76,
    preset: "custom",
  });
  graphAudioParams(graph).forEach((audioParam) => {
    assert.equal(Number.isFinite(audioParam.value), true);
  });
});

test("drive curve is fixed, finite, bounded, monotonic, and approximately odd-symmetric", () => {
  const curve = createFilterDriveCurve();

  assert.equal(curve.length, FILTER_DRIVE_CURVE_SAMPLE_COUNT);
  assert.equal(curve[0], -1);
  assert.equal(curve[curve.length - 1], 1);
  for (let index = 0; index < curve.length; index++) {
    assert.equal(Number.isFinite(curve[index]), true, String(index));
    assert.ok(curve[index] >= -1 && curve[index] <= 1, String(index));
    if (index > 0) {
      assert.ok(curve[index] >= curve[index - 1], String(index));
    }
    const mirrorIndex = curve.length - 1 - index;
    assert.ok(Math.abs(curve[index] + curve[mirrorIndex]) < 1e-6, String(index));
  }
  assert.ok(Math.abs(curve[curve.length / 2]) < 0.01);
});

test("invalid drive-curve counts fall back to the complete safe default curve", () => {
  const summaries = [0, 1, -1, 1.5, 65_537, Number.NaN, Infinity].map((sampleCount) => {
    const curve = createFilterDriveCurve(sampleCount);
    return {
      sampleCount,
      length: curve.length,
      first: curve[0],
      last: curve[curve.length - 1],
      allFinite: curve.every(Number.isFinite),
    };
  });

  assert.deepEqual(
    summaries,
    summaries.map(({ sampleCount }) => ({
      sampleCount,
      length: FILTER_DRIVE_CURVE_SAMPLE_COUNT,
      first: -1,
      last: 1,
      allFinite: true,
    })),
  );
});

test("node construction failures fail closed before any partial path reaches protection", () => {
  assert.throws(
    () => createMasterFilterGraph({}, createNode("destination")),
    /requires Gain, BiquadFilter, and WaveShaper nodes/,
  );

  for (const throwOn of ["waveshaper", "biquad", "gain-7"]) {
    const audioContext = createFakeAudioContext({ throwOn });
    const protectionInput = createNode("master-protection-input");
    assert.throws(
      () => createMasterFilterGraph(audioContext, protectionInput),
      /construction failed/,
      throwOn,
    );
    assert.equal(protectionInput.incoming.length, 0, throwOn);
    audioContext.createdNodes.forEach((node) => {
      assert.equal(node.connections.length, 0, throwOn);
    });
  }
});

test("connection failure transactionally disconnects every partially wired node", () => {
  const audioContext = createFakeAudioContext({ throwOnConnectAttempt: 6 });
  const protectionInput = createNode("master-protection-input");

  assert.throws(
    () => createMasterFilterGraph(audioContext, protectionInput),
    /connection failed/,
  );
  assert.equal(protectionInput.incoming.length, 0);
  audioContext.createdNodes.forEach((node) => {
    assert.equal(node.connections.length, 0, node.kind);
    assert.equal(node.disconnectCalls, 1, node.kind);
  });
});

test("initial parameter failure removes the completed route to master protection", () => {
  const audioContext = createFakeAudioContext({
    paramMethods: { throwOnSetValue: true },
  });
  const protectionInput = createNode("master-protection-input");

  assert.throws(
    () => createMasterFilterGraph(audioContext, protectionInput),
    /parameter initialization failed/,
  );
  assert.equal(protectionInput.incoming.length, 0);
  audioContext.createdNodes.forEach((node) => {
    assert.equal(node.connections.length, 0, node.kind);
    assert.equal(node.disconnectCalls, 1, node.kind);
  });
});

test("disconnect tears down every persistent node once and rejects later updates", () => {
  const { audioContext, graph, protectionInput } = createGraph();
  graph.disconnect();

  audioContext.createdNodes.forEach((node) => {
    assert.equal(node.disconnectCalls, 1, node.kind);
    assert.equal(node.connections.length, 0, node.kind);
  });
  assert.equal(protectionInput.incoming.length, 0);
  assert.throws(
    () => graph.applyState(DEFAULT_STATE),
    /Cannot update a disconnected Filter effect graph/,
  );

  graph.disconnect();
  audioContext.createdNodes.forEach((node) => {
    assert.equal(node.disconnectCalls, 1, node.kind);
  });
});
