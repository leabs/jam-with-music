import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appMenu = readFileSync(new URL("../src/components/AppMenu.jsx", import.meta.url), "utf8");
const arrange = readFileSync(new URL("../src/components/ArrangeDialog.jsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../src/pages/index.astro", import.meta.url), "utf8");
const globals = readFileSync(new URL("../src/styles/globals.css", import.meta.url), "utf8");
const testing = readFileSync(new URL("../TESTING.md", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const componentsJson = JSON.parse(readFileSync(new URL("../components.json", import.meta.url), "utf8"));

const assertCompleteSha256Manifest = (manifest) => {
  const tokens = [...manifest.matchAll(/`([^`]*)`/g)].map(([, token]) => token);
  assert.ok(tokens.length > 0);
  for (const token of tokens) assert.match(token, /^[0-9a-f]{64}$/);
};

function getNamedFunctionBody(source, marker) {
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `${marker} must exist`);
  const openingBrace = source.indexOf("{", markerIndex + marker.length);
  assert.notEqual(openingBrace, -1, `${marker} must have a body`);
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] !== "}") continue;
    depth -= 1;
    if (depth === 0) return source.slice(openingBrace + 1, index);
  }
  assert.fail(`${marker} body must be balanced`);
}

function assertInstalledReadinessEffect(source) {
  const marker = "useEffect(function bindShellReadiness()";
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, "readiness binding must be installed with useEffect");
  const openingBrace = source.indexOf("{", markerIndex + marker.length);
  let depth = 0;
  let closingBrace = -1;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] !== "}") continue;
    depth -= 1;
    if (depth === 0) {
      closingBrace = index;
      break;
    }
  }
  assert.notEqual(closingBrace, -1, "readiness effect body must be balanced");
  assert.match(
    source.slice(closingBrace + 1, closingBrace + 24),
    /^\s*,\s*\[\]\s*\);/,
    "readiness binding must be invoked once as a mount effect",
  );
  const body = source.slice(openingBrace + 1, closingBrace);
  assert.match(
    body,
    /addEventListener\("open-beats:page-consumer-ready", update\);[\s\S]*?addEventListener\("open-beats:patterns-consumer-ready", update\);[\s\S]*?update\(\);/,
  );
  assert.match(
    body,
    /removeEventListener\("open-beats:page-consumer-ready", update\);[\s\S]*?removeEventListener\("open-beats:patterns-consumer-ready", update\);/,
  );
  assert.equal((body.match(/\bupdate\(\);/g) || []).length, 1);
  return body;
}

function createReadinessWindow(initial) {
  const listeners = new Map();
  return {
    __openBeatsShellReadiness: { ...initial },
    addEventListener(type, callback) {
      const callbacks = listeners.get(type) ?? [];
      callbacks.push(callback);
      listeners.set(type, callbacks);
    },
    removeEventListener(type, callback) {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((candidate) => candidate !== callback),
      );
    },
    dispatch(type) {
      for (const callback of listeners.get(type) ?? []) callback();
    },
  };
}

function assertColdShellReadiness(source) {
  assert.match(
    source,
    /const \[ready, setReady\] = useState\(false\);/,
    "shell commands must start disabled until both consumers report ready",
  );
}

function assertPhoneTransportSpansHeader(source) {
  const finalShellMarker = "/* Final shell contract:";
  const finalShellStart = source.indexOf(finalShellMarker);
  assert.notEqual(finalShellStart, -1, "final shell contract must exist");
  const finalShell = source.slice(finalShellStart, source.indexOf("</style>", finalShellStart));
  const phoneBlock = getNamedFunctionBody(finalShell, "@media (max-width: 420px)");
  const transportRule = getNamedFunctionBody(phoneBlock, ".header-grid > .bpm-control");
  assert.match(transportRule, /\bgrid-column:\s*1\s*\/\s*-1\s*;/);
  assert.match(transportRule, /\bwidth:\s*100%\s*;/);
  assert.match(transportRule, /\boverflow:\s*visible\s*;/);
}

test("authoritative TESTING hashes are complete lowercase SHA-256 tokens", () => {
  const manifest = testing.slice(
    testing.indexOf("The authoritative static/VM/build artifact"),
    testing.indexOf("Its full package gate"),
  );
  assertCompleteSha256Manifest(manifest);

  const valid = "a".repeat(64);
  for (const invalid of [
    "a".repeat(63),
    "A".repeat(64),
    "g".repeat(64),
    `${"a".repeat(32)}-${"a".repeat(31)}`,
  ]) {
    assert.throws(() => assertCompleteSha256Manifest(`\`${valid}\` \`${invalid}\``));
  }
});

test("shell readiness starts disabled before either consumer reports ready", () => {
  assertColdShellReadiness(appMenu);
  const initiallyReady = appMenu.replace(
    "const [ready, setReady] = useState(false);",
    "const [ready, setReady] = useState(true);",
  );
  assert.notEqual(initiallyReady, appMenu, "initial readiness mutation must apply");
  assert.throws(
    () => assertColdShellReadiness(initiallyReady),
    /must start disabled/,
  );
});

test("app shell exposes two direct readiness-gated dialog commands", () => {
  assert.match(appMenu, /function ShellButton/);
  assert.match(appMenu, /<div[\s\S]*?role="group"[\s\S]*?aria-label="Application commands"/);
  assert.doesNotMatch(appMenu, /<nav\b|role="navigation"/);
  assert.match(appMenu, /type="button"/);
  assert.match(appMenu, /aria-haspopup="dialog"/);
  assert.match(appMenu, /aria-controls=\{controls\}/);
  assert.match(appMenu, /aria-expanded="false"/);
  assert.match(appMenu, /window\.dispatchEvent\(new CustomEvent\(action\)\)/);
  assert.equal((appMenu.match(/onClick=\{handleClick\}/g) || []).length, 1);
  assert.equal(
    (appMenu.match(/window\.dispatchEvent\(new CustomEvent\(action\)\)/g) || []).length,
    1,
  );
  assert.match(appMenu, /id="patterns-menu-trigger"[\s\S]*?controls="patternsDialog"[\s\S]*?action="open-beats:patterns"/);
  assert.match(appMenu, /id="effects-menu-trigger"[\s\S]*?controls="effectsDialog"[\s\S]*?action="open-beats:effects"/);
  assert.equal((appMenu.match(/disabled=\{!ready\}/g) || []).length, 2);
  assert.match(appMenu, /__openBeatsShellReadiness/);
  assert.match(appMenu, /open-beats:page-consumer-ready/);
  assert.match(appMenu, /open-beats:patterns-consumer-ready/);
  assert.match(appMenu, /min-h-11 min-w-11/);
  assert.doesNotMatch(appMenu, /Menubar|menuitem|pendingAction|typeahead|onKeyDown/);
  assert.doesNotMatch(appMenu, /requestAnimationFrame/);
  assert.match(arrange, /id="patternsDialog"/);
  assert.match(arrange, /setAttribute\("aria-expanded", open \? "true" : "false"\)/);
  assert.match(page, /function setEffectsCommandExpanded\(expanded\)/);
  assert.match(page, /getElementById\("effects-menu-trigger"\)/);
  assert.match(page, /setEffectsCommandExpanded\(true\)/);
  assert.match(page, /setEffectsCommandExpanded\(false\)/);
});

test("direct command readiness and dispatch execute exactly once", () => {
  const readinessMatch = appMenu.match(
    /setReady\(Boolean\((readiness\.page && readiness\.patterns)\)\)/,
  );
  assert.ok(readinessMatch, "readiness expression must be extractable");
  const isReady = new Function(
    "readiness",
    `return Boolean(${readinessMatch[1]});`,
  );
  assert.equal(isReady({ page: false, patterns: false }), false);
  assert.equal(isReady({ page: true, patterns: false }), false);
  assert.equal(isReady({ page: false, patterns: true }), false);
  assert.equal(isReady({ page: true, patterns: true }), true);

  const readinessBody = assertInstalledReadinessEffect(appMenu);
  const detachedReadiness = appMenu.replace(
    "useEffect(function bindShellReadiness()",
    "void function bindShellReadiness()",
  ).replace(/\n  \}, \[\]\);/, "\n  };");
  assert.notEqual(detachedReadiness, appMenu, "detached readiness mutation must apply");
  assert.throws(
    () => assertInstalledReadinessEffect(detachedReadiness),
    /installed with useEffect/,
  );
  const bindReadiness = new Function("window", "setReady", readinessBody);
  const runReadinessOrder = (initial, order) => {
    const fakeWindow = createReadinessWindow(initial);
    const values = [];
    const cleanup = bindReadiness(fakeWindow, (value) => values.push(value));
    for (const key of order) {
      fakeWindow.__openBeatsShellReadiness[key] = true;
      fakeWindow.dispatch(
        key === "page"
          ? "open-beats:page-consumer-ready"
          : "open-beats:patterns-consumer-ready",
      );
    }
    cleanup();
    return values;
  };
  assert.deepEqual(
    runReadinessOrder({ page: true, patterns: true }, []),
    [true],
    "preexisting readiness flags must enable commands during mount",
  );
  assert.deepEqual(
    runReadinessOrder({ page: false, patterns: false }, ["page", "patterns"]),
    [false, false, true],
    "page-first readiness must enable after both consumers",
  );
  assert.deepEqual(
    runReadinessOrder({ page: false, patterns: false }, ["patterns", "page"]),
    [false, false, true],
    "Patterns-first readiness must enable after both consumers",
  );

  const handlerMatch = appMenu.match(
    /function handleClick\(\) \{\s*([\s\S]*?)\s*\n  \}/,
  );
  assert.ok(handlerMatch, "direct click handler must be extractable");
  const dispatched = [];
  class FakeCustomEvent {
    constructor(type) {
      this.type = type;
    }
  }
  const fakeWindow = {
    dispatchEvent(event) {
      dispatched.push(event.type);
      return true;
    },
  };
  const createHandler = new Function(
    "window",
    "CustomEvent",
    "action",
    `return function handleClick() { ${handlerMatch[1]} };`,
  );
  createHandler(fakeWindow, FakeCustomEvent, "open-beats:patterns")();
  createHandler(fakeWindow, FakeCustomEvent, "open-beats:effects")();
  assert.deepEqual(dispatched, ["open-beats:patterns", "open-beats:effects"]);
});

test("app shell keeps transport and scope outside command surfaces", () => {
  for (const id of ["instrumentScreen", "bpm", "playBtn", "loopPatternBtn", "shareBtn", "clearProjectBtn"]) {
    assert.match(page, new RegExp(`\\bid="${id}"`));
  }
  assert.match(page, /id="clearProjectBtn"[\s\S]*?Clear All/);
  assert.match(page, /<div class="app-menu-slot">\s*<AppMenu client:load\s*\/>\s*<\/div>/);
  assert.match(page, /@media \(max-width: 420px\)[\s\S]*?grid-template-areas: "title menu" "scope scope" "bpm bpm"/);
  assert.match(globals, /\.header-grid > \.app-menu-slot\s*\{[\s\S]*?grid-area: menu/);
  assert.doesNotMatch(globals, /menu-popup|tw-animate-css/);
  assert.equal(packageJson.dependencies["@base-ui/react"], undefined);
  assert.equal(packageJson.dependencies["tw-animate-css"], undefined);
  assert.equal(componentsJson.style, "radix-nova");
  assert.doesNotMatch(componentsJson.style, /^base-/);
});

test("phone transport spans the full header row without clipping direct controls", () => {
  assertPhoneTransportSpansHeader(page);
  const clippedPhoneTransport = page.replace(
    "grid-column: 1 / -1;\n      justify-content: flex-start;\n      overflow: visible;\n      width: 100%;",
    "grid-column: auto;\n      justify-content: flex-start;\n      overflow: hidden;\n      width: 100%;",
  );
  assert.notEqual(clippedPhoneTransport, page, "phone transport mutation must apply");
  assert.throws(
    () => assertPhoneTransportSpansHeader(clippedPhoneTransport),
    /grid-column|overflow/,
  );
});

test("Effects is a centered responsive two-bay workbench", () => {
  assert.match(page, /<dialog\b[^>]*id="effectsDialog"/);
  assert.match(page, /\.effects-dialog\s*\{[\s\S]*?width: min\(1120px, calc\(100vw - 48px\)\)/);
  assert.match(page, /\.effects-dialog\s*\{[\s\S]*?height: min\(80dvh, 760px\)/);
  assert.match(page, /\.effects-dialog\s*\{[\s\S]*?max-height: min\(80dvh, 760px\)/);
  assert.match(page, /\.effects-dialog\s*\{[\s\S]*?margin: auto/);
  assert.match(page, /\.effects-dialog\s*\{[\s\S]*?overflow: hidden/);
  assert.match(page, /\.effects-dialog \.filter-fx-bar\s*\{[\s\S]*?position: sticky[\s\S]*?top: 0/);
  assert.match(page, /@media \(min-width: 1200px\)[\s\S]*?\.effects-dialog \.filter-fx-body-inner[\s\S]*?grid-template-columns: minmax\(0, 1\.15fr\) minmax\(360px, 0\.85fr\)/);
  assert.match(page, /@media \(min-width: 601px\) and \(max-width: 1199px\)[\s\S]*?\.effects-dialog\s*\{[\s\S]*?width: calc\(100vw - 32px\)/);
  assert.match(page, /@media \(max-width: 899px\)[\s\S]*?\.effects-dialog\s*\{[\s\S]*?width: calc\(100vw - 32px\)/);
  assert.match(page, /@media \(max-width: 600px\)[\s\S]*?\.effects-dialog\s*\{[\s\S]*?width: calc\(100vw - 16px\)[\s\S]*?height: calc\(100dvh - 16px\)[\s\S]*?max-height: calc\(100dvh - 16px\)/);
  assert.match(page, /\.effects-dialog #filterFxPanel\s*\{[\s\S]*?height: 100%[\s\S]*?max-height: none[\s\S]*?overflow-x: hidden[\s\S]*?overflow-y: auto[\s\S]*?overscroll-behavior-y: contain[\s\S]*?scrollbar-gutter: stable/);
});

test("direct command implementation has no audio or song-state authority", () => {
  assert.doesNotMatch(appMenu, /audio|codec|song|patternList|AudioContext/i);
});
