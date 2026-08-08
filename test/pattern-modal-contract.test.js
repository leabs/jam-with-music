import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const arrangeSource = readFileSync(
  new URL("../src/components/ArrangeDialog.jsx", import.meta.url),
  "utf8",
);
const dialogSource = readFileSync(
  new URL("../src/components/ui/dialog.jsx", import.meta.url),
  "utf8",
);
const pageSource = readFileSync(
  new URL("../src/pages/index.astro", import.meta.url),
  "utf8",
);
const globalStyleSource = readFileSync(
  new URL("../src/styles/globals.css", import.meta.url),
  "utf8",
);
const clearProjectSource = readFileSync(
  new URL("../src/components/ClearProjectDialog.jsx", import.meta.url),
  "utf8",
);

function contrastRatio(foreground, background) {
  const luminance = (hex) => {
    const channels = hex.match(/[0-9a-f]{2}/gi).map(value => parseInt(value, 16) / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countMatches(source, pattern) {
  return source.match(pattern)?.length ?? 0;
}

function compact(source) {
  return source.replace(/\s+/g, " ").trim();
}

function assertPatternConsumerReadinessOrder(source) {
  const flag = "readiness.patterns = true;";
  const event =
    'window.dispatchEvent(new CustomEvent("open-beats:patterns-consumer-ready"));';
  const flagIndex = source.indexOf(flag);
  const eventIndex = source.indexOf(event);
  assert.notEqual(flagIndex, -1, "Pattern readiness flag must exist");
  assert.notEqual(eventIndex, -1, "Pattern readiness event must exist");
  assert.ok(
    flagIndex < eventIndex,
    "Pattern readiness flag must precede its consumer-ready event",
  );
}

function getJsxBlock(source, componentName) {
  const match = source.match(
    new RegExp(
      `<${escapeRegExp(componentName)}\\b[^>]*>[\\s\\S]*?<\\/${escapeRegExp(componentName)}>`,
    ),
  );
  assert.ok(match, `<${componentName}> block must exist`);
  return match[0];
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

function getRenderedPatternClassNames(source, variableName) {
  const renderBlock = getBalancedBlock(source, "function renderPatternList()");
  const match = renderBlock.match(
    new RegExp(`${escapeRegExp(variableName)}\\.className\\s*=\\s*"([^"]+)"\\s*;`),
  );
  assert.ok(
    match,
    `${variableName}.className must be a literal installed assignment`,
  );
  return match[1].trim().split(/\s+/);
}

function getCssRuleBody(source, selector) {
  const match = source.match(
    new RegExp(`${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`),
  );
  assert.ok(match, `CSS rule ${selector} must exist`);
  return match[1];
}

function getArrangeStyleSource(source) {
  const startMarker = "<style>{`";
  const endMarker = "`}</style>";
  const startIndex = source.indexOf(startMarker);
  const endIndex = source.indexOf(endMarker, startIndex + startMarker.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, "Arrange style must exist");
  return source.slice(startIndex + startMarker.length, endIndex);
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
  const query = header.replace(/^@media\s*/i, "");
  return splitSelectorList(query).some((branch) => {
    const bounds = Array.from(
      branch.matchAll(/\((min|max)-width:\s*([0-9.]+)px\)/gi),
      ([, kind, value]) => ({ kind: kind.toLowerCase(), value: Number(value) }),
    );
    if (!bounds.length) return false;
    return bounds.every(({ kind, value }) =>
      kind === "min" ? viewportWidth >= value : viewportWidth <= value,
    );
  });
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

function splitComplexSelector(selector) {
  const compounds = [];
  const combinators = [];
  let buffer = "";
  let parentheses = 0;
  let brackets = 0;
  let quote = null;
  const flushCompound = () => {
    const compound = buffer.trim();
    buffer = "";
    if (!compound) return false;
    compounds.push(compound);
    return true;
  };

  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index];
    if (quote) {
      buffer += character;
      if (character === "\\") {
        buffer += selector[index + 1] || "";
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      buffer += character;
      continue;
    }
    if (character === "(") parentheses += 1;
    if (character === ")") parentheses -= 1;
    if (character === "[") brackets += 1;
    if (character === "]") brackets -= 1;
    if (parentheses || brackets) {
      buffer += character;
      continue;
    }
    if (character === "+" || character === "~") return null;
    if (character === ">") {
      flushCompound();
      if (combinators.length !== compounds.length - 1) return null;
      combinators.push(">");
      while (/\s/.test(selector[index + 1] || "")) index += 1;
      continue;
    }
    if (/\s/.test(character)) {
      if (!flushCompound()) continue;
      let nextIndex = index + 1;
      while (/\s/.test(selector[nextIndex] || "")) nextIndex += 1;
      if (selector[nextIndex] !== ">") combinators.push(" ");
      index = nextIndex - 1;
      continue;
    }
    buffer += character;
  }
  if (!flushCompound()) return null;
  if (combinators.length !== compounds.length - 1) return null;
  return { compounds, combinators };
}

function compoundMatchesPatternElement(compound, element) {
  if (compound.includes("::")) return false;
  let normalized = compound;
  if (normalized.includes(":not(:disabled)")) {
    if (element.disabled) return false;
    normalized = normalized.replaceAll(":not(:disabled)", "");
  }
  if (normalized.includes(":hover") && !element.hover) return false;
  if (normalized.includes(":focus-visible") && !element.focusVisible) return false;
  if (normalized.includes(":disabled") && !element.disabled) return false;
  normalized = normalized
    .replaceAll(":hover", "")
    .replaceAll(":focus-visible", "")
    .replaceAll(":disabled", "");
  if (/(?<!:):(?!:)[\w-]+/.test(normalized)) return false;

  const typeSelector = normalized.match(/^(\*|[a-z][\w-]*)/i)?.[1];
  if (typeSelector && typeSelector !== "*" && typeSelector.toLowerCase() !== element.tag) {
    return false;
  }
  for (const id of normalized.match(/#[\w-]+/g) || []) {
    if (id.slice(1) !== element.id) return false;
  }
  for (const className of normalized.match(/\.[\w-]+/g) || []) {
    if (!element.classes.has(className.slice(1))) return false;
  }
  return true;
}

function selectorMatchesPatternChain(selector, chain) {
  const parsed = splitComplexSelector(selector);
  if (!parsed) return false;
  let chainIndex = chain.length - 1;
  let compoundIndex = parsed.compounds.length - 1;
  if (!compoundMatchesPatternElement(parsed.compounds[compoundIndex], chain[chainIndex])) {
    return false;
  }
  while (compoundIndex > 0) {
    const combinator = parsed.combinators[compoundIndex - 1];
    compoundIndex -= 1;
    if (combinator === ">") {
      chainIndex -= 1;
      if (
        chainIndex < 0 ||
        !compoundMatchesPatternElement(parsed.compounds[compoundIndex], chain[chainIndex])
      ) {
        return false;
      }
      continue;
    }
    let ancestorIndex = chainIndex - 1;
    while (
      ancestorIndex >= 0 &&
      !compoundMatchesPatternElement(parsed.compounds[compoundIndex], chain[ancestorIndex])
    ) {
      ancestorIndex -= 1;
    }
    if (ancestorIndex < 0) return false;
    chainIndex = ancestorIndex;
  }
  return true;
}

function assertDeclaration(ruleBody, property, value) {
  assert.match(
    ruleBody,
    new RegExp(
      `${escapeRegExp(property)}\\s*:\\s*${escapeRegExp(value)}\\s*;`,
      "i",
    ),
    `expected ${property}: ${value}`,
  );
}

function selectorSpecificity(selector) {
  const normalized = selector.replace(/:where\([^)]*\)/g, "");
  return [
    (normalized.match(/#[\w-]+/g) || []).length,
    (normalized.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+(?:\([^)]*\))?/g) || []).length,
    (normalized.match(/(?:^|[\s>+~])(?:[a-z][\w-]*|\*)/gi) || [])
      .filter((token) => !token.trim().startsWith("*")).length,
  ];
}

function compareSpecificity(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function selectorMatchesPatternTarget(selector, target) {
  const withoutNotDisabled = selector.replace(/:not\(:disabled\)/g, "");
  if (selector.includes(":not(:disabled)") && target.disabled) return false;
  if (withoutNotDisabled.includes(":disabled") && !target.disabled) return false;
  if (selector.includes(":hover") && !target.hover) return false;
  if (selector.includes(":focus-visible") && !target.focusVisible) return false;
  for (const id of selector.match(/#[\w-]+/g) || []) {
    if (id.slice(1) !== target.id) return false;
  }
  for (const className of selector.match(/\.[\w-]+/g) || []) {
    if (!target.classes.has(className.slice(1))) return false;
  }
  return true;
}

function getEffectivePatternDeclaration(source, target, property) {
  let winner = null;
  let order = 0;
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations = Object.fromEntries(
      Array.from(
        match[2].matchAll(/(?:^|;)\s*([\w-]+)\s*:\s*([^;]+)(?=;|$)/g),
        ([, name, value]) => [name, value.trim()],
      ),
    );
    if (!(property in declarations)) continue;
    for (const selector of match[1].split(",").map((value) => value.trim())) {
      order += 1;
      if (!selectorMatchesPatternTarget(selector, target)) continue;
      const specificity = selectorSpecificity(selector);
      if (
        !winner ||
        compareSpecificity(specificity, winner.specificity) > 0 ||
        (compareSpecificity(specificity, winner.specificity) === 0 && order > winner.order)
      ) {
        winner = { value: declarations[property], specificity, order };
      }
    }
  }
  assert.ok(winner, `${property} must resolve for the Pattern target`);
  return winner.value;
}

function splitCssComponents(value) {
  const components = [];
  let start = 0;
  let parentheses = 0;
  let quote = null;
  for (let index = 0; index <= value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(") parentheses += 1;
    if (character === ")") parentheses -= 1;
    if (index < value.length && (!/\s/.test(character) || parentheses)) continue;
    const component = value.slice(start, index).trim();
    if (component) components.push(component);
    while (/\s/.test(value[index + 1] || "")) index += 1;
    start = index + 1;
  }
  return components;
}

function expandPaddingShorthand(value) {
  const components = splitCssComponents(value);
  if (components.length === 1) return [components[0], components[0], components[0], components[0]];
  if (components.length === 2) return [components[0], components[1], components[0], components[1]];
  if (components.length === 3) return [components[0], components[1], components[2], components[1]];
  if (components.length === 4) return components;
  return null;
}

function expandPatternDeclaration(name, value) {
  const unsupported = `__unsupported-${name}:${value}`;
  if (name === "flex") {
    if (value === "none") {
      return { "flex-grow": "0", "flex-shrink": "0", "flex-basis": "auto" };
    }
    if (value === "auto") {
      return { "flex-grow": "1", "flex-shrink": "1", "flex-basis": "auto" };
    }
    if (value === "initial") {
      return { "flex-grow": "0", "flex-shrink": "1", "flex-basis": "auto" };
    }
    const components = splitCssComponents(value);
    if (components.length !== 3) {
      return {
        "flex-grow": unsupported,
        "flex-shrink": unsupported,
        "flex-basis": unsupported,
      };
    }
    return {
      "flex-grow": components[0],
      "flex-shrink": components[1],
      "flex-basis": components[2],
    };
  }
  if (["flex-grow", "flex-shrink", "flex-basis", "flex-wrap"].includes(name)) {
    return { [name]: value };
  }
  if (name === "flex-flow") {
    const components = splitCssComponents(value);
    const wrap = components.find((component) =>
      ["nowrap", "wrap", "wrap-reverse"].includes(component),
    );
    const direction = components.find((component) =>
      ["row", "row-reverse", "column", "column-reverse"].includes(component),
    );
    if (components.some((component) => component !== wrap && component !== direction)) {
      return { "flex-wrap": unsupported };
    }
    return {
      "flex-direction": direction || "row",
      "flex-wrap": wrap || "nowrap",
    };
  }
  if (name === "padding") {
    const expanded = expandPaddingShorthand(value);
    if (!expanded) {
      return {
        "padding-inline-start": unsupported,
        "padding-inline-end": unsupported,
      };
    }
    return {
      "padding-top": expanded[0],
      "padding-inline-end": expanded[1],
      "padding-bottom": expanded[2],
      "padding-inline-start": expanded[3],
    };
  }
  if (name === "padding-inline") {
    const components = splitCssComponents(value);
    if (components.length === 1) {
      return {
        "padding-inline-start": components[0],
        "padding-inline-end": components[0],
      };
    }
    if (components.length === 2) {
      return {
        "padding-inline-start": components[0],
        "padding-inline-end": components[1],
      };
    }
    return {
      "padding-inline-start": unsupported,
      "padding-inline-end": unsupported,
    };
  }
  if (name === "padding-left") return { "padding-inline-start": value };
  if (name === "padding-right") return { "padding-inline-end": value };
  if (["padding-inline-start", "padding-inline-end"].includes(name)) {
    return { [name]: value };
  }
  return { [name]: value };
}

function getEffectivePatternCssDeclaration(source, viewportWidth, targetChain, property) {
  let winner = null;
  let sourceOrder = 0;
  for (const rule of getApplicableCssRules(source, viewportWidth)) {
    const matchingSelectors = splitSelectorList(rule.header)
      .filter((selector) => selectorMatchesPatternChain(selector, targetChain));
    for (const match of rule.body.matchAll(/(?:^|;)\s*([\w-]+)\s*:\s*([^;]+)(?=;|$)/g)) {
      sourceOrder += 1;
      if (!matchingSelectors.length) continue;
      const name = match[1].toLowerCase();
      const rawValue = match[2];
      const important = /\s*!important\s*$/i.test(rawValue);
      const value = rawValue.replace(/\s*!important\s*$/i, "").trim();
      const expanded = expandPatternDeclaration(name, value);
      if (!(property in expanded)) continue;
      for (const selector of matchingSelectors) {
        const candidate = {
          value: expanded[property],
          important,
          specificity: selectorSpecificity(selector),
          order: sourceOrder,
        };
        if (
          !winner ||
          Number(candidate.important) > Number(winner.important) ||
          (candidate.important === winner.important &&
            (compareSpecificity(candidate.specificity, winner.specificity) > 0 ||
              (compareSpecificity(candidate.specificity, winner.specificity) === 0 &&
                candidate.order > winner.order)))
        ) {
          winner = candidate;
        }
      }
    }
  }
  assert.ok(winner, `${property} must resolve for the Pattern target at ${viewportWidth}px`);
  return winner.value;
}

function assertNoConflictingPatternEquivalents(
  source,
  viewportWidth,
  targetChain,
  declarationNames,
  expected,
) {
  for (const rule of getApplicableCssRules(source, viewportWidth)) {
    if (!splitSelectorList(rule.header).some((selector) =>
      selectorMatchesPatternChain(selector, targetChain))) {
      continue;
    }
    for (const match of rule.body.matchAll(/(?:^|;)\s*([\w-]+)\s*:\s*([^;]+)(?=;|$)/g)) {
      const name = match[1].toLowerCase();
      if (!declarationNames.includes(name)) continue;
      const value = match[2].replace(/\s*!important\s*$/i, "").trim();
      const expanded = expandPatternDeclaration(name, value);
      for (const [property, expectedValue] of Object.entries(expected)) {
        if (!(property in expanded)) continue;
        assert.equal(
          expanded[property],
          expectedValue,
          `conflicting 320px Pattern ${name} must be rejected for ${property}`,
        );
      }
    }
  }
}

function getPatternCssChain(className, cardState = "is-idle", renderSource = pageSource) {
  const element = (tag, { id = null, classes = [] } = {}) => ({
    tag,
    id,
    classes: new Set(classes),
    hover: false,
    focusVisible: false,
    disabled: false,
  });
  const chain = [
    element("html"),
    element("body"),
    element("div", { id: "patternsDialog", classes: ["pattern-manager-dialog"] }),
    element("div", { id: "patternList", classes: ["pattern-manager-list"] }),
    element("div", { classes: getRenderedPatternClassNames(renderSource, "row") }),
    element("div", {
      classes: [
        ...getRenderedPatternClassNames(renderSource, "patternCard"),
        cardState,
      ],
    }),
  ];
  if (className === "arrange-pattern-card") return chain;
  const leafVariable = className === "arrange-pattern-button" ? "patternBtn" : "rowActions";
  const leafClasses = getRenderedPatternClassNames(renderSource, leafVariable);
  if (className === "arrange-pattern-button") {
    assert.ok(
      leafClasses.includes("flex-1"),
      "installed Pattern button must retain flex-1",
    );
    assert.ok(
      leafClasses.includes("truncate"),
      "installed Pattern button must retain truncate",
    );
    assert.ok(
      !leafClasses.includes("flex"),
      "installed Pattern button must not fabricate flex",
    );
  }
  chain.push(
    element(className === "arrange-pattern-button" ? "button" : "div", {
      classes: leafClasses,
    }),
  );
  return chain;
}

function assertEffectiveMobilePatternIdentity(source, renderSource = pageSource) {
  const styleSource = source.includes("<style>") ? getArrangeStyleSource(source) : source;
  for (const cardState of ["is-selected", "is-idle"]) {
    const cardTarget = getPatternCssChain("arrange-pattern-card", cardState, renderSource);
    const buttonTarget = getPatternCssChain("arrange-pattern-button", cardState, renderSource);
    const actionsTarget = getPatternCssChain("arrange-row-actions", cardState, renderSource);

    assertNoConflictingPatternEquivalents(
      styleSource,
      320,
      cardTarget,
      ["flex-flow"],
      { "flex-wrap": "wrap" },
    );
    assertNoConflictingPatternEquivalents(
      styleSource,
      320,
      buttonTarget,
      [
        "flex-grow",
        "flex-shrink",
        "flex-basis",
        "padding-inline",
        "padding-left",
        "padding-right",
        "padding-inline-start",
        "padding-inline-end",
      ],
      {
        "flex-grow": "1",
        "flex-shrink": "0",
        "flex-basis": "100%",
        "padding-inline-start": "6px",
        "padding-inline-end": "6px",
      },
    );

    assert.equal(
      getEffectivePatternCssDeclaration(styleSource, 320, cardTarget, "flex-wrap"),
      "wrap",
      `winning 320px ${cardState} Pattern card must wrap`,
    );
    assert.equal(
      getEffectivePatternCssDeclaration(styleSource, 320, buttonTarget, "flex-grow"),
      "1",
      `winning 320px ${cardState} Pattern button must own a complete line`,
    );
    assert.equal(
      getEffectivePatternCssDeclaration(styleSource, 320, buttonTarget, "flex-shrink"),
      "0",
      `winning 320px ${cardState} Pattern button must not shrink`,
    );
    assert.equal(
      getEffectivePatternCssDeclaration(styleSource, 320, buttonTarget, "flex-basis"),
      "100%",
      `winning 320px ${cardState} Pattern button must retain a full-line basis`,
    );
    assert.equal(
      getEffectivePatternCssDeclaration(styleSource, 320, buttonTarget, "padding-inline-start"),
      "6px",
      `winning 320px ${cardState} Pattern button must preserve label padding`,
    );
    assert.equal(
      getEffectivePatternCssDeclaration(styleSource, 320, buttonTarget, "padding-inline-end"),
      "6px",
      `winning 320px ${cardState} Pattern button must preserve label padding`,
    );
    assert.equal(
      getEffectivePatternCssDeclaration(styleSource, 320, actionsTarget, "flex-grow"),
      "0",
      `winning 320px ${cardState} Pattern actions must preserve their fixed width`,
    );
    assert.equal(
      getEffectivePatternCssDeclaration(styleSource, 320, actionsTarget, "flex-shrink"),
      "0",
      `winning 320px ${cardState} Pattern actions must not shrink`,
    );
    assert.equal(
      getEffectivePatternCssDeclaration(styleSource, 320, actionsTarget, "flex-basis"),
      "90px",
      `winning 320px ${cardState} Pattern actions must preserve their fixed basis`,
    );
    assert.equal(
      getEffectivePatternCssDeclaration(styleSource, 320, actionsTarget, "flex-wrap"),
      "wrap",
      `winning 320px ${cardState} Pattern actions must wrap`,
    );
    assert.equal(
      getEffectivePatternCssDeclaration(styleSource, 320, actionsTarget, "grid-column"),
      "2 / 4",
      `winning 320px ${cardState} Pattern actions must span the name and repeat tracks`,
    );
    assert.equal(
      getEffectivePatternCssDeclaration(styleSource, 320, actionsTarget, "justify-content"),
      "flex-end",
      `winning 320px ${cardState} Pattern actions must stay end-aligned`,
    );
    assert.equal(
      getEffectivePatternCssDeclaration(styleSource, 320, actionsTarget, "margin-left"),
      "auto",
      `winning 320px ${cardState} Pattern actions must remain right-aligned`,
    );
  }
}

function assertPatternHoverContrast(source) {
  const rowTarget = {
    id: null,
    classes: new Set(["pattern-manager-dialog", "pattern-manager-list", "arrange-row-action"]),
    hover: true,
    focusVisible: false,
    disabled: false,
  };
  const newTarget = {
    id: "newPatternBtn",
    classes: new Set(["pattern-manager-dialog", "pattern-manager-action"]),
    hover: true,
    focusVisible: false,
    disabled: false,
  };
  const disabledDeleteTarget = {
    id: null,
    classes: new Set([
      "pattern-manager-dialog",
      "pattern-manager-list",
      "arrange-row-action",
      "is-delete",
    ]),
    hover: true,
    focusVisible: false,
    disabled: true,
  };
  assert.equal(getEffectivePatternDeclaration(source, rowTarget, "color"), "var(--pattern-on-accent)");
  assert.equal(getEffectivePatternDeclaration(source, rowTarget, "background"), "var(--pattern-green)");
  assert.equal(getEffectivePatternDeclaration(source, newTarget, "color"), "var(--pattern-on-accent)");
  assert.equal(getEffectivePatternDeclaration(source, newTarget, "background"), "var(--pattern-orange)");
  assert.equal(
    getEffectivePatternDeclaration(source, disabledDeleteTarget, "color"),
    "var(--color-disabled, #6d737a)",
  );
  assert.equal(getEffectivePatternDeclaration(source, disabledDeleteTarget, "background"), "transparent");
  assert.ok(contrastRatio("171A1F", "27AE60") >= 4.5);
  assert.ok(contrastRatio("171A1F", "F2994A") >= 4.5);
}

function getButtonById(source, id) {
  const idIndex = source.indexOf(`id="${id}"`);
  assert.notEqual(idIndex, -1, `#${id} must exist`);

  const startIndex = source.lastIndexOf("<button", idIndex);
  const endIndex = source.indexOf("</button>", idIndex);
  assert.notEqual(startIndex, -1, `#${id} must be a button`);
  assert.notEqual(endIndex, -1, `#${id} button must close`);
  return source.slice(startIndex, endIndex + "</button>".length);
}

test("Patterns is a direct 44px command with a readiness-gated consumer", () => {
  const appMenuSource = readFileSync(
    new URL("../src/components/AppMenu.jsx", import.meta.url),
    "utf8",
  );
  assert.match(appMenuSource, /id="patterns-menu-trigger"/);
  assert.match(appMenuSource, /controls="patternsDialog"/);
  assert.match(appMenuSource, /action="open-beats:patterns"/);
  assert.match(appMenuSource, /type="button"/);
  assert.match(appMenuSource, /aria-haspopup="dialog"/);
  assert.match(appMenuSource, /min-h-11 min-w-11/);
  assert.doesNotMatch(arrangeSource, /DialogTrigger/);
  assert.doesNotMatch(arrangeSource, /pattern-manager-trigger/);
  assert.match(arrangeSource, /open-beats:patterns-consumer-ready/);
  assert.match(arrangeSource, /open-beats:patterns-ready/);
  assert.match(arrangeSource, /open-beats:effects/);
  assert.match(arrangeSource, /function handleEffectsOpen\(\)[\s\S]*?setOpen\(false\)/);
  assert.match(arrangeSource, /id="patternsDialog"/);
  assert.match(arrangeSource, /setAttribute\("aria-expanded", open \? "true" : "false"\)/);
});

test("Patterns publishes its readiness flag before its consumer-ready event", () => {
  assertPatternConsumerReadinessOrder(arrangeSource);
  const eventBeforeFlag = arrangeSource.replace(
    '      readiness.patterns = true;\n      window.dispatchEvent(new CustomEvent("open-beats:patterns-consumer-ready"));',
    '      window.dispatchEvent(new CustomEvent("open-beats:patterns-consumer-ready"));\n      readiness.patterns = true;',
  );
  assert.notEqual(eventBeforeFlag, arrangeSource, "Pattern readiness ordering mutation must apply");
  assert.throws(
    () => assertPatternConsumerReadinessOrder(eventBeforeFlag),
    /must precede/,
  );
});

test("the complete pattern library and fixed actions live only in DialogContent", () => {
  const contentMarkup = getJsxBlock(arrangeSource, "DialogContent");
  const outsideContent = arrangeSource.replace(contentMarkup, "");

  for (const id of ["patternList", "newPatternBtn", "clearPatternBtn"]) {
    const idAttribute = new RegExp(`\\bid="${id}"`, "g");
    assert.equal(
      countMatches(arrangeSource, idAttribute),
      1,
      `#${id} must occur exactly once as JSX markup`,
    );
    assert.match(contentMarkup, new RegExp(`\\bid="${id}"`));
    assert.doesNotMatch(outsideContent, new RegExp(`\\bid="${id}"`));
  }

  assert.match(
    contentMarkup,
    /<DialogTitle>\s*Patterns\s*<\/DialogTitle>/,
  );
  assert.match(
    compact(contentMarkup),
    /<DialogDescription> Select, reorder, repeat, duplicate, add, or remove patterns\. <\/DialogDescription>/,
  );
});

test("the modal is an internally scrolling responsive vertical card grid", () => {
  const dialogRule = getCssRuleBody(arrangeSource, ".pattern-manager-dialog");
  const listRule = getCssRuleBody(arrangeSource, ".pattern-manager-list");
  const rowRule = getCssRuleBody(
    arrangeSource,
    ".pattern-manager-list .arrange-row",
  );
  const mobileBlock = getBalancedBlock(arrangeSource, "@media (max-width: 640px)");

  assertDeclaration(
    dialogRule,
    "max-height",
    "min(720px, calc(100dvh - 1.5rem))",
  );
  assertDeclaration(dialogRule, "grid-template-rows", "auto minmax(0, 1fr) auto");
  assertDeclaration(dialogRule, "overflow", "hidden");

  assertDeclaration(listRule, "display", "flex");
  assertDeclaration(listRule, "flex-direction", "column");
  assertDeclaration(listRule, "overflow", "auto");
  assertDeclaration(rowRule, "display", "grid");
  assertDeclaration(
    rowRule,
    "grid-template-columns",
    "28px minmax(180px, 1fr) 72px auto",
  );

  const mobileRowRule = getCssRuleBody(
    mobileBlock,
    ".pattern-manager-list .arrange-row",
  );
  const mobileRowActionsRule = getCssRuleBody(
    mobileBlock,
    ".pattern-manager-list .arrange-row-actions",
  );
  const mobileFixedActionsRule = getCssRuleBody(
    mobileBlock,
    ".pattern-manager-actions",
  );
  assertDeclaration(
    mobileRowRule,
    "grid-template-columns",
    "24px minmax(0, 1fr) 72px",
  );
  assertDeclaration(mobileRowActionsRule, "grid-column", "2 / 4");
  assertDeclaration(mobileRowActionsRule, "justify-content", "flex-end");
  assertDeclaration(mobileFixedActionsRule, "display", "grid");
  assertDeclaration(mobileFixedActionsRule, "grid-template-columns", "1fr 1fr");

  const mobileRepeatRule = getCssRuleBody(
    mobileBlock,
    ".pattern-manager-list .arrange-repeat-input",
  );
  assertDeclaration(mobileRepeatRule, "width", "100%");
  assertDeclaration(mobileRepeatRule, "min-width", "0");
  assertDeclaration(mobileRepeatRule, "box-sizing", "border-box");

  const modalWidth = 320 - 24;
  const rowWidth = modalWidth - 32 - 2;
  const fixedTrackWidth = 24 + 72 + 2 * 4;
  const actionSpanWidth = rowWidth - 24 - 2 * 4;
  assert.equal(modalWidth, 296);
  assert.equal(rowWidth, 262);
  assert.equal(fixedTrackWidth, 104);
  assert.ok(rowWidth > fixedTrackWidth, "the 320px row must retain a flexible name track");
  assert.ok(actionSpanWidth >= 90, "the wrapped 90px action block must stay contained");
});

test("320px keeps multiple Pattern numbers visibly distinct", () => {
  assertEffectiveMobilePatternIdentity(arrangeSource);

  const installedClassMutation = pageSource.replace(
    "arrange-pattern-button min-w-0 flex-1 truncate",
    "arrange-pattern-button min-w-0 flex-1 flex",
  );
  assert.notEqual(
    installedClassMutation,
    pageSource,
    "installed Pattern button class mutation must apply",
  );
  assert.throws(
    () => assertEffectiveMobilePatternIdentity(arrangeSource, installedClassMutation),
    /installed Pattern button must retain truncate/,
  );

  const renderBlock = compact(
    getBalancedBlock(pageSource, "function renderPatternList()"),
  );
  assert.match(renderBlock, /patternBtn\.textContent = "Pattern " \+ \(index \+ 1\)/);
  const labels = [0, 1, 11].map((index) => `Pattern ${index + 1}`);
  assert.deepEqual(labels, ["Pattern 1", "Pattern 2", "Pattern 12"]);
  assert.equal(new Set(labels).size, labels.length);

  const rowWidth = 320 - 24 - 32 - 2;
  const nameTrackWidth = rowWidth - 24 - 72 - 2 * 4;
  const labelContentWidth = nameTrackWidth - 2 * 6;
  const conservativeTextWidth = Math.max(...labels.map((label) => label.length * 9));
  assert.ok(
    labelContentWidth >= conservativeTextWidth,
    "the minimum-width name line must show complete numeric Pattern identities",
  );

  const styleSource = getArrangeStyleSource(arrangeSource);
  const lateNowrap = `${styleSource}\n.pattern-manager-list .arrange-pattern-card {
    flex-wrap: nowrap;
  }`;
  assert.equal(
    getEffectivePatternCssDeclaration(
      lateNowrap,
      320,
      getPatternCssChain("arrange-pattern-card", "is-selected"),
      "flex-wrap",
    ),
    "nowrap",
    "late nowrap mutation must win before the sentry rejects it",
  );
  assert.throws(
    () => assertEffectiveMobilePatternIdentity(lateNowrap),
    /winning 320px is-selected Pattern card must wrap/,
  );

  const lateCollapsedButton = `${styleSource}\n.pattern-manager-list .arrange-pattern-button {
    flex: 0 1 1px;
    padding: 0;
  }`;
  assert.throws(
    () => assertEffectiveMobilePatternIdentity(lateCollapsedButton),
    /winning 320px is-selected Pattern button must own a complete line/,
  );

  const realTruncateCollapse = `${styleSource}\n.arrange-pattern-button.truncate {
    flex: 0 1 1px !important;
  }`;
  assert.throws(
    () => assertEffectiveMobilePatternIdentity(realTruncateCollapse),
    /winning 320px is-selected Pattern button must own a complete line/,
  );

  const impossibleFlexCollapse = `${styleSource}\n.arrange-pattern-button.flex {
    flex: 0 1 1px !important;
  }`;
  assert.doesNotThrow(
    () => assertEffectiveMobilePatternIdentity(impossibleFlexCollapse),
    "the production Pattern button has flex-1 and truncate, never flex",
  );

  const commaMediaNowrap = `${styleSource}\n@media (max-width: 319px), (min-width: 320px) {
    .pattern-manager-list .arrange-pattern-card { flex-wrap: nowrap !important; }
  }`;
  assert.throws(
    () => assertEffectiveMobilePatternIdentity(commaMediaNowrap),
    /winning 320px is-selected Pattern card must wrap/,
  );

  const importantBeforeNormal = `${styleSource}\n.arrange-pattern-card {
    flex-wrap: nowrap !important;
    flex-wrap: wrap;
  }`;
  assert.throws(
    () => assertEffectiveMobilePatternIdentity(importantBeforeNormal),
    /winning 320px is-selected Pattern card must wrap/,
  );

  const lateFlexFlow = `${styleSource}\n.arrange-pattern-card {
    flex-flow: row nowrap;
  }`;
  assert.throws(
    () => assertEffectiveMobilePatternIdentity(lateFlexFlow),
    /conflicting 320px Pattern flex-flow/,
  );

  for (const declaration of [
    "flex-grow: 0;",
    "flex-shrink: 1;",
    "flex-basis: 1px;",
  ]) {
    const lateFlexLonghand = `${styleSource}\n.arrange-pattern-button { ${declaration} }`;
    assert.throws(
      () => assertEffectiveMobilePatternIdentity(lateFlexLonghand),
      /conflicting 320px Pattern flex-/,
    );
  }

  const latePaddingShorthand = `${styleSource}\n.pattern-manager-list .arrange-pattern-button {
    padding: 0;
  }`;
  assert.throws(
    () => assertEffectiveMobilePatternIdentity(latePaddingShorthand),
    /winning 320px is-selected Pattern button must preserve label padding/,
  );

  for (const declaration of [
    "padding-inline: 0;",
    "padding-left: 0;",
    "padding-right: 0;",
    "padding-inline-start: 0;",
    "padding-inline-end: 0;",
  ]) {
    const latePadding = `${styleSource}\n.arrange-pattern-button { ${declaration} }`;
    assert.throws(
      () => assertEffectiveMobilePatternIdentity(latePadding),
      /conflicting 320px Pattern padding-/,
    );
  }

  const lateAncestorQualified = `${styleSource}\n.impossible-pattern-target,
  #patternList .arrange-row > .arrange-pattern-card {
    flex-wrap: nowrap !important;
  }`;
  assert.equal(
    getEffectivePatternCssDeclaration(
      lateAncestorQualified,
      320,
      getPatternCssChain("arrange-pattern-card", "is-selected"),
      "flex-wrap",
    ),
    "nowrap",
    "ancestor-qualified grouped mutation must match the real Pattern DOM chain",
  );
  assert.throws(
    () => assertEffectiveMobilePatternIdentity(lateAncestorQualified),
    /winning 320px is-selected Pattern card must wrap/,
  );

  const impossibleCompound = `${styleSource}\n#patternsDialog.arrange-pattern-card {
    flex-wrap: nowrap !important;
  }`;
  assert.doesNotThrow(
    () => assertEffectiveMobilePatternIdentity(impossibleCompound),
    "an impossible dialog-ID/card-class compound must not match",
  );

  const nonApplicableMutation = `${styleSource}\n@media (max-width: 319px) {
    .pattern-manager-list .arrange-pattern-card { flex-wrap: nowrap; }
  }`;
  assert.doesNotThrow(() => assertEffectiveMobilePatternIdentity(nonApplicableMutation));
});

test("existing dynamic arrangement hooks remain styled inside the modal seam", () => {
  const requiredSelectors = [
    ".pattern-manager-list .arrange-row",
    ".pattern-manager-list .arrange-drag-handle",
    ".pattern-manager-list .arrange-pattern-card",
    ".pattern-manager-list .arrange-pattern-card.is-selected",
    ".pattern-manager-list .arrange-pattern-button",
    ".pattern-manager-list .arrange-row-actions",
    ".pattern-manager-list .arrange-row-action",
    ".pattern-manager-list .arrange-row-action.is-delete",
    ".pattern-manager-list .arrange-repeat-input",
    ".pattern-manager-list .arrange-times-label",
  ];

  for (const selector of requiredSelectors) {
    assert.ok(arrangeSource.includes(selector), `${selector} must remain supported`);
  }

  const movePatternBlock = compact(
    getBalancedBlock(pageSource, "function movePattern(fromIndex, insertIndex)"),
  );
  const moveOffsetBlock = compact(
    getBalancedBlock(pageSource, "function movePatternByOffset(fromIndex, offset)"),
  );
  const renderBlock = compact(
    getBalancedBlock(pageSource, "function renderPatternList()"),
  );
  const encodeBlock = compact(
    getBalancedBlock(pageSource, "function encodeSongState()"),
  );

  assert.match(movePatternBlock, /const selectedPatternRef = patterns\[selectedPatternIndex\]/);
  assert.match(movePatternBlock, /const playbackPatternRef = patterns\[playbackPatternIndex\]/);
  assert.match(movePatternBlock, /patterns\.splice\(from, 1\)/);
  assert.match(movePatternBlock, /patternRepeats\.splice\(from, 1\)/);
  assert.match(movePatternBlock, /patternPitchOffsets\.splice\(from, 1\)/);
  assert.match(movePatternBlock, /selectedPatternIndex = Math\.max\(0, patterns\.indexOf\(selectedPatternRef\)\)/);
  assert.match(movePatternBlock, /playbackPatternIndex = Math\.max\(0, patterns\.indexOf\(playbackPatternRef\)\)/);
  assert.match(moveOffsetBlock, /movePattern\(fromIndex, insertIndex\)/);
  assert.match(moveOffsetBlock, /focusTarget\.focus\(\)/);

  assert.match(renderBlock, /moveUpBtn\.className = "arrange-row-action is-move-up/);
  assert.match(renderBlock, /"Move pattern " \+ \(index \+ 1\) \+ " up"/);
  assert.match(renderBlock, /moveUpBtn\.disabled = index === 0/);
  assert.match(renderBlock, /movePatternByOffset\(index, -1\)/);
  assert.match(renderBlock, /moveDownBtn\.className = "arrange-row-action is-move-down/);
  assert.match(renderBlock, /"Move pattern " \+ \(index \+ 1\) \+ " down"/);
  assert.match(renderBlock, /moveDownBtn\.disabled = index === patterns\.length - 1/);
  assert.match(renderBlock, /movePatternByOffset\(index, 1\)/);
  assert.match(encodeBlock, /p: patterns\.map\(function \(patternBytes\)/);
});

test("opening retries readiness after the portal mounts if the rendered list is empty", () => {
  const effectBody = getBalancedBlock(
    arrangeSource,
    "function bindArrangementEvents()",
  );
  const effect = compact(effectBody);
  const openGuardIndex = effect.indexOf("if (!open) {");
  const mountedRetryIndex = effect.indexOf("function renderWhenMounted()");
  const listLookupIndex = effect.indexOf(
    'document.getElementById("patternList")',
  );
  const renderIndex = effect.indexOf("requestArrangementRender();");
  const initialRetryIndex = effect.lastIndexOf("window.requestAnimationFrame");

  assert.ok(openGuardIndex >= 0, "closed dialogs must not bind modal content");
  assert.ok(mountedRetryIndex > openGuardIndex, "the retry follows the open guard");
  assert.ok(listLookupIndex > mountedRetryIndex, "each retry must query the mounted portal");
  assert.ok(renderIndex > listLookupIndex, "rendering waits for connected content");
  assert.ok(initialRetryIndex > renderIndex, "the mounted retry is scheduled initially");
  assert.match(effect, /if \(!patternList \|\| !patternList\.isConnected\) \{ readinessFrame = window\.requestAnimationFrame\(renderWhenMounted\); return; \}/);
  assert.match(effect, /requestArrangementRender\(\); if \(patternList\.childElementCount === 0\) \{ readinessFrame = window\.requestAnimationFrame\(renderWhenMounted\); \}/);
  assert.doesNotMatch(effect, /if \(!patternList\) return undefined;/);
  assert.match(effect, /typeof window\.renderPatternManager === "function"/);
  assert.match(
    effect,
    /return function cleanup\(\) \{ window\.cancelAnimationFrame\(readinessFrame\); window\.removeEventListener\("open-beats:patterns-ready", handleOpen\); window\.removeEventListener\("open-beats:effects", handleEffectsOpen\); \};/,
  );
  assert.match(arrangeSource, /\},\s*\[open\]\s*\);/);
});

test("React does not rerender and erase page-owned modal rows", () => {
  assert.doesNotMatch(arrangeSource, /\bsetSummary\b/);
  assert.doesNotMatch(arrangeSource, /\bMutationObserver\b/);
  assert.equal(countMatches(arrangeSource, /\buseState\(/g), 1);

  const retryBlock = compact(
    getBalancedBlock(pageSource, "function tryWireArrangementControlsWithRetry"),
  );
  assert.match(retryBlock, /wireArrangementControls\(\).*?renderPatternList\(\)/);
  assert.match(pageSource, /window\.renderPatternManager = function \(\) \{\s*return tryWireArrangementControlsWithRetry\(30, 100\);\s*\};/);
  assert.match(pageSource, /window\.addEventListener\("arrangement:ready", function \(\) \{\s*window\.renderPatternManager\(\);\s*\}\);/);
});

test("Clear retains destructive confirmation in the capture phase", () => {
  const handlerBody = compact(
    getBalancedBlock(arrangeSource, "function handleClearClickCapture(event)"),
  );
  const clearButton = compact(getButtonById(arrangeSource, "clearPatternBtn"));

  assert.match(
    handlerBody,
    /window\.confirm\( "Clear the current pattern\? This cannot be undone\." \)/,
  );
  assert.match(
    handlerBody,
    /if \(!confirmed\) \{ event\.preventDefault\(\); event\.stopPropagation\(\); \}/,
  );
  assert.match(clearButton, /onClickCapture=\{handleClearClickCapture\}/);
  assert.match(clearButton, /className="pattern-manager-action is-destructive"/);
});

test("Clear Project destructive action keeps normal text contrast above 4.5 to 1", () => {
  const clearClass = clearProjectSource.match(/const clearBtn\s*=\s*\n\s*"([^"]+)"/)?.[1] ?? "";
  assert.match(clearClass, /bg-\[var\(--color-orange-strong\)\]/);
  assert.match(clearClass, /text-\[var\(--color-accent-ink\)\]/);
  assert.ok(contrastRatio("171A1F", "F57C00") >= 4.5);
});

test("green and orange Pattern hover states keep on-accent normal-text contrast", () => {
  assertPatternHoverContrast(arrangeSource);
  for (const mutation of [
    ".pattern-manager-dialog .pattern-manager-list .arrange-row-action:hover { color: var(--pattern-chassis); }",
    ".pattern-manager-dialog #newPatternBtn:hover { color: var(--pattern-chassis); }",
  ]) {
    assert.throws(
      () => assertPatternHoverContrast(`${arrangeSource}\n${mutation}`),
      /Expected values to be strictly equal/,
    );
  }

  const actionableDisabledDelete = arrangeSource.replace(
    ".pattern-manager-list .arrange-row-action.is-delete:hover:not(:disabled)",
    ".pattern-manager-list .arrange-row-action.is-delete:hover",
  );
  assert.notEqual(actionableDisabledDelete, arrangeSource, "disabled Delete mutation must apply");
  assert.throws(
    () => assertPatternHoverContrast(actionableDisabledDelete),
    /Expected values to be strictly equal/,
  );
});

test("modal visibility is local UI state with no song, audio, URL, codec, or transport authority", () => {
  assert.match(
    arrangeSource,
    /const \[open, setOpen\] = useState\(false\);/,
  );
  assert.match(arrangeSource, /<Dialog open=\{open\} onOpenChange=\{handleOpenChange\}>/);
  assert.match(arrangeSource, /open-beats:patterns/);
  assert.match(arrangeSource, /patterns-menu-trigger/);
  assert.ok(countMatches(arrangeSource, /\bsetOpen\b/g) >= 2);
  assert.equal(countMatches(arrangeSource, /\buseState\(/g), 1);

  const importSources = Array.from(
    arrangeSource.matchAll(/from\s+"([^"]+)";/g),
    (match) => match[1],
  );
  assert.deepEqual(importSources, ["react", "react-icons/fi", "./ui/dialog"]);

  const dispatchedEvents = Array.from(
    arrangeSource.matchAll(/new CustomEvent\("([^"]+)"\)/g),
    (match) => match[1],
  );
  assert.deepEqual(dispatchedEvents, ["open-beats:patterns-consumer-ready", "arrangement:ready"]);

  const forbiddenAuthority = [
    /\bAudioContext\b/,
    /\baudioCtx\b/,
    /\baudioStatus\b/,
    /\bencodeSongState\b/,
    /\bloadSongStateFromBase64\b/,
    /\bcodec\b/i,
    /\bsong(?:Document|State)?\b/i,
    /\btransport\b/i,
    /\bplayback\b/i,
    /\bisPlaying\b/,
    /\bplayBtn\b/,
    /\bstopBtn\b/,
    /\bwindow\.location\b/,
    /\bhistory\./,
    /\bURLSearchParams\b/,
    /\blocalStorage\b/,
    /\bsessionStorage\b/,
    /\bfetch\s*\(/,
  ];

  for (const pattern of forbiddenAuthority) {
    assert.doesNotMatch(arrangeSource, pattern);
  }
});

test("Radix content remains authoritative and the command event owns modal focus handoff", () => {
  const rootMarkup = getJsxBlock(arrangeSource, "Dialog");
  const uiContentStart = dialogSource.indexOf("const DialogContent =");
  const uiContentEnd = dialogSource.indexOf(
    'DialogContent.displayName = "DialogContent";',
  );
  assert.notEqual(uiContentStart, -1);
  assert.notEqual(uiContentEnd, -1);
  const uiContent = dialogSource.slice(uiContentStart, uiContentEnd);

  for (const importedComponent of [
    "Dialog",
    "DialogContent",
    "DialogDescription",
    "DialogHeader",
    "DialogTitle",
  ]) {
    assert.match(
      arrangeSource,
      new RegExp(`\\b${importedComponent}\\b`),
      `${importedComponent} must use the shared dialog seam`,
    );
  }
  assert.match(arrangeSource, /from "\.\/ui\/dialog";/);
  assert.doesNotMatch(rootMarkup, /DialogTrigger/);
  assert.match(rootMarkup, /<Dialog\s+open=\{open\}\s+onOpenChange=\{handleOpenChange\}>/);
  assert.match(arrangeSource, /open-beats:patterns/);
  assert.match(arrangeSource, /patterns-menu-trigger/);
  assert.match(arrangeSource, /requestAnimationFrame/);

  assert.match(dialogSource, /const Dialog = DialogPrimitive\.Root;/);
  assert.match(dialogSource, /const DialogTrigger = DialogPrimitive\.Trigger;/);
  assert.match(dialogSource, /const DialogPortal = DialogPrimitive\.Portal;/);
  assert.match(dialogSource, /const DialogClose = DialogPrimitive\.Close;/);
  assert.match(uiContent, /<DialogPortal>/);
  assert.match(uiContent, /<DialogOverlay \/>/);
  assert.match(uiContent, /<DialogPrimitive\.Content\b/);
  assert.match(uiContent, /<DialogPrimitive\.Close\b/);
  assert.match(uiContent, /<span className="sr-only">Close<\/span>/);

  assert.doesNotMatch(rootMarkup, /\bmodal=\{false\}/);
  assert.doesNotMatch(rootMarkup, /\bforceMount\b/);
  assert.doesNotMatch(rootMarkup, /\btrapFocus=\{false\}/);
  assert.doesNotMatch(rootMarkup, /\bonEscapeKeyDown\b/);
  assert.match(rootMarkup, /onCloseAutoFocus=\{handleCloseAutoFocus\}/);
});

test("the modal uses exact instrument tokens and real 44px actions", () => {
  const managerRule = getCssRuleBody(arrangeSource, ".pattern-manager");
  const dialogRule = getCssRuleBody(arrangeSource, ".pattern-manager-dialog");
  const exactTokens = {
    "--pattern-chassis": "var(--color-page, #eceae4)",
    "--pattern-surface": "var(--color-panel, #ffffff)",
    "--pattern-ink": "var(--color-text, #171a1f)",
    "--pattern-gray": "var(--color-border, #82878d)",
    "--pattern-on-accent": "var(--color-accent-ink, #171a1f)",
    "--pattern-green": "var(--color-green, #27ae60)",
    "--pattern-blue": "var(--color-blue, #2f80ed)",
    "--pattern-orange": "var(--color-orange, #f2994a)",
    "--pattern-destructive": "var(--color-orange-strong, #f57c00)",
  };
  for (const [token, value] of Object.entries(exactTokens)) {
    assertDeclaration(managerRule, token, value);
    assertDeclaration(dialogRule, token, value);
  }

  const focusRule = arrangeSource.match(
    /\.pattern-manager-action:focus-visible,[\s\S]*?\.arrange-repeat-input:focus-visible\s*\{([^}]*)\}/,
  );
  assert.ok(focusRule, "all static and generated pattern controls need one focus rule");
  assertDeclaration(focusRule[1], "outline", "3px solid var(--pattern-ink, #171a1f)");
  assertDeclaration(focusRule[1], "outline-offset", "2px");
  assertDeclaration(
    focusRule[1],
    "box-shadow",
    "0 0 0 6px var(--pattern-blue, #2f80ed)",
  );

  const targetGroup = arrangeSource.match(
    /\.pattern-manager-list \.arrange-pattern-button,\s*\.pattern-manager-list \.arrange-row-action,\s*\.pattern-manager-list \.arrange-repeat-input,\s*\.pattern-manager-action\s*\{([^}]*)\}/,
  );
  assert.ok(targetGroup, "all generated and fixed pattern actions need one target rule");
  assertDeclaration(targetGroup[1], "min-height", "44px");

  const dragRule = getCssRuleBody(
    arrangeSource,
    ".pattern-manager-list .arrange-drag-handle",
  );
  const rowActionRule = getCssRuleBody(
    arrangeSource,
    ".pattern-manager-list .arrange-row-action",
  );
  const repeatRule = getCssRuleBody(
    arrangeSource,
    ".pattern-manager-list .arrange-repeat-input",
  );
  assertDeclaration(dragRule, "min-height", "44px");
  assertDeclaration(rowActionRule, "width", "44px");
  assertDeclaration(repeatRule, "width", "72px");

  const contentMarkup = getJsxBlock(arrangeSource, "DialogContent");
  assert.equal(
    countMatches(contentMarkup, /className="pattern-manager-action(?: is-destructive)?"/g),
    2,
    "New and Clear must both inherit the 44px action target",
  );
  assert.match(dialogSource, /\bmin-h-11 min-w-11\b/);
});

test("the portaled Pattern dialog has a global reduced-motion rule", () => {
  assert.match(globalStyleSource, /\.pattern-manager-dialog,[\s\S]*?animation-duration:\s*0\.01ms\s*!important/);
  assert.doesNotMatch(pageSource, /\.pattern-manager-dialog,[\s\S]*?animation-duration:\s*0\.01ms\s*!important/);
});
