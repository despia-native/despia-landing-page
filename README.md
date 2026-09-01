# despia.com

The Despia marketing site, authored in [DSX](https://despia.com) and built by the shipped
`despia` toolchain. This is the real thing: the pages this repo contains are the pages that
serve our traffic.

We publish it because the most useful answer to "what does a real DSX project look like" is
a real DSX project. Every page, route, stylesheet and piece of logic below is what we run.

> **Source available, not open source.** You may read this, learn from it, and borrow the
> patterns. You may not copy the content, copy, imagery or brand. See [LICENSE](./LICENSE).

## Run it

```bash
npx dsx dev
```

`npx dsx build` writes the site to `dist/`, and `npm start` serves it.

## Rendering

Every page is server-rendered, at two levels, and both ship.

**The build renders each route to a file.** The exported HTML holds the real markup, and
because `dsx.config.json` sets `"ssrSeed": true` it also holds the data: the build resolves
each page's `<api>` blocks and writes the results into both the body and the hydration
payload. The feature list is in the HTML on first paint, not after a client fetch. The client
then adopts that DOM in place rather than re-mounting it. This alone is a complete site, and
any static host can serve `dist/` as-is.

**`server.mjs` renders each request live.** A file cannot do two things: a dynamic route like
`/mcp/:tool` has one skeleton rather than a page per tool, and its data is only as fresh as the
last build. So when a server is present the page handler renders on request instead, with the
same documents and the same seeding, resolved now.

The server also restores the two first-party analytics paths. On our own domain `/js/script.js`
and `/api/events` are a reverse proxy, which is the point: an ad blocker or a third-party-cookie
rule that would drop the vendor does not drop us. A static host has nowhere to put a proxy, so
there the tracking module falls back to the vendor's own origin and analytics degrade to
third-party instead of disappearing.

Redirect rows answer with their real status (302, 308) when the server is running; the static
export writes each as a meta-refresh page, which is the most a file can do.

```bash
npm run build && npm start     # PORT and DIST override the defaults
```

## What is where

| Path | What it is |
|---|---|
| `dsx.json` | the package manifest: name, scheme, platforms, and the `web.styles` list every page loads |
| `dsx.config.json` | the project contract: entry component, output directory, and the route table |
| `Components/*.dsx` | one file per component. Head block for the contract, body for markup |
| `Components/*.css` | one sidecar sheet per component, owner scoped at build time |
| `web/*.css` | the four project sheets: fonts, theme, colors, base |
| `Modules/*/` | custom modules: one folder per capability, with a lane per platform |
| `server.mjs` | the live-SSR host: per-request rendering, real redirects, the analytics proxy |
| `public/` | static assets served as-is |

## Routing

The whole routing story is one table in `dsx.config.json`. There are two kinds of row.

A **page** binds a path to a component. A segment starting with `:` is a parameter, readable
as `route.params.tool` or bound straight into markup:

```json
{ "path": "/mcp/:tool", "component": "site.SiteMcp" }
```

A **redirect** binds a path to a destination and a status. No component, no server: the
build emits a meta-refresh page with a matching `<link rel="canonical">`, so it works on any
static host:

```json
{ "path": "/license", "redirect": "https://legal.despia.com", "status": 302 }
```

A page row can carry `meta`, which is where the title and description for that page live:

```json
{ "path": "/lovable", "component": "site.SiteLovable",
  "meta": { "title": "...", "description": "..." } }
```

Both kinds live in the same ordered list, which means the site map is one file you can read
top to bottom.

## Layout

Layout is CSS. DSX gives you the element vocabulary (`stack`, `text`, `image`, `pressable`,
`list`, `svg`) and the cascade does the rest, with three rules worth knowing:

**One sheet per component, owner scoped.** `SiteHome.css` sits beside `SiteHome.dsx` and the
compiler prefixes every selector with that component's owner stamp. You never think about
collisions, and you never write a BEM prefix.

**The project sheets set the base.** `web/base.css` defines the box model every element on
the site starts from, so a component sheet only writes what makes that component different.
`web/theme.css` holds the design tokens, `web/colors.css` the palette.

**Colors are tokens, never literals.** Every color on the site is a named token in
`web/colors.css` and every component sheet references it by name. This is mechanical, not a
convention: the linter fails a hex value written anywhere else.

## State and logic

A component's head block is its whole contract:

```xml
<head>
  <attribute as="menuOptions"/>
  <variable as="menuOpen">return false</variable>
  <action as="closeMenu">dsx.variable.menuOpen = false</action>
  <api as="features" url="https://cloud.despia.com/..." method="GET" auto="true"/>
</head>
```

`<attribute>` is a prop. `<variable>` is component state. `<action>` is a named workflow you
call from any handler. `<api>` is declarative data: it fetches on mount, exposes
`features.data` / `.loading` / `.error`, and refetches when anything its URL reads changes.

Handlers are expressions, not callbacks:

```xml
<pressable on:tap="dsx.variable.menuOpen = !(dsx.variable.menuOpen)">
<stack visible-if="dsx.variable.menuOpen">
<list bind="(features.data || []).filter(row => row.category == 'feature')" key="index">
```

Anything longer than a couple of statements becomes an `<action>`, which is where a workflow
belongs anyway.

## Custom modules

Six analytics and affiliate vendors run on this site, all of them shipping as CDN JavaScript.
The obvious move is six script tags in the page head, and it works exactly once, on one
platform: the same pages run as an iOS app and an Android app, and neither has a document to
paste a script into.

So they live in `Modules/Tracking/` instead, as one module with a lane per platform:

```
Modules/Tracking/
  dsx.json      the contract: scheme, actions, declared state
  config.json   every vendor id, in one file
  web/index.js  loads the real vendor scripts and calls their real APIs
  swift/        no DOM, so it reports over HTTP
  kotlin/       the Swift lane's twin
```

Markup calls the actions and never learns which platform it is on:

```xml
<button on:tap="dsx.module.tracking.goal({ name: 'nav_start_cta' })">
<stack visible-if="dsx.module.tracking.context.referral.length > 0">
```

The toolchain assembles the rest. `dsx build` bundles the web lane into its own chunk and
imports it from the generated bootloader. `dsx export ios` adds the Swift file to a real Xcode
project and generates its registration table; `dsx export android` does the same for Gradle. A
project keeps DSX markup plus a folder of custom code, and the CLI, the Swift toolchain and the
Kotlin toolchain put the rest together.

This is where app-specific native code belongs. Affiliate tracking is not something every
Despia app needs, so it is not something DSX ships: it is four files in this repo. See
[Modules/Tracking/README.md](./Modules/Tracking/README.md) for the actions and for which
vendors are full on every platform and which are named as limited.

## Movement

Two things on the home page move, and neither is scripted.

The **tool logo** cycles every seven seconds. That is a `<variable>` and a `setInterval` in an
`<action>` the root calls from `on:appear`:

```xml
<action as="onAppear">setInterval(() => { ... }, 7000, 'iv:tool_icon')</action>
```

`setInterval` is part of the expression language, not a browser API, so it means the same thing
on a phone. The key in the third argument makes it idempotent: mounting twice replaces the
timer instead of stacking a second one.

The **compatibility strip** scrolls continuously. The list is bound to its rows concatenated
with themselves, and an inner `max-content` wrapper animates to `translateX(-50%)`, which lands
on the identical frame and so wraps seamlessly. Its duration is bound to the row count, which
holds the speed constant however much data the API returns:

```xml
<stack class="ds-marquee" style="--ds-marquee-dur: {{ rows.length * 1.91 }}s">
```

Declaring it rather than stepping a transform on every animation frame is what lets it run on
all three renderers, and what lets `prefers-reduced-motion` switch it off in one rule.

## Motion

Entry and exit are declared, not scripted.

```css
@starting-style { .card { opacity: 0; transform: translateY(24px) } }
@ending-style   { .card { opacity: 0; transform: translateX(-40px) } }
```

`@starting-style` is the browser's own entry at-rule. `@ending-style` is DSX's exit
counterpart, which CSS has never had: the runtime holds the element in the tree until the
pose settles, then removes it. The `enter=` and `transition=` attributes are the shorthand
for the same engine, and an explicit at-rule beats the shorthand.

`/motion` is a live demo of both.

## The same files run natively

Nothing here is web only. The same `.dsx` documents render on iOS and Android through the
native runtime, which is the point of the format: one grammar, one project, every target.

---

Copyright Despia LLC-FZ. All rights reserved.
