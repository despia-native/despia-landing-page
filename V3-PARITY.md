# The v3 landing page, converted 1:1 into DSX

The Nordcraft export of **Despia V3 Landing** (`despia_v3_landing`, the live despia.com)
was converted mechanically into DSX and mounted at **`/v3`** beside the existing
`Landing.dsx` at `/`, so the two build in one project and can be compared in one browser.

The question this answers is the standing measure in [`web/21-nordcraft-parity.md`][21]:
everything the Nordcraft **engine** does for a running app, DSX Web does. The page is the
test case, not a matrix row, an actual shipped page, so what follows is measured, not
asserted.

[21]: ../../web/21-nordcraft-parity.md

## The result, measured, not eyeballed

The live page stamps every node with `data-node-id`, and the conversion stamps the same
id onto the node it produced. That makes the two pages **pairable node by node**, so
fidelity is a measurement rather than an impression: load both at 1226x900, read
`getBoundingClientRect()` for every paired node, diff.

| | |
|---|---|
| Nordcraft nodes converted | 601 across 10 components |
| Paired nodes measured | 416 |
| **Size within 2px of the original** | **416 / 416, 100%** |
| **Position within 2px of the original** | **416 / 416, 100%** |
| Document height | 4562px vs the original's 4563px |
| SVG census (hosts · path · rect · polyline) | 37 · 55 · 2 · 9, identical to the original; 0 rejected |
| DSX emitted | 934 lines across `Components/V3*.dsx` |
| CSS emitted | sidecar sheets + a project reset, theme and font set |

Two accounting notes, both checked rather than assumed:

- **55 nodes are not individually addressable.** They are `<path>`/`<g>`/`<polyline>`
  *inside* SVG markup: DSX's sanitizer re-serialises the graphic and cannot carry a
  per-shape class, so the probe has no handle on them. They are verified in aggregate
  instead, the shape census above matches the original exactly, and no SVG is rejected.
- **6 nodes exist here that the original's snapshot lacks.** All six measure 0x0: they
  occupy nothing and paint nothing.

### How it got here

The first pass measured **3.0%**. None of the gap was the framework refusing to do
something; all of it was the conversion, and the diff named each one:

| Fix | Effect |
|---|---|
| Stop collapsing nested text/`<span>` into one `<text>`, every Nordcraft node becomes its own node | 186 missing nodes → 53 |
| Load the **exact** font faces the original serves (its own `/.toddle/fonts` stylesheet, 450 faces) | **36.3% → 79.0%**, the single biggest lever. Same family names and identical computed `font-*` still left every heading ~2% wide: a synthesised Inter Tight 800 is a different file |
| Hoist the reset to ONE project stylesheet | duplicated per sidecar sheet, each owner-scoped copy still matched *descendants*, so the last sheet emitted beat every component's own classes |
| `white-space: pre-line` on the text leaf | Nordcraft splits text on newlines into real `<br>`s; without it one section came out 205px short |
| Carry `condition` → `visible-if` | it had been dropped entirely. 11 nodes were permanently visible, one of them the navbar's **fixed full-viewport menu overlay**, which covered the page and swallowed every wheel event |
| Carry component **slot children** | the caller passes the real Despia logo into `slot="logo"`; dropping component children left the navbar showing the slot's generic placeholder glyph |
| Set `line-height` once at the root, not per node | `line-height` is inherited; pinning it on every node blocked an ancestor's value from reaching a descendant |
| A real path scanner for arc flags | SVG arc flags are single digits and may be packed (`a16 16 0 01-10-28.49` is `…0,1,-10,-28.49`). A regex tokenizer reads `01` as one number and mis-aligns every argument after it, which silently produced `NaN` in converted paths |
| `<br>` as an inline break, not a zero-height block | a block breaks the line but has no box; an inline text leaf holding one newline under `white-space: pre` breaks *and* occupies the line box, which is what a real `<br>` does |


## The whole project, not just one page

The first pass converted the landing page. The rest of the Nordcraft project is now here
too, so nothing still depends on the competitor's hosting.

| | |
|---|---|
| Page routes | 6, `/` (landing), `/terms`, `/lovable`, `/base44`, `/mcp/:tool`, `/setup/lovable`. The hand-written DSX landing keeps `/original`. |
| Rewrite / redirect routes | 4, `/license` → legal.despia.com (302), `/js/script.js` and `/api/events` → datafa.st (302), `/open-source-supporter` → buy.polar.sh (308) |
| Components | 17, `dsx lint` 0/0/0 |

Both tables are GENERATED from `export.json`, never retyped: the page routes come from each
component's own `route.path`, and the redirects from the export's own rewrite table. Each
redirect builds to a meta-refresh page with a matching `<link rel="canonical">`.

**One deployment note.** `/js/script.js` builds correctly to
`dist/js/script.js/index.html`, but a static host that treats a `.js` path as a file rather
than a directory serves 404 (the dev server does). The artifact is right; the host needs to
resolve `path/index.html` for it.

## The behaviour layer

Structure and styling were carried first. The half that makes the page *do* things is now
carried too, and the first pass had left 16 `dsx.action.*()` references pointing at
actions that were never declared, which `dsx lint` passed silently.

| Nordcraft | DSX | Count |
|---|---|---|
| `datafast_goal(name)` | a `<script>` function called from `on:tap` | 31 |
| `@toddle/gotToURL(url)` | `route.path = url` (navigation is a state write) | 4 |
| `SetVariable` | `dsx.variable.x = v` | 1 |
| `TriggerWorkflow` | the workflow's `<action>`, resolved by KEY → name | 2 |
| `TriggerEvent` | `dsx.event('name')` + the `<event as=…>` the linter demands | 2 |
| `Switch` | an `if/else` in the action body | 1 |
| component workflows | `<action as=…>` | all |

A handler within the 2-statement / 120-char budget (`Conformance/lint/facts.json`) stays
inline; anything larger becomes a named `<action>`, which is where a workflow belongs.
Verified running: the menu toggle writes state, the overlay follows `visible-if`, both ways.

**One shape did not carry.** Nordcraft's imperative `revertSvgAnimation()` has no DSX twin
because DSX motion is STATE-DRIVEN, `enter=`/`transition=` follow `visible-if` and
variables, so the state write beside it is what plays the animation. Recorded, not stubbed.

## `@starting-style`, and the exit half CSS has never had

Most of what was wanted here already existed: `enter=` IS the cross-renderer
`@starting-style` (iOS `Stack.swift:5700`, Android `StackMotion.kt`, web
`element-motion.ts` all cite it as the model), and the exit "magic" is `transition=` /
`exit=` / `keep=`, corpus-pinned on all three. The genuine gaps were narrower:

1. raw CSS `@starting-style` is *parsed* by the native DSX-CSS parser and *applied* only on web;
2. CSS has no exit at-rule at all, in any browser;
3. the web renderer kept its **own** preset table, and it had already drifted from the kernel's.

The POSE plane closes all three. One engine, two authoring forms:

- `enter=` / `transition=` stay preferred, and are SUGAR, each lowers to a pose.
- `@starting-style { … }` supplies an explicit enter pose; **`@ending-style { … }`** supplies
  an exit pose and DEFERS unmount until the motion settles. An explicit at-rule beats the
  preset: the author being specific outranks the shorthand.
- Article 7 throughout: an unparseable pose animates nothing and never holds an element in
  the tree. An element must always be able to appear and to leave.

| Piece | Where |
|---|---|
| the law | `OpenSource/Conformance/motion/pose.json`, 11 cases + the preset table |
| TS | `packages/kernel/src/motion-pose.ts`, gated by `test/motion-pose.test.ts` |
| Swift twin | `OpenSource/Engine/iOS/MotionPose.swift` |
| Kotlin twin | `OpenSource/Engine/Android/core/…/MotionPose.kt` |

The web renderer's duplicate preset table is gone, `motionFrom()` now reads the kernel's.
That surfaced a real disagreement: my corpus first wrote `scale(0.94)` while iOS, Android
and web all ship `0.92`. The corpus was corrected to the shipped value; the renderers were
not moved to match a number I had invented.

Verified: 68 kernel + 92 dom tests green, `check_swift_parse` clean, `MotionPose.swift`
added to the Runtime Sources phase. The Kotlin twin is compile-pending, gradle fails at
configuration on pre-existing dependency-verification pins, before reaching any source.


### The three pieces, closed

**1 · The adopt hook.** A server-rendered page's `visible-if` lifecycle belongs to
hydration (`adopt.ts`), not `mount.ts`, so the exit pose never got a window there. Both
paths now ask the seam the same question at REMOVAL, which is the only moment a pose
authored in CSS can be matched at all, since nothing about the NODE announces one.
Verified with no motion attribute on the element: marker stamped, pose animating
(`opacity 0.898`, `matrix(0.984725, …, -4.07343, 0)`), removal deferred, re-show clean.

**2 · iOS.** `@ending-style` now reaches `Stack.swift`. The at-rule was already parsed by
the native CSS pipeline and applied by nobody; it is now a phase-scoped lookup
(`CSSResolver.pose`), an engine entry point (`CSSEngine.poseAttributes`), a seam in the
OPEN kernel (`StackStyleSeam.pose`, the kernel never names the closed engine), and an
asymmetric transition whose removal is built from the pose. SwiftUI keeps a view alive for
its removal transition, so the deferred unmount the web has to arrange by hand is free here.

**3 · Android.** The same three layers in Kotlin (`CSSResolver.pose`,
`CSSEngine.poseAttributes`, `StackMotion.exitPose`), plus the piece the other two needed
too: an exit pose ARMS the animated flip on its own. Without that the element left before
the pose could play, because `hasMotion` only looked at attributes and this one is authored
in CSS.

Only the properties each renderer can interpolate on the way out are read, opacity, scale,
translate. Anything else in the block is inert rather than wrong: Article 7, and the element
still leaves.

**Also fixed on the way:** the native CSS parser now accepts `@ending-style` (catalogued
beside `starting-style`), and `@starting-style`'s inner selectors were never owner-scoped on
web, a component's own `@starting-style` rule silently matched nothing.

**Colour tokens.** The converted sheets carried 955 raw colour literals, which turned
`lint_dsx_css` E006 red, a gate that was green before I added them. Rather than scope the
rule away, the converter now mints every colour as a token (`web/v3-tokens.css`, 73) and
references it by name, so a generated page obeys the same rule a hand-written one does.

## What carried, and how

| Nordcraft | DSX | Notes |
|---|---|---|
| element tree (`div`/`section`/`main`/`ul`/`li`) | `<stack>` | the generic CSS-driven container, `vstack`/`hstack` would each add their own gap/align defaults on top of the imported sheet |
| `p`/`h1-h6`/`span` (text-only) | `<text value=…>` | mixed-content ones become containers |
| `a` | `<pressable href=…>` | real anchors, SSR-crawlable |
| `img` | `<image src=… contentFit="cover">` | CDN paths absolutised to `despia.com` |
| `svg` + nested shapes | `<svg src="<svg>…">` | see **SVG** below |
| `iframe` | `<WebView src=…>` | the Tella video embed; see gap 1 |
| inline styles + variants | one generated class per node in the sidecar sheet | `@media`, `:hover`, `@starting-style`, state classes all survive as real CSS |
| `repeat` | `<list bind=… key="index">` | see **repeat** below |
| formulas (`@toddle/*`) | JSE | 21 functions mapped; `filter`/`findIndex`/`formatDate` land on JSE's own Array/Date surface |
| component attributes | `<attribute as=…>` | kebab-case → camelCase (a JSE path segment cannot hold a hyphen) |
| component variables | `<variable as=…>` | initial values carried as JSE literals |
| HTTP blocks | `<api as=… url=… method=… auto=…>` | the live `cloud.despia.com` features API, auto-fetched, 30 rows rendering |
| inline `<style>` node | sidecar sheet | pseudo-elements + `@keyframes` pass through untouched |

### CSS is not a constraint
Sidecar sheets are **selector-prefixed pass-through**, `scopeSheet` in
`packages/compiler/src/css.ts` rewrites selectors for owner scoping and never inspects a
declaration body. All 94 CSS properties the export uses arrive verbatim on the web.

The sheet is still a **DSX-CSS sheet**, though: `lint_dsx_css.rb` validates every sidecar
against `dsx-css-properties.json`, and the native export compiles the same sheets for iOS and
Android (`compile_project_css.rb`). An earlier version of this paragraph said the catalog
governed only the inline `style=` plane, it did not, and the sheets carried 568 E001/E002
errors (`display: block` ×123, `overflow: clip` ×200, `rotate` ×62, per-side borders,
`text-shadow`, …) that every other gate passed. The converter now reads the catalog at
conversion time and splits each node's declarations in two:

- what the catalog has stays in the rule, and four words the engines already kept were
  added to the catalog rather than rewritten (`overflow: clip`, `-webkit-backdrop-filter`,
  the individual `rotate`/`translate`/`scale`, `white-space: break-spaces`);
- what it has no cross-platform word for goes into a **`@supports (<that declaration>)`**
  block right after the rule, same selector, so the cascade position is the one the page
  gave it. The browser answers the feature query yes; both native resolvers answer every
  feature query no (`CSSResolver mediaApplies`: unknown queries are inert), so the
  declaration reaches exactly the lane that can draw it, the spec's own "`@supports`, done
  truthfully" (dsx-css.md §4.11).

A few Nordcraft spellings fold losslessly on the way and are listed in the parity report as
carries, never dropped silently: `rotate: 0 0 1 <angle>` is the angle (that axis IS the 2D
rotation); `grid-row-gap`/`grid-column-gap` are their Grid 1 canonical names;
`grid-template: <rows> / <columns>` is its two longhands; a field holding a whole declaration
list (`position: absolute; top: 0; …` on the video embeds) is exploded into them; a dash-less
`webkit-font-smoothing` never was a property and is dropped. Measured after the split:
computed styles and a full-page pixel diff of every route at 1226px and 390px against the
previous build, same paint.

### SVG
The `<svg>` element takes full inline markup through `sanitizeSvgMarkup`
(`packages/dom/src/media-surfaces.ts`), not just a single `d=` path. All 20 SVGs on the
page carried, including the 9 multi-shape ones. Two shapes had to be flattened:

- **`<g>` (30 uses)**, not in the shape allowlist. Every one of the 30 carried only
  `id` and `box-sizing`: **no transform, no paint, nothing to cascade**, so flattening
  its children into direct `<svg>` children is lossless. A `<g>` carrying a transform
  or a group opacity would NOT survive.
- **`<defs>` (9 uses)**, every one is **empty**. Dropping an empty `<defs>` changes no
  pixel. A `<defs>` holding a gradient or a clip path would NOT survive, and neither
  would the `fill="url(#…)"` that referenced it.

### repeat
A Nordcraft `repeat` emits bare siblings into the parent's flow. DSX's `<list>` is a real
container (`.dsx-list`) with a wrapper per row (`.dsx-row.dsx-collection-row`) and its own
axis. The converted sheet gives both `display: contents`, which dissolves the two boxes so
the repeated nodes land exactly where the repeat put them and the parent's own
flex-direction and gap govern, the original semantics, restored in CSS.

One asymmetry worth knowing: DSX exposes a **primitive** row as `item.value` and an
**object** row's fields as `item.<field>` (`collectionItem`, `mount.ts`). Nordcraft writes
both as `ListItem/Item`, so the converter tracks the row kind down from each repeat.

### The reset has to travel with the page
The exported inline styles were authored against
[`despia.com/_static/reset.css`](https://despia.com/_static/reset.css), where every node is
`display:flex; flex-direction:column; box-sizing:border-box; margin:0; padding:0`. DSX's
own element layer asserts a *different* base (`.dsx-stack` adds `align-items:start`,
`min-width:0`, `min-height:0`; `.dsx-text` imposes the Despia type ramp). Neither base is
wrong, but the page only means what it meant under the one it was written for, so that
reset is ported into `.nc` / `.nc-*` and carried with the markup. The sidecar sheet sits in
the stronger `dsx-sheets` layer, so restating wins.

The load-bearing line is `align-self: auto`: without it every converted box stretched to
its parent's full width instead of hugging its content, measured, the hero column came out
1146px against the original's 544px.

## The 4 that did not carry

**1 · `<iframe>` → `<WebView>`, attributes lost.**
The hero's Tella video embed renders and plays. But `allowfullscreen` and
`allowtransparency` have no `<WebView>` equivalent, and neither does `sandbox`. DSX models
a web surface as a *navigable* one (`src`, `origin`, `on:commit/finish/fail/message`), not
as an embed with a permissions policy. For an embedded third-party player that is a real,
if small, difference.

**2 · `<script>` importing a third-party ESM module from a CDN.**
The `motion` component does `import { animate, scroll } from "https://cdn.jsdelivr.net/npm/motion@11.13.5/+esm"`.
DSX runs author JS through the JS tier (`/web/15`), which is a bounded sandbox with **no
remote-import channel**, by design, since the same document has to run on iOS and Android
where a CDN import is not a thing. The animation this drives does not survive. Vendoring
Motion into the project, or rewriting the animation as DSX transitions/`@keyframes`, are
both available; neither is a mechanical conversion.

**3 · `<slot>` has no fallback content.**
A Nordcraft slot carries default children; DSX's `<slot>` is `children: "none"`, it
renders only what the caller passes. The navbar's `slot name="logo"` (its own logo, which
no caller overrides) rendered nothing. The defaults are inlined by the converter, so the
logo is on the page, but the slot seam itself does not survive the carry.

**4 · `background-clip: text` does not clip through DSX's `<text>` wrapper.**
The hero's gradient headline is `background-clip: text` + `color: transparent` on the
block, with the words in child text nodes. Carried faithfully, node for node, computed
styles byte-identical to the original, geometry exact, it painted **nothing**: the clip
does not reach glyphs sitting inside DSX's `<text>` element. Merging the run back into a
single `<text>` restores it, at the cost of those two child nodes. Worth a look in
`packages/dom`: an author hitting this sees a heading vanish with no error anywhere.


### `currentColor` did not inherit through `<svg>`, fixed on all three renderers

`<svg fill="currentColor">` over bare shapes is how every icon set colours itself, and it
did not work on any renderer. The Despia mark rendered black on its dark tile.

The cause was the same in all three, which is at least consistent: **the root `<svg>`'s
paint was read off the shape and nowhere else.** `fill`/`stroke` and their modifiers are
INHERITED SVG properties, so a shape with none of its own must take the root's; instead it
fell to SVG's initial black.

| Renderer | Was | Now |
|---|---|---|
| web (`packages/dom/src/media-surfaces.ts`) | `SVG_ROOT_ATTRIBUTES` allowed only `viewbox/width/height/preserveAspectRatio/xmlns`, so the sanitizer **stripped** root paint | `SVG_INHERITED_PAINT` is carried on the root and validated exactly as on a shape; `url()` is still refused |
| iOS (`SVG.swift`) | `guard let f = fillRaw else { return .black }`, and `color()` had no `currentColor` case | shape paint falls back to the root's; `currentColor` resolves to `.primary`, the ambient ink |
| Android (`SvgElements.kt`) | `fillRaw == null -> Color.Black`, same absence | same root fallback; `currentColor` yields `Color.Unspecified`, which the draw pass swaps for `LocalContentColor.current` |

`currentColor` now means the same thing on all three: the inherited ink, CSS `color` on
web, SwiftUI's ambient foreground on iOS, `LocalContentColor` on Compose.

Verified on web (the notification tile's mark is white against its dark ground, the navbar's
is `#171717` against its light one, and the black-path census tracks the original: 20/53
there, 22/55 here, the delta being the two inlined Ionicons). The Swift and Kotlin twins are
parse-clean and **compile-pending**: `check_swift_parse` passes, and the Android kernel
cannot compile in this environment, `gradle` fails at *configuration* on pre-existing
dependency-verification pins (Kotlin 2.4.0 against the pinned metadata), before reaching any
source.

### Two more the framework made the conversion work around

- **`<slot>` cannot fall back, and a component instance's children are the only way in.**
  Carried correctly, the navbar's `slot="logo"` receives the real Despia mark from its
  caller. A slot nobody fills renders nothing at all, so its defaults have to be inlined.
- **A DSX route frame does not use the document scroller.** A frame is a fixed-size
  surface (`position:absolute; overflow:hidden`) with its own inner `<scroll>`, because a
  covered frame keeps its DOM and its scroll offset. A marketing page wants the opposite:
  the real document scroller, so the browser supplies a scrollbar, overscroll,
  scroll-linked chrome and window-level anchor scrolling. The converted page hands the
  active frame back to the document (covered frames stay hidden). Worth a first-class
  switch, every marketing page and every long article wants it.

### Two the converter had to work around

- **SVG path arcs.** DSX's path parser accepts `M L H V C S Q T Z` only; an `A`/`a`
  command makes `sanitizeSvgMarkup` reject the **whole document**, so the graphic renders
  nothing. **77 of the page's 153 paths use arcs**, including the Despia logo. The
  converter converts arcs to cubic Béziers at build time (`tools/v3-import/arcs.mjs`,
  SVG 1.1 F.6.5), exact to well under a pixel. Without it, half the page's icons are
  blank. Arc support in the parser would remove the need.
- **`<ion-icon>`.** A third-party web component with no DSX twin, and the SF corpus
  carries neither `layers` nor `terminal`, so a symbol swap would be the wrong artwork.
  The real Ionicons paths (MIT, `tools/v3-import/ionicons/`) are inlined into `<svg>`
  instead, with `name` and `size` bound reactively: same glyph, same 20x20 box, one node,
  no custom element.
- **Non-scalar `<svg width/height>`.** The sanitizer's `width`/`height` are numbers; a CSS
  length (`"50rem"`, `"100%"`) fails validation and again takes the whole document down.
  Those two are carried into the sheet instead of the markup.

### Not gaps, though they look like one
Ten custom tag names (`in-app-purchase-overview`, `modal`, `screen`, `widget`, `logo`,
`chart`, `icon`, `loader`, `close`, …) read like missing web components. They are not: every
one carries **no attributes and no events**, they are styled tag names, and `<stack>` with
the same class is a lossless carry. The single exception, `<close>`, has a click handler
and became a `<pressable>`.

## Framework bugs this turned up

**`dsx build` refused `<WebView>` in a standalone project.**
The renderer registers `WebView`/`DSXWebView`/`DSXView` (`RICH_ELEMENT_TAGS`,
`packages/dom/src/elements.ts`) and `stack-elements.json` documents `<WebView>` as a
first-class element, but the linter's `GLOBAL_ELEMENT_TAGS` and its corpus
(`Conformance/lint/facts.json`) both omitted them, so any project without a module census
that used one failed to build with *"unresolved component (not in this package, not
global)"*. Fixed by adding the three tags to both, which is what makes the video embed on
this page build at all.

**Two authoring sharp edges, both caught by the linter or the screen:**
- `bind=` takes a bare JSE expression; `{{ }}` there parses as a dict literal. The linter
  says so clearly.
- An `<api as="x">` publishes at the **bare name**, `x.data`, not `dsx.api.x.data`
  (`/web/05`). Nothing catches the wrong path; the list just stays empty.
- Inside a `filter`/`findIndex` predicate, naming the callback parameter `item` collides
  with the enclosing list row's `item` and silently yields zero rows.

## Reproducing

The conversion is a script, not hand-work, regenerate rather than hand-editing any
`V3*.dsx`:

```bash
node convert.mjs HomePage navbar footer mockup compatible button icon motion loader tool_icon && node emit.mjs
```

The converter lives in the session scratchpad (`conv/convert.mjs`, `conv/emit.mjs`) and
prints the gap report above on every run. `web/v3-theme.css` holds the 121 Nordcraft theme
tokens, lifted from the live stylesheet's `@layer base`.

## Native: the same document on iOS and Android

The conversion above proved the document against the browser. The second proof is the
same `.dsx` rendered by the native engines with the DSX-CSS layout core linked (the
`guides/styling.md` section "The layout core"): one file, one interface, three renderers.
It was measured, not eyeballed, with the fidelity harness that now lives in
`ClosedSource/scripts/dsxcss/` (`geometry-live.js` in the browser, the geometry probe on the
device, `geometry-diff.mjs` between them). Every element carries a probe id (the converter's
`n-<id>` class; `PROBE=1 bash tools/v3-import/run.sh` regenerates the components with it), the
browser reports each element's rect at the device's width, and the device reports the rect
the core placed it at.

Devices: iPhone simulator at 402 points wide, Pixel 10 Pro emulator at 427 density-independent
points (the browser measured at the same widths). The fonts the page declares (Inter, Inter
Tight, Roboto, Geist, Geist Mono) ship in `Fonts/` with `DSXFontRegistry.json`, so the glyph
widths are the browser's (Inter Tight Bold 20 "Get Started for Free" measures 180 points on
both).

What carried mechanically once the core was linked: the cascade in order with shorthands
expanded, block and flex and grid boxes, percentage sizes and paddings (the `padding-bottom:
56.25%` video card), borders reserved by the core, absolute children placed by their insets
inside the core's tree (the hero image, the navbar), negative margins (the overlapping avatar
row), `fit-content`, inline formatting at element granularity with the browser's `pre-line`
line-box rules (measured in the browser and reproduced: a run's first newline ends its line,
each further newline is an empty line box, a whitespace-only child of a flex container is not
rendered), and a text-only inline context as one wrapped paragraph.

What the harness turned up in the engines on the way, all fixed: the Swift cascade re-entering
itself on a text run's newline rule (a launch crash), a size table that survived a marquee's
rows arriving after mount, the Compose lane measuring in pixels against a core speaking points,
an Android export that shipped no compiled sheet at all, Compose text runs that inherited no
font from their container, XML attribute-value normalisation eating a run's newlines on both
native parsers, and two core defects (a row-reverse container asked at max-content, and a
child with `flex-shrink: 0` plus a negative margin, both answering zero) worked around in the
FFI's size pass.

### The numbers

Widths are the device's points; every native number is the rect the layout core placed the
element at, read from the same capture the harness diffs. Each pass was taken on the build of
2 September 2026 (iOS build 46, Android build 21).

| Section | iPhone 402 web | iPhone 402 native | Pixel 10 Pro 427 web | Pixel 10 Pro 427 native | iPad 820 web | iPad 820 native | Pixel Tablet 1280 web | Pixel Tablet 1280 native |
|---|---|---|---|---|---|---|---|---|
| Page | 402x7365 | 402x7414 | 427x7320 | 427x7262 | 820x6127 | 820x6172 | 1280x4542 | 1280x4552 |
| Hero section | 402x876 | 402x876 | 427x898 | 427x895 | 820x1155 | 820x1154 | 1280x1189 | 1280x1189 |
| Hero card | 386x748 | 386x748 | 411x770 | 411x767 | 804x1027 | 804x1026 | 1264x1061 | 1264x1061 |
| Hero video card | 322x183 | 322x183 | 347x197 | 347x197 | 740x418 | 740x418 | 800x452 | 800x452 |
| Primary button | 233x54 | 234x54 | 233x54 | 234x53 | 233x54 | 234x54 | 233x54 | 234x54 |
| Marquee | 402x82 | 402x48 | 427x82 | 427x48 | 820x82 | 820x83 | 1280x82 | 1280x82 |
| Features | 402x2184 | 402x2238 | 427x2160 | 427x2179 | 820x1820 | 820x1852 | 1280x910 | 1280x920 |
| Testimonials | 402x485 | 402x499 | 427x485 | 427x491 | 820x451 | 820x458 | 1280x451 | 1280x458 |
| Pricing | 402x1812 | 402x1828 | 427x1812 | 427x1762 | 820x1187 | 820x1198 | 1280x618 | 1280x615 |
| Ship section | 402x545 | 402x559 | 427x545 | 427x551 | 820x494 | 820x500 | 1280x494 | 1280x500 |
| Terms | 402x832 | 402x813 | 427x791 | 427x771 | 820x566 | 820x551 | 1280x545 | 1280x531 |
| Footer | 338x484 | 338x489 | 363x484 | 363x501 | 756x309 | 756x312 | 1216x190 | 1216x193 |

- iPhone 402: page 7414 native vs 7365 web, 184 of 273 paired boxes within 3 points in size
- Pixel 10 Pro 427: page 7262 native vs 7320 web, 167 of 273 paired boxes within 3 points in size
- iPad 820: page 6172 native vs 6127 web, 193 of 274 paired boxes within 3 points in size
- Pixel Tablet 1280: page 4552 native vs 4542 web, 182 of 308 paired boxes within 3 points in size

Two rows need a note. The marquee's chips arrive from an API response, and a capture that
lands before it (both phones above) reads the strip empty; the passes that had the rows
(the iPad and the tablet above, and the earlier phone captures) read the marquee at the
browser's 82 or 83 points. The paired-box counts pair every probe id the browser reports with
the same id on the device; a run inside a native paragraph has no rect of its own any more,
which is why a third of the pairs are missing rather than wrong.

What remains, and where it is written down: a mixed inline context (text beside an icon, a
chip or a gradient word) wraps at the run boundary rather than inside a run,
`text-wrap: balance` has no native twin (a wrapping text does hug its widest line), and
`position: fixed` pins at scroll zero. Each is a row of the parity register
(`ClosedSource/release/platform-parity-register.json`, `knownGapsOutsideTheLedgers`) and a line
of the proposal's status table (`architecture/proposals/dsx-css.md`, section 10).

## The verdict

The engine cleared it. Layout, styling with every variant, repeats, formulas, component
attributes and variables, declarative auto-fetched APIs, real anchors, routing and
multi-shape SVG all carried mechanically, the page builds with the shipped toolchain and
renders against the live original.

What did not carry is a CDN ESM import, an iframe's permission attributes, slot fallback
content, and a gradient text-clip. None of those is engine parity: two are third-party integration
surfaces and one is a deliberate sandbox boundary that exists because the same document has
to run natively. The honest one-line answer is that **the framework is ready for this page**, every
paired node lands within 2px of the original in both size and position, with the
`<WebView>` linter fix as the price of admission, and arc support, slot fallbacks and a
document-scroll mode as the three things that would remove the workarounds.
