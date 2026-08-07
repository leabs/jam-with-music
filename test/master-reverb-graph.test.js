import assert from "node:assert/strict";
import test from "node:test";
import { createMasterReverbGraph, SPACE_BANK_SWAP_CURVE_POINTS } from "../src/lib/master-reverb-graph.js";
import { createAudioNode, createMasterEffectsAudioFake } from "./support/master-effects-audio-fake.js";

const state = (changes = {}) => ({ enabled: true, size: 22, decay: 18, air: 34,
  mix: 24, preset: "pocket-room", ...changes });
function setup(options = {}, initialState = state()) {
  const fake = createMasterEffectsAudioFake(options);
  const destination = createAudioNode("destination");
  let calls = 0;
  const graph = createMasterReverbGraph(fake.context, destination, initialState, {
    queueMicrotask: fake.queueMicrotask, setTimeout: fake.setTimeout, clearTimeout: fake.clearTimeout,
    generateImpulse({ sampleRate }) {
      calls += 1;
      return { frameCount: 8, sampleRate, channels: [new Float32Array(8), new Float32Array(8)] };
    },
  });
  return { fake, graph, destination, get calls() { return calls; } };
}

test("implements the exact public contract and a fed normalized stereo wet bank", () => {
  const sample = setup(); sample.fake.flushMicrotasks();
  assert.deepEqual(Object.keys(sample.graph), ["input", "output", "nodes", "applyState",
    "markTailResetNeeded", "resetWetPath", "wake", "disconnect", "getState", "getLifecycleState"]);
  const bank = sample.graph.nodes.currentBank;
  assert.equal(bank.convolver.normalize, false);
  assert.equal(bank.convolver.buffer.numberOfChannels, 2);
  assert.ok(bank.delay.incoming.includes(sample.graph.input));
  assert.deepEqual(bank.delay.connections, [bank.convolver]);
});

for (const operation of ["cancel", "value"]) {
  test(`initial bank activation ${operation} failure leaves no unowned wet bank`, () => {
    const sample = setup();
    let writes = 0;
    sample.fake.controls.hit = label => {
      if (label === `gain.${operation}` && ++writes === 2) throw new Error(`initial-${operation}`);
    };
    sample.fake.flushMicrotasks();
    assert.equal(sample.graph.getLifecycleState().bankCount, 0);
    assert.equal(sample.graph.getLifecycleState().blockedBankCount, 0);
    assert.deepEqual(sample.graph.input.connections, [sample.graph.nodes.dryGain]);
    const convolvers = sample.fake.context.nodes.filter(node => node.kind === "convolver");
    assert.ok(convolvers.every(node => node.buffer === null && node.incoming.length === 0 && node.connections.length === 0));
  });
}

for (const [failureLabel, occurrence = 1] of [
  ["createDelay"], ["createConvolver"], ["createBuffer"], ["buffer.copy0"], ["buffer.copy1"],
  ["convolver.buffer"], ["createBiquadFilter"], ["createGain"],
  ["delayTime.value"], ["frequency.value"], ["Q.value"], ["gain.value"],
  ["delayTime.cancel"], ["frequency.cancel"], ["Q.cancel"], ["gain.cancel"],
  ["delay.connect"], ["convolver.connect"], ["biquad.connect"], ["gain.connect"], ["gain.connect", 2],
]) {
  test(`strict native cleanup handles pre-inlet ${failureLabel} failure ${occurrence}`, () => {
    const sample = setup({ strictTargetDisconnect: true }); let seen = 0;
    sample.fake.controls.hit = label => {
      if (label === failureLabel && ++seen === occurrence) throw new Error(`injected:${failureLabel}`);
    };
    sample.fake.flushMicrotasks();
    assert.equal(sample.graph.getLifecycleState().blockedBankCount, 0);
    assert.deepEqual(sample.graph.input.connections, [sample.graph.nodes.dryGain]);
    assert.ok(sample.fake.context.nodes.filter(node => node.kind === "convolver")
      .every(node => node.buffer === null && node.incoming.length === 0 && node.connections.length === 0));
    sample.fake.controls.hit = () => {};
    sample.graph.disconnect(); sample.graph.disconnect();
    assert.equal(sample.graph.input, null);
  });
}

test("maps low-rate Air Q and exact Mix endpoints without allocating", async () => {
  const sample = setup({ sampleRate: 8000 }); sample.fake.flushMicrotasks(); const before = sample.calls;
  await sample.graph.applyState(state({ air: 100, mix: 100 }));
  const bank = sample.graph.nodes.currentBank;
  assert.equal(bank.filter.frequency.value, 3600);
  assert.equal(bank.filter.Q.value, Math.SQRT1_2);
  assert.equal(sample.graph.nodes.dryGain.gain.value, 0);
  assert.equal(sample.graph.nodes.wetGain.gain.value, 1);
  await sample.graph.applyState(state({ enabled: false, mix: 0 }));
  assert.equal(sample.graph.nodes.dryGain.gain.value, 1);
  assert.equal(sample.graph.nodes.wetGain.gain.value, 0);
  assert.equal(sample.calls, before);
});

test("G09 holds one currentTime and exact 15ms targets for every allocation-free Space parameter", async () => {
  const sample = setup({}, state({ size: 73 })); sample.fake.flushMicrotasks();
  let currentTimeReads = 0;
  Object.defineProperty(sample.fake.context, "currentTime", {
    configurable: true,
    get() { currentTimeReads += 1; return 7.25; },
  });
  const params = [sample.graph.nodes.dryGain.gain, sample.graph.nodes.wetGain.gain,
    sample.graph.nodes.currentBank.delay.delayTime, sample.graph.nodes.currentBank.filter.frequency,
    sample.graph.nodes.currentBank.filter.Q];
  params.forEach(param => { param.events.length = 0; });
  const applied = sample.graph.applyState(state({ size: 73, air: 81, mix: 63 }));
  sample.fake.flushMicrotasks();
  assert.equal(await applied, "applied");
  const expected = [Math.cos(0.63 * Math.PI * 0.5), Math.sin(0.63 * Math.PI * 0.5),
    0.022, 1200 * Math.pow(16000 / 1200, 0.81), Math.SQRT1_2];
  assert.equal(currentTimeReads, 1);
  for (const [index, param] of params.entries()) {
    assert.deepEqual(param.events.map(event => event[0]), ["hold", "target"]);
    assert.equal(param.events[0][1], 7.25);
    assert.equal(param.events[1][2], 7.25);
    assert.equal(param.events[1][3], 0.015);
    assert.equal(param.events[1][1], expected[index]);
    assert.equal(param.events.some(event => event[0] === "cancel"), false);
  }
});

test("G09 binds bypass setup to exact dry-only payloads with one currentTime read", async () => {
  const sample = setup(); sample.fake.flushMicrotasks();
  let currentTimeReads = 0;
  Object.defineProperty(sample.fake.context, "currentTime", {
    configurable: true,
    get() { currentTimeReads += 1; return 4.75; },
  });
  const params = [sample.graph.nodes.dryGain.gain, sample.graph.nodes.wetGain.gain,
    sample.graph.nodes.currentBank.delay.delayTime, sample.graph.nodes.currentBank.filter.frequency,
    sample.graph.nodes.currentBank.filter.Q];
  params.forEach(param => { param.events.length = 0; });
  assert.equal(await sample.graph.applyState(state({ enabled: false })), "applied");
  assert.equal(currentTimeReads, 1);
  const expected = [1, 0, 0.008, 1200 * Math.pow(16000 / 1200, 0.34), Math.SQRT1_2];
  params.forEach((param, index) => assert.deepEqual(param.events, [
    ["hold", 4.75], ["target", expected[index], 4.75, 0.015],
  ]));
});

test("G09 falls back from hold to cancel and from target to value without double scheduling", async () => {
  const sample = setup(); sample.fake.flushMicrotasks();
  const params = [sample.graph.nodes.dryGain.gain, sample.graph.nodes.wetGain.gain,
    sample.graph.nodes.currentBank.delay.delayTime, sample.graph.nodes.currentBank.filter.frequency,
    sample.graph.nodes.currentBank.filter.Q];
  let currentTimeReads = 0;
  Object.defineProperty(sample.fake.context, "currentTime", {
    configurable: true,
    get() { currentTimeReads += 1; return 9.5; },
  });
  for (const param of params) {
    param.events.length = 0;
    param.cancelAndHoldAtTime = () => { throw new Error("hold unavailable"); };
    param.setTargetAtTime = undefined;
  }
  assert.equal(await sample.graph.applyState(state({ air: 17, mix: 48 })), "applied");
  const expected = [Math.cos(0.48 * Math.PI * 0.5), Math.sin(0.48 * Math.PI * 0.5),
    0.008, 1200 * Math.pow(16000 / 1200, 0.17), Math.SQRT1_2];
  assert.equal(currentTimeReads, 1);
  for (const [index, param] of params.entries()) {
    assert.deepEqual(param.events.map(event => event[0]), ["cancel", "value"]);
    assert.equal(param.events[0][1], 9.5);
    assert.equal(param.events[1][2], 9.5);
    assert.equal(param.events[1][1], expected[index]);
  }
  const direct = params[0];
  direct.events.length = 0;
  direct.cancelAndHoldAtTime = undefined;
  direct.cancelScheduledValues = undefined;
  direct.setValueAtTime = undefined;
  await sample.graph.applyState(state({ mix: 47 }));
  assert.equal(currentTimeReads, 2);
  assert.equal(direct.value, Math.cos(0.47 * Math.PI * 0.5));
  assert.deepEqual(direct.events, []);
});

test("latest desired request wins before installed-key no-op across 1000 updates", async () => {
  const sample = setup(); sample.fake.flushMicrotasks();
  const swap = sample.graph.applyState(state({ size: 40 })); sample.fake.flushMicrotasks(); await swap;
  const promises = [];
  for (let index = 0; index < 999; index += 1) promises.push(sample.graph.applyState(state({ size: 41 + index % 40 })));
  const revert = sample.graph.applyState(state({ size: 40 }));
  sample.fake.flushMicrotasks();
  assert.equal(await revert, "applied");
  assert.equal(sample.graph.getLifecycleState().bankCount, 2);
  assert.equal(sample.fake.context.nodes.filter(node => node.kind === "convolver" && node.buffer !== null).length, 2);
  sample.fake.runTimers();
  assert.ok((await Promise.all(promises)).every(result => result === "superseded"));
  assert.equal(sample.graph.getState().size, 40);
  assert.equal(sample.calls, 2);
  assert.equal(sample.fake.context.buffers.length, 2);
  assert.equal(sample.fake.context.nodes.filter(node => node.kind === "convolver").length, 2);
  assert.equal(sample.graph.getLifecycleState().bankCount, 1);
  assert.equal(sample.fake.context.nodes.filter(node => node.kind === "convolver" && node.buffer !== null).length, 1);
});

test("1000 Air Mix and bypass updates allocate no IR buffer or Convolver", async () => {
  const sample = setup(); sample.fake.flushMicrotasks();
  const before = { calls: sample.calls, buffers: sample.fake.context.buffers.length,
    convolvers: sample.fake.context.nodes.filter(node => node.kind === "convolver").length };
  for (let index = 0; index < 1000; index += 1) {
    assert.equal(await sample.graph.applyState(state({ air: index % 101, mix: (index * 7) % 101,
      enabled: index % 3 !== 0 })), "applied");
  }
  assert.deepEqual({ calls: sample.calls, buffers: sample.fake.context.buffers.length,
    convolvers: sample.fake.context.nodes.filter(node => node.kind === "convolver").length }, before);
});

test("uses fixed curves, retires inlet and buffer, and keeps two-bank ceiling", async () => {
  const sample = setup(); sample.fake.flushMicrotasks(); const old = sample.graph.nodes.currentBank;
  const swap = sample.graph.applyState(state({ size: 40 })); sample.fake.flushMicrotasks(); await swap;
  assert.equal(sample.graph.getLifecycleState().bankCount, 2);
  const curve = sample.graph.nodes.currentBank.gain.gain.events.find(event => event[0] === "curve")[1];
  assert.equal(curve.length, SPACE_BANK_SWAP_CURVE_POINTS); assert.equal(curve[0], 0); assert.equal(curve.at(-1), 1);
  sample.fake.runTimers();
  assert.equal(old.convolver.buffer, null); assert.equal(old.delay.incoming.length, 0);
  assert.equal(sample.graph.getLifecycleState().bankCount, 1);
});

test("persistent buffer cleanup blocks allocation then recovers without a third Convolver", async () => {
  const sample = setup({ strictTargetDisconnect: true }); sample.fake.flushMicrotasks();
  let bufferWrites = 0;
  let blocked = true;
  sample.fake.controls.hit = label => {
    if (label === "convolver.buffer" && ++bufferWrites >= 2 && blocked) throw new Error("blocked-buffer-null");
  };
  const swap = sample.graph.applyState(state({ size: 40 })); sample.fake.flushMicrotasks(); await swap;
  sample.fake.runTimers();
  assert.equal(sample.graph.getLifecycleState().blockedBankCount, 1);
  const blockedUpdate = sample.graph.applyState(state({ size: 50 })); sample.fake.flushMicrotasks();
  assert.equal(await blockedUpdate, "unavailable");
  assert.equal(sample.fake.context.nodes.filter(node => node.kind === "convolver").length, 2);
  assert.ok(sample.fake.context.nodes.filter(node => node.kind === "convolver" && node.buffer).length <= 2);
  blocked = false;
  sample.fake.controls.hit = () => {};
  sample.graph.disconnect(); sample.graph.disconnect();
  assert.equal(sample.graph.input, null);
  assert.ok(sample.fake.context.nodes.filter(node => node.kind === "convolver").every(node => node.buffer === null));
});

test("persistent inlet cleanup survives full teardown and clears on the first released retry", () => {
  const sample = setup({ strictTargetDisconnect: true }); sample.fake.flushMicrotasks();
  const input = sample.graph.input;
  const bank = sample.graph.nodes.currentBank;
  const disconnect = input.disconnect.bind(input);
  let blocked = true;
  input.disconnect = destination => {
    if (blocked && destination === bank.delay) throw new Error("blocked-inlet-disconnect");
    return disconnect(destination);
  };
  assert.throws(() => sample.graph.disconnect(), /cleanup is blocked/);
  assert.equal(sample.graph.getLifecycleState().blockedBankCount, 1);
  assert.ok(input.connections.includes(bank.delay));
  blocked = false;
  assert.equal(sample.graph.disconnect(), undefined);
  assert.equal(sample.graph.getLifecycleState().blockedBankCount, 0);
  assert.equal(sample.graph.input, null);
  assert.equal(bank.delay.incoming.length, 0);
  assert.equal(bank.convolver.buffer, null);
});

test("captured canceled swap callbacks are inert and Stop tail ownership survives installs", async () => {
  const sample = setup(); sample.fake.flushMicrotasks();
  const first = sample.graph.applyState(state({ size: 40 })); sample.fake.flushMicrotasks(); await first;
  const staleCallback = [...sample.fake.timers.values()][0].fn;
  sample.graph.markTailResetNeeded();
  const queued = sample.graph.applyState(state({ size: 50 }));
  assert.equal(sample.graph.getLifecycleState().tailResetNeeded, true);
  sample.fake.runTimers(); sample.fake.flushMicrotasks(); await queued;
  const current = sample.graph.nodes.currentBank;
  staleCallback();
  assert.equal(sample.graph.nodes.currentBank, current);
  assert.equal(sample.graph.getLifecycleState().tailResetNeeded, true);
  assert.equal(await sample.graph.wake(), true);
  assert.equal(sample.graph.getLifecycleState().tailResetNeeded, false);
});

test("tail reset replaces and releases the old wet path", () => {
  const sample = setup(); sample.fake.flushMicrotasks(); const old = sample.graph.nodes.currentBank;
  sample.graph.markTailResetNeeded(); assert.equal(sample.graph.resetWetPath(), true);
  assert.notEqual(sample.graph.nodes.currentBank, old); assert.equal(old.convolver.buffer, null);
  assert.equal(old.delay.incoming.length, 0);
});

for (const [name, failingGainWrite] of [
  ["post-build bank gain", 2],
  ["allocation-free state refresh", 3],
]) {
  test(`tail reset cleans ${name} failure without an orphan`, () => {
    const sample = setup(); sample.fake.flushMicrotasks();
    let gainWrites = 0;
    sample.fake.controls.hit = label => {
      if (label === "gain.value" && ++gainWrites === failingGainWrite) throw new Error(`injected:${name}`);
    };
    sample.graph.markTailResetNeeded();
    assert.equal(sample.graph.resetWetPath(), false);
    if (failingGainWrite === 3) assert.equal(sample.graph.getLifecycleState().tailResetNeeded, true);
    assert.equal(sample.graph.getLifecycleState().bankCount, 0);
    assert.equal(sample.graph.nodes.currentBank, null);
    assert.deepEqual(sample.graph.input.connections, [sample.graph.nodes.dryGain]);
    const convolvers = sample.fake.context.nodes.filter(node => node.kind === "convolver");
    assert.ok(convolvers.length <= 2);
    assert.ok(convolvers.every(node => node.buffer === null && node.incoming.length === 0 && node.connections.length === 0));
    const delays = sample.fake.context.nodes.filter(node => node.kind === "delay");
    assert.ok(delays.every(node => node.incoming.length === 0 && node.connections.length === 0));
  });
}

test("bank failure becomes dry-only unavailable with no retained wet bank", async () => {
  const sample = setup(); sample.fake.flushMicrotasks();
  sample.fake.controls.hit = label => { if (label === "createBiquadFilter") throw new Error("injected"); };
  const result = sample.graph.applyState(state({ size: 31 })); sample.fake.flushMicrotasks();
  assert.equal(await result, "unavailable");
  assert.equal(sample.graph.nodes.currentBank, null);
  assert.equal(sample.graph.nodes.dryGain.gain.value, 1); assert.equal(sample.graph.nodes.wetGain.gain.value, 0);
});

test("AudioParam failure installs a structural unity safety bypass", async () => {
  const sample = setup(); sample.fake.flushMicrotasks();
  const dryParam = sample.graph.nodes.dryGain.gain;
  const prior = dryParam.value;
  dryParam.setTargetAtTime = () => { throw new Error("target"); };
  dryParam.setValueAtTime = () => { throw new Error("value"); };
  Object.defineProperty(dryParam, "value", { configurable: true, get: () => prior,
    set: () => { throw new Error("direct"); } });
  assert.equal(await sample.graph.applyState(state({ mix: 90 })), "unavailable");
  assert.equal(sample.graph.getLifecycleState().safetyBypassConnected, true);
  assert.deepEqual(sample.graph.input.connections, [sample.graph.output]);
  assert.equal(sample.graph.nodes.dryGain.incoming.length, 0);
  assert.equal(sample.graph.nodes.wetGain.connections.length, 0);
});

for (const failedRemoval of ["dry", "wet"]) {
  test(`structural fallback fails closed when ${failedRemoval} edge removal fails`, async () => {
    const sample = setup(); sample.fake.flushMicrotasks();
    const dryParam = sample.graph.nodes.dryGain.gain; const prior = dryParam.value;
    dryParam.setTargetAtTime = () => { throw new Error("target"); };
    dryParam.setValueAtTime = () => { throw new Error("value"); };
    Object.defineProperty(dryParam, "value", { configurable: true, get: () => prior,
      set: () => { throw new Error("direct"); } });
    if (failedRemoval === "dry") {
      const disconnect = sample.graph.input.disconnect.bind(sample.graph.input);
      sample.graph.input.disconnect = destination => {
        if (destination === sample.graph.nodes.dryGain) throw new Error("dry-disconnect");
        return disconnect(destination);
      };
    } else {
      const wet = sample.graph.nodes.wetGain; const disconnect = wet.disconnect.bind(wet);
      wet.disconnect = destination => {
        if (destination === sample.graph.output) throw new Error("wet-disconnect");
        return disconnect(destination);
      };
    }
    assert.equal(await sample.graph.applyState(state({ mix: 90 })), "unavailable");
    assert.equal(sample.graph.getLifecycleState().safetyBypassConnected, false);
    assert.ok(!sample.graph.input.connections.includes(sample.graph.output));
    assert.equal(sample.graph.output.connections.length, 0);
  });
}

test("disconnect is idempotent, releases references, and rejects later mutation", () => {
  const sample = setup(); sample.fake.flushMicrotasks(); const bank = sample.graph.nodes.currentBank;
  sample.graph.disconnect(); sample.graph.disconnect();
  assert.equal(bank.convolver.buffer, null); assert.equal(sample.graph.input, null);
  assert.deepEqual(sample.graph.getLifecycleState(), {
    available: true, disconnected: true, tailResetNeeded: false,
    requestGeneration: 2, queued: false, swapping: false,
    safetyBypassConnected: false, bankCount: 0, blockedBankCount: 0,
  });
  assert.throws(() => sample.graph.applyState(state()), /disconnected/);
  assert.throws(() => sample.graph.markTailResetNeeded(), /disconnected/);
});

test("disconnect settles pending work and clears structural bypass ownership and telemetry", async () => {
  const sample = setup(); sample.fake.flushMicrotasks();
  const capturedBaseNodes = [sample.graph.input, sample.graph.nodes.dryGain,
    sample.graph.nodes.wetGain, sample.graph.output, sample.destination];
  const capturedBanks = [sample.graph.nodes.currentBank, sample.graph.nodes.retiringBank].filter(Boolean);
  const capturedBankNodes = capturedBanks.flatMap(bank => [bank.delay, bank.convolver, bank.filter, bank.gain]);
  const capturedBuffers = capturedBanks.map(bank => bank.convolver.buffer);
  const pending = sample.graph.applyState(state({ size: 44 }));
  assert.equal(sample.graph.getLifecycleState().queued, true);
  const dryParam = sample.graph.nodes.dryGain.gain;
  dryParam.setTargetAtTime = () => { throw new Error("target"); };
  dryParam.setValueAtTime = () => { throw new Error("value"); };
  Object.defineProperty(dryParam, "value", { configurable: true, get: () => 0.5,
    set: () => { throw new Error("direct"); } });
  assert.equal(await sample.graph.applyState(state({ air: 88 })), "unavailable");
  assert.equal(await pending, "superseded");
  assert.equal(sample.graph.getLifecycleState().safetyBypassConnected, true);
  sample.graph.disconnect();
  assert.deepEqual(sample.graph.getLifecycleState(), {
    available: false, disconnected: true, tailResetNeeded: false,
    requestGeneration: 5, queued: false, swapping: false,
    safetyBypassConnected: false, bankCount: 0, blockedBankCount: 0,
  });
  assert.equal(sample.graph.input, null);
  assert.equal(sample.graph.output, null);
  assert.deepEqual(Object.values(sample.graph.nodes), [null, null, null, null, null, null]);
  assert.ok([...capturedBaseNodes, ...capturedBankNodes]
    .every(node => node.incoming.length === 0 && node.connections.length === 0));
  assert.ok(capturedBuffers.every(buffer => buffer !== null));
  assert.ok(capturedBanks.every(bank => bank.convolver.buffer === null));
  assert.ok(sample.fake.context.nodes.filter(node => node.kind === "convolver")
    .every(node => node.buffer === null && node.incoming.length === 0 && node.connections.length === 0));
});
