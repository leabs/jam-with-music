import {
  createDefaultFilterEffectState,
  getFilterCutoffFrequencyHz,
  normalizeFilterEffectState,
} from "./filter-effect.js";

export const FILTER_PARAMETER_SMOOTHING_SECONDS = 0.015;
export const FILTER_TRANSPORT_FADE_SECONDS = 0.01;
export const FILTER_TRANSPORT_SETTLE_MILLISECONDS = 20;
export const FILTER_MIN_Q = Math.SQRT1_2;
export const FILTER_MAX_Q = 12;
export const FILTER_DRIVE_MAX_PRE_GAIN = 16;
export const FILTER_DRIVE_COMPENSATION_RANGE = 3.5;
export const FILTER_DRIVE_CURVE_SAMPLE_COUNT = 2048;
export const FILTER_DRIVE_CURVE_SHAPE = 2.5;

export function createFilterDriveCurve(sampleCount = FILTER_DRIVE_CURVE_SAMPLE_COUNT) {
  const safeSampleCount =
    Number.isInteger(sampleCount) && sampleCount >= 2 && sampleCount <= 65536
      ? sampleCount
      : FILTER_DRIVE_CURVE_SAMPLE_COUNT;
  const curve = new Float32Array(safeSampleCount);
  const shape = FILTER_DRIVE_CURVE_SHAPE;
  const normalization = Math.tanh(shape);
  for (let index = 0; index < safeSampleCount; index++) {
    const input = (index / (safeSampleCount - 1)) * 2 - 1;
    curve[index] = Math.tanh(shape * input) / normalization;
  }
  return curve;
}

function setAudioParam(
  audioParam,
  value,
  currentTime,
  immediate,
  timeConstant = FILTER_PARAMETER_SMOOTHING_SECONDS
) {
  if (!audioParam) return;
  let heldCurrentValue = false;
  if (!immediate && typeof audioParam.cancelAndHoldAtTime === "function") {
    try {
      audioParam.cancelAndHoldAtTime(currentTime);
      heldCurrentValue = true;
    } catch (_error) {
      heldCurrentValue = false;
    }
  }
  if (!heldCurrentValue && typeof audioParam.cancelScheduledValues === "function") {
    audioParam.cancelScheduledValues(currentTime);
  }
  if (!immediate && typeof audioParam.setTargetAtTime === "function") {
    audioParam.setTargetAtTime(value, currentTime, timeConstant);
    return;
  }
  if (typeof audioParam.setValueAtTime === "function") {
    audioParam.setValueAtTime(value, currentTime);
    return;
  }
  audioParam.value = value;
}

function closeAudioParam(audioParam, currentTime, immediate) {
  if (!audioParam) return;
  let heldCurrentValue = false;
  if (!immediate && typeof audioParam.cancelAndHoldAtTime === "function") {
    try {
      audioParam.cancelAndHoldAtTime(currentTime);
      heldCurrentValue = true;
    } catch (_error) {
      heldCurrentValue = false;
    }
  }
  if (!heldCurrentValue && typeof audioParam.cancelScheduledValues === "function") {
    audioParam.cancelScheduledValues(currentTime);
  }
  if (immediate) {
    setAudioParam(audioParam, 0, currentTime, true);
    return;
  }

  const currentValue = Number.isFinite(audioParam.value) ? audioParam.value : 1;
  if (!heldCurrentValue && typeof audioParam.setValueAtTime === "function") {
    audioParam.setValueAtTime(currentValue, currentTime);
  }
  if (typeof audioParam.linearRampToValueAtTime === "function") {
    audioParam.linearRampToValueAtTime(
      0,
      currentTime + FILTER_TRANSPORT_FADE_SECONDS
    );
    return;
  }

  // Exact immediate silence is safer than an asymptotic fade when ramps are unavailable.
  setAudioParam(audioParam, 0, currentTime, true);
}

export function mapFilterEffectStateToAudio(value, sampleRate = 48000) {
  const state = normalizeFilterEffectState(value);
  const safeSampleRate =
    typeof sampleRate === "number" && Number.isFinite(sampleRate) && sampleRate > 0
      ? sampleRate
      : 48000;
  const driveAmount = state.drive / 100;
  const effectMix = state.enabled ? state.mix / 100 : 0;
  return {
    state,
    cutoffFrequencyHz: Math.min(
      getFilterCutoffFrequencyHz(state.cutoff),
      Math.max(80, safeSampleRate * 0.45)
    ),
    resonanceQ:
      FILTER_MIN_Q +
      Math.pow(state.resonance / 100, 2) * (FILTER_MAX_Q - FILTER_MIN_Q),
    cleanDriveGain: 1 - driveAmount,
    drivenGain: driveAmount / (1 + driveAmount * FILTER_DRIVE_COMPENSATION_RANGE),
    drivePreGain: 1 + driveAmount * (FILTER_DRIVE_MAX_PRE_GAIN - 1),
    dryGain: 1 - effectMix,
    wetGain: effectMix,
  };
}

export function createMasterFilterGraph(audioContext, destination, initialState) {
  if (
    !audioContext ||
    !destination ||
    typeof audioContext.createGain !== "function" ||
    typeof audioContext.createBiquadFilter !== "function" ||
    typeof audioContext.createWaveShaper !== "function"
  ) {
    throw new Error("The Filter effect requires Gain, BiquadFilter, and WaveShaper nodes.");
  }

  const createdNodes = [];
  function disconnectCreatedNodes() {
    createdNodes.forEach(function (node) {
      try {
        node.disconnect();
      } catch (_error) {
        // A partially constructed node may not have any connections yet.
      }
    });
  }
  function createTrackedNode(factory) {
    try {
      const node = factory();
      createdNodes.push(node);
      return node;
    } catch (error) {
      disconnectCreatedNodes();
      throw error;
    }
  }

  const inputNode = createTrackedNode(function () {
    return audioContext.createGain();
  });
  const dryGainNode = createTrackedNode(function () {
    return audioContext.createGain();
  });
  const cleanDriveGainNode = createTrackedNode(function () {
    return audioContext.createGain();
  });
  const drivePreGainNode = createTrackedNode(function () {
    return audioContext.createGain();
  });
  let driveShaperNode = createTrackedNode(function () {
    return audioContext.createWaveShaper();
  });
  const drivenGainNode = createTrackedNode(function () {
    return audioContext.createGain();
  });
  let filterNode = createTrackedNode(function () {
    return audioContext.createBiquadFilter();
  });
  const wetGainNode = createTrackedNode(function () {
    return audioContext.createGain();
  });
  const outputNode = createTrackedNode(function () {
    return audioContext.createGain();
  });

  function configureDriveShaper(node) {
    node.curve = createFilterDriveCurve();
    if ("oversample" in node) {
      try {
        node.oversample = "2x";
      } catch (_error) {
        // Some older implementations expose oversample but reject assignment.
      }
    }
  }

  try {
    filterNode.type = "lowpass";
    configureDriveShaper(driveShaperNode);

    inputNode.connect(dryGainNode);
    dryGainNode.connect(outputNode);
    inputNode.connect(cleanDriveGainNode);
    cleanDriveGainNode.connect(filterNode);
    inputNode.connect(drivePreGainNode);
    drivePreGainNode.connect(driveShaperNode);
    driveShaperNode.connect(drivenGainNode);
    drivenGainNode.connect(filterNode);
    filterNode.connect(wetGainNode);
    wetGainNode.connect(outputNode);
    outputNode.connect(destination);
  } catch (error) {
    disconnectCreatedNodes();
    throw error;
  }

  let disconnected = false;
  let wetPathAvailable = true;
  let currentState = createDefaultFilterEffectState();
  let transportClosed = false;
  let transportNeedsReset = false;
  let closeGeneration = 0;
  let closeTimerId = null;
  let closeResolver = null;
  let transportClosePromise = Promise.resolve(true);

  function setFilterNodeParameters(node, values, immediate) {
    const currentTime = Number.isFinite(audioContext.currentTime)
      ? audioContext.currentTime
      : 0;
    setAudioParam(node.frequency, values.cutoffFrequencyHz, currentTime, immediate);
    setAudioParam(node.Q, values.resonanceQ, currentTime, immediate);
  }

  function setFilterParameters(values, immediate) {
    setFilterNodeParameters(filterNode, values, immediate);
  }

  function applyState(nextState, options) {
    if (disconnected) {
      throw new Error("Cannot update a disconnected Filter effect graph.");
    }
    const values = mapFilterEffectStateToAudio(nextState, audioContext.sampleRate);
    const currentTime = Number.isFinite(audioContext.currentTime)
      ? audioContext.currentTime
      : 0;
    const immediate = Boolean(options && options.immediate);
    if (wetPathAvailable) {
      setFilterParameters(values, immediate);
    }
    setAudioParam(cleanDriveGainNode.gain, values.cleanDriveGain, currentTime, immediate);
    setAudioParam(drivePreGainNode.gain, values.drivePreGain, currentTime, immediate);
    setAudioParam(drivenGainNode.gain, values.drivenGain, currentTime, immediate);
    setAudioParam(
      dryGainNode.gain,
      wetPathAvailable ? values.dryGain : 1,
      currentTime,
      immediate
    );
    setAudioParam(
      wetGainNode.gain,
      wetPathAvailable ? values.wetGain : 0,
      currentTime,
      immediate
    );
    currentState = { ...values.state };
    return {
      ...values,
      dryGain: wetPathAvailable ? values.dryGain : 1,
      wetGain: wetPathAvailable ? values.wetGain : 0,
      state: { ...currentState },
    };
  }

  function resetWetPath() {
    if (disconnected || !transportClosed) return false;
    const previousDriveShaperNode = driveShaperNode;
    const previousFilterNode = filterNode;
    let replacementDriveShaperNode = null;
    let replacementFilterNode = null;
    try {
      replacementDriveShaperNode = audioContext.createWaveShaper();
      replacementFilterNode = audioContext.createBiquadFilter();
      configureDriveShaper(replacementDriveShaperNode);
      replacementFilterNode.type = "lowpass";
      setFilterNodeParameters(
        replacementFilterNode,
        mapFilterEffectStateToAudio(currentState, audioContext.sampleRate),
        true
      );

      drivePreGainNode.disconnect();
      previousDriveShaperNode.disconnect();
      cleanDriveGainNode.disconnect();
      drivenGainNode.disconnect();
      previousFilterNode.disconnect();

      drivePreGainNode.connect(replacementDriveShaperNode);
      replacementDriveShaperNode.connect(drivenGainNode);
      cleanDriveGainNode.connect(replacementFilterNode);
      drivenGainNode.connect(replacementFilterNode);
      replacementFilterNode.connect(wetGainNode);

      driveShaperNode = replacementDriveShaperNode;
      filterNode = replacementFilterNode;
      wetPathAvailable = true;
      return true;
    } catch (_error) {
      [
        cleanDriveGainNode,
        drivePreGainNode,
        previousDriveShaperNode,
        drivenGainNode,
        previousFilterNode,
        replacementDriveShaperNode,
        replacementFilterNode,
      ]
        .filter(Boolean)
        .forEach(function (node) {
          try {
            node.disconnect();
          } catch (_disconnectError) {
            // A failed wet-path rebuild is forced into neutral dry-only audio.
          }
        });
      wetPathAvailable = false;
      const currentTime = Number.isFinite(audioContext.currentTime)
        ? audioContext.currentTime
        : 0;
      setAudioParam(dryGainNode.gain, 1, currentTime, true);
      setAudioParam(wetGainNode.gain, 0, currentTime, true);
      return false;
    }
  }

  function clearCloseTimer() {
    if (closeTimerId === null) return;
    if (typeof globalThis.clearTimeout === "function") {
      globalThis.clearTimeout(closeTimerId);
    }
    closeTimerId = null;
  }

  function resolvePendingClose(result) {
    clearCloseTimer();
    const resolve = closeResolver;
    closeResolver = null;
    if (resolve) {
      resolve(Boolean(result));
    }
  }

  function finishClose(generation) {
    if (disconnected || generation !== closeGeneration) return;
    const currentTime = Number.isFinite(audioContext.currentTime)
      ? audioContext.currentTime
      : 0;
    try {
      closeAudioParam(outputNode.gain, currentTime, true);
      transportClosed = true;
      resolvePendingClose(true);
    } catch (_error) {
      transportClosed = false;
      resolvePendingClose(false);
    }
  }

  function silence(options) {
    if (disconnected) return Promise.resolve(false);
    resolvePendingClose(false);
    const generation = ++closeGeneration;
    const contextIsRunning = audioContext.state === "running";
    const immediate = Boolean(options && options.immediate) || !contextIsRunning;
    const canSettleAsynchronously =
      !immediate && typeof globalThis.setTimeout === "function";
    const currentTime = Number.isFinite(audioContext.currentTime)
      ? audioContext.currentTime
      : 0;
    transportNeedsReset = true;
    transportClosed = false;

    try {
      closeAudioParam(
        outputNode.gain,
        currentTime,
        !canSettleAsynchronously
      );
    } catch (_error) {
      transportClosePromise = Promise.resolve(false);
      return transportClosePromise;
    }

    if (!canSettleAsynchronously) {
      transportClosed = true;
      transportClosePromise = Promise.resolve(true);
      return transportClosePromise;
    }

    transportClosePromise = new Promise(function (resolve) {
      closeResolver = resolve;
      closeTimerId = globalThis.setTimeout(function () {
        finishClose(generation);
      }, FILTER_TRANSPORT_SETTLE_MILLISECONDS);
    });
    return transportClosePromise;
  }

  async function wake() {
    if (disconnected) return false;
    const awaitedGeneration = closeGeneration;
    const closeCompleted = await transportClosePromise;
    if (
      disconnected ||
      !closeCompleted ||
      awaitedGeneration !== closeGeneration
    ) {
      return false;
    }

    closeGeneration += 1;
    resolvePendingClose(false);
    const currentTime = Number.isFinite(audioContext.currentTime)
      ? audioContext.currentTime
      : 0;
    try {
      closeAudioParam(outputNode.gain, currentTime, true);
      transportClosed = true;
      if (transportNeedsReset && !resetWetPath()) {
        return false;
      }
      setAudioParam(outputNode.gain, 1, currentTime, true);
      transportClosed = false;
      transportNeedsReset = false;
      transportClosePromise = Promise.resolve(true);
      return true;
    } catch (_error) {
      transportClosed = true;
      return false;
    }
  }

  function disconnect() {
    if (disconnected) return;
    disconnected = true;
    closeGeneration += 1;
    resolvePendingClose(false);
    [
      inputNode,
      dryGainNode,
      cleanDriveGainNode,
      drivePreGainNode,
      driveShaperNode,
      drivenGainNode,
      filterNode,
      wetGainNode,
      outputNode,
    ].forEach(function (node) {
      try {
        node.disconnect();
      } catch (_error) {
        // The graph may already be disconnected by the browser.
      }
    });
  }

  const nodes = Object.freeze({
    input: inputNode,
    dryGain: dryGainNode,
    cleanDriveGain: cleanDriveGainNode,
    drivePreGain: drivePreGainNode,
    get driveShaper() {
      return driveShaperNode;
    },
    drivenGain: drivenGainNode,
    get filter() {
      return filterNode;
    },
    wetGain: wetGainNode,
    output: outputNode,
  });

  try {
    setAudioParam(outputNode.gain, 1, 0, true);
    applyState(initialState || createDefaultFilterEffectState(), { immediate: true });
  } catch (error) {
    disconnected = true;
    disconnectCreatedNodes();
    throw error;
  }
  return Object.freeze({
    input: inputNode,
    output: outputNode,
    nodes,
    applyState,
    silence,
    wake,
    resetWetPath,
    disconnect,
    getState() {
      return { ...currentState };
    },
    getTransportState() {
      return {
        closed: transportClosed,
        needsReset: transportNeedsReset,
        closePending: Boolean(closeResolver),
        generation: closeGeneration,
      };
    },
  });
}
