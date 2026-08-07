# Testing

Run the full package regression suite with:

```sh
npm test
```

The Wave 0 harness uses Node's built-in test runner, so it does not add a test
dependency. It directly imports the pure BPM safety module and evaluates the
inline sequencer script from `src/pages/index.astro` in a deterministic fake
DOM/Web Audio environment.

## Wave 0 baseline

- Repository commit: `d9eaa8f37ed78cfa3673072a167d22616f062d6a`
- Repository tree: `2811bd0b684f3c3d88de0df66adb91d26556e686`
- Fixture coverage: BPM query/commit boundaries, defensive scheduling math that
  preserves in-progress field edits, a real legacy catalog URL, v4
  patterns/repeats/mix/pitch, malformed state fallback, stop/reset/visibility
  cancellation, and immediate suspended/interrupted source disconnection.
- The two `todo` cases freeze known codec defects for malformed mix lanes and
  pattern metadata alignment. They are not part of the Phase 0A safety gate.

The inline harness is intentionally a characterization seam. It executes the
real page script but does not prove Astro/Vite integration, browser focus
behavior, sample decoding, audible output, or Web Audio timing. Replace it with
tests against extracted production modules when the canonical project/audio
foundation lands in Wave 0B.

## FX-1 Filter seam

`test/filter-effect.test.js` imports the production state module directly. It
covers strict canonical types, clamping and rounding, immutable presets,
default omission and v1 wire data, public value/graphic language, logarithmic
cutoff mapping, bounded resonance/drive, and the linear bypass/dry-wet law.

`test/master-filter-graph.test.js` uses deterministic AudioNode and AudioParam
fakes around the production graph module. It covers topology upstream of the
provided protection input, 15 ms automation, state isolation, drive-curve
safety, transactional construction cleanup, running and non-running transport
silence, neutral dry-only fallback and recovery, repeated silence/wake cycles,
rapid parameter updates, and disconnect behavior.

Run just the frozen module seam with:

```sh
node --test test/filter-effect.test.js test/master-filter-graph.test.js
```

`test/filter-inline.test.js` exercises the real inline page controller through
the source-backed VM harness. It covers canonical v4/v5 Filter URL encoding,
load/share/reset cycles, neutral omission, malformed-state fallback, direct and
Filter-graph audio fallback, Stop/Play retirement fences, the default-minimized
native Effects drawer open/close, Custom promotion, shared bypass state, and
the single shared four-macro control surface. Its synthetic document now represents all
14 `.steps[data-instrument]` containers and their 16 children, so the canonical
pattern reorder regression exercises a genuinely nonzero selected pattern and
proves bundled bytes/repeats/pitch, selection/playback identity, boundary
no-ops, and encoded/reopened order.

`test/filter-page-contract.test.js` provides static acceptance coverage for the
native Effects drawer markup, one native visibility contract, focus return and
interleave-safe reopen sequencing, the reduced-motion contract, real 44 px-or-larger targets, the
text-backed non-authoritative micro-screen, preserved script hooks, and one
shared Filter state/control surface. It also binds the final zero-gap 44 px
desktop cadence, internal non-interactive lane divider, and 44 px targets. Its
624 px lane-stack reference is derived from the 14 rendered instrument rows,
production lane height, and top/bottom sequencer padding; the absolutely
positioned divider adds no layout height. Pre-grid fit remains computed-browser
evidence. It also binds the high-contrast ink edge plus green focus halo.

`test/pattern-modal-contract.test.js` covers the single 44 px Patterns trigger,
one portaled modal-owned list, preserved IDs/actions, Radix focus and close
structure, destructive confirmation, portal-root token inheritance, literal
two-color focus fallback, 44 px Move up/down controls and disabled boundaries,
canonical reorder delegation, and the 72 px border-box repeat track. Its 320 px
source arithmetic proves the fixed tracks and wrapped action block fit the
available row width; computed layout remains a browser check.

## UI overhaul seam

The authoritative static/VM/build artifact is page
`af762040bf611d5da81b1b035601e153679f5039251fc35a9ba076ffcf7f5b59`
with ArrangeDialog
`124468b55394bae9b368101f9dcb80ffad873cc2b3957b513f4c307974be8ca1`,
ClearProjectDialog
`978947c70470ecf7f86b5346fecd545fe00dd6db133382eae94d4ff9a3000784`,
page contract
`4678daea298123ca7b698d5e60bbdce084f822753f7f190e5281897139ebf2f5`,
Filter inline
`9e057452ab12b2105a1c799d51803f5d76f8158d7e25750c982918f8e32a394c`,
harness
`37d0b9f6e44bbbd24adb9289f751af05239119351ccba8ea8efb3ceb3cfed6ce`,
and app-menubar contract
`f477c46fe2c957e5696342bff22d6577653395e4ac48e6b4fe58943d502256e7`,
AppMenu
`88fabc5da8a92437f29aaf19aba8cc2d198f23b250de3217b7a56dbed5f0e3d7`,
typeahead helper
`f79f6c075ee0e2bf9491d62b7823adb9ec264d56dd25f767688398607ca258f7`,
typeahead test
`ec4f0f54deae18b6b130437a1fcb689483c9b877d44a07dd170174e8fde78a4d`,
Menubar wrapper
`011bcc73aa396051c3a00599ebc26b1b6418f329da8b78a6703063d1bd8fe780`,
global styles
`e3110614a0e653431fe844d52bbbb40058089aa7885114a66a8a8c33d9b00efa`,
Pattern contract
`9419af71c5463d7a1565395fcd4465aa6a85b92d040fee3888c6930dca9554ac`,
package
`6b460cbfb9b6aa956495d0b1c7179ee82be9f4d74810e77f73ec573b9abb4333`,
package lock
`ce718858802d1ad23382ab9253ada82c509b056592138d3cd71d936455965d88`,
and shadcn config
`b7bdf01339d62e6f2a433bf258449d8cb74df9696ca239143477c7b9cdc4d7dd`,
tsconfig
`6551e8fc79128cbc8b6a69d0babad0b354a3985a07598c5ff458e070acfa1457`, and
Space graph contract
`a3ab0d45d6b9d5914176966900be752e5496313824a316addac41ab243aebac4`.
Its full package gate is 217 total, 215 pass, 0 fail, and the same 2 Phase 0B
TODOs described above. Browser/device/assistive-technology/native-audio,
interruption, and listening evidence remain separate and pending.

The app-shell overhaul supersedes the prior standalone Patterns rail and
Effects disclosure expectations above. The persistent shell keeps BPM,
Play/Stop, Loop, Share, Clear All, and Step Scope visible. Patterns and Effects
are non-modal Base UI Menubar commands gated until the page coordinator and
Arrange island consumers are hydrated; menu item clicks record a pending action
and dispatch only from the post-close completion callback. Printable keys without
Alt/Ctrl/Meta chords move focus among enabled top-level triggers by accessible-label prefix
without dispatching a command. Patterns keeps the
Radix ArrangeDialog and its page-owned list, with the page coordinating a
distinct ready event. Effects is permanently mounted in a native
`#effectsDialog` drawer; native close restores its opener, while Pattern close
uses one prevented Radix autofocus owner. Pattern takeover cancels stale Effects
frames. Reduced motion covers the native drawer, Radix-portaled Pattern content,
and the portaled menu popup through the global stylesheet.

The VM coverage also snapshots music, Filter state, codec output, URL, graph,
and transport before and after disclosure changes. Preset selection, Custom,
Filter/project reset, v4/v5/legacy/malformed load, Share, and playback must
preserve the in-session disclosure choice and cannot make view state part of a
song or audio route.

Visual assertions for the density-first shell and six preset-card vocabulary bind
only to the final frozen page. The visible Custom identity is the abstract
Custom Patch editor; `data-creature="chameleon"` remains only a compatibility
hook. The other frozen vocabulary is Clean/Moon Rabbit, Warm/Sleepy Bear,
Bright/Songbird, Resonant Sweep/Ribbon Snake, and Grit/Black-and-white Dragon.
The drawings are decorative and `aria-hidden`; the six existing buttons remain the preset controls, while
one shared four-range strip and one shared bypass remain the only editable
Filter surface. Creature gestures are short, never infinite, and reduced-motion
safe. Bypass/unavailable states keep nonvisual text/`aria-pressed` truth and
suppress active accents and flame.

The additive Space bay uses four finite selected/enabled gestures (Mole dust,
Whale sonar, Jellyfish ripple, and Snail crescent), suppresses them while
bypassed or unavailable, and exposes a static selected pose under reduced
motion. Tone and Space are separately labelled bays with independent live
status. The VM/audio contracts additionally cover single-owner automatic Space
failure reconciliation, exact hold-or-cancel/currentTime/15 ms automation
fallbacks, and a 30-cycle Stop/Play plus preset/Size/Decay soak that settles to
one live Convolver and no timers.

Density checks bind the real 14-row inventory, exact 44 px desktop lane cadence,
4 px top/bottom sequencer padding, an internal absolute divider that adds no
height, and real 44 px targets. Pre-grid fit and how many complete lanes remain
visible at each viewport are computed-browser evidence. The persistent shell
keeps transport and Step Scope visible; Patterns is a Base UI Menubar command
opening the existing portaled ArrangeDialog, while Effects is a permanently
mounted native drawer. The 320 px transport must not overflow.

These tests do not establish real-browser AudioParam semantics, audible
smoothing, level stability, resonance safety, clipping behavior, or device
compatibility. They also do not prove actual responsive layout, touch target
geometry, keyboard focus movement, screen-reader announcements, or that the
decorative response curves render unclipped in a browser. Browser, touch,
screen-reader, device, and listening checks remain manual.
