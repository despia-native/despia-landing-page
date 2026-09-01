//
//  Tracking - the browser lane.
//
//  These vendors ship as CDN JavaScript and expect to run in a document: they set first-party
//  cookies, read the referrer, and de-duplicate visitors across sessions. So the browser lane
//  does the honest thing and loads their real scripts, rather than reimplementing their wire
//  formats badly. That is the point of a lane: the browser gets the browser answer.
//
//  The native lanes cannot do this - a phone has no DOM to load a script into - so they reach
//  the same vendors over HTTP. The ACTIONS are identical on all three, which is the contract
//  markup binds against (constitution, Article 10).
//
//  Nothing here is hardcoded. Every id comes from config.json, and a blank id disables that
//  vendor rather than failing: a fork of this repo runs the site without reporting into our
//  accounts, and the site keeps working with every id blank.
//

const REFERRAL_KEY = "dsx.tracking.referral";
const REFERRAL_AT_KEY = "dsx.tracking.referral.at";

/** Load a third-party script once, keyed by src. Resolves either way: a blocked tracker
 *  (an ad blocker, a strict CSP, an offline first load) must never reject into a caller. */
const loaded = new Map();
function script(src, attrs = {}) {
  if (loaded.has(src)) return loaded.get(src);
  const p = new Promise((resolve) => {
    const el = document.createElement("script");
    el.async = true;
    for (const [k, v] of Object.entries(attrs)) {
      if (v === true) el.setAttribute(k, "");
      else if (v !== false && v != null && v !== "") el.setAttribute(k, String(v));
    }
    el.src = src;
    el.addEventListener("load", () => resolve(true), { once: true });
    el.addEventListener("error", () => resolve(false), { once: true });
    document.head.appendChild(el);
  });
  loaded.set(src, p);
  return p;
}

function store(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}
function read(key) {
  try { return localStorage.getItem(key) ?? ""; } catch { return ""; }
}

/** The affiliate code that brought this visitor in.
 *
 *  `?via=<code>` wins whenever it is present, because a fresh click is a fresh attribution.
 *  Otherwise the remembered code stands until the cookie window closes. Reading the URL on
 *  every call rather than only at boot is deliberate: this is a single-page app, so a visitor
 *  can arrive on a referred link during the session without a document load. */
function referralOf(cfg) {
  let code = "";
  try {
    code = new URL(location.href).searchParams.get("via") ?? "";
  } catch { code = ""; }
  if (code !== "") {
    store(REFERRAL_KEY, code);
    store(REFERRAL_AT_KEY, String(Date.now()));
    return { code, stored: read(REFERRAL_KEY) === code };
  }
  const remembered = read(REFERRAL_KEY);
  if (remembered === "") return { code: "", stored: false };
  const days = Number(cfg.affonsoCookieDays ?? 30);
  const at = Number(read(REFERRAL_AT_KEY) || 0);
  const expired = at > 0 && Number.isFinite(days) &&
    Date.now() - at > days * 24 * 60 * 60 * 1000;
  return expired ? { code: "", stored: false } : { code: remembered, stored: true };
}

// ── the vendors ──────────────────────────────────────────────────────────────
//
//  One function each, every one a no-op when its id is blank, every one returning whether it
//  actually reported. `goal` counts those answers so a caller can tell "nothing configured"
//  from "reported to three vendors" without knowing which vendors exist.

function datafast(cfg) {
  const id = String(cfg.datafastWebsiteId ?? "");
  if (id === "") return false;
  script(String(cfg.datafastScript ?? "/js/script.js"), {
    defer: true,
    "data-website-id": id,
    "data-domain": cfg.datafastDomain ?? location.hostname,
  });
  return true;
}

function affonso(cfg) {
  const id = String(cfg.affonsoProgramId ?? "");
  if (id === "") return false;
  script("https://affonso.io/js/affonso.js", {
    "data-affonso": id,
    "data-cookie-duration": String(cfg.affonsoCookieDays ?? 30),
  });
  return true;
}

function googleAnalytics(cfg) {
  const id = String(cfg.gaMeasurementId ?? "");
  if (id === "") return false;
  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag !== "function") {
    window.gtag = function gtag() { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", id);
  }
  script(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`);
  return true;
}

function xPixel(cfg) {
  const id = String(cfg.xPixelId ?? "");
  if (id === "") return false;
  if (typeof window.twq !== "function") {
    const q = function twq(...args) { q.exe ? q.exe.apply(q, args) : q.queue.push(args); };
    q.version = "1.1";
    q.queue = [];
    window.twq = q;
    script("https://static.ads-twitter.com/uwt.js");
  }
  window.twq("config", id);
  return true;
}

function promptWatch(cfg) {
  const id = String(cfg.promptWatchProjectId ?? "");
  if (id === "") return false;
  script("https://ingest.promptwatch.com/js/client.min.js", { "data-project-id": id });
  return true;
}

function intercom(cfg, visitor) {
  const id = String(cfg.intercomAppId ?? "");
  if (id === "") return false;
  if (typeof window.Intercom !== "function") {
    const stub = function Intercom(...args) { stub.q.push(args); };
    stub.q = [];
    window.Intercom = stub;
    script(`https://widget.intercom.io/widget/${encodeURIComponent(id)}`);
  }
  window.Intercom("boot", { api_base: "https://api-iam.intercom.io", app_id: id, ...visitor });
  return true;
}

export default {
  scheme: "tracking",
  state: { ready: false, referral: "", visitorId: "" },

  boot(dsx) {
    const cfg = dsx.config ?? {};
    // Attribution has to survive the first paint: a visitor who lands on a referred link and
    // taps a CTA before any lazy chunk resolves must still be attributed, which is why this
    // module declares web.boot.
    const { code } = referralOf(cfg);
    const started = [datafast, affonso, googleAnalytics, xPixel, promptWatch]
      .map((fn) => fn(cfg)).filter(Boolean).length;
    dsx.state.set("referral", code);
    dsx.state.set("ready", started > 0);
    if (code !== "") dsx.broadcast("referred", { code });
  },

  actions: {
    goal(ctx) {
      const cfg = ctx.dsx.config ?? {};
      const name = String(ctx.args("name") ?? "").trim();
      if (name === "") { ctx.fail("bad_goal", "A goal needs a name.", false); return null; }
      const value = ctx.args("value");
      const { code } = referralOf(cfg);
      let delivered = 0;

      // datafa.st is the primary goal sink; the script may not have resolved yet on a very
      // early tap, and a queued goal is worth more than a thrown one.
      if (typeof window.datafast === "function") { window.datafast(name); delivered++; }
      if (typeof window.gtag === "function") {
        window.gtag("event", name, value === undefined ? {} : { value });
        delivered++;
      }
      if (typeof window.twq === "function") { window.twq("event", name, {}); delivered++; }
      if (typeof window.Affonso === "object" && window.Affonso !== null &&
          typeof window.Affonso.track === "function") {
        window.Affonso.track(name); delivered++;
      }
      ctx.broadcast("goal", { name, delivered, referral: code });
      return { delivered, referral: code };
    },

    referral(ctx) {
      const { code, stored } = referralOf(ctx.dsx.config ?? {});
      ctx.dsx.state.set("referral", code);
      return { code, stored };
    },

    identify(ctx) {
      const cfg = ctx.dsx.config ?? {};
      const userId = String(ctx.args("userId") ?? "").trim();
      if (userId === "") { ctx.fail("bad_identity", "Identifying a visitor needs a user id.", false); return null; }
      const { code } = referralOf(cfg);
      const visitor = {
        user_id: userId,
        email: ctx.args("email") ?? undefined,
        name: ctx.args("name") ?? undefined,
        created_at: ctx.args("createdAt") ?? undefined,
      };
      let identified = intercom(cfg, visitor);
      if (typeof window.gtag === "function") {
        window.gtag("set", { user_id: userId });
        identified = true;
      }
      // The affiliate conversion: the code that brought them in, bound to who they became.
      if (typeof window.Affonso === "object" && window.Affonso !== null &&
          typeof window.Affonso.signup === "function" && code !== "") {
        window.Affonso.signup(ctx.args("email") ?? userId);
        identified = true;
      }
      ctx.dsx.state.set("visitorId", userId);
      ctx.broadcast("identified", { userId, referral: code });
      return { identified, referral: code };
    },
  },
};
