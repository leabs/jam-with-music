import { normalizeSpaceEffectState } from "./space-effect.js";
import { generateSpaceImpulseResponse } from "./space-ir.js";

export const SPACE_PARAMETER_SMOOTHING_SECONDS = 0.015;
export const SPACE_BANK_SWAP_SECONDS = 0.05;
export const SPACE_BANK_SWAP_MILLISECONDS = 50;
export const SPACE_BANK_SWAP_CURVE_POINTS = 65;

function setParam(param, value, time, immediate = false) {
  if (!param) throw new Error("Space effect requires writable AudioParams.");
  if (!immediate && typeof param.cancelAndHoldAtTime === "function") {
    try { param.cancelAndHoldAtTime(time); }
    catch (_error) { param.cancelScheduledValues?.(time); }
  } else param.cancelScheduledValues?.(time);
  if (!immediate && typeof param.setTargetAtTime === "function") {
    param.setTargetAtTime(value, time, SPACE_PARAMETER_SMOOTHING_SECONDS);
  } else if (typeof param.setValueAtTime === "function") param.setValueAtTime(value, time);
  else param.value = value;
}

function constantPowerCurves() {
  const incoming = new Float32Array(SPACE_BANK_SWAP_CURVE_POINTS);
  const outgoing = new Float32Array(SPACE_BANK_SWAP_CURVE_POINTS);
  for (let index = 0; index < SPACE_BANK_SWAP_CURVE_POINTS; index += 1) {
    const phase = (index / (SPACE_BANK_SWAP_CURVE_POINTS - 1)) * Math.PI * 0.5;
    incoming[index] = Math.sin(phase);
    outgoing[index] = Math.cos(phase);
  }
  incoming[0] = 0; incoming[incoming.length - 1] = 1;
  outgoing[0] = 1; outgoing[outgoing.length - 1] = 0;
  return { incoming, outgoing };
}

function mixGains(mix) {
  if (mix <= 0) return { dryGain: 1, wetGain: 0 };
  if (mix >= 1) return { dryGain: 0, wetGain: 1 };
  return {
    dryGain: Math.cos(mix * Math.PI * 0.5),
    wetGain: Math.sin(mix * Math.PI * 0.5),
  };
}

function mapState(state, sampleRate) {
  const mix = state.enabled ? state.mix / 100 : 0;
  return {
    preDelaySeconds: Math.round(2 + 0.28 * state.size) / 1000,
    airFrequency: Math.min(sampleRate * 0.45,
      1200 * Math.pow(16000 / 1200, state.air / 100)),
    ...mixGains(mix),
  };
}

export function createMasterReverbGraph(audioContext, destination, initialState, options = {}) {
  if (!audioContext || !destination || !audioContext.createGain || !audioContext.createDelay ||
      !audioContext.createConvolver || !audioContext.createBiquadFilter || !audioContext.createBuffer) {
    throw new Error("Space requires Gain, Delay, Convolver, BiquadFilter, and AudioBuffer support.");
  }
  const generateImpulse = options.generateImpulse || generateSpaceImpulseResponse;
  const queueTask = options.queueMicrotask || globalThis.queueMicrotask;
  const schedule = options.setTimeout || globalThis.setTimeout;
  const cancel = options.clearTimeout || globalThis.clearTimeout;
  let created = [];
  let input; let dry; let wet; let output;
  try {
    input = audioContext.createGain(); created.push(input);
    dry = audioContext.createGain(); created.push(dry);
    wet = audioContext.createGain(); created.push(wet);
    output = audioContext.createGain(); created.push(output);
    input.connect(dry); dry.connect(output); wet.connect(output); output.connect(destination);
  } catch (error) {
    for (const node of created) { try { node.disconnect(); } catch (_cleanupError) {} }
    throw error;
  }

  let state = normalizeSpaceEffectState(initialState);
  let currentBank = null;
  let retiringBank = null;
  let pendingRequest = null;
  let queued = false;
  let requestGeneration = 0;
  let swapTimer = null;
  let swapToken = null;
  let unavailable = false;
  let disconnected = false;
  let tailResetNeeded = false;
  let installedKey = null;
  let safetyBypassConnected = false;
  const blockedBanks = new Set();

  function assertConnected() {
    if (disconnected) throw new Error("Space graph is disconnected.");
  }
  function disposeBank(bank) {
    if (!bank || (bank.disposed && !blockedBanks.has(bank))) return true;
    const cleanup = bank.cleanup || (bank.cleanup = {
      input: true, delay: false, convolver: false, filter: false, gain: false, buffer: false,
    });
    if (!cleanup.input) {
      if (!input || !bank.delay) cleanup.input = true;
      else try { input.disconnect(bank.delay); cleanup.input = true; } catch (_error) {}
    }
    for (const key of ["delay", "convolver", "filter", "gain"]) {
      if (cleanup[key]) continue;
      if (!bank[key]) cleanup[key] = true;
      else try { bank[key].disconnect(); cleanup[key] = true; } catch (_error) {}
    }
    if (!cleanup.buffer) {
      if (!bank.convolver) cleanup.buffer = true;
      else try { bank.convolver.buffer = null; cleanup.buffer = true; } catch (_error) {}
    }
    const clean = Object.values(cleanup).every(Boolean);
    bank.disposed = clean;
    if (clean) blockedBanks.delete(bank); else blockedBanks.add(bank);
    return clean;
  }
  function retryBlockedBanks() {
    for (const bank of [...blockedBanks]) disposeBank(bank);
    return blockedBanks.size === 0;
  }
  function createBuffer(impulse) {
    const buffer = audioContext.createBuffer(2, impulse.frameCount, impulse.sampleRate);
    try {
      for (let channel = 0; channel < 2; channel += 1) {
        if (buffer.copyToChannel) buffer.copyToChannel(impulse.channels[channel], channel);
        else buffer.getChannelData(channel).set(impulse.channels[channel]);
      }
      return buffer;
    } catch (error) {
      throw error;
    }
  }
  function buildBank(requestState) {
    if (!retryBlockedBanks() || [currentBank, retiringBank].filter(Boolean).length + blockedBanks.size >= 2) {
      throw new Error("Space cleanup is blocked.");
    }
    const bank = { delay: null, convolver: null, filter: null, gain: null, disposed: false,
      cleanup: { input: true, delay: false, convolver: false, filter: false, gain: false, buffer: false } };
    try {
      const impulse = generateImpulse({ size: requestState.size, decay: requestState.decay,
        sampleRate: audioContext.sampleRate });
      bank.delay = audioContext.createDelay();
      bank.convolver = audioContext.createConvolver();
      bank.filter = audioContext.createBiquadFilter();
      bank.gain = audioContext.createGain();
      bank.convolver.normalize = false;
      bank.convolver.buffer = createBuffer(impulse);
      bank.filter.type = "lowpass";
      const values = mapState(requestState, audioContext.sampleRate);
      setParam(bank.delay.delayTime, values.preDelaySeconds, audioContext.currentTime, true);
      setParam(bank.filter.frequency, values.airFrequency, audioContext.currentTime, true);
      setParam(bank.filter.Q, Math.SQRT1_2, audioContext.currentTime, true);
      setParam(bank.gain.gain, 0, audioContext.currentTime, true);
      bank.delay.connect(bank.convolver);
      bank.convolver.connect(bank.filter);
      bank.filter.connect(bank.gain);
      bank.gain.connect(wet);
      input.connect(bank.delay);
      bank.cleanup.input = false;
      return bank;
    } catch (error) {
      disposeBank(bank);
      throw error;
    }
  }
  function resolvePending(result) {
    const request = pendingRequest;
    pendingRequest = null;
    request?.resolve(result);
  }
  function forceDryOnly() {
    let parameterFallbackFailed = false;
    try { setParam(dry.gain, 1, audioContext.currentTime, true); }
    catch (_error) { try { dry.gain.value = 1; } catch (_directError) { parameterFallbackFailed = true; } }
    try { setParam(wet.gain, 0, audioContext.currentTime, true); }
    catch (_error) { try { wet.gain.value = 0; } catch (_directError) { parameterFallbackFailed = true; } }
    if (!parameterFallbackFailed && dry.gain.value === 1 && wet.gain.value === 0) return;
    let dryRemoved = false; let wetRemoved = false;
    try { input.disconnect(dry); dryRemoved = true; } catch (_error) {}
    try { wet.disconnect(output); wetRemoved = true; } catch (_error) {}
    if (!dryRemoved || !wetRemoved) {
      safetyBypassConnected = false;
      try { output.disconnect(destination); } catch (_error) {}
      return;
    }
    if (!safetyBypassConnected) { input.connect(output); safetyBypassConnected = true; }
  }
  function failUnavailable() {
    unavailable = true;
    requestGeneration += 1;
    resolvePending("unavailable");
    if (swapTimer !== null) { try { cancel(swapTimer); } catch (_error) {} swapTimer = null; }
    swapToken = null;
    disposeBank(currentBank); disposeBank(retiringBank);
    currentBank = null; retiringBank = null; installedKey = null;
    retryBlockedBanks();
    try { forceDryOnly(); } catch (_error) {}
  }
  function updateAllocationFree(next, immediate) {
    const values = mapState(next, audioContext.sampleRate);
    const time = audioContext.currentTime;
    setParam(dry.gain, unavailable ? 1 : values.dryGain, time, immediate);
    setParam(wet.gain, unavailable ? 0 : values.wetGain, time, immediate);
    for (const bank of [currentBank, retiringBank]) {
      if (!bank) continue;
      setParam(bank.delay.delayTime, values.preDelaySeconds, time, immediate);
      setParam(bank.filter.frequency, values.airFrequency, time, immediate);
      setParam(bank.filter.Q, Math.SQRT1_2, time, immediate);
    }
  }
  function finishSwap(token) {
    if (token !== swapToken || token.outgoing !== retiringBank || token.replacement !== currentBank) return;
    const old = token.outgoing;
    retiringBank = null;
    swapTimer = null;
    swapToken = null;
    disposeBank(old);
    queuePending();
  }
  function installBank(replacement, key) {
    if (!currentBank) {
      setParam(replacement.gain.gain, 1, audioContext.currentTime, true);
      currentBank = replacement; installedKey = key; return;
    }
    const curves = constantPowerCurves();
    const outgoing = currentBank;
    const previousKey = installedKey;
    const time = audioContext.currentTime;
    try {
      replacement.gain.gain.setValueCurveAtTime(curves.incoming, time, SPACE_BANK_SWAP_SECONDS);
      outgoing.gain.gain.setValueCurveAtTime(curves.outgoing, time, SPACE_BANK_SWAP_SECONDS);
      retiringBank = outgoing;
      currentBank = replacement;
      installedKey = key;
      const token = { outgoing, replacement };
      swapToken = token;
      swapTimer = schedule(() => finishSwap(token), SPACE_BANK_SWAP_MILLISECONDS);
    } catch (error) {
      disposeBank(replacement);
      currentBank = outgoing; retiringBank = null; installedKey = previousKey; swapTimer = null; swapToken = null;
      throw error;
    }
  }
  function queuePending() {
    if (queued || swapTimer !== null || !pendingRequest || disconnected || unavailable) return;
    queued = true;
    try {
      queueTask(() => {
        queued = false;
        const request = pendingRequest;
        if (!request || disconnected || unavailable) return;
        if (request.generation !== requestGeneration) { resolvePending("superseded"); queuePending(); return; }
        pendingRequest = null;
        let replacement = null;
        try {
          replacement = buildBank(request.state);
          if (disconnected || unavailable || request.generation !== requestGeneration) {
            disposeBank(replacement); request.resolve("superseded"); queuePending(); return;
          }
          installBank(replacement, request.key);
          request.resolve("applied");
        } catch (_error) {
          if (replacement && replacement !== currentBank && replacement !== retiringBank) disposeBank(replacement);
          request.resolve("unavailable"); failUnavailable();
        }
      });
    } catch (_error) { queued = false; failUnavailable(); }
  }
  function applyState(value, applyOptions = {}) {
    assertConnected();
    const next = normalizeSpaceEffectState(value);
    state = next;
    requestGeneration += 1;
    resolvePending("superseded");
    try { updateAllocationFree(next, Boolean(applyOptions.immediate)); }
    catch (_error) { failUnavailable(); return Promise.resolve("unavailable"); }
    if (unavailable) return Promise.resolve("unavailable");
    const key = `${next.size}:${next.decay}`;
    if (currentBank && key === installedKey && !tailResetNeeded) return Promise.resolve("applied");
    const generation = requestGeneration;
    return new Promise((resolve) => {
      pendingRequest = { state: { ...next }, key, generation, resolve };
      queuePending();
    });
  }
  function markTailResetNeeded() { assertConnected(); tailResetNeeded = true; }
  function resetWetPath() {
    assertConnected();
    requestGeneration += 1;
    resolvePending("superseded");
    if (swapTimer !== null) { try { cancel(swapTimer); } catch (_error) {} swapTimer = null; }
    swapToken = null;
    disposeBank(currentBank); disposeBank(retiringBank);
    currentBank = null; retiringBank = null; installedKey = null;
    if (!retryBlockedBanks()) { failUnavailable(); return false; }
    if (unavailable) { forceDryOnly(); return false; }
    let replacement = null;
    try {
      replacement = buildBank(state);
      setParam(replacement.gain.gain, 1, audioContext.currentTime, true);
      currentBank = replacement; installedKey = `${state.size}:${state.decay}`;
      updateAllocationFree(state, true);
      tailResetNeeded = false;
      replacement = null;
      return true;
    } catch (_error) {
      disposeBank(replacement);
      if (currentBank === replacement) currentBank = null;
      failUnavailable();
      return false;
    }
  }
  async function wake() {
    assertConnected();
    if (unavailable) return false;
    if (tailResetNeeded && !resetWetPath()) return false;
    return true;
  }
  function disconnect() {
    if (!disconnected) {
      disconnected = true; requestGeneration += 1;
      resolvePending("superseded");
      queued = false;
      if (swapTimer !== null) { try { cancel(swapTimer); } catch (_error) {} swapTimer = null; }
      swapToken = null;
      disposeBank(currentBank); disposeBank(retiringBank);
      currentBank = null; retiringBank = null; installedKey = null;
    }
    retryBlockedBanks();
    let baseClean = true;
    const inletCleanupBlocked = [...blockedBanks].some(bank => !bank.cleanup.input);
    for (const node of created) {
      if (node === input && inletCleanupBlocked) continue;
      try { node.disconnect(); } catch (_error) { baseClean = false; }
    }
    if (blockedBanks.size || !baseClean) throw new Error("Space graph cleanup is blocked.");
    input = null; dry = null; wet = null; output = null;
    safetyBypassConnected = false; tailResetNeeded = false;
    created = [];
  }
  const nodes = Object.freeze({
    get input() { return input; }, get dryGain() { return dry; }, get wetGain() { return wet; },
    get output() { return output; }, get currentBank() { return currentBank; },
    get retiringBank() { return retiringBank; },
  });
  function getState() { return { ...state }; }
  function getLifecycleState() {
    return { available: !unavailable, disconnected, tailResetNeeded, requestGeneration,
      queued, swapping: swapTimer !== null, safetyBypassConnected,
      bankCount: [currentBank, retiringBank].filter(Boolean).length,
      blockedBankCount: blockedBanks.size };
  }
  try { updateAllocationFree(state, true); }
  catch (error) { disconnect(); throw error; }
  void applyState(state, { immediate: true });
  return Object.freeze({
    get input() { return input; }, get output() { return output; }, nodes, applyState,
    markTailResetNeeded, resetWetPath, wake, disconnect, getState, getLifecycleState,
  });
}
