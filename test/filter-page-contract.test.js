import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  FILTER_EFFECT_PRESETS,
  formatFilterMacroValue,
} from "../src/lib/filter-effect.js";

const pageSource = readFileSync(
  new URL("../src/pages/index.astro", import.meta.url),
  "utf8"
);
const globalStyleSource = readFileSync(
  new URL("../src/styles/globals.css", import.meta.url),
  "utf8"
);

const PRIMARY_HELP_COPY =
  "Filter reshapes the whole groove. Cutoff moves from dark to bright. " +
  "Resonance adds a peak. Drive adds grit. Mix blends the filtered sound with the clean signal.";

const FILTER_CONTROL_NAMES = ["cutoff", "resonance", "drive", "mix"];

const FILTER_MACRO_MARKUP = {
  cutoff: { label: "Cutoff", value: "100", output: "18 kHz", hint: "Dark ↔ Bright" },
  resonance: { label: "Resonance", value: "0", output: "0%", hint: "Calm ↔ Peaked" },
  drive: { label: "Drive", value: "0", output: "0%, Clean", hint: "Clean ↔ Driven" },
  mix: { label: "Mix", value: "100", output: "100%, Wet", hint: "Dry ↔ Wet" },
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(value) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function relativeLuminance(hex) {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4
    );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(first, second) {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

function getCssDeclaration(source, selector, property) {
  const block = getBalancedBlock(source, selector);
  const match = block.match(new RegExp(`${escapeRegExp(property)}:\\s*([^;]+)`));
  assert.ok(match, `${selector} must declare ${property}`);
  return match[1].trim();
}

function getLastCssDeclaration(source, selector, property) {
  const rules = Array.from(source.matchAll(
    new RegExp(`${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`, "g")
  ));
  const declarations = rules.flatMap((rule) => Array.from(
    rule[1].matchAll(new RegExp(`${escapeRegExp(property)}:\\s*([^;]+)`, "g")),
    (match) => match[1].trim()
  ));
  assert.ok(declarations.length, `${selector} must declare ${property}`);
  return declarations.at(-1);
}

function pixelValue(value) {
  if (value === "0") return 0;
  const match = value.match(/^([0-9.]+)px$/);
  assert.ok(match, `${value} must be a pixel value`);
  return Number(match[1]);
}

function horizontalPadding(value) {
  const parts = value.split(/\s+/).map(pixelValue);
  if (parts.length === 1) return parts[0] * 2;
  if (parts.length === 2 || parts.length === 3) return parts[1] * 2;
  assert.equal(parts.length, 4, `${value} must be CSS padding shorthand`);
  return parts[1] + parts[3];
}

function assertSelectorHasNoOpacity(source, selector) {
  for (const rule of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (rule[1].includes(selector)) {
      assert.doesNotMatch(rule[2], /\bopacity\s*:/, `${selector} must remain full-opacity`);
    }
  }
}

function normalizeSelectorList(selector) {
  return selector
    .split(",")
    .map((part) => part.trim().replace(/\s+/g, " "))
    .join(",");
}

function getInnermostCssRules(source) {
  const rules = [];
  const openBraces = [];
  let lastBoundary = -1;
  let quote = null;
  let inComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];
    if (inComment) {
      if (character === "*" && nextCharacter === "/") {
        inComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (character === "\\") {
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "/" && nextCharacter === "*") {
      inComment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "{") {
      if (openBraces.length) openBraces.at(-1).hasChild = true;
      openBraces.push({
        open: index,
        selectorStart: lastBoundary + 1,
        hasChild: false,
      });
      lastBoundary = index;
      continue;
    }
    if (character !== "}" || !openBraces.length) continue;

    const block = openBraces.pop();
    if (!block.hasChild) {
      rules.push([
        source.slice(block.selectorStart, block.open),
        source.slice(block.open + 1, index),
      ]);
    }
    lastBoundary = index;
  }

  return rules;
}

function assertInformativeAncestorsHaveNoOpacity(source, allowedSelector) {
  const informativeAncestors = [
    ".filter-fx-body-inner",
    ".space-fx-panel",
    ".space-fx-header",
    ".space-fx-body",
    ".space-fx-macros",
    ".space-fx-macro",
  ];
  const allowed = normalizeSelectorList(allowedSelector);

  for (const [selectorList, declarations] of getInnermostCssRules(source)) {
    if (!/\bopacity\s*:/i.test(declarations)) continue;
    if (!informativeAncestors.some((selector) => selectorList.includes(selector))) continue;
    assert.equal(
      normalizeSelectorList(selectorList),
      allowed,
      "Space informative ancestors must remain full-opacity"
    );
  }
}

function assertCanonicalCustomProperty(source, canonicalBlock, name) {
  const declarations = Array.from(
    source.matchAll(new RegExp(`--${escapeRegExp(name)}\\s*:`, "g"))
  );
  assert.equal(declarations.length, 1, `--${name} must not be redefined outside :root`);
  assert.match(
    canonicalBlock,
    new RegExp(`--${escapeRegExp(name)}\\s*:`),
    `--${name} must be declared in the canonical :root block`
  );
}

function getCustomProperty(source, name) {
  const match = source.match(new RegExp(`--${escapeRegExp(name)}:\\s*(#[0-9a-f]{6})`, "i"));
  assert.ok(match, `--${name} must be a six-digit hex color`);
  return match[1].toLowerCase();
}

function getFilterPanelMarkup() {
  const start = pageSource.search(/<section\b[^>]*\bid="filterFxPanel"/);
  const end = pageSource.indexOf("<!-- Sequencer", start);
  assert.ok(start >= 0 && end > start, "Filter panel markup must exist");
  return pageSource.slice(start, end);
}

function getStartTagById(source, id) {
  const match = source.match(
    new RegExp(`<[^>]+\\bid="${escapeRegExp(id)}"[^>]*>`)
  );
  assert.ok(match, `#${id} must exist`);
  return match[0];
}

function getStartTagByAttribute(source, name, value) {
  const match = source.match(
    new RegExp(`<[^>]+\\b${escapeRegExp(name)}="${escapeRegExp(value)}"[^>]*>`)
  );
  assert.ok(match, `[${name}="${value}"] must exist`);
  return match[0];
}

function getElementMarkupById(source, id) {
  const startTag = getStartTagById(source, id);
  const startIndex = source.indexOf(startTag);
  const tagName = startTag.match(/^<([a-z0-9-]+)/i)?.[1];
  assert.ok(tagName, `#${id} must have a tag name`);
  const tokenPattern = new RegExp(`<\\/?${tagName}\\b[^>]*>`, "gi");
  tokenPattern.lastIndex = startIndex;
  let depth = 0;
  for (const token of source.matchAll(tokenPattern)) {
    depth += token[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return source.slice(startIndex, token.index + token[0].length);
  }
  assert.fail(`#${id} must close`);
}

function assertAttribute(tag, name, expectedValue) {
  assert.match(
    tag,
    new RegExp(`\\b${escapeRegExp(name)}="${escapeRegExp(expectedValue)}"`),
    `expected ${name}="${expectedValue}" on ${tag}`
  );
}

function getBalancedBlock(source, marker) {
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `${marker} must exist`);

  const openingBraceIndex = source.indexOf("{", markerIndex + marker.length);
  assert.notEqual(openingBraceIndex, -1, `${marker} must open a block`);

  let depth = 0;
  for (let index = openingBraceIndex; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(openingBraceIndex + 1, index);
  }

  assert.fail(`${marker} must close its block`);
}

function getCssRuleBody(source, selectorPattern) {
  const match = source.match(new RegExp(`${selectorPattern}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `CSS rule ${selectorPattern} must exist`);
  return match[1];
}

function getHardwareSource() {
  const marker = "/* Minimal hardware system: a quiet chassis with color reserved for state. */";
  const markerIndex = pageSource.indexOf(marker);
  assert.notEqual(markerIndex, -1, "hardware system marker must exist");
  const styleEnd = pageSource.indexOf("</style>", markerIndex);
  assert.ok(styleEnd > markerIndex, "hardware system must end inside its owning style tag");
  return pageSource.slice(markerIndex, styleEnd);
}

function countMatches(source, pattern) {
  return Array.from(source.matchAll(pattern)).length;
}

test("Filter panel uses the accepted primary help copy verbatim", () => {
  const panelMarkup = getFilterPanelMarkup();
  const helpMatch = panelMarkup.match(
    /<p\b[^>]*\bid="filterFxHelp"[^>]*>([\s\S]*?)<\/p>/
  );

  assert.ok(helpMatch, "#filterFxHelp must exist in the Filter panel");
  assert.equal(normalizeText(helpMatch[1]), PRIMARY_HELP_COPY);
});

test("Filter panel exposes every frozen integration selector and data hook", () => {
  const panelMarkup = getFilterPanelMarkup();
  const requiredIds = [
    "filterFxPanel",
    "filterFxTitle",
    "filterFxStatus",
    "filterFxActionStatus",
    "filterFxBypassBtn",
    "filterFxToggle",
    "filterFxBody",
    "filterFxHelp",
    "filterFxPreset",
    "filterFxResetBtn",
    "filterFxGraphic",
    "filterFxCurve",
    "filterFxGraphicState",
    "filterFxCutoff",
    "filterFxCutoffValue",
    "filterFxResonance",
    "filterFxResonanceValue",
    "filterFxDrive",
    "filterFxDriveValue",
    "filterFxMix",
    "filterFxMixValue",
  ];

  for (const id of requiredIds) {
    const matches = panelMarkup.match(
      new RegExp(`\\bid="${escapeRegExp(id)}"`, "g")
    );
    assert.equal(matches?.length, 1, `#${id} must occur exactly once in the panel`);
  }

  assert.match(panelMarkup, /\bdata-enabled="false"/);
  assert.match(panelMarkup, /\bdata-available="true"/);
  assert.match(panelMarkup, /\bdata-filter-toggle-label\b/);
  assert.match(panelMarkup, /\bdata-filter-curve-halo\b/);

  for (const control of FILTER_CONTROL_NAMES) {
    assert.match(
      panelMarkup,
      new RegExp(`\\bdata-filter-control="${control}"`)
    );
    assert.match(
      panelMarkup,
      new RegExp(`\\bdata-filter-macro="${control}"`)
    );
    assert.match(
      panelMarkup,
      new RegExp(`\\bdata-filter-output="${control}"`)
    );
  }
});

test("the preset state mirror is hidden, nonfocusable, and ordered", () => {
  const panelMarkup = getFilterPanelMarkup();
  const mirrorMatch = panelMarkup.match(
    /<div\b([^>]*\bclass="sr-only"[^>]*)>[\s\S]*?<select\b([^>]*\bid="filterFxPreset"[^>]*)>([\s\S]*?)<\/select>\s*<\/div>/,
  );
  const presetMatch = panelMarkup.match(
    /<select\b[^>]*\bid="filterFxPreset"[^>]*>([\s\S]*?)<\/select>/
  );

  assert.ok(mirrorMatch, "the preset state mirror must exist in a hidden wrapper");
  assert.ok(presetMatch, "#filterFxPreset must exist in the Filter panel");
  assertAttribute(`<div${mirrorMatch[1]}>`, "aria-hidden", "true");
  assertAttribute(`<select${mirrorMatch[2]}>`, "tabindex", "-1");
  assert.equal(panelMarkup.match(/<select\b/g)?.length, 1);
  const options = Array.from(
    presetMatch[1].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g),
    (match) => ({
      value: match[1].match(/\bvalue="([^"]+)"/)?.[1],
      label: normalizeText(match[2]),
      disabled: /\bdisabled\b/.test(match[1]),
    })
  );

  assert.deepEqual(options, [
    { value: "clean", label: "Clean", disabled: false },
    { value: "warm", label: "Warm", disabled: false },
    { value: "bright", label: "Bright", disabled: false },
    { value: "resonant-sweep", label: "Resonant Sweep", disabled: false },
    { value: "grit", label: "Grit", disabled: false },
    { value: "custom", label: "Custom", disabled: true },
  ]);
});

test("effects drawer starts closed while its controls remain mounted", () => {
  const panelMarkup = getFilterPanelMarkup();
  const toggleTag = getStartTagById(panelMarkup, "filterFxToggle");
  const bodyTag = getStartTagById(panelMarkup, "filterFxBody");
  const toggleMarkup = panelMarkup.match(
    /<button\b[^>]*\bid="filterFxToggle"[^>]*>([\s\S]*?)<\/button>/,
  );
  const toggleStateBlock = getBalancedBlock(
    pageSource,
    "function setFilterPanelExpanded",
  );

  assertAttribute(toggleTag, "aria-controls", "effectsDialog");
  assertAttribute(toggleTag, "aria-expanded", "false");
  assertAttribute(toggleTag, "aria-label", "Close effects");
  assert.equal(normalizeText(toggleMarkup?.[1] ?? ""), "Close effects");
  assertAttribute(bodyTag, "id", "filterFxBody");
  assertAttribute(bodyTag, "data-expanded", "true");
  assert.doesNotMatch(bodyTag, /\b(?:inert|hidden|aria-hidden)=/);
  assert.match(pageSource, /<dialog\b[^>]*id="effectsDialog"/);
  assert.equal(panelMarkup.match(/\bclass="filter-fx-body-inner"/g)?.length, 1);
  assert.match(pageSource, /\blet filterPanelExpanded = false\s*;/);
  assert.match(
    pageSource,
    /setFilterPanelExpanded\(false,\s*\{\s*animate:\s*false\s*\}\)\s*;/,
  );
  assert.equal(
    toggleStateBlock.match(/Close effects/g)?.length,
    2,
    "the close control keeps a stable accessible and visible label",
  );
});

test("the native effects dialog controller owns visibility and menu handoff", () => {
  const controllerBlock = getBalancedBlock(
    pageSource,
    "function setFilterPanelExpanded",
  );
  assert.match(
    controllerBlock,
    /effectsDialog\.showModal\(\)|effectsDialog\.setAttribute\("open"/,
  );
  assert.match(controllerBlock, /effectsDialog\.close\(\)/);
  assert.doesNotMatch(controllerBlock, /focusEffectsMenuTrigger/);
  assert.match(pageSource, /effectsDialog\.addEventListener\("close"/);
  assert.match(pageSource, /let effectsOpenFrame = null/);
  assert.match(pageSource, /function cancelEffectsOpenFrame/);
  assert.match(pageSource, /cancelEffectsOpenFrame\(\);[\s\S]*?open-beats:patterns/);
  assert.match(pageSource, /open-beats:patterns-ready/);
  assert.doesNotMatch(pageSource, /effectsDialogGeneration|effectsCloseGeneration/);
  assert.match(pageSource, /if \(effectsDialog\.open\) return/);
  assert.match(pageSource, /open-beats:page-consumer-ready/);
  assert.match(pageSource, /open-beats:page-consumer-ready/);
  assert.match(controllerBlock, /effectsDialog\.close\(\);\s*return true;/);
  assert.match(
    pageSource,
    /filterFxToggle\.addEventListener\("click",\s*function \(\) \{\s*setFilterPanelExpanded\(false\)/,
  );
  assert.match(pageSource, /window\.addEventListener\("open-beats:effects"/);
  assert.match(pageSource, /window\.addEventListener\("open-beats:patterns"/);
});

test("the micro-screen is text-backed presentation with no transport or Filter authority", () => {
  const screenTag = getStartTagById(pageSource, "instrumentScreen");
  const screenMarkup = pageSource.match(
    /<div\b[^>]*\bid="instrumentScreen"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/,
  );
  const renderBlock = getBalancedBlock(
    pageSource,
    "function renderInstrumentScreen",
  );

  assert.equal(pageSource.match(/\bid="instrumentScreen"/g)?.length, 1);
  assertAttribute(screenTag, "role", "img");
  assertAttribute(screenTag, "aria-label", "Stopped, 120 BPM, Filter bypassed.");
  assert.ok(screenMarkup, "micro-screen markup must exist");
  assert.match(screenMarkup[1], /\bdata-screen-bpm>120<\/span> BPM/);
  assert.match(screenMarkup[1], /\bdata-screen-mode>STOPPED<\/span>/);
  assert.match(screenMarkup[1], /\bdata-screen-filter>FILTER BYPASSED<\/span>/);
  assert.doesNotMatch(screenMarkup[1], /<(?:button|input|select|textarea|a)\b/);
  assert.doesNotMatch(pageSource, /instrumentScreen\.addEventListener\(/);

  assert.match(
    renderBlock,
    /normalizeBpm\(bpmInput \? bpmInput\.value : DEFAULT_BPM, DEFAULT_BPM\)/,
  );
  assert.match(
    renderBlock,
    /normalizeFilterEffectState\(filterEffectState\)/,
  );
  assert.match(renderBlock, /instrumentScreenBpm\.textContent = bpm\.toString\(\)/);
  assert.match(renderBlock, /instrumentScreenMode\.textContent = mode/);
  assert.match(renderBlock, /instrumentScreenFilter\.textContent = filterLabel/);
  assert.doesNotMatch(
    renderBlock,
    /\b(?:setFilterEffectState|applyFilterEffectPreset|scheduleNote|nextNote|startPlayback|stopPlayback|encodeSong|serialize|setInterval|setTimeout|requestAnimationFrame|AudioContext|masterFilterGraph)\b/,
  );
  assert.doesNotMatch(
    renderBlock,
    /\b(?:filterEffectState|isPlaying|isStartingPlayback|current16th)\s*=/,
  );
});

test("the Filter-only surface contains exactly the four accepted macro controls", () => {
  const panelMarkup = getFilterPanelMarkup();
  const controls = Array.from(
    panelMarkup.matchAll(/\bdata-filter-control="([^"]+)"/g),
    (match) => match[1]
  );
  const macros = Array.from(
    panelMarkup.matchAll(/\bdata-filter-macro="([^"]+)"/g),
    (match) => match[1]
  );
  const outputs = Array.from(
    panelMarkup.matchAll(/\bdata-filter-output="([^"]+)"/g),
    (match) => match[1]
  );

  assert.deepEqual(controls, FILTER_CONTROL_NAMES);
  assert.deepEqual(macros, FILTER_CONTROL_NAMES);
  assert.deepEqual(outputs, FILTER_CONTROL_NAMES);
});

test("all four macros remain native 0-100 range controls with one-point steps", () => {
  const panelMarkup = getFilterPanelMarkup();

  for (const control of FILTER_CONTROL_NAMES) {
    const id = `filterFx${control[0].toUpperCase()}${control.slice(1)}`;
    const tag = getStartTagById(panelMarkup, id);

    assert.match(tag, /^<input\b/);
    assertAttribute(tag, "type", "range");
    assertAttribute(tag, "min", "0");
    assertAttribute(tag, "max", "100");
    assertAttribute(tag, "step", "1");
    assertAttribute(tag, "data-filter-macro", control);
  }
});

test("each macro binds its visible label, value output, and friendly hint", () => {
  const panelMarkup = getFilterPanelMarkup();

  for (const [control, expected] of Object.entries(FILTER_MACRO_MARKUP)) {
    const title = control[0].toUpperCase() + control.slice(1);
    const inputId = `filterFx${title}`;
    const outputId = `${inputId}Value`;
    const hintId = `${inputId}Hint`;
    const inputTag = getStartTagById(panelMarkup, inputId);
    const labelMatch = panelMarkup.match(
      new RegExp(`<label\\s+for="${inputId}">([\\s\\S]*?)<\\/label>`),
    );
    const outputMatch = panelMarkup.match(
      new RegExp(`<output\\b([^>]*\\bid="${outputId}"[^>]*)>([\\s\\S]*?)<\\/output>`),
    );
    const hintMatch = panelMarkup.match(
      new RegExp(`<span\\b[^>]*\\bid="${hintId}"[^>]*>([\\s\\S]*?)<\\/span\\s*>`),
    );

    assert.ok(labelMatch, `${control} label must exist`);
    assert.ok(outputMatch, `${control} output must exist`);
    assert.ok(hintMatch, `${control} hint must exist`);
    assert.equal(normalizeText(labelMatch[1]), expected.label);
    assert.equal(normalizeText(outputMatch[2]), expected.output);
    assert.match(outputMatch[1], new RegExp(`\\bfor="${inputId}"`));
    assert.match(outputMatch[1], new RegExp(`\\bdata-filter-output="${control}"`));
    assertAttribute(inputTag, "value", expected.value);
    assertAttribute(inputTag, "aria-describedby", hintId);
    assert.equal(normalizeText(hintMatch[1]), expected.hint);
  }
});

test("the graphic is redundant, named in text, and hides its decorative SVG", () => {
  const panelMarkup = getFilterPanelMarkup();
  const graphicTag = getStartTagById(panelMarkup, "filterFxGraphic");
  const svgTag = panelMarkup.match(/<svg\b[^>]*>/)?.[0];
  const graphicState = panelMarkup.match(
    /<p\b[^>]*\bid="filterFxGraphicState"[^>]*>([\s\S]*?)<\/p>/,
  );

  assertAttribute(graphicTag, "role", "img");
  assertAttribute(
    graphicTag,
    "aria-label",
    "Filter response: bypassed. Macro settings are preserved.",
  );
  assert.ok(svgTag, "Filter graphic SVG must exist");
  assertAttribute(svgTag, "aria-hidden", "true");
  assertAttribute(svgTag, "focusable", "false");
  assert.equal(normalizeText(graphicState?.[1] ?? ""), "Bypassed");
});

test("real shell, disclosure, shared Filter, and lane controls keep a 44px floor", () => {
  const hardwareSource = getHardwareSource();
  const bpmRule = getCssRuleBody(hardwareSource, "#bpm");
  const transportRule = getCssRuleBody(
    hardwareSource,
    "#playBtn\\s*,\\s*#shareBtn\\s*,\\s*#loopPatternBtn\\s*,\\s*#clearProjectBtn\\s*,\\s*#mobileHelpBtn",
  );
  const retryRule = getCssRuleBody(hardwareSource, "\\.retry-samples-btn");
  const actionRule = getCssRuleBody(
    hardwareSource,
    "\\.filter-fx-action",
  );
  const rangeRule = getCssRuleBody(
    hardwareSource,
    '\\.filter-fx-shared-controls \\.filter-fx-macro input\\[type="range"\\]'
  );
  const bypassRule = getCssRuleBody(
    hardwareSource,
    "\\.filter-fx-shared-controls \\.filter-fx-footswitch",
  );
  const laneActionRule = getCssRuleBody(
    hardwareSource,
    "\\.instrument-volume-trigger\\s*,\\s*\\.instrument-pitch-trigger",
  );

  assert.match(bpmRule, /\bmin-height:\s*44px\s*;/);
  assert.match(transportRule, /\bmin-width:\s*44px\s*;/);
  assert.match(transportRule, /\bmin-height:\s*44px\s*;/);
  assert.match(retryRule, /\bmin-height:\s*44px\s*;/);
  assert.match(actionRule, /\bmin-height:\s*44px\s*;/);
  assert.match(rangeRule, /\bmin-height:\s*44px\s*;/);
  assert.ok(
    Number(bypassRule.match(/\bmin-height:\s*(\d+)px\s*;/)?.[1]) >= 44,
    "shared bypass target must be at least 44px high",
  );
  assert.match(laneActionRule, /\bwidth:\s*44px\s*;/);
  assert.match(laneActionRule, /\bheight:\s*44px\s*;/);

  const desktopBlock = getBalancedBlock(hardwareSource, "@media (min-width: 900px)");
  const machineRule = getCssRuleBody(desktopBlock, "\\.op1-drum-machine");
  const desktopSequencerRule = getCssRuleBody(desktopBlock, "\\.sequencer");
  const desktopRowRule = getCssRuleBody(desktopBlock, "\\.sequence-row");
  const desktopDividerRule = getCssRuleBody(
    desktopBlock,
    "\\.sequence-row:not\\(:last-child\\)::after",
  );
  const desktopStepsRule = getCssRuleBody(desktopBlock, "\\.steps");

  assert.match(machineRule, /--desktop-lane-row:\s*44px\s*;/);
  assert.match(desktopSequencerRule, /\bgap:\s*0\s*;/);
  assert.match(desktopRowRule, /\bposition:\s*relative\s*;/);
  assert.match(desktopRowRule, /\bheight:\s*var\(--desktop-lane-row\)\s*;/);
  assert.match(desktopRowRule, /\bmin-height:\s*var\(--desktop-lane-row\)\s*;/);
  assert.match(desktopDividerRule, /\bposition:\s*absolute\s*;/);
  assert.match(desktopDividerRule, /\bbottom:\s*0\s*;/);
  assert.match(desktopDividerRule, /\bheight:\s*1px\s*;/);
  assert.match(desktopDividerRule, /\bpointer-events:\s*none\s*;/);
  assert.match(desktopStepsRule, /\bheight:\s*44px\s*;/);

  const laneHeight = Number(machineRule.match(/--desktop-lane-row:\s*(\d+)px/)?.[1]);
  const sequencerPadding = Number(desktopSequencerRule.match(/\bpadding:\s*(\d+)px/)?.[1]);
  const renderedInstrumentCount = [...pageSource.matchAll(
    /<div class="steps" data-instrument="[^"]+">/g,
  )].length;
  assert.ok([laneHeight, sequencerPadding].every(Number.isFinite));
  assert.equal(renderedInstrumentCount, 14);
  assert.equal(laneHeight * renderedInstrumentCount + sequencerPadding * 2, 624);

  const focusSelectors = [
    "#bpm:focus\\s*,[\\s\\S]*?\\.step\\.playing:focus-visible",
    "\\.filter-fx-action:focus-visible\\s*,[\\s\\S]*?\\.filter-fx-shared-controls \\.filter-fx-macro input:focus-visible",
    ":global\\(\\.pitch-roll-cell:focus-visible\\)",
    ":global\\(\\.arrange-pattern-button:focus-visible\\)\\s*,[\\s\\S]*?:global\\(\\.arrange-repeat-input:focus-visible\\)",
  ];
  for (const selector of focusSelectors) {
    const focusRule = getCssRuleBody(hardwareSource, selector);
    assert.match(
      focusRule,
      /\boutline:\s*3px solid var\([^,]+,\s*#171a1f\)\s*;/i,
      `${selector} must retain a literal high-contrast ink edge`,
    );
    assert.match(
      focusRule,
      /\bbox-shadow:\s*0 0 0 6px var\([^,]+,\s*#00b578\)\s*;/i,
      `${selector} must retain a separate green halo`,
    );
  }
});

test("drawer and portaled Pattern content honor reduced motion", () => {
  const hardwareSource = getHardwareSource();
  assert.match(hardwareSource, /\.effects-dialog\s*\{/);
  assert.doesNotMatch(hardwareSource, /\.pattern-manager-dialog/);
  assert.match(globalStyleSource, /\.pattern-manager-dialog,[\s\S]*?\.menu-popup/);
  assert.match(globalStyleSource, /\.pattern-manager-dialog,[\s\S]*?animation-duration:\s*0\.01ms\s*!important/);
  assert.match(hardwareSource, /animation-duration:\s*0\.01ms\s*!important/);
  assert.match(hardwareSource, /transition-duration:\s*0\.01ms\s*!important/);
});

test("the effects shelf preserves one shared Filter control surface", () => {
  const panelMarkup = getFilterPanelMarkup();
  const visiblePanelText = normalizeText(getFilterPanelMarkup());
  const bypassTag = getStartTagById(panelMarkup, "filterFxBypassBtn");
  const bypassMarkup = panelMarkup.match(
    /<button\b[^>]*\bid="filterFxBypassBtn"[^>]*>([\s\S]*?)<\/button>/,
  );
  const rangeInputs = Array.from(
    panelMarkup.matchAll(/<input\b[^>]*\btype="range"[^>]*\bdata-filter-macro[^>]*>/g),
  );

  assert.equal(rangeInputs.length, 4);
  assert.equal(panelMarkup.match(/\bdata-filter-footswitch\b/g)?.length, 1);
  assert.equal(panelMarkup.match(/<fieldset\b[^>]*\bclass="filter-fx-macros"/g)?.length, 1);
  assert.match(bypassTag, /^<button\b/);
  assertAttribute(bypassTag, "type", "button");
  assertAttribute(bypassTag, "aria-label", "Enable filter");
  assertAttribute(bypassTag, "aria-pressed", "false");
  assert.equal(normalizeText(bypassMarkup?.[1] ?? ""), "Enable filter");
  assert.doesNotMatch(
    visiblePanelText,
    /\b(?:Echo|Automation|Sends?|Export WAV|Plug-?ins?)\b/i,
  );
  assert.doesNotMatch(
    visiblePanelText,
    /\b(?:BOSS|Roland|Korg|Moog|Strymon|Electro-Harmonix|Teenage Engineering|OP-1)\b/i,
  );
});

test("Space is one additive bay inside the existing Effects disclosure", () => {
  const panelMarkup = getFilterPanelMarkup();
  const bodyMarkup = getElementMarkupById(panelMarkup, "filterFxBody");
  for (const id of ["spaceFxPanel", "spaceFxBody", "spaceFxTitle", "spaceFxHelp",
    "spaceFxStatus", "spaceFxSummary", "spaceFxBypassBtn"]) {
    assert.equal(panelMarkup.match(new RegExp(`\\bid="${id}"`, "g"))?.length, 1, id);
  }
  assert.equal(bodyMarkup.match(/\bid="spaceFxPanel"/g)?.length, 1);
  assert.doesNotMatch(pageSource, /id="spaceFxToggle"|id="spaceFxReset(?:Btn)?"/);
  assert.equal(pageSource.match(/id="filterFxToggle"/g)?.length, 1);
  assert.match(getStartTagById(panelMarkup, "spaceFxStatus"), /\bdata-space-status\b/);
  assert.match(getStartTagById(panelMarkup, "spaceFxSummary"), /\bdata-space-summary\b/);
  for (const id of ["toneFxTitle", "toneFxStatus"]) {
    assert.equal(panelMarkup.match(new RegExp(`\\bid="${id}"`, "g"))?.length, 1, id);
  }
  assert.match(panelMarkup, /<section\b[^>]*class="tone-fx-panel"[^>]*aria-labelledby="toneFxTitle"/);
  assert.match(getStartTagById(panelMarkup, "toneFxStatus"), /\brole="status"[^>]*\baria-live="polite"/);
});

test("Space presets, creatures, controls, and exact copy follow the frozen order", () => {
  const panelMarkup = getFilterPanelMarkup();
  const presets = Array.from(panelMarkup.matchAll(
    /<button\b[^>]*\bdata-space-preset="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g,
  ), (match) => [match[1], normalizeText(match[2])]);
  assert.deepEqual(presets.map(([id]) => id), ["pocket-room", "warm-hall", "shimmer", "bloom", "custom"]);
  assert.deepEqual(presets.map(([, text]) => text), [
    "Pocket Room Mole", "Warm Hall Whale", "Shimmer Jellyfish", "Bloom Snail", "Custom",
  ]);
  assert.deepEqual(Array.from(panelMarkup.matchAll(
    /\bdata-space-creature="([^"]+)"/g,
  ), (match) => match[1]), ["burrowing-mole", "whale", "jellyfish", "snail"]);
  assert.doesNotMatch(
    getStartTagByAttribute(panelMarkup, "data-space-preset", "custom"),
    /data-space-creature/,
  );
  assert.deepEqual(presets.map(([id]) => {
    const tag = getStartTagByAttribute(panelMarkup, "data-space-preset", id);
    return tag.match(/\baria-label="([^"]+)"/)?.[1];
  }), ["Pocket Room, Mole", "Warm Hall, Whale", "Shimmer, Jellyfish", "Bloom, Snail", "Custom Space preset"]);
  const customMarkup = panelMarkup.match(/<button\b[^>]*data-space-preset="custom"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? "";
  assert.doesNotMatch(customMarkup, /<svg\b/);
  for (const presetId of ["pocket-room", "warm-hall", "shimmer", "bloom"]) {
    const markup = panelMarkup.match(new RegExp(`<button\\b[^>]*data-space-preset="${presetId}"[^>]*>([\\s\\S]*?)<\\/button>`))?.[1] ?? "";
    const svgTags = Array.from(markup.matchAll(/<svg\b[^>]*>/g), (match) => match[0]);
    assert.equal(svgTags.length, 1, `${presetId}: exactly one SVG`);
    for (const tag of svgTags) {
      assertAttribute(tag, "aria-hidden", "true");
      assertAttribute(tag, "focusable", "false");
    }
  }
  for (const control of ["size", "decay", "air", "mix"]) {
    const title = control[0].toUpperCase() + control.slice(1);
    const input = getStartTagById(panelMarkup, `spaceFx${title}`);
    assertAttribute(input, "min", "0");
    assertAttribute(input, "max", "100");
    assertAttribute(input, "step", "1");
    assert.match(input, new RegExp(`\\bdata-space-macro="${control}"`));
    assert.match(panelMarkup, new RegExp(`\\bdata-space-output="${control}"`));
    assert.match(panelMarkup, new RegExp(`<label\\b[^>]*for="spaceFx${title}"`));
    assert.match(panelMarkup, new RegExp(`id="spaceFx${title}Hint"`));
  }
  assert.match(panelMarkup, />Enable Space<\/button>/);
  assert.match(pageSource, /"Bypass Space"\s*:\s*"Enable Space"/);
  assert.match(pageSource, /"Space unavailable; audio is bypassed\."/);
  assert.match(pageSource, /"Tone: " \+ toneStatus \+ " · Space: " \+ spaceStatus/);
  assert.match(pageSource, /!filterEffectAvailable[\s\S]*?"Unavailable"[\s\S]*?state\.enabled \? "On" : "Bypassed"/);
  assert.match(pageSource, /!spaceEffectAvailable[\s\S]*?"Unavailable"[\s\S]*?spaceEffectState\.enabled \? "On" : "Bypassed"/);
});

test("open Effects tab order keeps Tone before every Space control", () => {
  const panelMarkup = getFilterPanelMarkup();
  const orderedHooks = [
    'id="filterFxToggle"',
    'data-filter-preset-card="clean"', 'data-filter-preset-card="warm"',
    'data-filter-preset-card="bright"', 'data-filter-preset-card="resonant-sweep"',
    'data-filter-preset-card="grit"', 'data-filter-preset-card="custom"',
    'id="filterFxResetBtn"', 'id="filterFxCutoff"', 'id="filterFxResonance"',
    'id="filterFxDrive"', 'id="filterFxMix"', 'id="filterFxBypassBtn"',
    'data-space-preset="pocket-room"', 'data-space-preset="warm-hall"',
    'data-space-preset="shimmer"', 'data-space-preset="bloom"',
    'data-space-preset="custom"', 'id="spaceFxSize"', 'id="spaceFxDecay"',
    'id="spaceFxAir"', 'id="spaceFxMix"', 'id="spaceFxBypassBtn"',
  ];
  let priorIndex = -1;
  for (const hook of orderedHooks) {
    const index = panelMarkup.indexOf(hook);
    assert.ok(index > priorIndex, `${hook} must follow the prior Tab stop`);
    priorIndex = index;
  }
});

test("Space hardware layer binds targets, focus, responsive stacking, and finite motion", () => {
  const hardware = getHardwareSource();
  assert.match(hardware, /\.space-fx-presets button,[\s\S]*?min-height:\s*44px/);
  assert.match(hardware, /\.space-fx-presets button:focus-visible,[\s\S]*?outline:\s*3px solid/);
  assert.match(hardware, /@media \(max-width: 600px\)[\s\S]*?\.space-fx-presets,[\s\S]*?\.space-fx-macros[\s\S]*?grid-template-columns:\s*1fr/);
  assert.match(hardware, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.space-fx-presets svg,[\s\S]*?animation:\s*none;[\s\S]*?transition:\s*none/);
  assert.match(hardware, /\.space-fx-presets\s*\{[\s\S]*?grid-template-columns:\s*repeat\(5,/);
  for (const [gesture, duration] of [["space-mole-dust", 620], ["space-whale-sonar", 760],
    ["space-jellyfish-ripple", 700], ["space-snail-crescent", 680]]) {
    assert.equal(pageSource.match(new RegExp(`class="space-creature-gesture ${gesture}"`, "g"))?.length, 1);
    assert.match(hardware, new RegExp(`data-enabled="true"\\]\\[data-available="true"\\][\\s\\S]*?button:is\\(\\[data-space-selected="true"\\]\\)[\\s\\S]*?\\.${gesture}[\\s\\S]*?animation:\\s*${gesture} ${duration}ms ease-out 1 both`));
    assert.match(hardware, new RegExp(`@keyframes ${gesture}\\s*\\{`));
  }
  assert.match(hardware, /\.space-mole-dust\s*\{\s*stroke:\s*#f05a28/);
  assert.match(hardware, /\.space-whale-sonar\s*\{\s*stroke:\s*#00b578/);
  assert.match(hardware, /\.space-jellyfish-ripple\s*\{\s*fill:\s*#f05a28;\s*stroke:\s*#00a6d6/);
  assert.match(hardware, /\.space-snail-crescent\s*\{\s*fill:\s*none;\s*stroke:\s*#00b578/);
  for (const gesture of ["space-mole-dust", "space-whale-sonar", "space-jellyfish-ripple"]) {
    const keyframes = getBalancedBlock(hardware, `@keyframes ${gesture}`);
    assert.match(keyframes, /0%\s*\{[^}]*visibility:\s*visible;[^}]*opacity:\s*0;[^}]*transform:\s*[^;}]+;?[^}]*\}/);
    assert.match(keyframes, /(?:45|50)%\s*\{[^}]*opacity:\s*(?:1|0\.9);?[^}]*\}/);
    assert.match(keyframes, /100%\s*\{[^}]*visibility:\s*hidden;[^}]*opacity:\s*0;[^}]*transform:\s*[^;}]+;?[^}]*\}/);
  }
  assert.match(hardware, /@keyframes space-snail-crescent[\s\S]*?100%\s*\{\s*visibility:\s*visible;\s*opacity:\s*1/);
  assert.match(hardware, /data-enabled="false"\] \.space-creature-gesture,[\s\S]*?data-available="false"\] \.space-creature-gesture[\s\S]*?animation:\s*none;[\s\S]*?visibility:\s*hidden/);
  assert.match(hardware, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?data-enabled="true"\]\[data-available="true"\][\s\S]*?button:is\(\[data-space-selected="true"\]\)[\s\S]*?\.space-creature-gesture[\s\S]*?animation:\s*none;[\s\S]*?visibility:\s*visible;[\s\S]*?transform:\s*none/);
  const twoBayRule = hardware.match(/@media \(min-width: (\d+)px\)\s*\{\s*\.filter-fx-body-inner\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) minmax\(320px, 0\.72fr\)/);
  assert.ok(twoBayRule, "two-bay breakpoint must be extractable");
  assert.equal(Number(twoBayRule[1]), 1400);
  for (const width of [1200, 1280, 1399]) {
    assert.ok(width < Number(twoBayRule[1]), `${width}px must remain stacked`);
  }
  assert.ok(1400 >= Number(twoBayRule[1]), "1400px must align both bays");
  const alignedRule = getBalancedBlock(hardware, "@media (min-width: 1400px)");
  const alignedBase = pageSource.slice(0, pageSource.indexOf("@media (min-width: 1400px)"));
  assert.match(
    alignedRule,
    /\.filter-fx-shared-controls \.filter-fx-macros\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);[\s\S]*?grid-template-rows:\s*repeat\(2, 1fr\)/
  );
  const outerColumns = getCssDeclaration(alignedRule, ".filter-fx-body-inner", "grid-template-columns");
  const fractions = Array.from(outerColumns.matchAll(/([0-9.]+)fr\b/g), (match) => Number(match[1]));
  assert.deepEqual(fractions, [1, 0.72]);
  const outerGap = pixelValue(getCssDeclaration(alignedRule, ".filter-fx-body-inner", "gap"));
  const layoutColumns = getLastCssDeclaration(alignedBase, ".filter-fx-shared-controls .filter-fx-layout", "grid-template-columns");
  const fixedTracks = Array.from(layoutColumns.matchAll(/minmax\(([0-9.]+)px,/g), (match) => Number(match[1]));
  assert.deepEqual(fixedTracks, [170, 120]);
  const layoutGap = pixelValue(getLastCssDeclaration(alignedBase, ".filter-fx-shared-controls .filter-fx-layout", "gap"));
  const macroGap = pixelValue(getLastCssDeclaration(alignedBase, ".filter-fx-shared-controls .filter-fx-macros", "gap"));
  const macroPadding = pixelValue(getLastCssDeclaration(alignedBase, ".filter-fx-shared-controls .filter-fx-macro", "padding"));
  const macroBorder = pixelValue(getLastCssDeclaration(alignedBase, ".filter-fx-shared-controls .filter-fx-macro", "border").split(" ")[0]);
  const classicScrollbarWidth = 17;
  const containerPadding = horizontalPadding(getLastCssDeclaration(alignedBase, ".container", "padding"));
  const machinePadding = horizontalPadding(getLastCssDeclaration(alignedBase, ".op1-drum-machine", "padding"));
  const machineBorder = pixelValue(getLastCssDeclaration(alignedBase, ".op1-drum-machine", "border").split(" ")[0]) * 2;
  const bodyPadding = horizontalPadding(getLastCssDeclaration(alignedBase, ".filter-fx-body-inner", "padding"));
  const panelPadding = horizontalPadding(getLastCssDeclaration(alignedBase, ".filter-fx-shared-controls", "padding"));
  const panelBorder = pixelValue(getLastCssDeclaration(alignedBase, ".filter-fx-shared-controls", "border").split(" ")[0]) * 2;
  assert.equal(pixelValue(getLastCssDeclaration(alignedBase, ".container", "max-width")), 1440);
  const availableGrid = 1400 - classicScrollbarWidth - containerPadding - machinePadding - machineBorder - bodyPadding;
  const toneBay = (availableGrid - outerGap) * fractions[0] / (fractions[0] + fractions[1]);
  const macroDeck = toneBay - panelPadding - panelBorder - fixedTracks.reduce((sum, value) => sum + value, 0) - layoutGap * 2;
  const macroHeading = (macroDeck - macroGap) / 2 - (macroPadding + macroBorder) * 2;
  const grit = FILTER_EFFECT_PRESETS.find((preset) => preset.id === "grit");
  assert.ok(grit);
  const headings = [
    `Drive · ${formatFilterMacroValue("drive", grit.drive)}`,
    `Drive · ${formatFilterMacroValue("drive", 100)}`,
  ];
  assert.deepEqual(headings, ["Drive · 68%, Driven", "Drive · 100%, Driven"]);
  assert.ok(macroHeading >= 96.02, `${macroHeading}px must fit ${headings[1]}`);
  assert.match(hardware, /@media \(min-width: 900px\)[\s\S]*?\.filter-fx-body-inner\s*\{\s*display:\s*block/);

  assert.match(hardware, /@media \(max-width: 899px\)/);
});

test("Space selected and unavailable states preserve literal contrast", () => {
  const hardware = getHardwareSource();
  assert.doesNotMatch(hardware, /<\/style>|<script\b/);
  assert.match(pageSource.slice(pageSource.indexOf("</style>")), /<script\b/);
  const root = getBalancedBlock(hardware, ":root");
  const variables = Object.fromEntries(
    ["hardware-ink", "hardware-muted", "hardware-surface", "hardware-canvas"].map((name) => [
      name,
      getCustomProperty(root, name),
    ])
  );
  for (const name of ["hardware-ink", "hardware-muted", "hardware-surface", "hardware-canvas"]) {
    assertCanonicalCustomProperty(pageSource, root, name);
  }
  const selectedRule = getBalancedBlock(
    hardware,
    '.space-fx-presets button[data-space-selected="true"]'
  );
  assert.match(selectedRule, /border-color:\s*var\(--hardware-ink\)/);
  assert.match(selectedRule, /inset 0 -4px 0 var\(--hardware-ink\)/);
  assert.match(selectedRule, /inset 0 -7px 0 var\(--signal-effect\)/);
  assert.ok(contrastRatio(variables["hardware-ink"], variables["hardware-surface"]) >= 3);
  assert.ok(contrastRatio(variables["hardware-ink"], variables["hardware-canvas"]) >= 3);

  const informativeRule = getBalancedBlock(hardware, ".space-fx-kicker,");
  assert.match(hardware, /\.space-fx-kicker,\s*\.space-fx-status,\s*\.space-fx-summary,\s*\.space-fx-macro span\s*\{/);
  assert.match(informativeRule, /color:\s*var\(--hardware-muted\)/);
  assert.doesNotMatch(informativeRule, /opacity:/);
  for (const selector of [".space-fx-status", ".space-fx-summary", ".space-fx-macro span"]) {
    assertSelectorHasNoOpacity(hardware, selector);
  }

  assert.doesNotMatch(
    hardware,
    /\.space-fx-panel\[data-available="false"\]\s*\{[^}]*opacity:/
  );
  const disabledChromeSelector = `.space-fx-panel[data-available="false"] .space-fx-presets button,
    .space-fx-panel[data-available="false"] .space-fx-macro input,
    .space-fx-panel[data-available="false"] .space-fx-bypass,
    .space-fx-panel[data-available="false"] .space-fx-presets svg`;
  assert.match(
    hardware,
    /\.space-fx-panel\[data-available="false"\] \.space-fx-presets button,[\s\S]*?\.space-fx-panel\[data-available="false"\] \.space-fx-presets svg\s*\{\s*opacity:\s*0\.72/
  );
  assertInformativeAncestorsHaveNoOpacity(hardware, disabledChromeSelector);
  assert.throws(
    () => assertInformativeAncestorsHaveNoOpacity(
      `${hardware}\n.space-fx-header { opacity: 0.72; }`,
      disabledChromeSelector
    ),
    /Space informative ancestors must remain full-opacity/
  );
  for (const nestedMutation of [
    `@media (min-width: 1400px) { .space-fx-header { opacity: 0.72; } }`,
    `@supports (display: grid) { .space-fx-header { opacity: 0.72; } }`,
    `@supports (display: grid) { @media (min-width: 1400px) { .space-fx-header { opacity: 0.72; } } }`,
    `.space-fx-header { --sentinel: "{"; opacity: 0.72; }`,
    `.space-fx-header { --sentinel: "}"; opacity: 0.72; }`,
    `.space-fx-header { /* { } */ opacity: 0.72; }`,
    `.space-fx-header { OPACITY: 0.72; }`,
  ]) {
    assert.throws(
      () => assertInformativeAncestorsHaveNoOpacity(
        `${hardware}\n${nestedMutation}`,
        disabledChromeSelector
      ),
      /Space informative ancestors must remain full-opacity/
    );
  }
  assert.doesNotThrow(() => assertInformativeAncestorsHaveNoOpacity(
    `@media (min-width: 1400px) { ${disabledChromeSelector} { opacity: 0.72; } }`,
    disabledChromeSelector
  ));
  assert.ok(contrastRatio(variables["hardware-muted"], variables["hardware-surface"]) >= 4.5);
  assert.ok(contrastRatio(variables["hardware-muted"], variables["hardware-canvas"]) >= 4.5);
});
