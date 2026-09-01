# Datafast

[datafa.st](https://datafa.st) analytics, as a package. Four actions, three lanes, one contract.

```js
dsx.module.datafast.goal({ name: 'nav_start_cta' })          // -> { sent, visitorId }
dsx.module.datafast.goal({ name: 'signup', data: { plan: 'pro' } })
dsx.module.datafast.pageview({ path: '/pricing' })           // -> { sent }
dsx.module.datafast.identify({ userId, name, image })        // -> { sent, visitorId }
dsx.module.datafast.payment({ email })                       // -> { sent }
```

Declared state, bindable from markup:

```
dsx.module.datafast.context.ready       // a website id is configured
dsx.module.datafast.context.visitorId   // stable for a year
dsx.module.datafast.context.sessionId   // rolls over after 30 idle minutes
dsx.module.datafast.context.lastStatus  // HTTP status of the last native send
```

## Why the lanes differ

**The browser lane loads the vendor's own script.** That script does a long list of things that
only exist in a document: pageviews across history changes, throttled so the same URL inside a
minute is not double-counted; click goals declared with `data-fast-goal`; scroll goals with
`data-fast-scroll`; outbound-link tracking; first-party cookie identity; a `datafast_ignore`
opt-out; and bot screening. Reimplementing that on top of the ingest endpoint would be a worse
copy of something already loaded, so this lane calls the real API and mirrors its cookie
identity onto the declared plane.

A call made before the script arrives is not lost: the vendor exposes a queue for exactly this
and drains it on load.

**The native lanes speak the ingest protocol directly**, because a phone has no document to
load a script into. One POST of JSON per event to `/api/events`, carrying the envelope the
script sends: website id, href, visitor and session identity, locale, timezone, screen, and an
`extraData` bag whose shape depends on the event type.

Identity is the part that matters most. A visitor id that survives relaunches is what makes a
phone a returning visitor rather than a new one every cold start, so it is persisted with the
same lifetimes the script gives its cookies: a year for the visitor, thirty idle minutes for
the session, with the session counter incrementing on each new session.

## One thing worth knowing if you port this

**The ingest endpoint screens callers before it looks the website id up.** Without an `Origin`
header it answers `403 Invalid request` to a perfectly formed envelope. A native lane that
omits it sends events that vanish, while the code reports success, and you would not find out
until a quarter of native traffic was missing from the dashboard.

The `User-Agent` needs nothing: URLSession's and Dalvik's own defaults pass the same screen.
Nothing here pretends to be a browser.

Because a rejection is invisible by construction, the native lanes log a non-200 and publish it
as `context.lastStatus`. Analytics that fail silently are worse than analytics that are missing.

## Custom data

datafa.st caps custom data at 10 keys; a key is lowercase `a-z`, `0-9`, `_` or `-`, up to 32
characters; a value is stringified and truncated to 255. Every lane applies the same rules, so
a goal accepted in a browser is accepted on a phone. An invalid key is dropped rather than
renamed.

`payment` and `identify` are reserved words in the vendor's entry function. Calling
`goal({ name: 'payment' })` would be routed to the wrong branch and silently discarded, so it
is refused with `bad_event` and the dedicated action named instead.

## Configuration

`config.json`. The website id is public and ships in the page either way. **Blank it and the
package goes inert on every lane** rather than failing, so a fork of this repo does not report
into someone else's account.

`script` is a first-party path served by a reverse proxy, which is the point: a blocker that
would drop datafa.st does not drop us. `origin` is the fallback for a host with no proxy, and
the web lane switches to it only after checking whether the vendor's global actually turned up
(a host without a proxy answers that path with a 200 and an HTML body, so the load event fires
and the parse is what fails). `endpoint` is where the native lanes post; point it at your own
proxy to keep phone traffic first-party too.
