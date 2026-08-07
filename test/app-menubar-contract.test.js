import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appMenu = readFileSync(new URL("../src/components/AppMenu.jsx", import.meta.url), "utf8");
const menuPrimitives = readFileSync(new URL("../src/components/ui/menubar.jsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../src/pages/index.astro", import.meta.url), "utf8");
const globals = readFileSync(new URL("../src/styles/globals.css", import.meta.url), "utf8");
const testing = readFileSync(new URL("../TESTING.md", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const extractFunctionSource = (source, signature) => {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `missing ${signature}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  assert.fail(`unterminated ${signature}`);
};

const assertCompleteSha256Manifest = (manifest) => {
  const tokens = [...manifest.matchAll(/`([^`]*)`/g)].map(([, token]) => token);
  assert.ok(tokens.length > 0);
  for (const token of tokens) {
    assert.match(token, /^[0-9a-f]{64}$/);
  }
};

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

test("app menubar owns only post-close command dispatch", () => {
  assert.match(appMenu, /<Menubar[\s\S]*?modal=\{false\}/);
  assert.match(appMenu, /<Menubar[\s\S]*?modal=\{false\}[\s\S]*?aria-label="Application menu"/);
  assert.match(appMenu, /onOpenChangeComplete=\{handleOpenChangeComplete\}/);
  assert.match(appMenu, /const \[pendingAction, setPendingAction\] = useState\(null\)/);
  assert.match(appMenu, /onClick=\{\(\) => setPendingAction\(action\)\}/);
  assert.match(appMenu, /if \(open \|\| !pendingAction\) return/);
  assert.match(appMenu, /window\.dispatchEvent\(new CustomEvent\(eventName\)\)/);
  assert.doesNotMatch(appMenu, /requestAnimationFrame/);
  assert.match(appMenu, /triggerId="patterns-menu-trigger"/);
  assert.match(appMenu, /triggerId="effects-menu-trigger"/);
  assert.match(appMenu, /__openBeatsShellReadiness/);
  assert.match(appMenu, /disabled={!ready}/);
  assert.match(appMenu, /isTypeaheadPrintableKey/);
  assert.match(appMenu, /focusNextMatchingMenubarTrigger/);
  assert.match(appMenu, /event\.preventDefault\(\)/);
  assert.match(appMenu, /onKeyDown={handleMenubarKeyDown}/);
  assert.match(appMenu, /event\.target\.closest\?\.\('button\[id\$="-menu-trigger"\]'\)/);
  assert.match(appMenu, /if \(!trigger \|\| !menubarRef\.current\?\.contains\(trigger\)\) return/);
  assert.match(
    appMenu,
    /if \(focusNextMatchingMenubarTrigger\(menubarRef\.current, trigger, event\.key\)\)\s*\{\s*event\.preventDefault\(\);\s*\}/,
  );
  assert.match(
    appMenu,
    /function handleMenubarKeyDown\(event\)\s*\{\s*if \(!isTypeaheadPrintableKey\(event\)\) return;\s*const trigger = event\.target\.closest\?\.\('button\[id\$="-menu-trigger"\]'\);\s*if \(!trigger \|\| !menubarRef\.current\?\.contains\(trigger\)\) return;\s*if \(focusNextMatchingMenubarTrigger\(menubarRef\.current, trigger, event\.key\)\)\s*\{\s*event\.preventDefault\(\);\s*\}\s*\}/,
  );
  const handler = extractFunctionSource(appMenu, "function handleMenubarKeyDown(event)");
  assert.match(
    handler,
    /^function handleMenubarKeyDown\(event\)\s*\{\s*if \(!isTypeaheadPrintableKey\(event\)\) return;\s*const trigger = event\.target\.closest\?\.\('button\[id\$="-menu-trigger"\]'\);\s*if \(!trigger \|\| !menubarRef\.current\?\.contains\(trigger\)\) return;\s*if \(focusNextMatchingMenubarTrigger\(menubarRef\.current, trigger, event\.key\)\)\s*\{\s*event\.preventDefault\(\);\s*\}\s*\}$/,
  );
  assert.match(appMenu, /open-beats:patterns/);
  assert.match(appMenu, /open-beats:effects/);
  assert.match(page, /open-beats:patterns[\s\S]*?effectsDialog\.close\(\)/);
  assert.match(menuPrimitives, /@base-ui\/react\/menubar/);
  assert.match(menuPrimitives, /data-\[highlighted\]/);
  assert.match(menuPrimitives, /data-\[disabled\]/);
  assert.match(menuPrimitives, /menu-popup/);
  assert.match(globals, /\.pattern-manager-dialog,[\s\S]*?\.menu-popup,[\s\S]*?animation-duration:\s*0\.01ms\s*!important/);
  assert.doesNotMatch(page, /\.menu-popup[\s\S]*?animation-duration:\s*0\.01ms\s*!important/);
});

test("app shell keeps transport and scope outside menu portals", () => {
  for (const id of ["instrumentScreen", "bpm", "playBtn", "loopPatternBtn", "shareBtn", "clearProjectBtn"]) {
    assert.match(page, new RegExp(`\\bid="${id}"`));
  }
  assert.match(page, /id="clearProjectBtn"[\s\S]*?Clear All/);
  assert.match(page, /<div class="app-menu-slot">\s*<AppMenu client:load\s*\/>\s*<\/div>/);
  const finalAreas = page.lastIndexOf('grid-template-areas: "title menu scope bpm"');
  const finalBreakpoint = page.indexOf("@media (min-width: 900px)");
  assert.ok(finalAreas > finalBreakpoint, "final named shell areas must follow hardware breakpoints");
  assert.match(page.slice(finalAreas), /grid-template-areas: "title menu scope bpm"/);
  assert.match(page.slice(finalAreas), /@media \(max-width: 899px\)[\s\S]*?grid-template-areas: "title menu" "scope bpm"/);
  assert.match(page, /grid-template-columns: minmax\(118px, 0\.35fr\) auto minmax\(220px, 0\.8fr\) max-content/);
  assert.match(page, /@media \(min-width: 900px\) and \(max-width: 1132px\)[\s\S]*?grid-template-areas: "title menu" "scope bpm"/);
  for (const width of ["900px", "1100px", "1132px"]) {
    assert.match(page, new RegExp(width));
  }
  assert.match(page, /@media \(max-width: 420px\)[\s\S]*?grid-template-areas: "title menu" "scope scope" "bpm bpm"/);
  assert.match(page, /@media \(max-width: 420px\)[\s\S]*?\.header-grid > \.instrument-screen,[\s\S]*?\.header-grid > \.bpm-control/);
  assert.match(globals, /\.header-grid > \.app-menu-slot\s*\{[\s\S]*?grid-area: menu/);
  assert.equal(packageJson.dependencies["@base-ui/react"], "^1.7.0");
  assert.equal(packageJson.dependencies["tw-animate-css"], "^1.4.0");
});

test("menu implementation has no audio or song-state authority", () => {
  assert.doesNotMatch(appMenu, /audio|codec|song|patternList|AudioContext/i);
});
