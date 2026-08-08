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
const appMenuSource = readFileSync(
  new URL("../src/components/AppMenu.jsx", import.meta.url),
  "utf8"
);
const arrangeDialogSource = readFileSync(
  new URL("../src/components/ArrangeDialog.jsx", import.meta.url),
  "utf8"
);
const clearProjectDialogSource = readFileSync(
  new URL("../src/components/ClearProjectDialog.jsx", import.meta.url),
  "utf8"
);
const dialogSource = readFileSync(
  new URL("../src/components/ui/dialog.jsx", import.meta.url),
  "utf8"
);
const inlineHarnessSource = readFileSync(
  new URL("./support/index-inline-harness.js", import.meta.url),
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

function parseCssColor(value) {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    return {
      channels: hex[1].match(/.{2}/g).map((channel) => Number.parseInt(channel, 16)),
      alpha: 1,
    };
  }
  const rgba = value.match(
    /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([0-9.]+)\s*\)$/i
  );
  assert.ok(rgba, `${value} must be a six-digit hex or rgba color`);
  return {
    channels: rgba.slice(1, 4).map(Number),
    alpha: Number(rgba[4]),
  };
}

function compositeContrast(foreground, background) {
  const foregroundColor = parseCssColor(foreground);
  const backgroundColor = parseCssColor(background);
  assert.equal(backgroundColor.alpha, 1, "contrast backdrop must be opaque");
  const channels = foregroundColor.channels.map(
    (channel, index) =>
      channel * foregroundColor.alpha +
      backgroundColor.channels[index] * (1 - foregroundColor.alpha)
  );
  const luminance = (rgb) => {
    const linear = rgb
      .map((channel) => channel / 255)
      .map((channel) =>
        channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4
      );
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const values = [luminance(channels), luminance(backgroundColor.channels)].sort(
    (first, second) => second - first
  );
  return (values[0] + 0.05) / (values[1] + 0.05);
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
  const match = source.match(
    new RegExp(`--${escapeRegExp(name)}:\\s*(#[0-9a-f]{3}(?:[0-9a-f]{3})?)`, "i")
  );
  assert.ok(match, `--${name} must be a three- or six-digit hex color`);
  const value = match[1].toLowerCase();
  return value.length === 4
    ? `#${Array.from(value.slice(1), (character) => character.repeat(2)).join("")}`
    : value;
}

function getCustomPropertyValue(source, name) {
  const match = source.match(
    new RegExp(`--${escapeRegExp(name)}:\\s*(#[0-9a-f]{6}|rgba\\([^;]+\\))`, "i")
  );
  assert.ok(match, `--${name} must be a supported color`);
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

function getHardwareSource(source = pageSource) {
  const marker = "/* Dark hardware system: palette color is reserved for state and bay identity. */";
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, "hardware system marker must exist");
  const styleEnd = source.indexOf("</style>", markerIndex);
  assert.ok(styleEnd > markerIndex, "hardware system must end inside its owning style tag");
  return source.slice(markerIndex, styleEnd);
}

function getPageStyleSource(source = pageSource) {
  const styleStart = source.indexOf("<style>");
  const styleEnd = source.indexOf("</style>", styleStart);
  assert.ok(styleStart >= 0 && styleEnd > styleStart, "page style must exist");
  return source.slice(styleStart + "<style>".length, styleEnd);
}

function getTopLevelCssBlocks(source) {
  const blocks = [];
  let boundary = 0;
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
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
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
    if (character !== "{") continue;

    let depth = 1;
    let innerQuote = null;
    let innerComment = false;
    let end = index + 1;
    for (; end < source.length && depth > 0; end += 1) {
      const innerCharacter = source[end];
      const innerNext = source[end + 1];
      if (innerComment) {
        if (innerCharacter === "*" && innerNext === "/") {
          innerComment = false;
          end += 1;
        }
        continue;
      }
      if (innerQuote) {
        if (innerCharacter === "\\") end += 1;
        else if (innerCharacter === innerQuote) innerQuote = null;
        continue;
      }
      if (innerCharacter === "/" && innerNext === "*") {
        innerComment = true;
        end += 1;
        continue;
      }
      if (innerCharacter === '"' || innerCharacter === "'") {
        innerQuote = innerCharacter;
        continue;
      }
      if (innerCharacter === "{") depth += 1;
      if (innerCharacter === "}") depth -= 1;
    }
    assert.equal(depth, 0, "CSS block must be balanced");
    const header = source
      .slice(boundary, index)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .trim();
    blocks.push({ header, body: source.slice(index + 1, end - 1) });
    boundary = end;
    index = end - 1;
  }
  return blocks;
}

function mediaApplies(header, viewportWidth) {
  const bounds = Array.from(
    header.matchAll(/\((min|max)-width:\s*([0-9.]+)px\)/gi),
    ([, kind, value]) => ({ kind: kind.toLowerCase(), value: Number(value) }),
  );
  if (!bounds.length) return false;
  return bounds.every(({ kind, value }) =>
    kind === "min" ? viewportWidth >= value : viewportWidth <= value,
  );
}

function getApplicableCssRules(source, viewportWidth, rules = []) {
  for (const block of getTopLevelCssBlocks(source)) {
    if (/^@media\b/i.test(block.header)) {
      if (mediaApplies(block.header, viewportWidth)) {
        getApplicableCssRules(block.body, viewportWidth, rules);
      }
      continue;
    }
    if (/^@(?:keyframes|font-face|property)\b/i.test(block.header)) continue;
    if (/^@(?:supports|layer)\b/i.test(block.header)) {
      getApplicableCssRules(block.body, viewportWidth, rules);
      continue;
    }
    rules.push(block);
  }
  return rules;
}

function splitSelectorList(selectorList) {
  const selectors = [];
  let start = 0;
  let parentheses = 0;
  let brackets = 0;
  for (let index = 0; index < selectorList.length; index += 1) {
    const character = selectorList[index];
    if (character === "(") parentheses += 1;
    if (character === ")") parentheses -= 1;
    if (character === "[") brackets += 1;
    if (character === "]") brackets -= 1;
    if (character !== "," || parentheses || brackets) continue;
    selectors.push(selectorList.slice(start, index).trim());
    start = index + 1;
  }
  selectors.push(selectorList.slice(start).trim());
  return selectors.filter(Boolean);
}

function cssSpecificity(selector) {
  const normalized = selector.replace(/:where\([^)]*\)/g, "");
  return [
    (normalized.match(/#[\w-]+/g) || []).length,
    (normalized.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+(?:\([^)]*\))?/g) || []).length,
    (normalized.match(/(?:^|[\s>+~])(?:[a-z][\w-]*)/gi) || []).length,
  ];
}

function compareCssPriority(left, right) {
  if (left.important !== right.important) return Number(left.important) - Number(right.important);
  for (let index = 0; index < left.specificity.length; index += 1) {
    if (left.specificity[index] !== right.specificity[index]) {
      return left.specificity[index] - right.specificity[index];
    }
  }
  return left.order - right.order;
}

function selectorTargets(selector, target) {
  const compounds = selector.trim().split(/\s+|[>+~]/).filter(Boolean);
  const lastCompound = compounds.at(-1) || "";
  if (!target.tokens.some((token) => lastCompound.includes(token))) return false;
  if (target.classes) {
    const requiredClasses = Array.from(lastCompound.matchAll(/\.([\w-]+)/g), (match) => match[1]);
    if (requiredClasses.some((name) => !target.classes.includes(name))) return false;
  }
  if (target.pseudoClasses) {
    const requiredPseudoClasses = Array.from(
      lastCompound.matchAll(/(?<!:):(?!:)([\w-]+)(?:\([^)]*\))?/g),
      (match) => match[1],
    );
    if (requiredPseudoClasses.some((name) => !target.pseudoClasses.includes(name))) return false;
  }
  for (const match of selector.matchAll(/\[([\w-]+)=["']?([^\]"']+)["']?\]/g)) {
    const expected = target.attributes?.[match[1]];
    if (expected !== undefined && expected !== match[2]) return false;
  }
  return true;
}

function getEffectiveCssDeclaration(source, viewportWidth, target, property) {
  let winner = null;
  let order = 0;
  for (const rule of getApplicableCssRules(source, viewportWidth)) {
    const declarations = Array.from(
      rule.body.matchAll(/(?:^|;)\s*([\w-]+)\s*:\s*([^;]+)(?=;|$)/g),
      ([, name, rawValue]) => {
        const important = /\s*!important\s*$/i.test(rawValue);
        return {
          name,
          value: rawValue.replace(/\s*!important\s*$/i, "").trim(),
          important,
        };
      },
    );
    const declaration = declarations.filter(({ name }) =>
      name === property || (property === "flex-basis" && name === "flex")
    ).at(-1);
    if (!declaration) continue;
    const value = property === "flex-basis" && declaration.name === "flex"
      ? declaration.value.split(/\s+/).at(-1)
      : declaration.value;
    for (const selector of splitSelectorList(rule.header)) {
      order += 1;
      if (!selectorTargets(selector, target)) continue;
      const candidate = {
        ...declaration,
        value,
        specificity: cssSpecificity(selector),
        order,
      };
      if (!winner || compareCssPriority(candidate, winner) >= 0) winner = candidate;
    }
  }
  assert.ok(winner, `${property} must resolve for ${target.tokens.join(" or ")} at ${viewportWidth}px`);
  return winner.value;
}

function splitCssComponents(value) {
  const parts = [];
  let start = 0;
  let parentheses = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "(") parentheses += 1;
    if (character === ")") parentheses -= 1;
    if (!parentheses && /\s/.test(character)) {
      if (value.slice(start, index).trim()) parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (value.slice(start).trim()) parts.push(value.slice(start).trim());
  return parts;
}

function getEffectiveInlinePadding(source, viewportWidth, target) {
  const winners = { left: null, right: null };
  let order = 0;
  for (const rule of getApplicableCssRules(source, viewportWidth)) {
    const selectors = splitSelectorList(rule.header).filter((selector) =>
      selectorTargets(selector, target)
    );
    for (const match of rule.body.matchAll(
      /(?:^|;)\s*(padding|padding-inline|padding-inline-start|padding-inline-end|padding-left|padding-right)\s*:\s*([^;]+)(?=;|$)/g
    )) {
      order += 1;
      if (!selectors.length) continue;
      const important = /\s*!important\s*$/i.test(match[2]);
      const value = match[2].replace(/\s*!important\s*$/i, "").trim();
      const parts = splitCssComponents(value);
      const values = {};
      if (match[1] === "padding") {
        values.right = parts.length === 1 ? parts[0] : parts[1];
        values.left = parts.length < 4 ? values.right : parts[3];
      } else if (match[1] === "padding-inline") {
        values.left = parts[0];
        values.right = parts[1] || parts[0];
      } else {
        values[
          match[1] === "padding-left" || match[1] === "padding-inline-start"
            ? "left"
            : "right"
        ] = value;
      }
      for (const selector of selectors) {
        for (const [side, sideValue] of Object.entries(values)) {
          const candidate = {
            value: sideValue,
            important,
            specificity: cssSpecificity(selector),
            order,
          };
          if (!winners[side] || compareCssPriority(candidate, winners[side]) >= 0) {
            winners[side] = candidate;
          }
        }
      }
    }
  }
  assert.ok(winners.left, `padding-left must resolve for ${target.tokens.join(" or ")} at ${viewportWidth}px`);
  assert.ok(winners.right, `padding-right must resolve for ${target.tokens.join(" or ")} at ${viewportWidth}px`);
  return pixelValue(winners.left.value) + pixelValue(winners.right.value);
}

function getBorderWidthFromShorthand(value) {
  const width = splitCssComponents(value).find((part) => /^(?:0|[0-9.]+px)$/i.test(part));
  assert.ok(width, `border shorthand must expose a pixel width: ${value}`);
  return width;
}

function getEffectiveInlineBorderWidth(source, viewportWidth, target) {
  const winners = { left: null, right: null };
  let order = 0;
  const declarationPattern =
    /(?:^|;)\s*(border-inline-start-width|border-inline-end-width|border-left-width|border-right-width|border-inline-width|border-width|border-inline-start|border-inline-end|border-left|border-right|border-inline|border)\s*:\s*([^;]+)(?=;|$)/g;
  for (const rule of getApplicableCssRules(source, viewportWidth)) {
    const selectors = splitSelectorList(rule.header).filter((selector) =>
      selectorTargets(selector, target)
    );
    for (const match of rule.body.matchAll(declarationPattern)) {
      order += 1;
      if (!selectors.length) continue;
      const important = /\s*!important\s*$/i.test(match[2]);
      const value = match[2].replace(/\s*!important\s*$/i, "").trim();
      const parts = splitCssComponents(value);
      const values = {};
      if (match[1] === "border") {
        values.left = getBorderWidthFromShorthand(value);
        values.right = values.left;
      } else if (match[1] === "border-width") {
        values.right = parts.length === 1 ? parts[0] : parts[1];
        values.left = parts.length < 4 ? values.right : parts[3];
      } else if (match[1] === "border-inline") {
        values.left = getBorderWidthFromShorthand(value);
        values.right = values.left;
      } else if (match[1] === "border-inline-width") {
        values.left = parts[0];
        values.right = parts[1] || parts[0];
      } else {
        const side = /(?:left|inline-start)/.test(match[1]) ? "left" : "right";
        values[side] = match[1].endsWith("-width")
          ? value
          : getBorderWidthFromShorthand(value);
      }
      for (const selector of selectors) {
        for (const [side, sideValue] of Object.entries(values)) {
          const candidate = {
            value: sideValue,
            important,
            specificity: cssSpecificity(selector),
            order,
          };
          if (!winners[side] || compareCssPriority(candidate, winners[side]) >= 0) {
            winners[side] = candidate;
          }
        }
      }
    }
  }
  assert.ok(winners.left, `border-left-width must resolve for ${target.tokens.join(" or ")} at ${viewportWidth}px`);
  assert.ok(winners.right, `border-right-width must resolve for ${target.tokens.join(" or ")} at ${viewportWidth}px`);
  return pixelValue(winners.left.value) + pixelValue(winners.right.value);
}

function getBackgroundColorFromShorthand(value) {
  const semanticColors = Array.from(
    value.matchAll(/var\(--[\w-]+(?:\s*,\s*[^)]+)?\)/g),
    (match) => match[0],
  );
  if (semanticColors.length) return semanticColors.at(-1);
  const literal = value.match(/(?:#[0-9a-f]{3,8}|rgba?\([^)]*\)|\btransparent\b)\s*$/i);
  return literal?.[0] ?? "transparent";
}

function getEffectiveBackgroundColor(source, viewportWidth, target) {
  let winner = null;
  let order = 0;
  for (const rule of getApplicableCssRules(source, viewportWidth)) {
    for (const match of rule.body.matchAll(
      /(?:^|;)\s*(background|background-color)\s*:\s*([^;]+)(?=;|$)/g
    )) {
      const important = /\s*!important\s*$/i.test(match[2]);
      const rawValue = match[2].replace(/\s*!important\s*$/i, "").trim();
      const value = match[1] === "background"
        ? getBackgroundColorFromShorthand(rawValue)
        : rawValue;
      for (const selector of splitSelectorList(rule.header)) {
        order += 1;
        if (!selectorTargets(selector, target)) continue;
        const candidate = {
          value,
          important,
          specificity: cssSpecificity(selector),
          order,
        };
        if (!winner || compareCssPriority(candidate, winner) >= 0) winner = candidate;
      }
    }
  }
  assert.ok(winner, `background color must resolve for ${target.tokens.join(" or ")} at ${viewportWidth}px`);
  return winner.value;
}

function getEffectiveBackgroundImage(source, viewportWidth, target) {
  let winner = null;
  let order = 0;
  for (const rule of getApplicableCssRules(source, viewportWidth)) {
    for (const match of rule.body.matchAll(
      /(?:^|;)\s*(background|background-image)\s*:\s*([^;]+)(?=;|$)/g
    )) {
      const important = /\s*!important\s*$/i.test(match[2]);
      const rawValue = match[2].replace(/\s*!important\s*$/i, "").trim();
      const value = match[1] === "background" && !/(?:gradient|url|image-set)\(/i.test(rawValue)
        ? "none"
        : rawValue;
      for (const selector of splitSelectorList(rule.header)) {
        order += 1;
        if (!selectorTargets(selector, target)) continue;
        const candidate = {
          value,
          important,
          specificity: cssSpecificity(selector),
          order,
        };
        if (!winner || compareCssPriority(candidate, winner) >= 0) winner = candidate;
      }
    }
  }
  assert.ok(winner, `background image must resolve for ${target.tokens.join(" or ")} at ${viewportWidth}px`);
  return winner.value;
}

function assertEffectiveEffectsWorkbenchCss(source) {
  const pageStyle = source.includes("<style>") ? getPageStyleSource(source) : source;
  const dialogWidths = new Map([
    [1440, "min(1120px, calc(100vw - 48px))"],
    [1280, "min(1120px, calc(100vw - 48px))"],
    [1200, "min(1120px, calc(100vw - 48px))"],
    [900, "calc(100vw - 32px)"],
    [390, "calc(100vw - 16px)"],
    [320, "calc(100vw - 16px)"],
  ]);
  for (const width of [1440, 1280, 1200, 900, 390, 320]) {
    assert.equal(
      getEffectiveCssDeclaration(
        pageStyle,
        width,
        { tokens: [".effects-dialog", "#effectsDialog"] },
        "width",
      ),
      dialogWidths.get(width),
      `Effects dialog width must remain responsive at ${width}px`,
    );
    assert.equal(
      getEffectiveCssDeclaration(
        pageStyle,
        width,
        { tokens: [".filter-fx-bar"] },
        "position",
      ),
      "sticky",
      `Effects header must remain sticky at ${width}px`,
    );
    assert.equal(
      getEffectiveCssDeclaration(
        pageStyle,
        width,
        { tokens: [".filter-fx-bar"] },
        "top",
      ),
      "0",
      `Effects header must remain pinned at ${width}px`,
    );
    const headerZIndex = getEffectiveCssDeclaration(
      pageStyle,
      width,
      { tokens: [".filter-fx-bar"] },
      "z-index",
    );
    assert.match(
      headerZIndex,
      /^-?\d+$/,
      `Effects header z-index must resolve to an integer at ${width}px`,
    );
    assert.ok(
      Number(headerZIndex) > 0,
      `Effects header must remain above the scrolling body at ${width}px`,
    );
    if (width >= 1200) {
      assert.equal(
        getEffectiveCssDeclaration(
          pageStyle,
          width,
          { tokens: [".filter-fx-body-inner"] },
          "display",
        ),
        "grid",
        `Effects bays must keep their responsive layout at ${width}px`,
      );
      assert.equal(
        getEffectiveCssDeclaration(
          pageStyle,
          width,
          { tokens: [".filter-fx-body-inner"] },
          "grid-template-columns",
        ),
        "minmax(0, 1.15fr) minmax(360px, 0.85fr)",
        `Effects bays must keep their final column tracks at ${width}px`,
      );
    }
  }
}

function assertEffectivePhonePresetGeometry(source) {
  const pageStyle = source.includes("<style>") ? getPageStyleSource(source) : source;
  const expectedBasis =
    "clamp(88px, calc((100vw - var(--phone-preset-inline-cost)) / 2), 116px)";
  const expected = {
    flex: "0 0 var(--phone-preset-basis)",
    "flex-basis": "var(--phone-preset-basis)",
    width: "var(--phone-preset-basis)",
    "min-width": "88px",
    "max-width": "116px",
  };
  for (const width of [600, 390, 320]) {
    assert.equal(
      getEffectiveCssDeclaration(
        pageStyle,
        width,
        { tokens: [".filter-preset-pedal"] },
        "--phone-preset-basis",
      ).replace(/\s+/g, ""),
      expectedBasis.replace(/\s+/g, ""),
      `phone preset basis must remain responsive at ${width}px`,
    );
    for (const [property, value] of Object.entries(expected)) {
      assert.equal(
        getEffectiveCssDeclaration(
          pageStyle,
          width,
          { tokens: [".filter-preset-pedal"] },
          property,
        ),
        value,
        `phone preset ${property} must remain responsive at ${width}px`,
      );
    }
  }
}

function assertEffectivePlayingStepFocus(source) {
  const pageStyle = source.includes("<style>") ? getPageStyleSource(source) : source;
  const target = {
    tokens: [".step"],
    classes: ["step", "active", "playing"],
    pseudoClasses: ["focus-visible"],
  };
  for (const width of [1440, 1280, 1200, 900, 600, 390, 320]) {
    assert.equal(
      getEffectiveCssDeclaration(pageStyle, width, target, "outline"),
      "3px solid var(--hardware-ink, #f2f2f2)",
      `focused playing step outline must remain visible at ${width}px`,
    );
    assert.equal(
      getEffectiveCssDeclaration(pageStyle, width, target, "outline-offset"),
      "2px",
      `focused playing step outline offset must remain visible at ${width}px`,
    );
    assert.equal(
      getEffectiveCssDeclaration(pageStyle, width, target, "box-shadow"),
      "0 0 0 6px var(--signal-selection, #2f80ed)",
      `focused playing step halo must remain visible at ${width}px`,
    );
  }
}

function assertSoleEffectsVerticalScroller(source) {
  const effectSelectorPattern = /\.(?:filter|tone|space)-fx-|#(?:effectsDialog|filterFxPanel)/;
  const dialogRootPattern = /(?:^|[\s>+~])(?:[a-z][\w-]*)?(?:\.effects-dialog|#effectsDialog)(?=$|[\s>+~:.\[#])/i;
  const scrollers = [];
  for (const [selectorList, declarations] of getInnermostCssRules(source)) {
    const selectors = splitSelectorList(selectorList).map(normalizeSelectorList);
    const dialogRooted = selectors.some((selector) => dialogRootPattern.test(selector));
    if (!dialogRooted && !effectSelectorPattern.test(selectorList)) continue;
    if (!/(?:\boverflow\s*:[^;]*(?:auto|scroll)|\boverflow-(?:y|block)\s*:\s*(?:auto|scroll))\b/i.test(declarations)) {
      continue;
    }
    for (const selector of selectors) {
      if (!dialogRooted && !effectSelectorPattern.test(selector)) continue;
      const compounds = selector.split(/\s+|[>+~]/).filter(Boolean);
      const lastCompound = compounds.at(-1) || "";
      assert.equal(
        lastCompound,
        "#filterFxPanel",
        "#filterFxPanel must be the sole Effects vertical scroller",
      );
      scrollers.push(selector);
    }
  }
  assert.deepEqual(scrollers, [".effects-dialog #filterFxPanel"]);
  for (const width of [1440, 1280, 900, 390, 320]) {
    assert.equal(
      getEffectiveCssDeclaration(
        source,
        width,
        { tokens: [".effects-dialog", "#effectsDialog"] },
        "overflow",
      ),
      "hidden",
      `Effects dialog must clip overflow at ${width}px`,
    );
  }
}

function assertAllowedPaletteLiterals(source, label) {
  const allowedHex = new Set([
    "#111",
    "#111111",
    "#2f80ed",
    "#27ae60",
    "#333333",
    "#f2994a",
    "#f2f2f2",
    "#f57c00",
  ]);
  const allowedRgb = new Set([
    "17,17,17",
    "39,174,96",
    "47,128,237",
    "242,242,242",
  ]);
  const hexColors = Array.from(source.matchAll(/#[0-9a-f]{3,8}\b/gi), (match) =>
    match[0].toLowerCase()
  );
  for (const color of hexColors) {
    assert.ok(allowedHex.has(color), `${label} contains non-palette color ${color}`);
  }
  const rgbaColors = Array.from(
    source.matchAll(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,/gi),
    (match) => `${match[1]},${match[2]},${match[3]}`
  );
  for (const color of rgbaColors) {
    assert.ok(allowedRgb.has(color), `${label} contains non-palette rgba(${color}, ...)`);
  }
}

function assertEffectiveLegacyStatePalette(source) {
  const hardwareMarker = source.indexOf(
    "/* Dark hardware system: palette color is reserved for state and bay identity. */"
  );
  assert.ok(hardwareMarker > 0, "hardware marker must follow legacy state selectors");
  const legacy = source.slice(0, hardwareMarker);
  const unavailablePanel = getCssRuleBody(
    legacy,
    '\\.filter-fx-panel\\[data-available="false"\\]'
  );
  const bypassedKnob = getCssRuleBody(
    legacy,
    '\\.filter-fx-panel\\[data-enabled="false"\\] \\.filter-fx-knob-indicator'
  );
  const inactiveCurve = getCssRuleBody(
    legacy,
    '\\.filter-fx-panel\\[data-enabled="false"\\] \\.filter-fx-curve,\\s*' +
      '\\.filter-fx-panel\\[data-available="false"\\] \\.filter-fx-curve'
  );
  assert.equal(
    getDeclarationFromBody(unavailablePanel, "border-color"),
    "var(--hardware-hairline)",
    "unavailable Filter border must use the semantic palette",
  );
  const pageStyle = getPageStyleSource(source);
  for (const width of [1440, 390, 320]) {
    assert.equal(
      getEffectiveCssDeclaration(
        pageStyle,
        width,
        {
          tokens: [".filter-fx-panel"],
          attributes: { "data-available": "false" },
        },
        "border-color",
      ),
      "var(--hardware-hairline)",
      "unavailable Filter border must use the semantic palette",
    );
  }
  assert.equal(
    getDeclarationFromBody(bypassedKnob, "background"),
    "var(--hardware-disabled)",
    "bypassed knob indicator must use the semantic palette"
  );
  assert.equal(
    getDeclarationFromBody(inactiveCurve, "stroke"),
    "var(--hardware-disabled)",
    "bypassed and unavailable curves must use the semantic palette"
  );
}

function assertMicroScreenLabelContrast(source) {
  const hardware = getHardwareSource(source);
  const root = getBalancedBlock(hardware, ":root");
  const pageStyle = getPageStyleSource(source);
  for (const width of [1440, 390, 320]) {
    const labelColor = getEffectiveCssDeclaration(
      pageStyle,
      width,
      { tokens: [".instrument-screen-head"] },
      "color",
    );
    const token = labelColor.match(/^var\(--([^)]+)\)$/)?.[1];
    assert.ok(token, "micro-screen label color must use a semantic token");
    const ratio = compositeContrast(
      getCustomPropertyValue(root, token),
      getCustomProperty(root, "hardware-page")
    );
    assert.ok(ratio >= 4.5, `micro-screen label contrast ${ratio} must be at least 4.5`);
  }
}

function assertActivePresetLabelContrast(source) {
  const pageStyle = getPageStyleSource(source);
  const root = getBalancedBlock(getHardwareSource(source), ":root");
  const activeAttributes = {
    "data-available": "true",
    "data-filter-active": "true",
    "data-filter-selected": "true",
  };
  for (const width of [1440, 1280, 1200, 900, 600, 390, 320]) {
    const activeTile = {
      tokens: [".filter-creature-tile"],
      attributes: activeAttributes,
    };
    const foreground = getEffectiveCssDeclaration(
      pageStyle,
      width,
      {
        tokens: [".filter-creature-state::before"],
        attributes: activeAttributes,
      },
      "color",
    );
    const background = getEffectiveBackgroundColor(
      pageStyle,
      width,
      activeTile,
    );
    assert.equal(
      getEffectiveBackgroundImage(pageStyle, width, activeTile),
      "none",
      `active preset tile background image must remain none for conservative contrast at ${width}px`,
    );
    const foregroundToken = foreground.match(/^var\(--([^,\s)]+)/)?.[1];
    const backgroundToken = background.match(/^var\(--([^,\s)]+)/)?.[1];
    assert.ok(foregroundToken, "active preset label must use a semantic foreground");
    assert.ok(backgroundToken, "active preset tile must use a semantic background");
    const ratio = compositeContrast(
      getCustomPropertyValue(root, foregroundToken),
      getCustomPropertyValue(root, backgroundToken),
    );
    assert.ok(
      ratio >= 4.5,
      `active preset label contrast ${ratio} must be at least 4.5 at ${width}px`,
    );
  }
}

function assertPageConsumerReadinessOrder(source) {
  const flag = "shellReadiness.page = true;";
  const event =
    'window.dispatchEvent(new CustomEvent("open-beats:page-consumer-ready"));';
  const flagIndex = source.indexOf(flag);
  const eventIndex = source.indexOf(event);
  assert.notEqual(flagIndex, -1, "page readiness flag must exist");
  assert.notEqual(eventIndex, -1, "page readiness event must exist");
  assert.ok(
    flagIndex < eventIndex,
    "page readiness flag must precede its consumer-ready event",
  );
}

function getDeclarationFromBody(body, property) {
  const match = body.match(new RegExp(`${escapeRegExp(property)}:\\s*([^;]+)`));
  assert.ok(match, `rule body must declare ${property}`);
  return match[1].trim();
}

function assertPhonePresetFit(source, scrollbarWidth = 17) {
  const hardware = getHardwareSource(source);
  const pageStyle = getPageStyleSource(source);
  const phoneRule = getBalancedBlock(hardware, "@media (max-width: 600px)");
  assertEffectivePhonePresetGeometry(pageStyle);
  assert.equal(
    getEffectiveCssDeclaration(
      pageStyle,
      320,
      { tokens: [".filter-fx-pedalboard"] },
      "flex-wrap",
    ),
    "wrap",
    "phone preset rows must keep wrapping enabled"
  );
  const dialogWidth = getCssDeclaration(phoneRule, ".effects-dialog", "width");
  const dialogInset = Number(dialogWidth.match(/^calc\(100vw - ([0-9.]+)px\)$/)?.[1]);
  assert.ok(Number.isFinite(dialogInset), "phone dialog width must expose its inline inset");

  const phonePresetRule = getCssRuleBody(phoneRule, "\\.filter-preset-pedal");
  const declaredCost = pixelValue(getEffectiveCssDeclaration(
    pageStyle,
    320,
    { tokens: [".filter-preset-pedal"] },
    "--phone-preset-inline-cost",
  ));
  assert.match(
    getDeclarationFromBody(phonePresetRule, "--phone-preset-basis"),
    /clamp\(\s*88px,\s*calc\(\(100vw - var\(--phone-preset-inline-cost\)\) \/ 2\),\s*116px\s*\)/
  );
  assert.equal(getDeclarationFromBody(phonePresetRule, "flex"), "0 0 var(--phone-preset-basis)");
  assert.equal(getDeclarationFromBody(phonePresetRule, "width"), "var(--phone-preset-basis)");
  assert.equal(pixelValue(getDeclarationFromBody(phonePresetRule, "min-width")), 88);
  assert.equal(pixelValue(getDeclarationFromBody(phonePresetRule, "max-width")), 116);

  const preResponsiveHardware = hardware.slice(0, hardware.indexOf("@media (min-width: 900px)"));
  const dialogBorder = pixelValue(
    getLastCssDeclaration(source, ".effects-dialog", "border").split(" ")[0]
  ) * 2;
  const panelBorder = pixelValue(
    getLastCssDeclaration(preResponsiveHardware, ".filter-fx-panel", "border").split(" ")[0]
  ) * 2;
  const bodyPadding = horizontalPadding(
    getCssDeclaration(phoneRule, ".filter-fx-body-inner", "padding")
  );
  const tonePadding = getEffectiveInlinePadding(
    pageStyle,
    320,
    { tokens: [".tone-fx-panel"] },
  );
  const toneBorder = getEffectiveInlineBorderWidth(
    pageStyle,
    320,
    { tokens: [".tone-fx-panel"] },
  );
  const pedalboardBody = getCssRuleBody(phoneRule, "\\.filter-fx-pedalboard");
  const pedalboardPadding = horizontalPadding(getDeclarationFromBody(pedalboardBody, "padding"));
  const pedalboardGap = pixelValue(getDeclarationFromBody(pedalboardBody, "gap"));
  const pedalboardBorder = pixelValue(
    getLastCssDeclaration(preResponsiveHardware, ".filter-fx-pedalboard", "border").split(" ")[0]
  ) * 2;
  const computedCost = dialogInset + dialogBorder + scrollbarWidth + panelBorder +
    bodyPadding + tonePadding + toneBorder + pedalboardPadding + pedalboardBorder +
    pedalboardGap;
  assert.equal(declaredCost, computedCost, "phone preset cost must match every live inline deduction");

  const viewportWidth = 320;
  const basis = Math.max(88, Math.min((viewportWidth - declaredCost) / 2, 116));
  const availableRow = viewportWidth - computedCost + pedalboardGap;
  assert.equal(basis, 112.5);
  assert.equal(basis * 2 + pedalboardGap, availableRow);
  assert.ok(basis >= 88 && basis <= 116);
}

function desktopMacroHeadingWidth(source) {
  const hardware = getHardwareSource(source);
  const pageStyle = getPageStyleSource(source);
  const alignedRule = getBalancedBlock(hardware, "@media (min-width: 1200px)");
  const alignedMarker = source.indexOf(
    "@media (min-width: 1200px)",
    source.indexOf("/* Dark hardware system:")
  );
  const alignedBase = source.slice(0, alignedMarker);
  const outerColumns = getCssDeclaration(
    alignedRule,
    ".effects-dialog .filter-fx-body-inner",
    "grid-template-columns"
  );
  const fractions = Array.from(
    outerColumns.matchAll(/([0-9.]+)fr\b/g),
    (match) => Number(match[1])
  );
  const outerGap = pixelValue(getCssDeclaration(alignedRule, ".filter-fx-body-inner", "gap"));
  const layoutColumns = getLastCssDeclaration(
    alignedBase,
    ".filter-fx-shared-controls .filter-fx-layout",
    "grid-template-columns"
  );
  const fixedTracks = Array.from(
    layoutColumns.matchAll(/minmax\(([0-9.]+)px,/g),
    (match) => Number(match[1])
  );
  const layoutGap = pixelValue(getLastCssDeclaration(
    alignedBase,
    ".filter-fx-shared-controls .filter-fx-layout",
    "gap"
  ));
  const macroGap = pixelValue(getEffectiveCssDeclaration(
    pageStyle,
    1200,
    { tokens: [".filter-fx-macros"] },
    "gap",
  ));
  const macroPadding = pixelValue(getLastCssDeclaration(
    alignedBase,
    ".filter-fx-shared-controls .filter-fx-macro",
    "padding"
  ));
  const macroBorder = pixelValue(getLastCssDeclaration(
    alignedBase,
    ".filter-fx-shared-controls .filter-fx-macro",
    "border"
  ).split(" ")[0]);
  const dialogWidth = Math.min(1120, 1200 - 48);
  const dialogBorder = pixelValue(getLastCssDeclaration(
    alignedBase,
    ".effects-dialog",
    "border"
  ).split(" ")[0]) * 2;
  const panelBorder = pixelValue(getLastCssDeclaration(
    alignedBase,
    ".filter-fx-panel",
    "border"
  ).split(" ")[0]) * 2;
  const bodyPadding = horizontalPadding(getLastCssDeclaration(
    alignedBase,
    ".filter-fx-body-inner",
    "padding"
  ));
  const bayPadding = getEffectiveInlinePadding(
    pageStyle,
    1200,
    { tokens: [".tone-fx-panel"] },
  );
  const bayBorder = getEffectiveInlineBorderWidth(
    pageStyle,
    1200,
    { tokens: [".tone-fx-panel"] },
  );
  const controlsPadding = horizontalPadding(getLastCssDeclaration(
    alignedBase,
    ".filter-fx-shared-controls",
    "padding"
  ));
  const controlsBorder = pixelValue(getLastCssDeclaration(
    alignedBase,
    ".filter-fx-shared-controls",
    "border"
  ).split(" ")[0]) * 2;
  const availableGrid = dialogWidth - 17 - dialogBorder - panelBorder - bodyPadding;
  const toneBay = (availableGrid - outerGap) * fractions[0] / (fractions[0] + fractions[1]);
  const macroDeck = toneBay - bayPadding - bayBorder - controlsPadding - controlsBorder -
    fixedTracks.reduce((sum, value) => sum + value, 0) - layoutGap * 2;
  return (macroDeck - macroGap) / 2 - (macroPadding + macroBorder) * 2;
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

test("Effects workbench starts closed while its controls remain mounted", () => {
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
  assert.doesNotMatch(bodyTag, /\b(?:data-expanded|inert|hidden|aria-hidden)=/);
  assert.match(pageSource, /<dialog\b[^>]*id="effectsDialog"/);
  assert.equal(panelMarkup.match(/\bclass="filter-fx-body-inner"/g)?.length, 1);
  assert.doesNotMatch(pageSource, /\blet filterPanelExpanded\b/);
  assert.doesNotMatch(pageSource, /\bfilterPanelExpanded\s*=/);
  assert.doesNotMatch(
    inlineHarnessSource,
    /filterPanelExpanded:\s*filterPanelExpanded\b/,
  );
  assert.match(
    inlineHarnessSource,
    /filterPanelExpanded:\s*Boolean\(effectsDialog && effectsDialog\.open\)/,
  );
  assert.match(inlineHarnessSource, /filterPanelAriaExpanded:\s*filterFxToggle/);
  assert.match(inlineHarnessSource, /effectsCommandAriaExpanded:\s*document/);
  assert.match(pageSource, /setFilterPanelExpanded\(false\)\s*;/);
  assert.doesNotMatch(pageSource, /filterFxBody\.dataset\.expanded|data-expanded="false"/);
  assert.doesNotMatch(pageSource, /setFilterPanelExpanded\([^\n]*animate/);
  assert.equal(
    toggleStateBlock.match(/Close effects/g)?.length,
    2,
    "the close control keeps a stable accessible and visible label",
  );
});

test("the native Effects dialog controller owns visibility and command handoff", () => {
  const controllerBlock = getBalancedBlock(
    pageSource,
    "function setFilterPanelExpanded",
  );
  assert.match(
    controllerBlock,
    /effectsDialog\.showModal\(\)|effectsDialog\.setAttribute\("open"/,
  );
  assert.match(
    controllerBlock,
    /getElementById\("effects-menu-trigger"\)\?\.focus\(\);[\s\S]*?effectsDialog\.showModal\(\)/,
    "Effects must own the native dialog opener before showModal",
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
  assert.match(controllerBlock, /effectsDialog\.close\(\);\s*return true;/);
  assert.match(
    pageSource,
    /filterFxToggle\.addEventListener\("click",\s*function \(\) \{\s*setFilterPanelExpanded\(false\)/,
  );
  assert.match(pageSource, /window\.addEventListener\("open-beats:effects"/);
  assert.match(pageSource, /window\.addEventListener\("open-beats:patterns"/);
});

test("page readiness sets its flag before publishing the consumer-ready event", () => {
  assertPageConsumerReadinessOrder(pageSource);
  const eventBeforeFlag = pageSource.replace(
    '      shellReadiness.page = true;\n      window.dispatchEvent(new CustomEvent("open-beats:page-consumer-ready"));',
    '      window.dispatchEvent(new CustomEvent("open-beats:page-consumer-ready"));\n      shellReadiness.page = true;',
  );
  assert.notEqual(eventBeforeFlag, pageSource, "page readiness ordering mutation must apply");
  assert.throws(
    () => assertPageConsumerReadinessOrder(eventBeforeFlag),
    /must precede/,
  );
});

test("#filterFxPanel is the sole vertical Effects scroller", () => {
  const pageStyle = getPageStyleSource();
  assertSoleEffectsVerticalScroller(pageStyle);
  assertEffectiveEffectsWorkbenchCss(pageStyle);
  assert.match(
    pageStyle,
    /\.effects-dialog #filterFxPanel\s*\{[\s\S]*?overflow-x:\s*hidden;[\s\S]*?overflow-y:\s*auto;[\s\S]*?overscroll-behavior-y:\s*contain;[\s\S]*?scrollbar-gutter:\s*stable;/
  );
  assert.match(pageStyle, /\.effects-dialog\s*\{[\s\S]*?overflow:\s*hidden/);
  assert.match(
    pageStyle,
    /\.effects-dialog :is\([\s\S]*?\.filter-fx-body[\s\S]*?\.tone-fx-panel[\s\S]*?\.space-fx-body[\s\S]*?\)\s*\{\s*overflow-y:\s*visible;/
  );

  const scrollableDialog = pageStyle.replace(
    /(\.effects-dialog\s*\{[^}]*?)overflow:\s*hidden;/,
    "$1overflow: auto;"
  );
  assert.notEqual(scrollableDialog, pageStyle, "dialog overflow mutation must apply");
  assert.throws(
    () => assertSoleEffectsVerticalScroller(scrollableDialog),
    /sole Effects vertical scroller/
  );

  for (const mutation of [
    ".effects-dialog section { overflow-y: auto; }",
    "dialog.effects-dialog section { overflow-y: auto; }",
    ".effects-dialog article { overflow-block: auto; }",
    "#effectsDialog { overflow: auto; }",
    ".effects-dialog * { overflow-y: auto; }",
    "#effectsDialog * { overflow-y: auto; }",
    "#effectsDialog .tone-fx-panel > section { overflow-y: auto; }",
    ".tone-fx-panel { overflow-y: auto; }",
    ".space-fx-body { overflow: scroll; }",
    ".filter-fx-body-inner > div { overflow-y: scroll; }",
    "@media (max-width: 600px) { .space-fx-panel section { OVERFLOW-Y: AUTO; } }",
  ]) {
    assert.throws(
      () => assertSoleEffectsVerticalScroller(`${pageStyle}\n${mutation}`),
      /sole Effects vertical scroller/
    );
  }

  assert.throws(
    () => assertEffectiveEffectsWorkbenchCss(
      `${pageStyle}\n@media (max-width: 600px) { #effectsDialog .filter-fx-bar { position: static; } }`,
    ),
    /must remain sticky/,
  );
  assert.throws(
    () => assertEffectiveEffectsWorkbenchCss(
      `${pageStyle}\n.effects-dialog .filter-fx-bar { z-index: 0; }`,
    ),
    /above the scrolling body/,
  );
  assert.throws(
    () => assertEffectiveEffectsWorkbenchCss(
      `${pageStyle}\n@media (max-width: 600px) { #effectsDialog { width: 100vw; } }`,
    ),
    /width must remain responsive/,
  );
  assert.throws(
    () => assertEffectiveEffectsWorkbenchCss(
      `${pageStyle}\n#effectsDialog .filter-fx-body-inner { display: block; }`,
    ),
    /responsive layout/,
  );
  for (const [mutation, message] of [
    [
      "@media (min-width: 1200px) and (max-width: 1200px) { #effectsDialog { width: 100vw; } }",
      /width must remain responsive/,
    ],
    [
      "@media (min-width: 1200px) and (max-width: 1200px) { #effectsDialog .filter-fx-body-inner { display: block; } }",
      /responsive layout/,
    ],
    [
      "@media (min-width: 1200px) and (max-width: 1200px) { #effectsDialog .filter-fx-bar { position: static; } }",
      /must remain sticky/,
    ],
    [
      "@media (min-width: 1200px) and (max-width: 1200px) { #effectsDialog .filter-fx-bar { z-index: 0; } }",
      /above the scrolling body/,
    ],
  ]) {
    assert.throws(
      () => assertEffectiveEffectsWorkbenchCss(`${pageStyle}\n${mutation}`),
      message,
    );
  }
  assert.throws(
    () => assertEffectiveEffectsWorkbenchCss(
      `${pageStyle}\n@media (min-width: 1200px) { #effectsDialog .filter-fx-body-inner { grid-template-columns: minmax(0, .85fr) minmax(360px, 1.15fr); } }`,
    ),
    /final column tracks/,
  );
});

test("320px Effects preset cards fit two columns with a classic scrollbar", () => {
  assertPhonePresetFit(pageSource);
  assert.throws(
    () => assertPhonePresetFit(
      pageSource.replace(
        "</style>",
        "@media (max-width: 600px) { #effectsDialog .filter-preset-pedal { flex: 0 0 116px; width: 116px; min-width: 116px; max-width: 116px; } }\n</style>",
      ),
    ),
    /phone preset flex must remain responsive/,
  );
  assert.throws(
    () => assertPhonePresetFit(
      pageSource.replace(
        "</style>",
        "@media (max-width: 600px) { #effectsDialog .filter-preset-pedal { --phone-preset-basis: 116px; } }\n</style>",
      ),
    ),
    /phone preset basis must remain responsive/,
  );
  assert.throws(
    () => assertPhonePresetFit(
      pageSource.replace(
        "</style>",
        "#effectsDialog .tone-fx-panel { padding: 30px; }\n</style>",
      ),
    ),
    /phone preset cost must match every live inline deduction/,
  );
  assert.throws(
    () => assertPhonePresetFit(
      pageSource.replace(
        "</style>",
        "#effectsDialog .tone-fx-panel { padding-inline: 30px; }\n</style>",
      ),
    ),
    /phone preset cost must match every live inline deduction/,
  );
  assert.throws(
    () => assertPhonePresetFit(
      pageSource.replace(
        "</style>",
        "#effectsDialog .tone-fx-panel { padding-inline-start: 30px; padding-inline-end: 30px; }\n</style>",
      ),
    ),
    /phone preset cost must match every live inline deduction/,
  );
  assert.throws(
    () => assertPhonePresetFit(
      pageSource.replace(
        "</style>",
        "#effectsDialog .tone-fx-panel { border-inline: 30px solid var(--hardware-hairline); }\n</style>",
      ),
    ),
    /phone preset cost must match every live inline deduction/,
  );
  assert.throws(
    () => assertPhonePresetFit(
      pageSource.replace(
        "</style>",
        "@media (max-width: 600px) { #effectsDialog .filter-preset-pedal { --phone-preset-inline-cost: 0px; } }\n</style>",
      ),
    ),
    /phone preset cost must match every live inline deduction/,
  );
  assert.throws(
    () => assertPhonePresetFit(pageSource, 30),
    /phone preset cost must match every live inline deduction/,
  );
  assert.throws(
    () => assertPhonePresetFit(
      pageSource.replace(
        "--phone-preset-inline-cost: 95px",
        "--phone-preset-inline-cost: 94px"
      )
    ),
    /phone preset cost must match every live inline deduction/
  );
  assert.throws(
    () => assertPhonePresetFit(
      pageSource.replace(
        ".filter-fx-pedalboard {\n      gap: 8px;\n      max-width: 264px;",
        ".filter-fx-pedalboard {\n      gap: 9px;\n      max-width: 264px;"
      )
    ),
    /phone preset cost must match every live inline deduction/
  );
  assert.throws(
    () => assertPhonePresetFit(
      pageSource.replace(
        ".filter-fx-pedalboard {\n      flex-wrap: wrap;\n      max-width: 390px;",
        ".filter-fx-pedalboard {\n      flex-wrap: nowrap;\n      max-width: 390px;"
      )
    ),
    /phone preset rows must keep wrapping enabled/
  );
  assert.throws(
    () => assertPhonePresetFit(
      pageSource.replace(
        "</style>",
        "@media (max-width: 600px) { #effectsDialog .filter-fx-pedalboard { flex-wrap: nowrap; } }\n</style>",
      ),
    ),
    /phone preset rows must keep wrapping enabled/,
  );
});

test("the authoritative dark shell uses only the accepted semantic palette", () => {
  const hardware = getHardwareSource();
  const root = getBalancedBlock(hardware, ":root");
  const expected = {
    "hardware-page": "#111111",
    "hardware-canvas": "#333333",
    "hardware-surface": "#111111",
    "hardware-ink": "#f2f2f2",
    "hardware-muted": "#f2f2f2",
    "signal-playback": "#2f80ed",
    "signal-selection": "#2f80ed",
    "signal-effect": "#27ae60",
    "signal-space": "#f2994a",
    "signal-space-strong": "#f57c00",
    "signal-alert": "#f57c00",
  };
  for (const [name, value] of Object.entries(expected)) {
    assertCanonicalCustomProperty(pageSource, root, name);
    assert.equal(getCustomProperty(root, name), value);
  }
  assert.match(root, /--hardware-hairline:\s*rgba\(242, 242, 242, 0\.38\)/);
  assert.match(root, /--hardware-disabled:\s*rgba\(242, 242, 242, 0\.68\)/);
  assert.match(globalStyleSource, /--color-page:\s*#111;/i);
  assert.match(globalStyleSource, /--color-panel:\s*#333333;/i);
  assert.match(globalStyleSource, /--color-text:\s*#f2f2f2;/i);
  assert.match(globalStyleSource, /--color-blue:\s*#2f80ed;/i);
  assert.match(globalStyleSource, /--color-green:\s*#27ae60;/i);
  assert.match(globalStyleSource, /--color-orange:\s*#f2994a;/i);
  assert.match(globalStyleSource, /--color-orange-strong:\s*#f57c00;/i);

  for (const [source, label] of [
    [hardware, "hardware layer"],
    [globalStyleSource, "global theme"],
    [appMenuSource, "app commands"],
    [arrangeDialogSource, "Patterns dialog"],
    [clearProjectDialogSource, "Clear Project dialog"],
    [dialogSource, "shared dialog"],
  ]) {
    assertAllowedPaletteLiterals(source, label);
  }

  for (const background of [expected["hardware-page"], expected["hardware-canvas"]]) {
    assert.ok(contrastRatio(expected["hardware-ink"], background) >= 4.5);
  }
  for (const signal of [
    expected["signal-selection"],
    expected["signal-effect"],
    expected["signal-space"],
    expected["signal-space-strong"],
  ]) {
    assert.ok(contrastRatio(signal, expected["hardware-page"]) >= 4.5);
    assert.ok(contrastRatio(signal, expected["hardware-canvas"]) >= 3);
    assert.ok(contrastRatio(expected["hardware-page"], signal) >= 4.5);
  }
  assertActivePresetLabelContrast(pageSource);
  const lowContrastActiveLabel = pageSource.replace(
    '.filter-preset-pedal[data-filter-active="true"] .filter-creature-state::before {\n    content: "On";\n    color: var(--hardware-ink, #f2f2f2);',
    '.filter-preset-pedal[data-filter-active="true"] .filter-creature-state::before {\n    content: "On";\n    color: var(--signal-effect, #27ae60);',
  );
  assert.notEqual(lowContrastActiveLabel, pageSource, "active label mutation must apply");
  assert.throws(
    () => assertActivePresetLabelContrast(lowContrastActiveLabel),
    /must be at least 4\.5/,
  );
  const lowContrastActiveTile = pageSource.replace(
    "</style>",
    '.filter-preset-pedal[data-filter-active="true"] .filter-creature-tile { background: var(--signal-effect); }\n</style>',
  );
  assert.throws(
    () => assertActivePresetLabelContrast(lowContrastActiveTile),
    /must be at least 4\.5/,
  );
  const lowContrastActiveTileColor = pageSource.replace(
    "</style>",
    '.filter-preset-pedal[data-filter-active="true"] .filter-creature-tile { background-color: var(--signal-effect); }\n</style>',
  );
  assert.throws(
    () => assertActivePresetLabelContrast(lowContrastActiveTileColor),
    /must be at least 4\.5/,
  );
  const obscuredActiveTile = pageSource.replace(
    "</style>",
    '.filter-preset-pedal[data-filter-active="true"] .filter-creature-tile { background-image: linear-gradient(var(--signal-effect), var(--signal-effect)); }\n</style>',
  );
  assert.throws(
    () => assertActivePresetLabelContrast(obscuredActiveTile),
    /background image must remain none/,
  );
});

test("effective legacy Filter state selectors use the semantic hardware palette", () => {
  assertEffectiveLegacyStatePalette(pageSource);
  const mutations = [
    [
      "border-color: var(--hardware-hairline);",
      "border-color: rgba(178, 163, 152, 0.28);",
    ],
    [
      "background: var(--hardware-disabled);",
      "background: #f7faf9;",
    ],
    [
      "stroke: var(--hardware-disabled);",
      "stroke: #829188;",
    ],
  ];
  for (const [accepted, rejected] of mutations) {
    const mutated = pageSource.replace(accepted, rejected);
    assert.notEqual(mutated, pageSource, `${accepted} mutation must apply`);
    assert.throws(
      () => assertEffectiveLegacyStatePalette(mutated),
      /semantic palette/
    );
  }
  assert.throws(
    () => assertEffectiveLegacyStatePalette(
      pageSource.replace(
        "</style>",
        '#effectsDialog .filter-fx-panel[data-available="false"] { border-color: var(--signal-alert); }\n</style>',
      ),
    ),
    /semantic palette/,
  );
});

test("transport, selection, bay, bypass, disabled, unavailable, and destructive states stay distinct", () => {
  const hardware = getHardwareSource();
  assert.match(
    getBalancedBlock(hardware, '#playBtn[data-mode="play"]'),
    /color:\s*var\(--hardware-page\);[\s\S]*?border-color:\s*var\(--signal-playback\);[\s\S]*?background:\s*var\(--signal-playback\)/
  );
  assert.match(
    getBalancedBlock(hardware, '.filter-preset-pedal[data-filter-selected="true"]'),
    /border-color:\s*var\(--signal-selection\);[\s\S]*?box-shadow:\s*0 0 0 2px var\(--signal-selection\)/
  );
  assert.equal(
    getLastCssDeclaration(hardware, ".tone-fx-panel", "border-color"),
    "var(--signal-effect)"
  );
  assert.equal(
    getLastCssDeclaration(hardware, ".space-fx-panel", "border-color"),
    "var(--signal-space)"
  );
  assert.match(
    getBalancedBlock(hardware, '.filter-fx-shared-controls .filter-fx-footswitch[aria-pressed="true"]'),
    /color:\s*var\(--hardware-page\);[\s\S]*?background:\s*var\(--signal-effect\)/
  );
  assert.match(
    getBalancedBlock(hardware, '.space-fx-bypass[aria-pressed="true"]'),
    /color:\s*var\(--hardware-page\);[\s\S]*?background:\s*var\(--signal-space\)/
  );
  assert.match(
    getBalancedBlock(hardware, '.space-fx-presets button[data-space-selected="true"]'),
    /border-color:\s*var\(--signal-selection\);[\s\S]*?background:\s*var\(--signal-selection\);[\s\S]*?var\(--signal-space-strong\)/
  );
  assert.match(
    getBalancedBlock(hardware, "#playBtn:disabled,"),
    /color:\s*var\(--hardware-disabled\);[\s\S]*?opacity:\s*1;[\s\S]*?cursor:\s*not-allowed/
  );
  assert.match(
    hardware,
    /data-available="false"\] \.tone-fx-panel,[\s\S]*?data-available="false"\]\s*\{\s*border-style:\s*dashed;/
  );
  assert.match(
    getCssRuleBody(hardware, "#clearProjectBtn,\\s*#clearProjectBtn:hover"),
    /(?:^|\s)color:\s*var\(--hardware-page\);[\s\S]*?background:\s*var\(--signal-space-strong\)/
  );
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

test("the micro-screen heading keeps normal-text contrast on its live backdrop", () => {
  assertMicroScreenLabelContrast(pageSource);
  const mutated = pageSource.replace(
    ".instrument-screen-head {\n    color: var(--hardware-muted);\n  }",
    ".instrument-screen-head {\n    color: var(--hardware-hairline);\n  }"
  );
  assert.notEqual(mutated, pageSource, "micro-screen label mutation must apply");
  assert.throws(
    () => assertMicroScreenLabelContrast(mutated),
    /must be at least 4\.5/
  );
  assert.throws(
    () => assertMicroScreenLabelContrast(
      pageSource.replace(
        "</style>",
        "@media (max-width: 600px) { .header-grid .instrument-screen-head { color: var(--hardware-hairline); } }\n</style>",
      ),
    ),
    /must be at least 4\.5/,
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
    ["#bpm:focus\\s*,[\\s\\S]*?\\.step\\.playing:focus-visible", "#2f80ed"],
    ["\\.filter-fx-action:focus-visible\\s*,[\\s\\S]*?\\.filter-fx-shared-controls \\.filter-fx-macro input:focus-visible", "#27ae60"],
    [":global\\(\\.pitch-roll-cell:focus-visible\\)", "#2f80ed"],
    [":global\\(\\.arrange-pattern-button:focus-visible\\)\\s*,[\\s\\S]*?:global\\(\\.arrange-repeat-input:focus-visible\\)", "#2f80ed"],
  ];
  for (const [selector, halo] of focusSelectors) {
    const focusRule = getCssRuleBody(hardwareSource, selector);
    assert.match(
      focusRule,
      /\boutline:\s*3px solid var\([^,]+,\s*#f2f2f2\)\s*;/i,
      `${selector} must retain a literal high-contrast ink edge`,
    );
    assert.match(
      focusRule,
      new RegExp(`\\bbox-shadow:\\s*0 0 0 6px var\\([^,]+,\\s*${halo}\\)\\s*;`, "i"),
      `${selector} must retain its separate semantic halo`,
    );
  }
  assertEffectivePlayingStepFocus(pageSource);
  const missingPlayingFocus = pageSource.replace(
    /\n  \.step\.active\.playing:focus-visible \{\n    outline: 3px solid var\(--hardware-ink, #f2f2f2\);\n    outline-offset: 2px;\n    box-shadow: 0 0 0 6px var\(--signal-selection, #2f80ed\);\n  \}\n/,
    "\n",
  );
  assert.notEqual(missingPlayingFocus, pageSource, "playing focus mutation must apply");
  assert.throws(
    () => assertEffectivePlayingStepFocus(missingPlayingFocus),
    /focused playing step/,
  );
});

test("Effects workbench and portaled Pattern content honor reduced motion", () => {
  const hardwareSource = getHardwareSource();
  assert.match(hardwareSource, /\.effects-dialog\s*\{/);
  assert.doesNotMatch(hardwareSource, /\.pattern-manager-dialog/);
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
  assert.match(hardware, /\.space-mole-dust\s*\{\s*stroke:\s*var\(--signal-space-strong\)/);
  assert.match(hardware, /\.space-whale-sonar\s*\{\s*stroke:\s*var\(--signal-space\)/);
  assert.match(hardware, /\.space-jellyfish-ripple\s*\{\s*fill:\s*var\(--signal-space-strong\);\s*stroke:\s*var\(--signal-space\)/);
  assert.match(hardware, /\.space-snail-crescent\s*\{\s*fill:\s*none;\s*stroke:\s*var\(--signal-space\)/);
  for (const gesture of ["space-mole-dust", "space-whale-sonar", "space-jellyfish-ripple"]) {
    const keyframes = getBalancedBlock(hardware, `@keyframes ${gesture}`);
    assert.match(keyframes, /0%\s*\{[^}]*visibility:\s*visible;[^}]*opacity:\s*0;[^}]*transform:\s*[^;}]+;?[^}]*\}/);
    assert.match(keyframes, /(?:45|50)%\s*\{[^}]*opacity:\s*(?:1|0\.9);?[^}]*\}/);
    assert.match(keyframes, /100%\s*\{[^}]*visibility:\s*hidden;[^}]*opacity:\s*0;[^}]*transform:\s*[^;}]+;?[^}]*\}/);
  }
  assert.match(hardware, /@keyframes space-snail-crescent[\s\S]*?100%\s*\{\s*visibility:\s*visible;\s*opacity:\s*1/);
  assert.match(hardware, /data-enabled="false"\] \.space-creature-gesture,[\s\S]*?data-available="false"\] \.space-creature-gesture[\s\S]*?animation:\s*none;[\s\S]*?visibility:\s*hidden/);
  assert.match(hardware, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?data-enabled="true"\]\[data-available="true"\][\s\S]*?button:is\(\[data-space-selected="true"\]\)[\s\S]*?\.space-creature-gesture[\s\S]*?animation:\s*none;[\s\S]*?visibility:\s*visible;[\s\S]*?transform:\s*none/);
  const twoBayRule = hardware.match(/@media \(min-width: (\d+)px\)\s*\{\s*\.effects-dialog \.filter-fx-body-inner\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1\.15fr\) minmax\(360px, 0\.85fr\)/);
  assert.ok(twoBayRule, "two-bay breakpoint must be extractable");
  const twoBayBreakpoint = Number(twoBayRule[1]);
  assert.equal(twoBayBreakpoint, 1200);
  assert.ok(900 < twoBayBreakpoint, "900px must remain stacked");
  for (const width of [1200, 1280, 1440]) {
    assert.ok(width >= twoBayBreakpoint, `${width}px must align both bays`);
  }
  const alignedRule = getBalancedBlock(hardware, "@media (min-width: 1200px)");
  assert.match(
    alignedRule,
    /\.filter-fx-shared-controls \.filter-fx-macros\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);[\s\S]*?grid-template-rows:\s*repeat\(2, 1fr\)/
  );
  const outerColumns = getCssDeclaration(alignedRule, ".effects-dialog .filter-fx-body-inner", "grid-template-columns");
  const fractions = Array.from(outerColumns.matchAll(/([0-9.]+)fr\b/g), (match) => Number(match[1]));
  assert.deepEqual(fractions, [1.15, 0.85]);
  const hardwareBase = hardware.slice(0, hardware.indexOf("@media (min-width: 900px)"));
  assert.equal(
    getCssDeclaration(
      hardwareBase,
      ".filter-fx-shared-controls .filter-fx-macros",
      "gap"
    ),
    "8px",
    "desktop fit must read the live non-phone macro gap"
  );
  const macroHeading = desktopMacroHeadingWidth(pageSource);
  const grit = FILTER_EFFECT_PRESETS.find((preset) => preset.id === "grit");
  assert.ok(grit);
  const headings = [
    `Drive · ${formatFilterMacroValue("drive", grit.drive)}`,
    `Drive · ${formatFilterMacroValue("drive", 100)}`,
  ];
  assert.deepEqual(headings, ["Drive · 68%, Driven", "Drive · 100%, Driven"]);
  assert.ok(macroHeading >= 96.02, `${macroHeading}px must fit ${headings[1]}`);
  const desktopGapRule = `.filter-fx-shared-controls .filter-fx-macros {\n    gap: 8px;\n  }`;
  assert.equal(pageSource.match(new RegExp(escapeRegExp(desktopGapRule), "g"))?.length, 1);
  const wideGapMutation = pageSource.replace(
    desktopGapRule,
    desktopGapRule.replace("gap: 8px", "gap: 40px")
  );
  assert.throws(
    () => assert.ok(
      desktopMacroHeadingWidth(wideGapMutation) >= 96.02,
      "40px desktop macro gap must fail the heading fit floor"
    ),
    /40px desktop macro gap must fail/
  );
  const lateWideGapMutation = pageSource.replace(
    "</style>",
    "@media (min-width: 1200px) { #effectsDialog .filter-fx-shared-controls .filter-fx-macros { gap: 40px; } }\n</style>",
  );
  assert.throws(
    () => assert.ok(
      desktopMacroHeadingWidth(lateWideGapMutation) >= 96.02,
      "late 40px desktop macro gap must fail the heading fit floor",
    ),
    /late 40px desktop macro gap must fail/,
  );
  const lateInlinePaddingMutation = pageSource.replace(
    "</style>",
    "#effectsDialog .tone-fx-panel { padding-inline: 30px; }\n</style>",
  );
  assert.throws(
    () => assert.ok(
      desktopMacroHeadingWidth(lateInlinePaddingMutation) >= 96.02,
      "late 30px logical Tone padding must fail the heading fit floor",
    ),
    /late 30px logical Tone padding must fail/,
  );
  const lateInlineEdgesMutation = pageSource.replace(
    "</style>",
    "#effectsDialog .tone-fx-panel { padding-inline-start: 30px; padding-inline-end: 30px; }\n</style>",
  );
  assert.throws(
    () => assert.ok(
      desktopMacroHeadingWidth(lateInlineEdgesMutation) >= 96.02,
      "late 30px logical Tone edge padding must fail the heading fit floor",
    ),
    /late 30px logical Tone edge padding must fail/,
  );
  const lateInlineBorderMutation = pageSource.replace(
    "</style>",
    "#effectsDialog .tone-fx-panel { border-inline: 30px solid var(--hardware-hairline); }\n</style>",
  );
  assert.throws(
    () => assert.ok(
      desktopMacroHeadingWidth(lateInlineBorderMutation) >= 96.02,
      "late 30px logical Tone border must fail the heading fit floor",
    ),
    /late 30px logical Tone border must fail/,
  );
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
  assert.match(selectedRule, /color:\s*var\(--hardware-page\)/);
  assert.match(selectedRule, /border-color:\s*var\(--signal-selection\)/);
  assert.match(selectedRule, /background:\s*var\(--signal-selection\)/);
  assert.match(selectedRule, /inset 0 -4px 0 var\(--signal-space-strong\)/);
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
    /\.space-fx-panel\[data-available="false"\] \.space-fx-presets button,[\s\S]*?\.space-fx-panel\[data-available="false"\] \.space-fx-presets svg\s*\{\s*opacity:\s*1/
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
    `@media (min-width: 1400px) { ${disabledChromeSelector} { opacity: 1; } }`,
    disabledChromeSelector
  ));
  assert.ok(contrastRatio(variables["hardware-muted"], variables["hardware-surface"]) >= 4.5);
  assert.ok(contrastRatio(variables["hardware-muted"], variables["hardware-canvas"]) >= 4.5);
});
