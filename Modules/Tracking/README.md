# Tracking

Analytics and affiliate attribution for despia.com, as one module instead of six script tags.

## Why this is a module

Six vendors want to run on this site: datafa.st, Affonso, Google Analytics, the X pixel,
PromptWatch and Intercom. Every one of them ships as CDN JavaScript, and the obvious thing to
do is paste six snippets into the page head.

That works exactly once, on one platform. The same site runs as an iOS app and an Android app
through the native runtime, and neither has a document to paste a script into. Pasted snippets
would make the web build the only build that reports anything.

So the vendors live behind three actions instead, and each platform answers them the way that
platform can. Markup calls `dsx.module.tracking.goal(...)` and never learns which platform it
is on, which is the whole point of the format.

Nothing about affiliate tracking belongs in a framework. This is an app-level concern for one
app, which is why it is a module in this repo rather than anything shipped by DSX.

## The three lanes

| Lane | File | How it reaches the vendors |
|---|---|---|
| Web | `web/index.js` | Loads the real vendor scripts and calls their real APIs. They set first-party cookies and read the referrer, so a browser gets the browser answer. |
| iOS | `swift/TrackingBridge.swift` | No DOM, so it reports over HTTP. The referral arrives on the deep link that opened the app. |
| Android | `kotlin/TrackingBridge.kt` | The Swift lane's twin, line for line. |

The CLI assembles all of this. `dsx build` bundles the web lane into its own chunk and imports
it from the generated bootloader; `dsx export ios` adds the Swift file to a real Xcode project
and generates its registration; `dsx export android` does the same for Gradle. You maintain the
four files in this folder and nothing else.

## Actions

```js
dsx.module.tracking.goal({ name: 'nav_start_cta' })  // -> { delivered, referral }
dsx.module.tracking.referral()                       // -> { code, stored }
dsx.module.tracking.identify({ userId, email })      // -> { identified, referral }
```

Declared state, bindable straight from markup with no call in `on:appear`:

```
dsx.module.tracking.context.referral   // the affiliate code, "" for a direct visit
dsx.module.tracking.context.ready      // at least one vendor is configured
dsx.module.tracking.context.visitorId  // set once identify() has run
```

## Configuration

Every vendor id lives in `config.json`. None of them is a secret: they are public client-side
ids that ship in the page either way. **A blank id disables that vendor on every lane**, so a
fork of this repo runs the site without reporting into our accounts, and the site works with
every id blank.

`affonsoProgramId` is deliberately empty. Affiliate attribution is wired end to end (the `?via=`
code is captured, persisted for the cookie window, and rides every goal), and setting the
programme id is the only step left to switch it on.

## What is full on every platform, and what is not

Article 10 of the DSX constitution says a capability ships on every renderer: supported,
polyfilled, or platform-limited with a named degradation. For this module:

- **datafa.st is full on all three.** Its ingest endpoint takes the website id directly.
- **The affiliate referral is full on all three.** `?via=` on the web, the opening deep link
  natively, the same persistence window on each.
- **Google Analytics, the X pixel and Intercom are platform-limited on iOS and Android.** Each
  needs a server-held credential (a Measurement Protocol api_secret, a conversion-API token, an
  Intercom identity HMAC) and a client must never carry one. Set `collectorUrl` and goals are
  forwarded to your own endpoint, which holds those secrets and fans out server-side. Leave it
  unset and those three are simply not reported from a phone, and the `delivered` count says so
  rather than claiming a call nobody made.
