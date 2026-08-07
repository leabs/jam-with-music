export function createAudioParam(value = 0, controls = null, label = "param") {
  const hit = operation => controls?.hit(`${label}.${operation}`);
  return {
    value, events: [],
    cancelScheduledValues(time) { hit("cancel"); this.events.push(["cancel", time]); },
    cancelAndHoldAtTime(time) { hit("hold"); this.events.push(["hold", time]); },
    setValueAtTime(next, time) { hit("value"); this.value = next; this.events.push(["value", next, time]); },
    setTargetAtTime(next, time, constant) { hit("target"); this.value = next; this.events.push(["target", next, time, constant]); },
    linearRampToValueAtTime(next, time) { hit("ramp"); this.value = next; this.events.push(["ramp", next, time]); },
    setValueCurveAtTime(curve, time, duration) {
      hit("curve"); this.value = curve[curve.length - 1]; this.events.push(["curve", curve, time, duration]);
    },
  };
}

export function createAudioNode(kind, props = {}, controls = null) {
  const node = {
    kind, connections: [], incoming: [], disconnectCalls: 0,
    connect(destination) {
      controls?.hit(`${kind}.connect`);
      this.connections.push(destination); destination.incoming?.push(this); return destination;
    },
    disconnect(destination) {
      controls?.hit(`${kind}.disconnect`);
      if (destination && controls?.strictTargetDisconnect && !this.connections.includes(destination)) {
        throw new Error("InvalidAccessError");
      }
      this.disconnectCalls += 1;
      const targets = destination ? this.connections.filter(item => item === destination) : [...this.connections];
      for (const target of targets) {
        if (target.incoming) target.incoming = target.incoming.filter(item => item !== this);
      }
      this.connections = destination ? this.connections.filter(item => item !== destination) : [];
    },
    ...props,
  };
  return node;
}

export function createMasterEffectsAudioFake(options = {}) {
  const timers = new Map(); const microtasks = []; let timerId = 1; let operation = 0;
  const controls = {
    strictTargetDisconnect: Boolean(options.strictTargetDisconnect),
    hit(label) {
      operation += 1;
      if (options.failAt === operation || options.failLabel === label) throw new Error(`injected:${label}`);
    },
    get operation() { return operation; },
  };
  const makeParam = (value, label) => createAudioParam(value, controls, label);
  const context = {
    currentTime: 1, sampleRate: options.sampleRate || 48000, state: "running", nodes: [], buffers: [],
    destination: createAudioNode("destination", {}, controls),
    createGain() { controls.hit("createGain"); return this.track(createAudioNode("gain", { gain: makeParam(1, "gain") }, controls)); },
    createDelay() { controls.hit("createDelay"); return this.track(createAudioNode("delay", { delayTime: makeParam(0, "delayTime") }, controls)); },
    createConvolver() {
      controls.hit("createConvolver");
      const node = createAudioNode("convolver", { normalize: true, _buffer: null }, controls);
      Object.defineProperty(node, "buffer", {
        get() { return this._buffer; },
        set(value) { controls.hit("convolver.buffer"); this._buffer = value; },
      });
      return this.track(node);
    },
    createBiquadFilter() {
      controls.hit("createBiquadFilter");
      return this.track(createAudioNode("biquad", {
        type: "allpass", frequency: makeParam(350, "frequency"), Q: makeParam(1, "Q"),
      }, controls));
    },
    createWaveShaper() { controls.hit("createWaveShaper"); return this.track(createAudioNode("waveshaper", { curve: null, oversample: "none" }, controls)); },
    createBuffer(channels, length, rate) {
      controls.hit("createBuffer");
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      const buffer = {
        numberOfChannels: channels, length, sampleRate: rate,
        copyToChannel(array, channel) { controls.hit(`buffer.copy${channel}`); data[channel].set(array); },
        getChannelData(channel) { return data[channel]; },
      };
      this.buffers.push(buffer); return buffer;
    },
    track(node) { this.nodes.push(node); return node; },
  };
  return {
    context, controls, timers, microtasks,
    queueMicrotask(fn) { controls.hit("queueMicrotask"); microtasks.push(fn); },
    flushMicrotasks() { while (microtasks.length) microtasks.shift()(); },
    setTimeout(fn, milliseconds) { controls.hit("setTimeout"); const id = timerId++; timers.set(id, { fn, ms: milliseconds }); return id; },
    clearTimeout(id) { controls.hit("clearTimeout"); timers.delete(id); },
    runTimers() { for (const [id, timer] of [...timers]) { timers.delete(id); timer.fn(); } },
    liveNodes() { return context.nodes.filter(node => node.connections.length || node.incoming.length); },
  };
}
