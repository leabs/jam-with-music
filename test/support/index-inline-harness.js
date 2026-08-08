import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import {
  DEFAULT_BPM,
  getSixteenthNoteDurationSeconds,
  normalizeBpm,
} from "../../src/lib/sequencer-safety.js";
import {
  FILTER_SONG_SCHEMA_VERSION,
  createDefaultFilterEffectState,
  deserializeFilterEffectState,
  formatFilterMacroValue,
  getFilterEffectPresetState,
  getFilterGraphicSummary,
  normalizeFilterEffectState,
  serializeFilterEffectState,
} from "../../src/lib/filter-effect.js";
import { createMasterFilterGraph } from "../../src/lib/master-filter-graph.js";
import { createMasterEffectsChain } from "../../src/lib/master-effects-chain.js";
import { createMasterReverbGraph } from "../../src/lib/master-reverb-graph.js";
import {
  createDefaultSpaceEffectState,
  deserializeSpaceEffectState,
  formatSpaceMacroValue,
  getSpaceEffectSummary,
  getSpaceEffectPresetState,
  normalizeSpaceEffectState,
  serializeSpaceEffectState,
} from "../../src/lib/space-effect.js";

const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PAGE_PATH = resolve(TEST_DIRECTORY, "../../src/pages/index.astro");

class FakeClassList {
  constructor(owner) {
    this.owner = owner;
    this.values = new Set();
  }

  add(...values) {
    values.forEach((value) => this.values.add(value));
    this.owner._className = [...this.values].join(" ");
  }

  remove(...values) {
    values.forEach((value) => this.values.delete(value));
    this.owner._className = [...this.values].join(" ");
  }

  contains(value) {
    return this.values.has(value);
  }

  toggle(value, force) {
    const next = force === undefined ? !this.contains(value) : Boolean(force);
    if (next) this.add(value);
    else this.remove(value);
    return next;
  }

  replaceFromString(value) {
    this.values = new Set(String(value).split(/\s+/).filter(Boolean));
  }
}

class FakeStyle {
  constructor() {
    this.values = new Map();
  }

  setProperty(name, value) {
    const stringValue = String(value);
    this.values.set(name, stringValue);
    this[name] = stringValue;
  }

  getPropertyValue(name) {
    return this.values.get(name) ?? "";
  }

  removeProperty(name) {
    const previousValue = this.getPropertyValue(name);
    this.values.delete(name);
    delete this[name];
    return previousValue;
  }
}

class FakeElement {
  constructor(ownerDocument = null) {
    this.ownerDocument = ownerDocument;
    this.attributes = new Map();
    this.childNodes = [];
    this.dataset = new Proxy(
      {},
      {
        set: (target, key, value) => {
          const stringValue = String(value);
          target[key] = stringValue;
          const attributeName =
            "data-" + String(key).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
          this.attributes.set(attributeName, stringValue);
          return true;
        },
        deleteProperty: (target, key) => {
          delete target[key];
          const attributeName =
            "data-" + String(key).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
          this.attributes.delete(attributeName);
          return true;
        },
      },
    );
    this.disabled = false;
    this.draggable = false;
    this.hidden = true;
    this.focusable = true;
    this.inert = false;
    this.isConnected = true;
    this.listeners = new Map();
    this.parentElement = null;
    this.style = new FakeStyle();
    this.tabIndex = -1;
    this.textContent = "";
    this.value = "";
    this._className = "";
    this._innerHTML = "";
    this.classList = new FakeClassList(this);
  }

  get className() {
    return this._className;
  }

  set className(value) {
    this._className = String(value);
    this.classList.replaceFromString(value);
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    if (value === "") this.childNodes = [];
  }

  addEventListener(type, callback) {
    const callbacks = this.listeners.get(type) ?? [];
    callbacks.push(callback);
    this.listeners.set(type, callbacks);
  }

  removeEventListener(type, callback) {
    const callbacks = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      callbacks.filter((candidate) => candidate !== callback),
    );
  }

  dispatchEvent(event) {
    event.target ??= this;
    event.currentTarget = this;
    for (const callback of this.listeners.get(event.type) ?? []) {
      callback.call(this, event);
    }
    return true;
  }

  async dispatchEventAsync(event) {
    event.target ??= this;
    event.currentTarget = this;
    for (const callback of this.listeners.get(event.type) ?? []) {
      await callback.call(this, event);
    }
    return true;
  }

  setAttribute(name, value) {
    const stringValue = String(value);
    this.attributes.set(name, stringValue);
    if (name === "class") this.className = stringValue;
    if (name.startsWith("data-")) {
      const key = name
        .slice(5)
        .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      this.dataset[key] = stringValue;
    }
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name.startsWith("data-")) {
      const key = name
        .slice(5)
        .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      delete this.dataset[key];
    }
  }

  appendChild(child) {
    child.parentElement = this;
    this.childNodes.push(child);
    return child;
  }

  removeChild(child) {
    this.childNodes = this.childNodes.filter((candidate) => candidate !== child);
    child.parentElement = null;
    return child;
  }

  replaceChildren(...children) {
    this.childNodes = [];
    children.forEach((child) => this.appendChild(child));
  }

  contains(candidate) {
    if (candidate === this) return true;
    return this.childNodes.some((child) => child.contains(candidate));
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (selector.startsWith(".") && current.classList.contains(selector.slice(1))) {
        return current;
      }
      const dataPresence = selector.match(/^\[data-([a-z0-9-]+)\]$/i);
      if (dataPresence) {
        const attributeName = `data-${dataPresence[1]}`;
        if (current.attributes.has(attributeName)) return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  matchesSelector(selector) {
    if (selector.startsWith(".")) {
      return this.classList.contains(selector.slice(1));
    }
    const dataMatch = selector.match(
      /^\[data-([a-z0-9-]+)(?:=['"]([^'"]+)['"])?\]$/i,
    );
    if (!dataMatch) return false;
    const attributeName = `data-${dataMatch[1]}`;
    if (!this.attributes.has(attributeName)) return false;
    return dataMatch[2] === undefined || this.attributes.get(attributeName) === dataMatch[2];
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (node) => {
      for (const child of node.childNodes) {
        if (child.matchesSelector(selector)) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }

  focus() {
    if (!this.ownerDocument || this.disabled || !this.focusable) return;
    this.focusCalls = (this.focusCalls ?? 0) + 1;
    this.ownerDocument.activeElement = this;
  }

  select() {}

  setSelectionRange() {}

  getBoundingClientRect() {
    return { top: 0, bottom: 0, height: 0 };
  }
}

class FakeAudioParam {
  constructor(value = 0) {
    this.value = value;
    this.cancelAndHoldAtTimeCalls = [];
    this.cancelScheduledValuesCalls = [];
    this.exponentialRampToValueAtTimeCalls = [];
    this.linearRampToValueAtTimeCalls = [];
    this.setTargetAtTimeCalls = [];
    this.setValueAtTimeCalls = [];
    this.setValueCurveAtTimeCalls = [];
  }

  cancelAndHoldAtTime(time) {
    this.cancelAndHoldAtTimeCalls.push({ time });
  }

  cancelScheduledValues(time) {
    this.cancelScheduledValuesCalls.push({ time });
  }

  exponentialRampToValueAtTime(value, endTime) {
    this.value = value;
    this.exponentialRampToValueAtTimeCalls.push({ value, endTime });
  }

  linearRampToValueAtTime(value, endTime) {
    this.value = value;
    this.linearRampToValueAtTimeCalls.push({ value, endTime });
  }

  setTargetAtTime(value, startTime, timeConstant) {
    this.value = value;
    this.setTargetAtTimeCalls.push({ value, startTime, timeConstant });
  }

  setValueAtTime(value, startTime) {
    this.value = value;
    this.setValueAtTimeCalls.push({ value, startTime });
  }

  setValueCurveAtTime(values, startTime, duration) {
    this.value = values[values.length - 1];
    this.setValueCurveAtTimeCalls.push({ values, startTime, duration });
  }
}

function createAudioNode(properties = {}, controls = null) {
  return {
    connections: [],
    incoming: [],
    connectCalls: [],
    disconnectCalls: 0,
    disconnect(destination) {
      controls?.consumeCleanupFailure?.(this, destination);
      this.disconnectCalls += 1;
      const targets = destination
        ? this.connections.filter(candidate => candidate === destination)
        : [...this.connections];
      for (const target of targets) {
        target.incoming = target.incoming.filter(candidate => candidate !== this);
      }
      this.connections = destination
        ? this.connections.filter(candidate => candidate !== destination)
        : [];
    },
    connect(destination) {
      if (controls) controls.consumeFailure("connect");
      this.connections.push(destination);
      destination.incoming.push(this);
      this.connectCalls.push(destination);
      return destination;
    },
    ...properties,
  };
}

function hostCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createInlineHarness(options = {}) {
  let spaceDisconnectBlocked = options.spaceDisconnectFailure || false;
  const deferredDialogCloseCallbacks = [];
  const pageSource = readFileSync(PAGE_PATH, "utf8");
  const filterPresetCardMarkup = [
    ...pageSource.matchAll(
      /<button\b[^>]*\bdata-filter-preset-card="([^"]+)"[^>]*>/g,
    ),
  ].map((match) => {
    const label = match[0].match(/\baria-label="([^"]+)"/);
    assert.ok(label, `expected accessible label for Filter preset ${match[1]}`);
    return { id: match[1], label: label[1] };
  });
  const spacePresetCardMarkup = [
    ...pageSource.matchAll(
      /<button\b[^>]*\bdata-space-preset="([^"]+)"[^>]*>/g,
    ),
  ].map((match) => {
    const label = match[0].match(/\baria-label="([^"]+)"/);
    assert.ok(label, `expected accessible label for Space preset ${match[1]}`);
    return { id: match[1], label: label[1] };
  });
  const scripts = [...pageSource.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
  const scriptMatch = scripts.find((match) => match[1].includes("* Drum machine"));
  assert.ok(scriptMatch, "expected the inline drum-machine script");

  const inlineImportPattern =
    /^[ \t]*import[ \t]+\{[^}]*\}[ \t]+from[ \t]+["']([^"']+)["'];[ \t]*(?:\r?\n)?/gm;
  const inlineImportPaths = [...scriptMatch[1].matchAll(inlineImportPattern)].map(
    (match) => match[1],
  );
  assert.deepEqual(inlineImportPaths, [
    "../lib/sequencer-safety.js",
    "../lib/filter-effect.js",
    "../lib/master-effects-chain.js",
    "../lib/space-effect.js",
  ]);
  const scriptSource = scriptMatch[1]
    .replace(inlineImportPattern, "")
    .replace(
      "function renderSpaceEffectUi() {",
      "function renderSpaceEffectUi() { globalThis.__spaceUiRenderCount += 1;",
    );
  assert.doesNotMatch(scriptSource, /^\s*import\s/m);

  const ids = new Map();
  const filterDataElements = [];
  const getDataSelectorMatches = (selector) => {
    const match = selector.match(
      /^\[data-([a-z0-9-]+)(?:=['"]([^'"]+)['"])?\]$/i,
    );
    if (!match) return [];
    const key = match[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    return filterDataElements.filter((element) => {
      if (!Object.prototype.hasOwnProperty.call(element.dataset, key)) return false;
      return match[2] === undefined || element.dataset[key] === match[2];
    });
  };
  const instrumentNames = [
    ...pageSource.matchAll(/\bclass="steps"\s+data-instrument="([^"]+)"/g),
  ].map((match) => match[1]);
  assert.equal(instrumentNames.length, 14, "expected all instrument step containers");
  assert.equal(new Set(instrumentNames).size, instrumentNames.length);
  const instrumentStepContainers = new Map();
  const steps = [];
  instrumentNames.forEach((instrument) => {
    const container = new FakeElement();
    container.classList.add("steps");
    container.dataset.instrument = instrument;
    for (let stepIndex = 0; stepIndex < 16; stepIndex += 1) {
      const step = new FakeElement();
      step.classList.add("step");
      step.dataset.step = String(stepIndex);
      container.appendChild(step);
      steps.push(step);
    }
    instrumentStepContainers.set(instrument, container);
  });
  const documentListeners = new Map();
  const document = {
    activeElement: null,
    visibilityState: "visible",
    body: null,
    createElement() {
      return new FakeElement(document);
    },
    getElementById(id) {
      if (!ids.has(id)) ids.set(id, new FakeElement(document));
      return ids.get(id);
    },
    querySelector(selector) {
      if (selector === "#loopPatternBtn [data-loop-label]") {
        return document.getElementById("loopPatternBtnLabel");
      }
      const instrumentMatch = selector.match(
        /^\.steps\[data-instrument=['"]([^'"]+)['"]\]$/,
      );
      if (instrumentMatch) {
        return instrumentStepContainers.get(instrumentMatch[1]) ?? null;
      }
      if (/^#[A-Za-z0-9_-]+$/.test(selector)) {
        return document.getElementById(selector.slice(1));
      }
      if (selector === ".mobile-help-wrap") {
        return document.getElementById("mobileHelpWrap");
      }
      return getDataSelectorMatches(selector)[0] ?? null;
    },
    querySelectorAll(selector) {
      if (selector === ".step") return steps;
      if (selector === ".step.playing") {
        return steps.filter((step) => step.classList.contains("playing"));
      }
      const stepMatch = selector.match(/^\[data-step='(\d+)'\]$/);
      if (stepMatch) {
        return steps.filter((step) => step.dataset.step === stepMatch[1]);
      }
      return getDataSelectorMatches(selector);
    },
    addEventListener(type, callback) {
      const callbacks = documentListeners.get(type) ?? [];
      callbacks.push(callback);
      documentListeners.set(type, callbacks);
    },
    dispatchEvent(event) {
      event.target ??= document;
      for (const callback of documentListeners.get(event.type) ?? []) {
        callback.call(document, event);
      }
      return true;
    },
    execCommand() {
      return true;
    },
  };
  document.body = new FakeElement(document);
  instrumentStepContainers.forEach((container) => {
    container.ownerDocument = document;
    document.body.appendChild(container);
  });
  steps.forEach((step) => {
    step.ownerDocument = document;
  });
  document.getElementById("bpm").value = "120";
  document.getElementById("effects-menu-trigger").setAttribute("aria-expanded", "false");

  // This is a behavior fixture. Raw markup assertions belong to
  // filter-page-contract.test.js rather than this synthetic DOM.
  const filterElements = {
    dialog: document.getElementById("effectsDialog"),
    panel: document.getElementById("filterFxPanel"),
    toggle: document.getElementById("filterFxToggle"),
    toggleLabel: new FakeElement(document),
    body: document.getElementById("filterFxBody"),
    status: document.getElementById("filterFxStatus"),
    bypass: document.getElementById("filterFxBypassBtn"),
    preset: document.getElementById("filterFxPreset"),
    presetCards: [],
    selectedLabel: new FakeElement(document),
    reset: document.getElementById("filterFxResetBtn"),
    graphic: document.getElementById("filterFxGraphic"),
    curve: document.getElementById("filterFxCurve"),
    curveHalo: new FakeElement(document),
    graphicState: document.getElementById("filterFxGraphicState"),
    macroInputs: {},
    macroOutputs: {},
    macroCards: {},
  };
  filterElements.dialog.open = false;
  filterElements.dialog.showModal = function showModal() {
    this.__openerId = document.activeElement?.id || "effects-menu-trigger";
    this.open = true;
  };
  filterElements.dialog.close = function close() {
    this.open = false;
    document.getElementById(this.__openerId)?.focus();
    const dispatchClose = () => this.dispatchEvent({ type: "close" });
    if (options.deferredEffectsClose) deferredDialogCloseCallbacks.push(dispatchClose);
    else dispatchClose();
  };
  filterElements.panel.hidden = false;
  filterElements.panel.dataset.enabled = "false";
  filterElements.panel.dataset.available = "true";
  filterElements.toggleLabel.dataset.filterToggleLabel = "";
  filterElements.toggleLabel.textContent = "Close effects";
  filterElements.selectedLabel.dataset.filterSelectedLabel = "";
  filterElements.curveHalo.dataset.filterCurveHalo = "";
  filterElements.body.hidden = false;
  filterElements.body.inert = false;
  filterElements.toggle.setAttribute("aria-expanded", "false");
  filterElements.toggle.setAttribute("aria-label", "Close effects");
  filterElements.bypass.disabled = true;
  filterElements.preset.disabled = true;
  filterElements.preset.focusable = false;
  filterElements.reset.disabled = true;
  filterElements.preset.value = "clean";
  filterElements.panel.appendChild(filterElements.toggle);
  filterElements.toggle.appendChild(filterElements.toggleLabel);
  filterElements.panel.appendChild(filterElements.body);
  filterElements.body.appendChild(filterElements.preset);
  filterPresetCardMarkup.forEach(({ id, label }) => {
    const card = new FakeElement(document);
    card.classList.add("filter-preset-pedal");
    card.dataset.filterPresetCard = id;
    card.dataset.filterSelected = "false";
    card.dataset.filterActive = "false";
    card.setAttribute("aria-label", label);
    card.setAttribute("aria-pressed", "false");
    card.disabled = true;
    filterElements.body.appendChild(card);
    filterElements.presetCards.push(card);
    filterDataElements.push(card);
  });
  filterElements.body.appendChild(filterElements.selectedLabel);
  filterElements.body.appendChild(filterElements.reset);
  filterElements.body.appendChild(filterElements.graphic);
  filterElements.graphic.appendChild(filterElements.curveHalo);
  filterElements.graphic.appendChild(filterElements.curve);
  filterElements.graphic.appendChild(filterElements.graphicState);
  filterDataElements.push(
    filterElements.toggleLabel,
    filterElements.selectedLabel,
    filterElements.curveHalo,
  );

  const filterMacroDefaults = {
    cutoff: 100,
    resonance: 0,
    drive: 0,
    mix: 100,
  };
  Object.entries(filterMacroDefaults).forEach(([control, defaultValue]) => {
    const title = control[0].toUpperCase() + control.slice(1);
    const input = document.getElementById(`filterFx${title}`);
    const output = document.getElementById(`filterFx${title}Value`);
    const card = new FakeElement(document);
    card.classList.add("filter-fx-macro");
    card.dataset.filterControl = control;
    input.dataset.filterMacro = control;
    input.setAttribute("type", "range");
    input.setAttribute("min", "0");
    input.setAttribute("max", "100");
    input.setAttribute("step", "1");
    input.value = defaultValue.toString();
    input.disabled = true;
    output.dataset.filterOutput = control;
    card.appendChild(output);
    card.appendChild(input);
    filterElements.body.appendChild(card);
    filterElements.macroInputs[control] = input;
    filterElements.macroOutputs[control] = output;
    filterElements.macroCards[control] = card;
    filterDataElements.push(card, input, output);
  });

  const spaceElements = {
    panel: document.getElementById("spaceFxPanel"),
    body: document.getElementById("spaceFxBody"),
    status: document.getElementById("spaceFxStatus"),
    summary: document.getElementById("spaceFxSummary"),
    bypass: document.getElementById("spaceFxBypassBtn"),
    presetCards: [],
    macroInputs: {},
    macroOutputs: {},
  };
  spaceElements.panel.hidden = false;
  spaceElements.panel.dataset.enabled = "false";
  spaceElements.panel.dataset.available = "true";
  spaceElements.panel.dataset.preset = "pocket-room";
  spaceElements.summary.dataset.spaceSummary = "";
  spaceElements.status.dataset.spaceStatus = "";
  spaceElements.bypass.dataset.spaceBypass = "";
  spaceElements.panel.appendChild(spaceElements.body);
  spaceElements.body.appendChild(spaceElements.status);
  spaceElements.body.appendChild(spaceElements.summary);
  for (const { id: presetId, label } of spacePresetCardMarkup) {
    const card = new FakeElement(document);
    card.dataset.spacePreset = presetId;
    card.dataset.spaceSelected = presetId === "pocket-room" ? "true" : "false";
    card.setAttribute("aria-pressed", presetId === "pocket-room" ? "true" : "false");
    card.setAttribute("aria-label", label);
    card.disabled = true;
    spaceElements.body.appendChild(card);
    spaceElements.presetCards.push(card);
    filterDataElements.push(card);
  }
  const spaceMacroDefaults = { size: 22, decay: 18, air: 34, mix: 24 };
  Object.entries(spaceMacroDefaults).forEach(([control, defaultValue]) => {
    const title = control[0].toUpperCase() + control.slice(1);
    const input = document.getElementById(`spaceFx${title}`);
    const output = document.getElementById(`spaceFx${title}Value`);
    input.dataset.spaceMacro = control;
    input.setAttribute("type", "range");
    input.setAttribute("min", "0");
    input.setAttribute("max", "100");
    input.setAttribute("step", "1");
    input.value = defaultValue.toString();
    input.disabled = true;
    output.dataset.spaceOutput = control;
    spaceElements.body.appendChild(output);
    spaceElements.body.appendChild(input);
    spaceElements.macroInputs[control] = input;
    spaceElements.macroOutputs[control] = output;
    filterDataElements.push(input, output);
  });
  spaceElements.body.appendChild(spaceElements.bypass);
  filterElements.body.appendChild(spaceElements.panel);
  filterDataElements.push(spaceElements.status, spaceElements.summary, spaceElements.bypass);

  const intervals = new Map();
  const timeouts = new Map();
  const filterTransportTimeouts = new Map();
  let nextTimerId = 1;
  const sources = [];
  const spaceBanks = [];
  const audioFailureCounts = new Map(
    Object.entries(options.audioFailures ?? {}).map(([name, count]) => [
      name,
      count === true ? 1 : Math.max(0, Number(count) || 0),
    ]),
  );
  const audioControls = {
    consumeFailure(name) {
      const remaining = audioFailureCounts.get(name) ?? 0;
      if (remaining <= 0) return;
      audioFailureCounts.set(name, remaining - 1);
      throw new Error(`fake ${name} failure`);
    },
    consumeCleanupFailure(node, destination) {
      if (spaceDisconnectBlocked === "inlet-disconnect" &&
          node.kind === "gain" && destination?.kind === "delay") {
        throw new Error("fake Space inlet disconnect failure");
      }
    },
  };
  const gainNodes = [];
  const biquadFilterNodes = [];
  const waveShaperNodes = [];
  const compressorNodes = [];
  const delayNodes = [];
  const convolverNodes = [];

  const audioCtx = {
    currentTime: 0,
    sampleRate: 48_000,
    state: "running",
    stateListeners: new Map(),
    destination: createAudioNode({ kind: "destination" }, audioControls),
    gainNodes,
    biquadFilterNodes,
    waveShaperNodes,
    compressorNodes,
    delayNodes,
    convolverNodes,
    resumeCalls: 0,
    async decodeAudioData() {
      return {};
    },
    async resume() {
      this.resumeCalls += 1;
      this.state = "running";
    },
    addEventListener(type, callback) {
      const callbacks = this.stateListeners.get(type) ?? [];
      callbacks.push(callback); this.stateListeners.set(type, callbacks);
    },
    dispatchStateChange(state) {
      this.state = state;
      for (const callback of this.stateListeners.get("statechange") ?? []) callback();
    },
    createBufferSource() {
      audioControls.consumeFailure("createBufferSource");
      const listeners = new Map();
      const source = createAudioNode({
        kind: "buffer-source",
        buffer: null,
        playbackRate: new FakeAudioParam(1),
        starts: [],
        stops: [],
        addEventListener(type, callback) {
          const callbacks = listeners.get(type) ?? [];
          callbacks.push(callback);
          listeners.set(type, callbacks);
        },
        removeEventListener(type, callback) {
          const callbacks = listeners.get(type) ?? [];
          listeners.set(
            type,
            callbacks.filter((candidate) => candidate !== callback),
          );
        },
        start(when) {
          audioControls.consumeFailure("sourceStart");
          this.starts.push(when);
        },
        stop(when = 0) {
          this.stops.push(when);
        },
        emit(type) {
          for (const callback of listeners.get(type) ?? []) callback.call(this);
          if (type === "ended" && typeof this.onended === "function") {
            this.onended();
          }
        },
      }, audioControls);
      sources.push(source);
      return source;
    },
    createGain() {
      audioControls.consumeFailure("createGain");
      const node = createAudioNode(
        {
          kind: "gain",
          gain: new FakeAudioParam(1),
        },
        audioControls,
      );
      gainNodes.push(node);
      return node;
    },
    createBiquadFilter() {
      audioControls.consumeFailure("createBiquadFilter");
      const node = createAudioNode(
        {
          kind: "biquad-filter",
          type: "allpass",
          frequency: new FakeAudioParam(350),
          Q: new FakeAudioParam(1),
        },
        audioControls,
      );
      biquadFilterNodes.push(node);
      return node;
    },
    createDelay() {
      audioControls.consumeFailure("createDelay");
      const node = createAudioNode({kind:"delay",delayTime:new FakeAudioParam(0)},audioControls);
      delayNodes.push(node); return node;
    },
    createConvolver() {
      audioControls.consumeFailure("createConvolver");
      const node = createAudioNode({kind:"convolver",normalize:true},audioControls);
      let buffer = null;
      Object.defineProperty(node, "buffer", {
        enumerable: true,
        get() { return buffer; },
        set(value) {
          if (spaceDisconnectBlocked === "buffer-null" && value === null && buffer !== null) {
            throw new Error("fake Space buffer null failure");
          }
          buffer = value;
        },
      });
      convolverNodes.push(node); return node;
    },
    createBuffer(channels, length, sampleRate) {
      const data = Array.from({length:channels},()=>new Float32Array(length));
      return {numberOfChannels:channels,length,sampleRate,copyToChannel(values,index){data[index].set(values);},getChannelData(index){return data[index];}};
    },
    createWaveShaper() {
      audioControls.consumeFailure("createWaveShaper");
      const node = createAudioNode(
        {
          kind: "wave-shaper",
          curve: null,
          oversample: "none",
        },
        audioControls,
      );
      waveShaperNodes.push(node);
      return node;
    },
    createDynamicsCompressor() {
      audioControls.consumeFailure("createDynamicsCompressor");
      const node = createAudioNode(
        {
          kind: "dynamics-compressor",
          attack: new FakeAudioParam(),
          knee: new FakeAudioParam(),
          ratio: new FakeAudioParam(),
          release: new FakeAudioParam(),
          threshold: new FakeAudioParam(),
        },
        audioControls,
      );
      compressorNodes.push(node);
      return node;
    },
    failNext(name, count = 1) {
      audioFailureCounts.set(name, Math.max(0, Number(count) || 0));
    },
    clearFailures() {
      audioFailureCounts.clear();
    },
  };
  if (options.omitDynamicsCompressor) {
    audioCtx.createDynamicsCompressor = undefined;
  }

  class FakeAudioContext {
    constructor() {
      return audioCtx;
    }
  }

  const windowListeners = new Map();
  const animationFrames = new Map();
  let nextAnimationFrameId = 1;
  const clipboardWrites = [];
  const window = {
    AudioContext: FakeAudioContext,
    webkitAudioContext: FakeAudioContext,
    PointerEvent: undefined,
    location: { origin: "https://example.test", pathname: "/", search: "" },
    history: {
      replaceState(_state, _title, url) {
        window.location.search = String(url).includes("?")
          ? String(url).slice(String(url).indexOf("?"))
          : "";
      },
    },
    matchMedia(query) {
      return {
        media: String(query),
        matches:
          Boolean(options.reducedMotion) &&
          String(query) === "(prefers-reduced-motion: reduce)",
      };
    },
    addEventListener(type, callback) {
      const callbacks = windowListeners.get(type) ?? [];
      callbacks.push(callback);
      windowListeners.set(type, callbacks);
    },
    dispatchEvent(event) {
      event.target ??= window;
      event.currentTarget = window;
      for (const callback of windowListeners.get(event.type) ?? []) {
        callback.call(window, event);
      }
      return true;
    },
    requestAnimationFrame(callback) {
      const id = nextAnimationFrameId++;
      animationFrames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      animationFrames.delete(id);
    },
    flushAnimationFrames() {
      const callbacks = Array.from(animationFrames.values());
      animationFrames.clear();
      callbacks.forEach((callback) => callback(Date.now()));
    },
    async dispatchEventAsync(event) {
      event.target ??= window;
      event.currentTarget = window;
      for (const callback of windowListeners.get(event.type) ?? []) {
        await callback.call(window, event);
      }
      return true;
    },
  };

  class FakeEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.defaultPrevented = false;
      Object.assign(this, init);
    }

    preventDefault() {
      this.defaultPrevented = true;
    }

    stopPropagation() {}
  }

  class FakeCustomEvent extends FakeEvent {
    constructor(type, init = {}) {
      super(type, init);
      this.detail = init.detail;
    }
  }

  const alerts = [];
  const consoleMessages = [];
  const filterTransportEvents = [];
  let context = null;

  function setPageTimeout(callback, delay, ...args) {
    const id = nextTimerId++;
    timeouts.set(id, {
      callback: () => callback(...args),
      delay,
    });
    return id;
  }

  function clearPageTimeout(id) {
    timeouts.delete(id);
  }

  function setFilterTransportTimeout(callback, delay, ...args) {
    const id = nextTimerId++;
    filterTransportTimeouts.set(id, {
      callback: () => withHarnessTimers(() => callback(...args)),
      delay,
    });
    return id;
  }

  function clearFilterTransportTimeout(id) {
    filterTransportTimeouts.delete(id);
  }

  function withHarnessTimers(callback) {
    const previousSetTimeout = globalThis.setTimeout;
    const previousClearTimeout = globalThis.clearTimeout;
    globalThis.setTimeout = setFilterTransportTimeout;
    globalThis.clearTimeout = clearFilterTransportTimeout;
    try {
      return callback();
    } finally {
      globalThis.setTimeout = previousSetTimeout;
      globalThis.clearTimeout = previousClearTimeout;
    }
  }

  function recordFilterTransportEvent(type, graph) {
    filterTransportEvents.push({
      type,
      snapshot:
        context && context.__jamTest
          ? hostCopy(context.__jamTest.snapshot())
          : null,
      transportState: hostCopy(graph.getTransportState()),
      outputGain: graph.nodes.output.gain.value,
      filterNodeCount: biquadFilterNodes.length,
      waveShaperNodeCount: waveShaperNodes.length,
    });
  }

  function createHarnessMasterFilterGraph(...args) {
    const graph = withHarnessTimers(() => createMasterFilterGraph(...args));
    return Object.freeze({
      ...graph,
      silence(options) {
        recordFilterTransportEvent("silence", graph);
        return withHarnessTimers(() => graph.silence(options));
      },
      wake(options) {
        recordFilterTransportEvent("wake", graph);
        return withHarnessTimers(() => graph.wake(options));
      },
      disconnect() {
        return withHarnessTimers(() => graph.disconnect());
      },
    });
  }

  function createHarnessMasterEffectsChain(audioContext, destination, initialStates, chainOptions = {}) {
    return createMasterEffectsChain(audioContext, destination, initialStates, {
      ...chainOptions,
      setTimeout: setFilterTransportTimeout,
      clearTimeout: clearFilterTransportTimeout,
      createToneGraph: createHarnessMasterFilterGraph,
      createSpaceGraph(contextValue, destinationValue, initialState) {
        let buildingBank = null;
        const registryContext = Object.create(contextValue);
        registryContext.createDelay = function () {
          const delay = contextValue.createDelay();
          buildingBank = { delay };
          return delay;
        };
        registryContext.createConvolver = function () {
          const convolver = contextValue.createConvolver();
          if (buildingBank) buildingBank.convolver = convolver;
          return convolver;
        };
        registryContext.createBiquadFilter = function () {
          const filter = contextValue.createBiquadFilter();
          if (buildingBank) buildingBank.filter = filter;
          return filter;
        };
        registryContext.createGain = function () {
          const gain = contextValue.createGain();
          if (buildingBank) {
            buildingBank.gain = gain;
            spaceBanks.push(buildingBank);
            buildingBank = null;
          }
          return gain;
        };
        return createMasterReverbGraph(registryContext, destinationValue, initialState, {
          setTimeout: setFilterTransportTimeout,
          clearTimeout: clearFilterTransportTimeout,
          queueMicrotask(callback) { Promise.resolve().then(callback); },
          generateImpulse({ size, decay, sampleRate }) {
            return {size,decay,sampleRate,frameCount:8,channels:[new Float32Array(8),new Float32Array(8)]};
          },
        });
      },
    });
  }

  const sandbox = {
    __spaceUiRenderCount: 0,
    window,
    document,
    Element: FakeElement,
    Event: FakeEvent,
    CustomEvent: FakeCustomEvent,
    navigator: {
      clipboard: {
        async writeText(value) {
          clipboardWrites.push(String(value));
        },
      },
    },
    alert(message) {
      alerts.push(String(message));
    },
    console: {
      log(...args) {
        consoleMessages.push({ level: "log", args });
      },
      warn(...args) {
        consoleMessages.push({ level: "warn", args });
      },
      error(...args) {
        consoleMessages.push({ level: "error", args });
      },
    },
    fetch: async () => {
      throw new Error("sample loading is outside this unit harness");
    },
    atob,
    btoa,
    URLSearchParams,
    Uint8Array,
    ArrayBuffer,
    Map,
    Set,
    DEFAULT_BPM,
    FILTER_SONG_SCHEMA_VERSION,
    createDefaultFilterEffectState,
    createMasterEffectsChain: createHarnessMasterEffectsChain,
    deserializeFilterEffectState,
    formatFilterMacroValue,
    getFilterEffectPresetState,
    getFilterGraphicSummary,
    getSixteenthNoteDurationSeconds,
    normalizeFilterEffectState,
    normalizeBpm,
    serializeFilterEffectState,
    createDefaultSpaceEffectState,
    deserializeSpaceEffectState,
    getSpaceEffectPresetState,
    formatSpaceMacroValue,
    getSpaceEffectSummary,
    normalizeSpaceEffectState,
    serializeSpaceEffectState,
    setInterval(callback, _delay, ...args) {
      const id = nextTimerId++;
      intervals.set(id, () => callback(...args));
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    setTimeout: setPageTimeout,
    clearTimeout: clearPageTimeout,
  };
  window.setInterval = sandbox.setInterval;
  window.clearInterval = sandbox.clearInterval;
  window.setTimeout = sandbox.setTimeout;
  window.clearTimeout = sandbox.clearTimeout;

  const expose = `
globalThis.__jamTest = {
  FILTER_SONG_SCHEMA_VERSION,
  encodeSongState,
  encodeMixParam,
  loadMixParam,
  loadSongStateFromBase64,
  loadSinglePatternFromBase64,
  loadFromURLParams,
  movePatternByOffset,
  setFilterEffectState,
  applyFilterEffectPreset,
  resetFilterEffectState,
  setFilterPanelExpanded,
  bindFilterEffectControls,
  renderFilterEffectUi,
  renderSpaceEffectUi,
  initializeMasterOutput,
  disableFilterEffectGraph,
  getValidatedBpm,
  startSequencer,
  stopSequencer,
  schedulerLoop,
  nextNote,
  scheduleStep,
  playSound,
  resetProjectState,
  getFilterEffectState: function () {
    return { ...filterEffectState };
  },
  getSpaceEffectState: function () {
    return { ...spaceEffectState };
  },
  setSpaceEffectStateThroughController: function (next, options) {
    return spaceController.setState(next, options);
  },
  makeSpaceUnavailableThroughController: function () {
    return spaceController.makeUnavailable();
  },
  makeToneUnavailableThroughController: function () {
    if (masterEffectsChain) masterEffectsChain.makeToneUnavailable();
    masterFilterGraph = null;
    filterEffectAvailable = false;
    renderFilterEffectUi();
  },
  getSpaceControllerKeys: function () {
    return Object.keys(spaceController);
  },
  syncSelectedPatternToGrid: function () {
    loadSelectedPatternIntoGrid();
  },
  getMasterFilterGraph: function () {
    return masterFilterGraph;
  },
  getMasterEffectsChain: function () {
    return masterEffectsChain;
  },
  retireMasterEffectsChainForTest: function () {
    try { masterGainNode?.disconnect(); } catch (_error) {}
    try { masterEffectsChain?.disconnect(); } catch (_error) {}
    masterEffectsChain = null; masterFilterGraph = null;
    masterGainNode = null; masterProtectionNode = null; masterOutputDestination = null;
  },
  snapshot: function () {
    return {
      instrumentsOrder: Array.from(instrumentsOrder),
      patterns: patterns.map(function (pattern) { return Array.from(pattern); }),
      patternRepeats: Array.from(patternRepeats),
      patternPitchOffsets: patternPitchOffsets,
      instrumentVolumes: instrumentVolumes,
      selectedPatternIndex: selectedPatternIndex,
      playbackPatternIndex: playbackPatternIndex,
      isPlaying: isPlaying,
      isStartingPlayback: isStartingPlayback,
      current16th: current16th,
      nextNoteTime: nextNoteTime,
      schedulerIntervalId: schedulerIntervalId,
      bpm: bpmInput.value,
      scheduledSourceCount: scheduledSources.size,
      retiringSourceCount: retiringSources.size,
      scheduledHighlightTimerCount: scheduledHighlightTimers.size,
      filterEffectState: { ...filterEffectState },
      spaceEffectState: { ...spaceEffectState },
      filterEffectAvailable: filterEffectAvailable,
      spaceEffectAvailable: spaceEffectAvailable,
      filterPanelExpanded: Boolean(effectsDialog && effectsDialog.open),
      filterPanelAriaExpanded: filterFxToggle
        ? filterFxToggle.getAttribute("aria-expanded")
        : null,
      effectsCommandAriaExpanded: document
        .getElementById("effects-menu-trigger")
        ?.getAttribute("aria-expanded") ?? null,
      filterControlsBound: filterControlsBound,
      masterFilterGraphPresent: Boolean(masterFilterGraph),
      masterEffectsChainPresent: Boolean(masterEffectsChain),
      blockedMasterEffectsChainPresent: Boolean(blockedMasterEffectsChain),
      masterEffectsRoute: masterEffectsChain
        ? (masterEffectsChain.toneGraph ? "tone-" : "") +
          (masterEffectsChain.spaceGraph ? "space-" : "") + "gate"
        : null,
      masterTerminalGateGain: masterEffectsChain?.terminalGate?.gain.value ?? null,
      masterFilterGraphState: masterFilterGraph ? masterFilterGraph.getState() : null,
      masterFilterGraphTransportState:
        masterFilterGraph ? masterFilterGraph.getTransportState() : null,
      masterFilterOutputGain:
        masterFilterGraph ? masterFilterGraph.nodes.output.gain.value : null,
      masterGainConnectionCount: masterGainNode ? masterGainNode.connections.length : 0,
      masterGainConnectedToFilter:
        Boolean(masterGainNode && masterFilterGraph) &&
        masterGainNode.connections.indexOf(masterFilterGraph.input) !== -1,
      filterOutputConnectedToProtection:
        Boolean(masterFilterGraph && masterOutputDestination) &&
        masterFilterGraph.output.connections.indexOf(masterOutputDestination) !== -1,
      masterProtectionConnectedToDestination:
        Boolean(masterProtectionNode && audioCtx) &&
        masterProtectionNode.connections.indexOf(audioCtx.destination) !== -1,
      audioInitializationError: audioInitializationError
        ? String(audioInitializationError.message || audioInitializationError)
        : null,
      sampleLoadStates: { ...sampleLoadStates }
    };
  },
  setState: function (next) {
    if (next.patterns) {
      patterns = next.patterns.map(function (pattern) { return new Uint8Array(pattern); });
    }
    if (next.patternRepeats) patternRepeats = Array.from(next.patternRepeats);
    if (next.patternPitchOffsets) patternPitchOffsets = next.patternPitchOffsets;
    if (next.instrumentVolumes) setAllInstrumentVolumes(next.instrumentVolumes);
    if (Object.prototype.hasOwnProperty.call(next, "selectedPatternIndex")) selectedPatternIndex = next.selectedPatternIndex;
    if (Object.prototype.hasOwnProperty.call(next, "playbackPatternIndex")) playbackPatternIndex = next.playbackPatternIndex;
    if (Object.prototype.hasOwnProperty.call(next, "nextNoteTime")) nextNoteTime = next.nextNoteTime;
    if (Object.prototype.hasOwnProperty.call(next, "current16th")) current16th = next.current16th;
    if (Object.prototype.hasOwnProperty.call(next, "isPlaying")) isPlaying = next.isPlaying;
    if (Object.prototype.hasOwnProperty.call(next, "filterEffectState")) {
      setFilterEffectState(next.filterEffectState, {
        immediate: Boolean(next.filterImmediate)
      });
    }
    if (Object.prototype.hasOwnProperty.call(next, "spaceEffectState")) {
      spaceEffectState = normalizeSpaceEffectState(next.spaceEffectState);
    }
    if (Object.prototype.hasOwnProperty.call(next, "filterPanelExpanded")) {
      setFilterPanelExpanded(next.filterPanelExpanded);
    }
    ensureSongState();
  },
  seedAudioBuffer: function (instrument, value) {
    audioBuffers[instrument] = value || {};
    sampleLoadStates[instrument] = "ready";
  },
  setSampleLoadState: function (instrument, state) {
    sampleLoadStates[instrument] = state;
  },
  setBpm: function (value) {
    bpmInput.value = String(value);
  }
};`;

  context = vm.createContext(sandbox);
  new vm.Script(scriptSource + expose, { filename: PAGE_PATH }).runInContext(context);

  return {
    api: context.__jamTest,
    alerts,
    audioCtx,
    audioNodes: {
      gains: gainNodes,
      filters: biquadFilterNodes,
      waveShapers: waveShaperNodes,
      compressors: compressorNodes,
      convolvers: convolverNodes,
      delays: delayNodes,
    },
    clipboardWrites,
    consoleMessages,
    document,
    filterElements,
    spaceElements,
    filterTransportEvents,
    filterTransportTimeouts,
    ids,
    instrumentStepContainers,
    intervals,
    spaceBanks,
    sources,
    steps,
    timeouts,
    window,
    hostSnapshot() {
      return hostCopy(context.__jamTest.snapshot());
    },
    hostFilterState() {
      return hostCopy(context.__jamTest.getFilterEffectState());
    },
    clearSpaceDisconnectFailure() {
      spaceDisconnectBlocked = false;
    },
    flushAnimationFrames() {
      window.flushAnimationFrames();
    },
    flushDeferredDialogClose() {
      const callbacks = deferredDialogCloseCallbacks.splice(0);
      callbacks.forEach((callback) => callback());
    },
    async dispatchElementEvent(element, event) {
      const fakeEvent =
        event instanceof FakeEvent
          ? event
          : new FakeEvent(event.type, event);
      await element.dispatchEventAsync(fakeEvent);
      return fakeEvent;
    },
    async dispatchWindowLoad() {
      const event = new FakeEvent("load");
      await window.dispatchEventAsync(event);
      return event;
    },
    bindFilterControls() {
      context.__jamTest.bindFilterEffectControls();
    },
    setFilterMacro(control, value, eventType = "input") {
      const input = filterElements.macroInputs[control];
      assert.ok(input, `unknown Filter macro: ${control}`);
      input.value = String(value);
      const event = new FakeEvent(eventType);
      input.dispatchEvent(event);
      return event;
    },
    setSpaceMacro(control, value, eventType = "input") {
      const input = spaceElements.macroInputs[control];
      assert.ok(input, `unknown Space macro: ${control}`);
      input.value = String(value);
      const event = new FakeEvent(eventType);
      input.dispatchEvent(event);
      return event;
    },
    clickSpaceBypass() {
      const event = new FakeEvent("click");
      spaceElements.bypass.dispatchEvent(event);
      return event;
    },
    clickSpacePreset(presetId) {
      const card = spaceElements.presetCards.find(
        (candidate) => candidate.dataset.spacePreset === String(presetId),
      );
      assert.ok(card, `unknown Space preset: ${presetId}`);
      const event = new FakeEvent("click");
      card.dispatchEvent(event);
      return event;
    },
    getSpaceUiRenderCount() {
      return context.__spaceUiRenderCount;
    },
    clickFilterControl(control) {
      const element = filterElements[control];
      assert.ok(element, `unknown Filter control: ${control}`);
      const event = new FakeEvent("click");
      element.dispatchEvent(event);
      return event;
    },
    selectFilterPreset(presetId) {
      filterElements.preset.value = String(presetId);
      const event = new FakeEvent("change");
      filterElements.preset.dispatchEvent(event);
      return event;
    },
    clickFilterPresetCard(presetId) {
      const card = filterElements.presetCards.find(
        (candidate) => candidate.dataset.filterPresetCard === String(presetId),
      );
      assert.ok(card, `unknown Filter preset card: ${presetId}`);
      const event = new FakeEvent("click");
      card.dispatchEvent(event);
      return event;
    },
    setAudioFailure(name, count = 1) {
      audioCtx.failNext(name, count);
    },
    runAllTimeouts() {
      let safety = 0;
      while (timeouts.size && safety < 1_000) {
        const pending = [...timeouts.entries()];
        timeouts.clear();
        pending.forEach(([, timer]) => timer.callback());
        safety += pending.length;
      }
      assert.ok(safety < 1_000, "fake timeout queue did not settle");
    },
    runTimeout(id) {
      const timer = timeouts.get(id);
      assert.ok(timer, `unknown page timeout: ${id}`);
      timeouts.delete(id);
      timer.callback();
    },
    runAllFilterTransportTimeouts() {
      let safety = 0;
      while (filterTransportTimeouts.size && safety < 1_000) {
        const pending = [...filterTransportTimeouts.entries()];
        filterTransportTimeouts.clear();
        pending.forEach(([, timer]) => timer.callback());
        safety += pending.length;
      }
      assert.ok(safety < 1_000, "fake Filter transport timeout queue did not settle");
    },
    dispatchVisibility(state) {
      document.visibilityState = state;
      document.dispatchEvent(new FakeEvent("visibilitychange"));
    },
  };
}
