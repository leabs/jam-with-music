import assert from "node:assert/strict";
import test from "node:test";

import * as spaceEffect from "../src/lib/space-effect.js";

const DEFAULT = {
  enabled: false,
  size: 22,
  decay: 18,
  air: 34,
  mix: 24,
  preset: "pocket-room",
};

const PRESETS = [
  { id: "pocket-room", name: "Pocket Room", size: 22, decay: 18, air: 34, mix: 24 },
  { id: "warm-hall", name: "Warm Hall", size: 68, decay: 64, air: 48, mix: 36 },
  { id: "shimmer", name: "Shimmer", size: 56, decay: 42, air: 86, mix: 30 },
  { id: "bloom", name: "Bloom", size: 82, decay: 78, air: 72, mix: 44 },
];

test("Space exposes exactly the frozen pure state surface", () => {
  assert.deepEqual(Object.keys(spaceEffect).sort(), [
    "SPACE_EFFECT_DEFAULT_STATE",
    "SPACE_EFFECT_PRESETS",
    "SPACE_EFFECT_VERSION",
    "SPACE_MACRO_MAX",
    "SPACE_MACRO_MIN",
    "createDefaultSpaceEffectState",
    "deserializeSpaceEffectState",
    "formatSpaceMacroValue",
    "getSpaceEffectPresetState",
    "getSpaceEffectSummary",
    "isDefaultSpaceEffectState",
    "normalizeSpaceEffectState",
    "serializeSpaceEffectState",
  ]);
  assert.equal(spaceEffect.SPACE_EFFECT_VERSION, 1);
  assert.equal(spaceEffect.SPACE_MACRO_MIN, 0);
  assert.equal(spaceEffect.SPACE_MACRO_MAX, 100);
  assert.deepEqual(spaceEffect.SPACE_EFFECT_DEFAULT_STATE, DEFAULT);
  assert.deepEqual(spaceEffect.SPACE_EFFECT_PRESETS, PRESETS);
  assert.ok(Object.isFrozen(spaceEffect.SPACE_EFFECT_DEFAULT_STATE));
  assert.ok(Object.isFrozen(spaceEffect.SPACE_EFFECT_PRESETS));
  assert.ok(spaceEffect.SPACE_EFFECT_PRESETS.every(Object.isFrozen));
});

test("Space defaults and normalization are fresh, strict, bounded, and non-mutating", () => {
  const first = spaceEffect.createDefaultSpaceEffectState();
  const second = spaceEffect.createDefaultSpaceEffectState();
  assert.deepEqual(first, DEFAULT);
  assert.notEqual(first, second);

  const input = { enabled: true, size: 68, decay: 64, air: 48, mix: 36, preset: "warm-hall" };
  assert.deepEqual(spaceEffect.normalizeSpaceEffectState(input), input);
  assert.deepEqual(input, { enabled: true, size: 68, decay: 64, air: 48, mix: 36, preset: "warm-hall" });

  for (const malformed of [null, undefined, "50", true, [], [50], {}, NaN, Infinity, -Infinity]) {
    assert.deepEqual(
      spaceEffect.normalizeSpaceEffectState({
        enabled: 1,
        size: malformed,
        decay: malformed,
        air: malformed,
        mix: malformed,
        preset: "custom",
      }),
      { ...DEFAULT, preset: "custom" }
    );
  }

  assert.deepEqual(
    spaceEffect.normalizeSpaceEffectState({ enabled: true, size: -1, decay: 18.5, air: 99.5, mix: 101, preset: "custom" }),
    { enabled: true, size: 0, decay: 19, air: 100, mix: 100, preset: "custom" }
  );

  const inherited = Object.create({ enabled: true, size: 82, decay: 78, air: 72, mix: 44, preset: "bloom" });
  assert.deepEqual(spaceEffect.normalizeSpaceEffectState(inherited), DEFAULT);

  const throwing = {};
  for (const key of ["enabled", "size", "decay", "air", "mix", "preset"]) {
    Object.defineProperty(throwing, key, {
      get() {
        throw new Error("must not invoke " + key);
      },
    });
  }
  assert.deepEqual(spaceEffect.normalizeSpaceEffectState(throwing), DEFAULT);

  for (const malformed of [Symbol("macro"), 1n, function () {}, { valueOf() { throw new Error("no coercion"); } }]) {
    assert.deepEqual(
      spaceEffect.normalizeSpaceEffectState({ size: malformed, decay: malformed, air: malformed, mix: malformed }),
      DEFAULT
    );
  }
});

test("named presets are truthful while Custom remains sticky", () => {
  for (const preset of PRESETS) {
    assert.deepEqual(spaceEffect.getSpaceEffectPresetState(preset.id), {
      enabled: true,
      size: preset.size,
      decay: preset.decay,
      air: preset.air,
      mix: preset.mix,
      preset: preset.id,
    });
    assert.equal(spaceEffect.normalizeSpaceEffectState({ ...preset, enabled: false, preset: preset.id }).preset, preset.id);
    assert.equal(spaceEffect.normalizeSpaceEffectState({ ...preset, enabled: false, preset: preset.id, mix: preset.mix + 1 }).preset, "custom");
    assert.equal(spaceEffect.normalizeSpaceEffectState({ ...preset, enabled: false, preset: "custom" }).preset, "custom");
  }
  assert.equal(spaceEffect.getSpaceEffectPresetState("unknown"), null);
});

test("Space wire encoding is ordered, omits only neutral, and decodes strictly", () => {
  assert.equal(spaceEffect.serializeSpaceEffectState(DEFAULT), null);
  assert.deepEqual(spaceEffect.serializeSpaceEffectState({ ...DEFAULT, enabled: true }), {
    v: 1, e: 1, s: 22, d: 18, a: 34, m: 24, p: "pocket-room",
  });
  assert.deepEqual(Object.keys(spaceEffect.serializeSpaceEffectState({ ...DEFAULT, mix: 25, preset: "custom" })), ["v", "e", "s", "d", "a", "m", "p"]);

  for (const invalid of [null, [], 1, "wire", { v: "1" }, { v: 2 }, Object.create({ v: 1 })]) {
    const decoded = spaceEffect.deserializeSpaceEffectState(invalid);
    assert.deepEqual(decoded, DEFAULT);
    assert.notEqual(decoded, spaceEffect.SPACE_EFFECT_DEFAULT_STATE);
  }

  const inherited = Object.create({ e: 1, s: 82, d: 78, a: 72, m: 44, p: "bloom" });
  inherited.v = 1;
  inherited.e = 1;
  inherited.s = 68;
  inherited.extra = "ignored";
  assert.deepEqual(spaceEffect.deserializeSpaceEffectState(inherited), {
    enabled: true, size: 68, decay: 18, air: 34, mix: 24, preset: "custom",
  });
});

test("Space formatting and summary use canonical normalized values", () => {
  assert.equal(spaceEffect.formatSpaceMacroValue("size", 42.6), "43%");
  assert.equal(spaceEffect.formatSpaceMacroValue("mix", "42", true), "24 percent");
  assert.equal(
    spaceEffect.getSpaceEffectSummary(spaceEffect.getSpaceEffectPresetState("bloom")),
    "Space Reverb · Bloom · Size 82 · Decay 78 · Air 72 · Mix 44"
  );
});

test("every public Space helper is nonthrowing for revoked proxies", () => {
  const target = {};
  const { proxy, revoke } = Proxy.revocable(target, {});
  revoke();

  assert.doesNotThrow(() => spaceEffect.normalizeSpaceEffectState(proxy));
  assert.doesNotThrow(() => spaceEffect.deserializeSpaceEffectState(proxy));
  assert.doesNotThrow(() => spaceEffect.serializeSpaceEffectState(proxy));
  assert.doesNotThrow(() => spaceEffect.isDefaultSpaceEffectState(proxy));
  assert.doesNotThrow(() => spaceEffect.getSpaceEffectSummary(proxy));
  assert.deepEqual(spaceEffect.normalizeSpaceEffectState(proxy), DEFAULT);
  assert.deepEqual(spaceEffect.deserializeSpaceEffectState(proxy), DEFAULT);
  assert.equal(spaceEffect.serializeSpaceEffectState(proxy), null);
  assert.equal(spaceEffect.isDefaultSpaceEffectState(proxy), true);
});
