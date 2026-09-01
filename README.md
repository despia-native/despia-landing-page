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

`npx dsx build` writes a static site to `dist/`. There is no server: every page, including
the redirects, is a file.

## What is where

| Path | What it is |
|---|---|
| `dsx.json` | the package manifest: name, scheme, platforms, and the `web.styles` list every page loads |
| `dsx.config.json` | the project contract: entry component, output directory, and the route table |
| `Components/*.dsx` | one file per component. Head block for the contract, body for markup |
| `Components/*.css` | one sidecar sheet per component, owner scoped at build time |
| `web/*.css` | the four project sheets: fonts, theme, colors, base |
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
