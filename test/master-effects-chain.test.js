import assert from "node:assert/strict";
import test from "node:test";
import { createMasterEffectsChain, MASTER_GATE_SETTLE_MILLISECONDS } from "../src/lib/master-effects-chain.js";
import { createAudioNode, createMasterEffectsAudioFake } from "./support/master-effects-audio-fake.js";

function module(kind, destination, events, controls = {}) {
  const input = createAudioNode(`${kind}-in`); const output = createAudioNode(`${kind}-out`); output.connect(destination);
  return {
    input, output, applyState: () => {},
    silence: () => { events.push(`${kind}:silence`); return controls.closePromise || Promise.resolve(true); },
    markTailResetNeeded: () => events.push(`${kind}:mark`),
    resetWetPath: () => { events.push(`${kind}:reset`); return controls.reset !== false; },
    wake: async () => { events.push(`${kind}:wake`); return controls.wakePromise ? controls.wakePromise : controls.wake !== false; },
    disconnect() { input.disconnect(); output.disconnect(); events.push(`${kind}:disconnect`); },
  };
}
function setup(fail = {}, controls = {}) {
  const fake = createMasterEffectsAudioFake(); const events = []; const protection = createAudioNode("protection");
  const chain = createMasterEffectsChain(fake.context, protection, { toneState: { x: 1 }, spaceState: { y: 2 } }, {
    setTimeout: fake.setTimeout, clearTimeout: fake.clearTimeout,
    isLifecycleValid: controls.isLifecycleValid,
    createSpaceGraph(context, destination, initial) {
      assert.deepEqual(initial, { y: 2 }); if (fail.space) throw new Error("space"); return module("space", destination, events, controls.space);
    },
    createToneGraph(context, destination, initial) {
      assert.deepEqual(initial, { x: 1 }); if (fail.tone) throw new Error("tone"); return module("tone", destination, events, controls.tone);
    },
  });
  return { fake, events, chain, protection };
}

test("implements exact API and constructs all four legal routes", () => {
  const both = setup();
  assert.deepEqual(Object.keys(both.chain), ["input", "toneGraph", "spaceGraph", "terminalGate", "applyToneState",
    "applySpaceState", "silence", "wake", "makeToneUnavailable", "makeSpaceUnavailable", "disconnect",
    "getAvailability", "getTransportState"]);
  assert.deepEqual(both.chain.getAvailability(), { tone: true, space: true });
  assert.deepEqual(setup({ space: true }).chain.getAvailability(), { tone: true, space: false });
  assert.deepEqual(setup({ tone: true }).chain.getAvailability(), { tone: false, space: true });
  assert.deepEqual(setup({ tone: true, space: true }).chain.getAvailability(), { tone: false, space: false });
});

test("terminal construction and final connection failures are fatal and cleaned", () => {
  const fake = createMasterEffectsAudioFake({ failLabel: "gain.connect" });
  assert.throws(() => createMasterEffectsChain(fake.context, createAudioNode("protection")), /injected/);
  assert.ok(fake.context.nodes.every(node => node.connections.length === 0));
});

test("silence closes at 10ms, settles at 20ms, and resets behind exact zero", async () => {
  const sample = setup(); sample.chain.terminalGate.gain.value = 1;
  const closing = sample.chain.silence();
  assert.equal(sample.chain.terminalGate.gain.events.find(event => event[0] === "ramp")[1], 0);
  assert.equal([...sample.fake.timers.values()][0].ms, MASTER_GATE_SETTLE_MILLISECONDS);
  sample.fake.runTimers(); assert.equal(await closing, true);
  assert.equal(sample.chain.terminalGate.gain.value, 0); assert.ok(sample.events.includes("space:reset"));
});

test("settle-time exact-zero failure resolves its close false and fails closed", async () => {
  const sample = setup(); sample.chain.terminalGate.gain.value = 1;
  const closing = sample.chain.silence();
  sample.fake.controls.hit = label => { if (label === "gain.cancel") throw new Error("settle-force"); };
  sample.fake.runTimers();
  assert.equal(await closing, false);
  assert.equal(sample.chain.getTransportState().closePending, false);
  assert.equal(sample.chain.getTransportState().phase, "closed");
});

test("initial Stop write and fallback failure settles false without throwing", async () => {
  const sample = setup(); sample.chain.terminalGate.gain.value = 1;
  sample.fake.controls.hit = label => { if (label === "gain.value") throw new Error("stop-write"); };
  assert.equal(await sample.chain.silence(), false);
  assert.equal(sample.chain.getTransportState().phase, "closed");
  assert.equal(sample.chain.getTransportState().closePending, false);
});

test("failClosed cancels and settles an outstanding close operation", async () => {
  const sample = setup(); sample.chain.terminalGate.gain.value = 1;
  const closing = sample.chain.silence();
  sample.chain.spaceGraph.disconnect = () => { throw new Error("runtime-disconnect"); };
  assert.throws(() => sample.chain.makeSpaceUnavailable(), /runtime-disconnect/);
  assert.equal(await closing, false);
  assert.equal(sample.chain.getTransportState().closePending, false);
  assert.equal(sample.chain.getTransportState().phase, "closed");
  assert.throws(() => sample.chain.disconnect(), /cleanup is blocked/);
});

test("disconnect surfaces blocked cleanup and retries only until ownership is released", () => {
  const sample = setup();
  const graph = sample.chain.spaceGraph;
  const originalDisconnect = graph.disconnect.bind(graph);
  let blocked = true;
  graph.disconnect = () => { if (blocked) throw new Error("persistent cleanup"); originalDisconnect(); };
  assert.throws(() => sample.chain.makeSpaceUnavailable(), /persistent cleanup/);
  assert.throws(() => sample.chain.disconnect(), /cleanup is blocked/);
  blocked = false;
  assert.equal(sample.chain.disconnect(), true);
  assert.equal(sample.chain.disconnect(), true);
});

test("wake fences stale work, wakes Space then Tone, and opens gate last", async () => {
  let resolveSpace; const spaceWake = new Promise(resolve => { resolveSpace = resolve; });
  const sample = setup({}, { space: { wakePromise: spaceWake } });
  const waking = sample.chain.wake(); await Promise.resolve();
  const stopping = sample.chain.silence({ immediate: true }); resolveSpace(true);
  assert.equal(await waking, false); await stopping;
  assert.ok(!sample.events.includes("tone:wake")); assert.equal(sample.chain.terminalGate.gain.value, 0);
});

test("runtime fallback preserves an active surviving route and truthful state", async () => {
  const sample = setup(); assert.equal(await sample.chain.wake(), true);
  sample.chain.makeSpaceUnavailable();
  assert.deepEqual(sample.chain.getAvailability(), { tone: true, space: false });
  assert.equal(sample.chain.terminalGate.gain.value, 1);
  assert.equal(sample.chain.getTransportState().closed, false);
});

test("wake accepts current-time gate automation when AudioParam value is the base value", async () => {
  const sample = setup();
  const gate = sample.chain.terminalGate.gain;
  gate.setValueAtTime = function (value, time) {
    this.events.push(["scheduled-value", value, time]);
  };
  gate.value = 1;

  assert.equal(await sample.chain.silence({ immediate: true }), true);
  assert.equal(await sample.chain.wake(), true);
  assert.equal(sample.chain.getTransportState().closed, false);
  assert.equal(sample.chain.terminalGate.gain.value, 1);
});

test("runtime fallback never reopens a gate while it is closing", async () => {
  const sample = setup(); assert.equal(await sample.chain.wake(), true);
  sample.chain.terminalGate.gain.linearRampToValueAtTime = function (value, time) {
    this.events.push(["ramp", value, time]);
  };
  const closing = sample.chain.silence();
  assert.equal(sample.chain.getTransportState().phase, "closing");
  sample.chain.makeSpaceUnavailable();
  assert.equal(sample.chain.terminalGate.gain.value, 0);
  assert.equal(sample.chain.getTransportState().phase, "closing");
  sample.fake.runTimers(); assert.equal(await closing, true);
});

test("stale close completion cannot resolve a newer close operation", async () => {
  let releaseTone;
  const toneClose = new Promise(resolve => { releaseTone = resolve; });
  const sample = setup({}, { tone: { closePromise: toneClose } });
  const first = sample.chain.silence(); sample.fake.runTimers();
  const second = sample.chain.silence();
  assert.equal(await first, false);
  releaseTone(true); await Promise.resolve(); await Promise.resolve();
  assert.equal(sample.chain.getTransportState().closePending, true);
  sample.fake.runTimers(); assert.equal(await second, true);
});

test("suspension during deferred Space wake fences Tone wake", async () => {
  let releaseSpace;
  const spaceWake = new Promise(resolve => { releaseSpace = resolve; });
  const sample = setup({}, { space: { wakePromise: spaceWake } });
  const waking = sample.chain.wake(); await Promise.resolve();
  sample.fake.context.state = "suspended"; releaseSpace(true);
  assert.equal(await waking, false);
  assert.ok(!sample.events.includes("tone:wake"));
});

test("lifecycle invalidation during deferred Tone wake keeps the gate closed", async () => {
  let releaseTone; let valid = true;
  const toneWake = new Promise(resolve => { releaseTone = resolve; });
  const sample = setup({}, { tone: { wakePromise: toneWake }, isLifecycleValid: () => valid });
  const waking = sample.chain.wake(); await Promise.resolve(); await Promise.resolve();
  valid = false; releaseTone(true);
  assert.equal(await waking, false);
  assert.equal(sample.chain.terminalGate.gain.value, 0);
  assert.equal(sample.chain.getTransportState().phase, "closed");
});

test("disconnect releases refs, is idempotent, and rejects public mutation", () => {
  const sample = setup(); sample.chain.disconnect(); sample.chain.disconnect();
  assert.equal(sample.chain.toneGraph, null); assert.equal(sample.chain.spaceGraph, null); assert.equal(sample.chain.terminalGate, null);
  assert.throws(() => sample.chain.makeSpaceUnavailable(), /disconnected/);
  assert.throws(() => sample.chain.silence(), /disconnected/);
});
