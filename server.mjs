//
//  despia.com, served with live SSR.
//
//  `dsx build` already writes a fully server-rendered document per route, with each page's
//  <api> data resolved into it (dsx.config.json sets "ssrSeed": true). That file is complete
//  and a CDN can serve it. Two things it cannot do on its own:
//
//    - a dynamic route (/mcp/:tool) has no file per tool, only one skeleton;
//    - its data is as fresh as the last build.
//
//  So when a server is present, the page handler renders each request live instead: the same
//  documents, the same seeding, resolved now. Static export stays the floor and this is the
//  ceiling, which is why both exist rather than one replacing the other.
//
//  It also restores the two FIRST-PARTY ANALYTICS paths. On our own domain they are a reverse
//  proxy, so an ad blocker or a third-party-cookie rule that would drop the vendor does not
//  drop us. A static host has nowhere to put a proxy, and the route table's redirect rows are
//  a meta-refresh page, which is not something a <script src> can execute. Here they proxy for
//  real, ahead of the site handler so they win over those rows.
//
//    node server.mjs            # PORT and DIST override the defaults
//

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createSiteHandler } from "@despia-native/server";

const PORT = Number(process.env.PORT ?? 8080);
const DIST = resolve(process.env.DIST ?? "dist");

/** The two paths datafa.st is served from under our own origin. Nothing else is proxied:
 *  an open forwarder is a liability, so this is a closed table, not a pattern. */
const PROXY = new Map([
  ["/js/script.js", "https://datafa.st/js/script.js"],
  ["/api/events", "https://datafa.st/api/events"],
]);

async function proxy(request, target) {
  const upstream = new URL(target);
  upstream.search = new URL(request.url).search;
  const headers = new Headers(request.headers);
  // The upstream must see its own host, and must not see ours as the forwarding hop.
  headers.delete("host");
  headers.delete("accept-encoding");
  // datafa.st attributes an event to the visitor, so the real client address has to survive
  // the hop or every visit is attributed to this server.
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded !== null) headers.set("x-forwarded-for", forwarded);
  const method = request.method.toUpperCase();
  const response = await fetch(upstream, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer(),
    redirect: "follow",
  });
  const out = new Headers(response.headers);
  out.delete("content-encoding");
  out.delete("content-length");
  return new Response(response.body, { status: response.status, headers: out });
}

const registry = JSON.parse(await readFile(resolve(DIST, "registry.json"), "utf8"));

/** The route table's redirect rows, as REAL status codes. The static export writes each one as
 *  a meta-refresh page, because that is the most a file can do; a server should answer with the
 *  status the table actually declares, so a crawler and a POST both see the truth. */
const REDIRECTS = new Map(
  (registry.routes ?? [])
    .filter((route) => typeof route.redirect === "string")
    .map((route) => [route.path.replace(/\/$/, "") || "/", { to: route.redirect, status: route.status ?? 302 }]),
);
const site = createSiteHandler(DIST, registry, {
  // A running server can always produce at least what the exported file holds, plus fresh
  // seeds, so the live render wins over the build-time one.
  preferLivePages: true,
  // A slow upstream must not hold a page open; past this the block falls back to the client
  // fetch it would have done anyway.
  ssrTimeoutMs: 2500,
});

createServer(async (req, res) => {
  const request = new Request(new URL(req.url, `http://${req.headers.host ?? "localhost"}`), {
    method: req.method,
    headers: req.headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : req,
    duplex: "half",
  });
  let response;
  try {
    const path = new URL(request.url).pathname.replace(/\/$/, "") || "/";
    const target = PROXY.get(path);
    const moved = REDIRECTS.get(path);
    response = target !== undefined ? await proxy(request, target)
      : moved !== undefined ? Response.redirect(moved.to, moved.status)
      : await site(request);
  } catch (error) {
    console.error("[despia.com]", error);
    response = new Response("Internal error", { status: 500 });
  }
  if (response === null) response = new Response("Not found", { status: 404 });
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(response.body === null ? undefined : Buffer.from(await response.arrayBuffer()));
}).listen(PORT, () => console.log(`despia.com on http://localhost:${PORT} (live SSR, dist=${DIST})`));
