import assert from "node:assert/strict";
import test from "node:test";
import {
  focusNextMatchingMenubarTrigger,
  isTypeaheadPrintableKey,
} from "../src/components/menubar-typeahead.js";

function event(key, overrides = {}) {
  return { key, altKey: false, ctrlKey: false, metaKey: false, ...overrides };
}

function trigger(label, { disabled = false } = {}) {
  return {
    disabled,
    textContent: label,
    focusCalls: 0,
    getAttribute() {
      return null;
    },
    focus() {
      this.focusCalls += 1;
    },
  };
}

function root(triggers) {
  return { querySelectorAll: () => triggers };
}

test("typeahead accepts plain and Shift-produced printable casing", () => {
  assert.equal(isTypeaheadPrintableKey(event("e")), true);
  assert.equal(isTypeaheadPrintableKey(event("E", { shiftKey: true })), true);
});

test("typeahead rejects command chords, whitespace, and non-printable keys", () => {
  for (const candidate of [
    event("e", { altKey: true }),
    event("e", { ctrlKey: true }),
    event("e", { metaKey: true }),
    event(" "),
    event("ArrowRight"),
  ]) {
    assert.equal(isTypeaheadPrintableKey(candidate), false);
  }
});

test("typeahead skips disabled triggers, wraps, and focuses only a match", () => {
  const patterns = trigger("Patterns");
  const disabledEffects = trigger("Effects", { disabled: true });
  const other = trigger("Other");
  const effects = trigger("Effects");
  const menu = root([patterns, disabledEffects, other, effects]);

  assert.equal(focusNextMatchingMenubarTrigger(menu, patterns, "E"), true);
  assert.equal(effects.focusCalls, 1);
  assert.equal(disabledEffects.focusCalls, 0);
  assert.equal(focusNextMatchingMenubarTrigger(menu, effects, "p"), true);
  assert.equal(patterns.focusCalls, 1);
  assert.equal(focusNextMatchingMenubarTrigger(menu, patterns, "z"), false);
  assert.equal(patterns.focusCalls, 1);
  assert.equal(effects.focusCalls, 1);
});
