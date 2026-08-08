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

function getCssRuleBody(source, selector) {
  const match = source.match(
    new RegExp(`${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`),
  );
  assert.ok(match, `CSS rule ${selector} must exist`);
  return match[1];
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
  assert.equal(getEffectivePatternDeclaration(source, rowTarget, "color"), "var(--pattern-chassis)");
  assert.equal(getEffectivePatternDeclaration(source, rowTarget, "background"), "var(--pattern-green)");
  assert.equal(getEffectivePatternDeclaration(source, newTarget, "color"), "var(--pattern-chassis)");
  assert.equal(getEffectivePatternDeclaration(source, newTarget, "background"), "var(--pattern-orange)");
  assert.equal(
    getEffectivePatternDeclaration(source, disabledDeleteTarget, "color"),
    "var(--color-disabled, rgba(242, 242, 242, 0.68))",
  );
  assert.equal(getEffectivePatternDeclaration(source, disabledDeleteTarget, "background"), "transparent");
  assert.ok(contrastRatio("111111", "27AE60") >= 4.5);
  assert.ok(contrastRatio("111111", "F2994A") >= 4.5);
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
  assert.match(clearClass, /text-\[var\(--color-page\)\]/);
  assert.ok(contrastRatio("111111", "F57C00") >= 4.5);
});

test("green and orange Pattern hover states keep dark normal-text contrast", () => {
  assertPatternHoverContrast(arrangeSource);
  for (const mutation of [
    ".pattern-manager-dialog .pattern-manager-list .arrange-row-action:hover { color: var(--pattern-ink); }",
    ".pattern-manager-dialog #newPatternBtn:hover { color: var(--pattern-ink); }",
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
    "--pattern-chassis": "var(--color-page, #111)",
    "--pattern-surface": "var(--color-panel, #333333)",
    "--pattern-ink": "var(--color-text, #f2f2f2)",
    "--pattern-gray": "var(--color-border, rgba(242, 242, 242, 0.38))",
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
  assertDeclaration(focusRule[1], "outline", "3px solid var(--pattern-ink, #f2f2f2)");
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
