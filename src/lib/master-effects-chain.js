import { createMasterFilterGraph } from "./master-filter-graph.js";
import { createMasterReverbGraph } from "./master-reverb-graph.js";

export const MASTER_GATE_FADE_SECONDS = 0.01;
export const MASTER_GATE_SETTLE_MILLISECONDS = 20;

function force(param, value, time) {
  if (!param) throw new Error("A writable terminal gate is required.");
  param.cancelScheduledValues?.(time);
  if (param.setValueAtTime) param.setValueAtTime(value, time);
  else param.value = value;
}

export function createMasterEffectsChain(audioContext, protectionDestination,
    { toneState, spaceState } = {}, options = {}) {
  if (!audioContext?.createGain || !protectionDestination) throw new Error("A terminal Gain gate is required.");
  const schedule = options.setTimeout || globalThis.setTimeout;
  const cancel = options.clearTimeout || globalThis.clearTimeout;
  const makeTone = options.createToneGraph || createMasterFilterGraph;
  const makeSpace = options.createSpaceGraph || createMasterReverbGraph;
  const isLifecycleValid = options.isLifecycleValid || (() => true);
  let terminalGate = null;
  let input = null;
  let toneGraph = null;
  let spaceGraph = null;
  let disconnected = false;
  let generation = 0;
  let closeOperation = null;
  let closePromise = Promise.resolve(true);
  let transportPhase = "closed";
  const blockedResources = new Set();

  function disconnectNode(node, destination) {
    try { destination ? node?.disconnect(destination) : node?.disconnect(); } catch (_error) {}
  }
  function disconnectStrict(node, destination) {
    if (!node) return;
    if (destination) node.disconnect(destination); else node.disconnect();
  }
  function failClosed(error) {
    transportPhase = "closed";
    cancelCloseOperation();
    disconnected = true;
    for (const resource of [toneGraph, spaceGraph, input, terminalGate]) {
      if (!resource) continue;
      try { resource.disconnect(); } catch (_cleanupError) { blockedResources.add(resource); }
    }
    toneGraph = null; spaceGraph = null; input = null; terminalGate = null;
    throw error;
  }
  function cleanAll() {
    for (const resource of [toneGraph, spaceGraph, input, terminalGate]) {
      if (!resource) continue;
      try { resource.disconnect(); } catch (_error) { blockedResources.add(resource); }
    }
    toneGraph = null; spaceGraph = null; input = null; terminalGate = null;
  }
  try {
    terminalGate = audioContext.createGain();
    force(terminalGate.gain, 0, audioContext.currentTime);
    terminalGate.connect(protectionDestination);
    input = audioContext.createGain();
    try { spaceGraph = makeSpace(audioContext, terminalGate, spaceState); } catch (_error) { spaceGraph = null; }
    try { toneGraph = makeTone(audioContext, spaceGraph?.input || terminalGate, toneState); }
    catch (_error) { toneGraph = null; }
    input.connect(toneGraph?.input || spaceGraph?.input || terminalGate);
  } catch (error) { cleanAll(); throw error; }

  function assertConnected() {
    if (disconnected) throw new Error("Master effects chain is disconnected.");
  }
  function removeModule(kind) {
    assertConnected();
    const shouldOpen = transportPhase === "open";
    try {
      force(terminalGate.gain, 0, audioContext.currentTime);
      disconnectStrict(input);
      disconnectStrict(toneGraph?.output);
      disconnectStrict(spaceGraph?.output);
    } catch (error) { failClosed(error); }
    if (kind === "tone" && toneGraph) {
      try { toneGraph.disconnect(); } catch (error) { failClosed(error); }
      toneGraph = null;
    }
    if (kind === "space" && spaceGraph) {
      try { spaceGraph.disconnect(); } catch (error) { failClosed(error); }
      spaceGraph = null;
    }
    try {
      if (spaceGraph) spaceGraph.output.connect(terminalGate);
      if (toneGraph) toneGraph.output.connect(spaceGraph?.input || terminalGate);
      input.connect(toneGraph?.input || spaceGraph?.input || terminalGate);
      if (shouldOpen) force(terminalGate.gain, 1, audioContext.currentTime);
    } catch (error) { failClosed(error); }
    return getAvailability();
  }
  function applyToneState(value, applyOptions) {
    assertConnected();
    return toneGraph ? toneGraph.applyState(value, applyOptions) : null;
  }
  async function applySpaceState(value, applyOptions) {
    assertConnected();
    if (!spaceGraph) return "unavailable";
    const result = await spaceGraph.applyState(value, applyOptions);
    if (result === "unavailable" && spaceGraph) removeModule("space");
    return result;
  }
  function validAfterAwait(myGeneration, graph) {
    return !disconnected && generation === myGeneration && graph === spaceGraph &&
      terminalGate && terminalGate.gain.value === 0 && audioContext.state === "running" &&
      isLifecycleValid();
  }
  async function finishClose(operation, toneClose) {
    if (disconnected || generation !== operation.generation || closeOperation !== operation) return false;
    force(terminalGate.gain, 0, audioContext.currentTime);
    try { await toneClose; } catch (_error) {}
    if (disconnected || generation !== operation.generation || closeOperation !== operation ||
        terminalGate.gain.value !== 0) return false;
    const graph = spaceGraph;
    if (graph) {
      try {
        const reset = graph.resetWetPath();
        if (disconnected || generation !== operation.generation || closeOperation !== operation ||
            graph !== spaceGraph || terminalGate.gain.value !== 0) return false;
        if (!reset) removeModule("space");
      } catch (_error) { if (graph === spaceGraph) removeModule("space"); }
    }
    if (disconnected || generation !== operation.generation || closeOperation !== operation ||
        terminalGate.gain.value !== 0) return false;
    transportPhase = "closed";
    return true;
  }
  function cancelCloseOperation() {
    const operation = closeOperation;
    if (!operation) return;
    if (operation.timer !== null) { try { cancel(operation.timer); } catch (_error) {} }
    operation.pending = false;
    operation.resolve(false);
    closeOperation = null;
  }
  function silence(silenceOptions = {}) {
    assertConnected();
    generation += 1;
    const myGeneration = generation;
    cancelCloseOperation();
    transportPhase = "closing";
    let toneClose = Promise.resolve(true);
    try {
      const param = terminalGate.gain;
      if (param.cancelAndHoldAtTime) {
        try { param.cancelAndHoldAtTime(audioContext.currentTime); }
        catch (_error) { param.cancelScheduledValues?.(audioContext.currentTime); }
      } else param.cancelScheduledValues?.(audioContext.currentTime);
      param.setValueAtTime?.(Number.isFinite(param.value) ? param.value : 1, audioContext.currentTime);
      if (silenceOptions.immediate || audioContext.state !== "running") force(param, 0, audioContext.currentTime);
      else if (param.linearRampToValueAtTime) {
        param.linearRampToValueAtTime(0, audioContext.currentTime + MASTER_GATE_FADE_SECONDS);
      } else force(param, 0, audioContext.currentTime);
      spaceGraph?.markTailResetNeeded();
      toneClose = Promise.resolve(toneGraph?.silence(silenceOptions));
    } catch (error) {
      try { force(terminalGate.gain, 0, audioContext.currentTime); transportPhase = "closed"; }
      catch (_fallbackError) { try { failClosed(error); } catch (_closedError) {} }
      closePromise = Promise.resolve(false);
      return closePromise;
    }
    closePromise = new Promise((resolve) => {
      const operation = { generation: myGeneration, resolve, timer: null, pending: true };
      closeOperation = operation;
      const complete = async () => {
        let result = false;
        try { result = await finishClose(operation, toneClose); }
        catch (error) { try { failClosed(error); } catch (_closedError) {} }
        finally {
          if (closeOperation === operation) closeOperation = null;
          operation.pending = false;
          operation.resolve(result);
        }
      };
      if (silenceOptions.immediate || audioContext.state !== "running") {
        void complete();
        return;
      }
      try {
        operation.timer = schedule(() => { operation.timer = null; void complete(); }, MASTER_GATE_SETTLE_MILLISECONDS);
      } catch (_error) {
        closeOperation = null; operation.pending = false;
        try { force(terminalGate.gain, 0, audioContext.currentTime); transportPhase = "closed"; }
        catch (error) { try { failClosed(error); } catch (_closedError) {} }
        resolve(false);
      }
    });
    return closePromise;
  }
  async function wake() {
    assertConnected();
    const awaitedClose = closePromise;
    let closeCompleted = false;
    try { closeCompleted = await awaitedClose; } catch (_error) {}
    if (!closeCompleted || awaitedClose !== closePromise || disconnected || audioContext.state !== "running" ||
        !isLifecycleValid()) return false;
    generation += 1;
    const myGeneration = generation;
    if (disconnected || audioContext.state !== "running" || !isLifecycleValid()) return false;
    force(terminalGate.gain, 0, audioContext.currentTime);
    const space = spaceGraph;
    if (space) {
      let awake = false;
      try { awake = await space.wake(); } catch (_error) {}
      if (!validAfterAwait(myGeneration, space)) return false;
      if (!awake) removeModule("space");
    }
    if (disconnected || generation !== myGeneration || terminalGate.gain.value !== 0 ||
        audioContext.state !== "running" || !isLifecycleValid()) return false;
    const tone = toneGraph;
    if (tone) {
      let awake = false;
      try { awake = await tone.wake(); } catch (_error) {}
      if (disconnected || generation !== myGeneration || tone !== toneGraph ||
          audioContext.state !== "running" || terminalGate.gain.value !== 0 || !isLifecycleValid()) return false;
      if (!awake) removeModule("tone");
    }
    if (disconnected || generation !== myGeneration || audioContext.state !== "running" ||
        terminalGate.gain.value !== 0 || !isLifecycleValid()) return false;
    force(terminalGate.gain, 1, audioContext.currentTime);
    transportPhase = "open";
    return true;
  }
  function makeToneUnavailable() { return removeModule("tone"); }
  function makeSpaceUnavailable() { return removeModule("space"); }
  function getAvailability() { return { tone: Boolean(toneGraph), space: Boolean(spaceGraph) }; }
  function getTransportState() {
    return { closed: transportPhase === "closed", phase: transportPhase, generation,
      closePending: Boolean(closeOperation?.pending) };
  }
  function disconnect() {
    if (disconnected) {
      for (const resource of [...blockedResources]) {
        try { resource.disconnect(); blockedResources.delete(resource); } catch (_error) {}
      }
      if (blockedResources.size) throw new Error("Master effects chain cleanup is blocked.");
      return true;
    }
    disconnected = true; generation += 1;
    cancelCloseOperation();
    cleanAll(); transportPhase = "closed";
    if (blockedResources.size) throw new Error("Master effects chain cleanup is blocked.");
    return true;
  }
  return Object.freeze({
    get input() { return input; }, get toneGraph() { return toneGraph; }, get spaceGraph() { return spaceGraph; },
    get terminalGate() { return terminalGate; }, applyToneState, applySpaceState, silence, wake,
    makeToneUnavailable, makeSpaceUnavailable, disconnect, getAvailability, getTransportState,
  });
}
