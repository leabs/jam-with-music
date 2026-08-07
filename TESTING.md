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
Show/Hide disclosure, Custom promotion, shared bypass state, and the single
shared four-macro control surface. Its synthetic document now represents all
14 `.steps[data-instrument]` containers and their 16 children, so the canonical
pattern reorder regression exercises a genuinely nonzero selected pattern and
proves bundled bytes/repeats/pitch, selection/playback identity, boundary
no-ops, and encoded/reopened order.

`test/filter-page-contract.test.js` provides static acceptance coverage for the
minimized server markup, hidden/inert/ARIA disclosure state, one visibility
writer, focus return and rapid-reopen generation safety, the exact 180 ms
transition/reduced-motion contract, real 44 px-or-larger targets, the
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
`ca3c79ee4127be03975c72dadb48af8a9aa26398d0494f73f416a2a65c5b2240`
with ArrangeDialog
`ffb321321d4bc688ff9fea71cf1853bd8d97d1cab1bfc6c4d429d291818ed231`,
ClearProjectDialog
`978947c70470ecf7f86b5346fecd545fe00dd6db133382eae94d4ff9a3000784`,
page contract
`f9e01c9a355e1193a0549131a904b21fa76b9e8d108896725cad9db72d553e81`,
Filter inline
`167741ffdc56b317cc7dc8198b74b5babe9c0850f1a5f7d4f426670ddec72026`,
harness
`d396e13f377cb654ea000d7c505dba360a03ffdaa08f9cb5a4caaad7acb721c2`,
and Space graph contract
`a3ab0d45d6b9d5914176966900be752e5496313824a316addac41ab243aebac4`.
Its full package gate is 205 total, 203 pass, 0 fail, and the same 2 Phase 0B
TODOs described above. Browser/device/assistive-technology/native-audio,
interruption, and listening evidence remain separate and pending.

The UI overhaul supersedes the expanded-by-default and stompbox visual
expectations above. The stable controller contract now starts with a minimized
`Show effects` rail and a hidden, inert, `aria-hidden` tray. Opening makes the
tray interactive synchronously and keeps focus on the disclosure button;
closing returns contained focus before excluding the tray and applies `hidden`
after one guarded 180 ms transition. Rapid reopen invalidates a stale close,
and reduced motion completes immediately.

The VM coverage also snapshots music, Filter state, codec output, URL, graph,
and transport before and after disclosure changes. Preset selection, Custom,
Filter/project reset, v4/v5/legacy/malformed load, Share, and playback must
preserve the in-session disclosure choice and cannot make view state part of a
song or audio route.

Visual assertions for the density-first shell and six-creature bestiary bind
only to the final frozen page. The frozen vocabulary is Clean/Moon Rabbit,
Warm/Sleepy Bear, Bright/Songbird, Resonant Sweep/Ribbon Snake,
Grit/Black-and-white Dragon, and Custom/Chameleon. The drawings are decorative
and `aria-hidden`; the six existing buttons remain the preset controls, while
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
visible at each viewport are computed-browser evidence. One compact Patterns
trigger must appear before the minimized effects rail and grid, with the complete
list and actions present only in its modal; the 320 px transport must not overflow.

These tests do not establish real-browser AudioParam semantics, audible
smoothing, level stability, resonance safety, clipping behavior, or device
compatibility. They also do not prove actual responsive layout, touch target
geometry, keyboard focus movement, screen-reader announcements, or that the
decorative response curves render unclipped in a browser. Browser, touch,
screen-reader, device, and listening checks remain manual.
