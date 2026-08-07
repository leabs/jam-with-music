export const SPACE_EFFECT_VERSION = 1;
export const SPACE_MACRO_MIN = 0;
export const SPACE_MACRO_MAX = 100;

export const SPACE_EFFECT_DEFAULT_STATE = Object.freeze({
  enabled: false,
  size: 22,
  decay: 18,
  air: 34,
  mix: 24,
  preset: "pocket-room",
});

export const SPACE_EFFECT_PRESETS = Object.freeze([
  Object.freeze({ id: "pocket-room", name: "Pocket Room", size: 22, decay: 18, air: 34, mix: 24 }),
  Object.freeze({ id: "warm-hall", name: "Warm Hall", size: 68, decay: 64, air: 48, mix: 36 }),
  Object.freeze({ id: "shimmer", name: "Shimmer", size: 56, decay: 42, air: 86, mix: 30 }),
  Object.freeze({ id: "bloom", name: "Bloom", size: 82, decay: 78, air: 72, mix: 44 }),
]);

function getOwnValue(source, key) {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    return descriptor && Object.prototype.hasOwnProperty.call(descriptor, "value")
      ? descriptor.value
      : undefined;
  } catch (_error) {
    return undefined;
  }
}

function isRecord(value) {
  if (!value || typeof value !== "object") return false;
  try {
    return !Array.isArray(value);
  } catch (_error) {
    return false;
  }
}

function clampMacro(value, fallback) {
  const finite = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(SPACE_MACRO_MAX, Math.max(SPACE_MACRO_MIN, Math.round(finite)));
}

function getPresetDefinition(presetId) {
  return SPACE_EFFECT_PRESETS.find(function (preset) {
    return preset.id === presetId;
  });
}

function macrosMatchPreset(state, preset) {
  return Boolean(
    preset &&
      state.size === preset.size &&
      state.decay === preset.decay &&
      state.air === preset.air &&
      state.mix === preset.mix
  );
}

export function createDefaultSpaceEffectState() {
  return { ...SPACE_EFFECT_DEFAULT_STATE };
}

export function normalizeSpaceEffectState(value) {
  const source = isRecord(value) ? value : {};
  const enabledValue = getOwnValue(source, "enabled");
  const presetValue = getOwnValue(source, "preset");
  const normalized = {
    enabled:
      enabledValue === true
        ? true
        : enabledValue === false
          ? false
          : SPACE_EFFECT_DEFAULT_STATE.enabled,
    size: clampMacro(getOwnValue(source, "size"), SPACE_EFFECT_DEFAULT_STATE.size),
    decay: clampMacro(getOwnValue(source, "decay"), SPACE_EFFECT_DEFAULT_STATE.decay),
    air: clampMacro(getOwnValue(source, "air"), SPACE_EFFECT_DEFAULT_STATE.air),
    mix: clampMacro(getOwnValue(source, "mix"), SPACE_EFFECT_DEFAULT_STATE.mix),
    preset:
      typeof presetValue === "string" && presetValue.trim()
        ? presetValue.trim()
        : SPACE_EFFECT_DEFAULT_STATE.preset,
  };

  if (normalized.preset === "custom") return normalized;
  const preset = getPresetDefinition(normalized.preset);
  normalized.preset = macrosMatchPreset(normalized, preset) ? preset.id : "custom";
  return normalized;
}

export function getSpaceEffectPresetState(presetId) {
  const preset = getPresetDefinition(presetId);
  if (!preset) return null;
  return {
    enabled: true,
    size: preset.size,
    decay: preset.decay,
    air: preset.air,
    mix: preset.mix,
    preset: preset.id,
  };
}

export function isDefaultSpaceEffectState(value) {
  const state = normalizeSpaceEffectState(value);
  return Object.keys(SPACE_EFFECT_DEFAULT_STATE).every(function (key) {
    return state[key] === SPACE_EFFECT_DEFAULT_STATE[key];
  });
}

export function serializeSpaceEffectState(value) {
  const state = normalizeSpaceEffectState(value);
  if (isDefaultSpaceEffectState(state)) return null;
  return {
    v: SPACE_EFFECT_VERSION,
    e: state.enabled ? 1 : 0,
    s: state.size,
    d: state.decay,
    a: state.air,
    m: state.mix,
    p: state.preset,
  };
}

export function deserializeSpaceEffectState(value) {
  if (!isRecord(value)) {
    return createDefaultSpaceEffectState();
  }
  const version = getOwnValue(value, "v");
  if (typeof version !== "number" || version !== SPACE_EFFECT_VERSION) {
    return createDefaultSpaceEffectState();
  }

  return normalizeSpaceEffectState({
    enabled: getOwnValue(value, "e") === 1,
    size: getOwnValue(value, "s"),
    decay: getOwnValue(value, "d"),
    air: getOwnValue(value, "a"),
    mix: getOwnValue(value, "m"),
    preset: getOwnValue(value, "p"),
  });
}

export function formatSpaceMacroValue(control, value, longUnits = false) {
  const fallback = Object.prototype.hasOwnProperty.call(SPACE_EFFECT_DEFAULT_STATE, control)
    ? SPACE_EFFECT_DEFAULT_STATE[control]
    : 0;
  const normalized = clampMacro(value, fallback);
  return normalized.toString() + (longUnits ? " percent" : "%");
}

export function getSpaceEffectSummary(value) {
  const state = normalizeSpaceEffectState(value);
  const preset = getPresetDefinition(state.preset);
  const presetName = preset ? preset.name : "Custom";
  return (
    "Space Reverb · " +
    presetName +
    " · Size " +
    state.size +
    " · Decay " +
    state.decay +
    " · Air " +
    state.air +
    " · Mix " +
    state.mix
  );
}
