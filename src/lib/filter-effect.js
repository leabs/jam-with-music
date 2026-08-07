export const FILTER_EFFECT_VERSION = 1;
export const FILTER_SONG_SCHEMA_VERSION = 5;
export const FILTER_MACRO_MIN = 0;
export const FILTER_MACRO_MAX = 100;

const FILTER_MIN_FREQUENCY_HZ = 80;
const FILTER_MAX_FREQUENCY_HZ = 18000;

export const FILTER_EFFECT_DEFAULT_STATE = Object.freeze({
  enabled: false,
  cutoff: 100,
  resonance: 0,
  drive: 0,
  mix: 100,
  preset: "clean",
});

export const FILTER_EFFECT_PRESETS = Object.freeze([
  Object.freeze({
    id: "clean",
    name: "Clean",
    cutoff: 100,
    resonance: 0,
    drive: 0,
    mix: 100,
  }),
  Object.freeze({
    id: "warm",
    name: "Warm",
    cutoff: 68,
    resonance: 18,
    drive: 14,
    mix: 78,
  }),
  Object.freeze({
    id: "bright",
    name: "Bright",
    cutoff: 90,
    resonance: 10,
    drive: 8,
    mix: 94,
  }),
  Object.freeze({
    id: "resonant-sweep",
    name: "Resonant Sweep",
    cutoff: 45,
    resonance: 64,
    drive: 5,
    mix: 72,
  }),
  Object.freeze({
    id: "grit",
    name: "Grit",
    cutoff: 60,
    resonance: 28,
    drive: 68,
    mix: 76,
  }),
]);

function toFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clampMacro(value, fallback) {
  const parsed = toFiniteNumber(value);
  const nextValue = parsed === null ? fallback : parsed;
  return Math.min(FILTER_MACRO_MAX, Math.max(FILTER_MACRO_MIN, Math.round(nextValue)));
}

function normalizeEnabled(value, fallback) {
  if (value === true) return true;
  if (value === false) return false;
  return fallback;
}

function getOwnValue(source, key) {
  return Object.prototype.hasOwnProperty.call(source, key) ? source[key] : undefined;
}

function getPresetDefinition(presetId) {
  return FILTER_EFFECT_PRESETS.find(function (preset) {
    return preset.id === presetId;
  });
}

function macrosMatchPreset(state, preset) {
  return Boolean(
    preset &&
      state.cutoff === preset.cutoff &&
      state.resonance === preset.resonance &&
      state.drive === preset.drive &&
      state.mix === preset.mix
  );
}

export function createDefaultFilterEffectState() {
  return { ...FILTER_EFFECT_DEFAULT_STATE };
}

export function normalizeFilterEffectState(value) {
  const source = value && typeof value === "object" ? value : {};
  const normalized = {
    enabled: normalizeEnabled(
      getOwnValue(source, "enabled"),
      FILTER_EFFECT_DEFAULT_STATE.enabled
    ),
    cutoff: clampMacro(getOwnValue(source, "cutoff"), FILTER_EFFECT_DEFAULT_STATE.cutoff),
    resonance: clampMacro(
      getOwnValue(source, "resonance"),
      FILTER_EFFECT_DEFAULT_STATE.resonance
    ),
    drive: clampMacro(getOwnValue(source, "drive"), FILTER_EFFECT_DEFAULT_STATE.drive),
    mix: clampMacro(getOwnValue(source, "mix"), FILTER_EFFECT_DEFAULT_STATE.mix),
    preset:
      typeof getOwnValue(source, "preset") === "string" &&
      getOwnValue(source, "preset").trim()
        ? getOwnValue(source, "preset").trim()
        : FILTER_EFFECT_DEFAULT_STATE.preset,
  };

  if (normalized.preset === "custom") {
    return normalized;
  }

  const preset = getPresetDefinition(normalized.preset);
  normalized.preset = macrosMatchPreset(normalized, preset) ? preset.id : "custom";
  return normalized;
}

export function getFilterEffectPresetState(presetId) {
  const preset = getPresetDefinition(presetId);
  if (!preset) return null;
  return normalizeFilterEffectState({
    enabled: true,
    cutoff: preset.cutoff,
    resonance: preset.resonance,
    drive: preset.drive,
    mix: preset.mix,
    preset: preset.id,
  });
}

export function isDefaultFilterEffectState(value) {
  const state = normalizeFilterEffectState(value);
  return (
    state.enabled === FILTER_EFFECT_DEFAULT_STATE.enabled &&
    state.cutoff === FILTER_EFFECT_DEFAULT_STATE.cutoff &&
    state.resonance === FILTER_EFFECT_DEFAULT_STATE.resonance &&
    state.drive === FILTER_EFFECT_DEFAULT_STATE.drive &&
    state.mix === FILTER_EFFECT_DEFAULT_STATE.mix &&
    state.preset === FILTER_EFFECT_DEFAULT_STATE.preset
  );
}

export function serializeFilterEffectState(value) {
  const state = normalizeFilterEffectState(value);
  if (isDefaultFilterEffectState(state)) return null;
  return {
    v: FILTER_EFFECT_VERSION,
    e: state.enabled ? 1 : 0,
    c: state.cutoff,
    r: state.resonance,
    d: state.drive,
    m: state.mix,
    p: state.preset,
  };
}

export function deserializeFilterEffectState(value) {
  if (!value || typeof value !== "object" || value.v !== FILTER_EFFECT_VERSION) {
    return createDefaultFilterEffectState();
  }
  return normalizeFilterEffectState({
    enabled: value.e === 1 ? true : value.e === 0 ? false : false,
    cutoff: value.c,
    resonance: value.r,
    drive: value.d,
    mix: value.m,
    preset: value.p,
  });
}

export function getFilterCutoffFrequencyHz(value) {
  const cutoff = clampMacro(value, FILTER_EFFECT_DEFAULT_STATE.cutoff);
  const ratio = FILTER_MAX_FREQUENCY_HZ / FILTER_MIN_FREQUENCY_HZ;
  return FILTER_MIN_FREQUENCY_HZ * Math.pow(ratio, cutoff / FILTER_MACRO_MAX);
}

function formatKilohertz(hertz) {
  const value = Math.round((hertz / 1000) * 10) / 10;
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

export function formatFilterCutoffValue(value, longUnits = false) {
  const hertz = getFilterCutoffFrequencyHz(value);
  if (hertz >= 1000) {
    return formatKilohertz(hertz) + (longUnits ? " kilohertz" : " kHz");
  }
  const roundedHertz = Math.round(hertz / 5) * 5;
  return roundedHertz.toString() + (longUnits ? " hertz" : " Hz");
}

export function getFilterDriveDescriptor(value) {
  const drive = clampMacro(value, FILTER_EFFECT_DEFAULT_STATE.drive);
  if (drive === 0) return "Clean";
  if (drive < 30) return "Gentle";
  if (drive < 60) return "Warm";
  return "Driven";
}

export function getFilterMixDescriptor(value) {
  const mix = clampMacro(value, FILTER_EFFECT_DEFAULT_STATE.mix);
  if (mix === 0) return "Dry";
  if (mix >= 90) return "Wet";
  return "Blend";
}

export function getFilterGraphicSummary(value) {
  const state = normalizeFilterEffectState(value);
  if (!state.enabled) {
    return {
      label: "Bypassed",
      description: "Filter response: bypassed. Macro settings are preserved.",
    };
  }

  if (state.preset === "custom") {
    const canonicalValues = [
      "Cutoff " + state.cutoff,
      "Resonance " + state.resonance,
      "Drive " + state.drive,
      "Mix " + state.mix,
    ];
    return {
      label: ["Custom", ...canonicalValues].join(" · "),
      description:
        "Filter response: custom. " +
        canonicalValues.join(", ").toLowerCase() +
        ", each out of 100.",
    };
  }

  const cutoff = state.cutoff < 75 ? "Dark" : "Bright";
  const resonance = state.resonance >= 45 ? "Peaked" : "Calm";
  const drive = getFilterDriveDescriptor(state.drive);
  const mix = getFilterMixDescriptor(state.mix);
  const accessibleMix = state.mix === 100 ? "Fully wet" : mix;
  return {
    label: [cutoff, resonance, drive, mix].join(" · "),
    description:
      "Filter response: " +
      [cutoff, resonance, drive, accessibleMix]
        .map(function (part) {
          return part.toLowerCase();
        })
        .join(", ") +
      ".",
  };
}

export function formatFilterMacroValue(control, value, longUnits = false) {
  const normalizedValue = clampMacro(value, FILTER_EFFECT_DEFAULT_STATE[control] ?? 0);
  if (control === "cutoff") {
    return formatFilterCutoffValue(normalizedValue, longUnits);
  }
  if (control === "drive") {
    const descriptor = getFilterDriveDescriptor(normalizedValue);
    return longUnits
      ? normalizedValue.toString() + " percent, " + descriptor.toLowerCase()
      : normalizedValue.toString() + "%, " + descriptor;
  }
  if (control === "mix") {
    const descriptor = getFilterMixDescriptor(normalizedValue);
    return longUnits
      ? normalizedValue.toString() + " percent, " + descriptor.toLowerCase()
      : normalizedValue.toString() + "%, " + descriptor;
  }
  return normalizedValue.toString() + (longUnits ? " percent" : "%");
}
