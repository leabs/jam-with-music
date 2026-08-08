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
Filter-graph audio fallback, Stop/Play retirement fences, the mounted native
Effects workbench open/close, Custom promotion, shared bypass state, and
the single shared four-macro control surface. Its synthetic document now represents all
14 `.steps[data-instrument]` containers and their 16 children, so the canonical
pattern reorder regression exercises a genuinely nonzero selected pattern and
proves bundled bytes/repeats/pitch, selection/playback identity, boundary
no-ops, and encoded/reopened order.

`test/filter-page-contract.test.js` provides static acceptance coverage for the
native Effects workbench markup, one native visibility contract, focus return and
interleave-safe reopen sequencing, the reduced-motion contract, real 44 px-or-larger targets, the
text-backed non-authoritative micro-screen, preserved script hooks, and one
shared Filter state/control surface. It also binds the final zero-gap 44 px
desktop cadence, internal non-interactive lane divider, and 44 px targets. Its
624 px lane-stack reference is derived from the 14 rendered instrument rows,
production lane height, and top/bottom sequencer padding; the absolutely
positioned divider adds no layout height. Pre-grid fit remains computed-browser
evidence. The contract additionally proves the semantic light hardware palette
and its literal contrast: warm page and chassis surfaces, white controls, a pale
blue instrument screen, blue transport/selection, green Tone, orange Space, and distinct
disabled/bypass/unavailable/destructive states, the sole `#filterFxPanel`
vertical scroller, exact two-card 320 px arithmetic with a classic 17 px
scrollbar, the winning custom card basis plus effective flex/basis/width bounds
at 320/390/600 px, live shorthand/logical-start/logical-end/physical Tone
padding and border widths across shorthand, logical, and physical declarations,
exact desktop bay tracks at 1200/1280/1440 px, and the live
8 px desktop macro gap. The active preset pseudo-label retains normal-text
contrast on its rendered creature tile after resolving both `background` and
`background-color`; its effective `background-image` must remain `none` so an
opaque image layer cannot invalidate that contrast. An active playing step keeps its ink focus
edge and blue halo after the later playing-state rule. Mutation sentries reject nested,
tag-qualified, logical-overflow, or dialog-rooted scrollers under either
`.effects-dialog` or `#effectsDialog`, a scrollable outer dialog, any stale or
ID-specific phone-width, preset-cost, or scrollbar deduction, a later
fixed 116 px phone card or custom basis, non-wrapping phone pedalboard, later
30 px Tone shorthand, logical, or logical-edge padding or border, an opaque
active-tile gradient, a later 40 px desktop macro gap,
reversed desktop bay tracks, an
ID-specific desktop two-bay collapse, and late non-sticky or non-elevated
header overrides including at the 1200 px boundary.
Effective later and more-specific declarations are
resolved at the acceptance viewports before the unavailable Filter border or
micro-screen label palette is accepted. Focus uses a near-black ink edge with a
state-appropriate blue, green, or orange halo.
Light-theme non-text sentries require the active Filter trace, status dot, knob
indicator, Filter and Space range accents, and failed-sample outline to use the
darker owner-ink variants at least 3:1 against their adjacent light surfaces;
late bright-accent mutations are rejected for each marker, including an
equivalent `background-color` override on the status dot.

`test/pattern-modal-contract.test.js` covers the single 44 px Patterns trigger,
one portaled modal-owned list, preserved IDs/actions, Radix focus and close
structure, destructive confirmation, portal-root token inheritance, literal
two-color focus fallback, 44 px Move up/down controls and disabled boundaries,
canonical reorder delegation, and the 72 px border-box repeat track. Its 320 px
source arithmetic proves the fixed tracks and wrapped action block fit the
available row width. At that minimum width, the name button owns a complete
line above the wrapped row actions, so `Pattern 1`, `Pattern 2`, and later
numeric identities remain fully visible and distinct without reducing the
72 px repeat field or any 44 px target. Its green row-action and orange New hover states require
dedicated dark on-accent text and literal normal-text contrast, with later-specific
mutation sentries for each selector. A disabled Delete stays disabled-looking
on hover because destructive hover only applies to enabled controls; computed
layout remains a browser check. The 320 px identity sentry resolves the complete
Arrange style by OR-separated media branches with AND conditions inside each,
then preserves per-declaration `!important`, specificity, and source order
against the actual dialog, list, row, card, and leaf-element chain. The button
class set is extracted from the installed `patternBtn.className` assignment;
the sentry requires production `flex-1` and `truncate` and rejects fabricated
`flex`. The row, card, and action class sets are likewise sourced from their
literal renderer assignments. Flex shorthands and
longhands, `flex-flow`, and shorthand, logical, or physical inline padding are
resolved into the layout values the identity needs, with conflicting equivalent
declarations rejected conservatively. Exact late nowrap, collapsed flex and
padding, real `.truncate`, comma-media, important-before-normal, `flex-flow`,
flex-longhand, and padding-variant mutations fail. A grouped ID-qualified child
selector must match, and changing the installed button from `flex-1 truncate`
to `flex-1 flex` fails for the installed-class reason. Impossible
`.arrange-pattern-button.flex`, impossible `#patternsDialog.arrange-pattern-card`,
and max-319 controls remain inapplicable.

## UI overhaul seam

The authoritative static/VM/build artifact is page
`2cef4b1d231d837096398ab52a975cfe67e12cc28c64da2b60fa2b118f8c8fd3`
with ArrangeDialog
`4ac5e1b4bab652f293621c5305b52add9ae485537f1828df89e1dd0ae4b14551`,
ClearProjectDialog
`a6100cc071a1d1f32180fbec1cbb0bcbca23fb18432d26109efaba74bb8cbcac`,
shared Dialog
`832351fa6fed23498c3598b925d000cf88aebaf3f2a76aa315b2ac8eafe59a66`,
Filter page contract
`87ce47a32c2d2b009d62c2b2551d008f669e1f124cf13cc02c3015865b0f60d8`,
Filter inline
`32dbe9734e3bb2bef1ba8d1719018bbea4410ab188fda1a7d9b933f005c7b7c7`,
harness
`396e95e109b90e723041c773dd25698375b70840421c0d685b9fedb240eff64d`,
and app-shell contract
`2ca1863ae1b8d988436043a5f5144a9486364e3e61df05bb649184a0e67427ce`,
AppMenu
`3d6473c120659492ef6bc56f2b3cc123795c4b2dcc77b85befac298c562d81f9`,
global styles
`f4c98ef1e9831dc9cc2614f778b0aace0e9c2b125519ccff5547811d8e579175`,
Pattern contract
`99348a1a339032af5a8ef86f0c164b29a182b03b0c4dd8bd8ff5a50f0e34f79b`,
package
`97c89235869bed7909bfadcad4d1c4c783c051a74b897184d37ae9ea91ba0ad3`,
package lock
`b7eb4eab7e65716f7444e86240f34b35f7e0a4838610143463b9e73cb288e4bc`,
and shadcn config
`6c42b2e247fde5b71a94e965881f9e60b0b0e36e2c176cde1151422026b40daf`,
tsconfig
`6551e8fc79128cbc8b6a69d0babad0b354a3985a07598c5ff458e070acfa1457`, and
Space graph contract
`a3ab0d45d6b9d5914176966900be752e5496313824a316addac41ab243aebac4`.
Its focused app-shell/Filter/Pattern gate is 94/94 pass. Its full package gate
is 232 total, 230 pass, 0 fail, and the same 2 Phase 0B
TODOs described above.

The app-shell overhaul supersedes the prior standalone Patterns rail and
Effects disclosure expectations above. The persistent shell keeps BPM,
Play/Stop, Loop, Share, Clear All, and Step Scope visible. Patterns and Effects
are direct native buttons gated until the page coordinator and Arrange island
consumers are hydrated. The app-shell contract executes the installed readiness
effect in preexisting, page-first, and Patterns-first orders, rejects a detached
non-invoked readiness function, requires the shell to start disabled, proves
each consumer writes its readiness flag before dispatching its ready event, and
binds each button to its click handler. One
pointer, Enter, or Space activation dispatches one
matching command; there is no one-item submenu, popup, custom typeahead, or
second state owner. Patterns keeps the Radix ArrangeDialog and its page-owned
list, with the page coordinating a distinct ready event. Effects is permanently
mounted in a centered native workbench. At 1200px and wider Tone and Reverb
occupy two bays; intermediate and phone widths stack them Tone-first. The native
dialog clips overflow while `#filterFxPanel` is the sole vertical scroller with
contained scroll chaining, so its sticky header and close control remain visible.
Native close restores its opener, while Pattern close uses one
prevented Radix autofocus owner. Pattern takeover cancels stale Effects frames,
settles the Effects controller and command ARIA synchronously, and an Effects
request closes Patterns before the next-frame workbench open. Immediately before
`showModal()`, Effects re-establishes its direct button as the native opener, so
closing after a Patterns takeover returns to Effects rather than the retired
Patterns trigger. Native dialog and ARIA state are the disclosure authorities;
there is no separate `filterPanelExpanded` mirror. The fake runtime queues that
same production frame rather than using a test-only scheduling path.
Reduced motion covers the native workbench and Radix-portaled Pattern content.

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
keeps transport and Step Scope visible; Patterns is a direct button
opening the existing portaled ArrangeDialog, while Effects is a permanently
mounted native workbench opened by a direct button. At 420 px and below, the
transport explicitly spans the full named header row instead of inheriting the
compact grids one-column override; BPM, Play, Loop, Share, Clear, and Help all
remain visible 44 px controls without page overflow. At 320 px the Effects card basis is 112.5 px after the dialog,
border, nested padding, gap, and classic 17 px scrollbar deductions, preserving
two columns while staying inside the 88-116 px contract.
The effective 320/390/400/420 px cascade also binds the six transport columns,
full-row span, 284 px cap, and visible overflow, rejecting later same- or
higher-specificity clipping mutations, including an override scoped only to
the upper 400-420 px edge of the phone breakpoint.

The checksum-bound production build was also rendered through a changed-angle
local Playwright/Chrome path in Chrome for Testing 149.0.7827.55 at 1440x1000,
390x844, and 320x720. That run produced no page or console errors, kept document
width equal to viewport width, showed all six phone transport cells at 44 px,
kept two Effects preset cards on the first phone row, and observed the outer
dialog clipped, `#filterFxPanel` vertically scrollable, and its Close bar sticky
at `top: 0` with `z-index: 2`. The same run opened the white Pattern and Clear
Project dialogs at all three widths; each stayed inside the viewport and kept
its dark-on-blue or dark-on-orange action treatment. The supported in-app Browser path remained
blocked before tab creation by `Cannot redefine property: process`, so this is
local Chromium evidence rather than a supported-browser, device, or AT result.
The corrected minimum-width Pattern render then opened three rows at 320x720:
`Pattern 1`, `Pattern 2`, and `Pattern 3` each measured 152 px wide with no text
clipping, retained a 44 px name target plus four 44 px row actions and a 72 px
repeat field, and kept document width equal to the 320 px viewport with no
console or page errors.

These tests do not establish real-browser AudioParam semantics, audible
smoothing, level stability, resonance safety, clipping behavior, or device
compatibility. Static tests alone do not prove actual responsive layout, touch
target geometry, keyboard focus movement, screen-reader announcements, or that
decorative response curves render unclipped. The changed-angle Chromium run
covers only the rendered geometry stated above; touch, screen-reader,
cross-browser, physical-device, native-audio, interruption, and listening checks
remain manual.
