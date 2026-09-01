//
//  datafa.st - the browser lane.
//
//  This lane LOADS THE VENDOR SCRIPT rather than reimplementing it, and that is a decision
//  worth stating. The script does a long list of things that only make sense in a document:
//  it fires pageviews across history changes and throttles a repeat of the same URL within a
//  minute, binds click goals declared with `data-fast-goal`, watches scroll depth for
//  `data-fast-scroll`, reports outbound-link clicks, carries visitor and session identity in
//  first-party cookies, honours a `datafast_ignore` opt-out, and screens bots. Reimplementing
//  that on top of its own ingest endpoint would be a worse copy of something already loaded.
//
//  So the browser gets the browser answer. The phone lanes have no document to give it, and
//  speak the ingest protocol directly instead - the same four actions, the same endpoint.
//
//  Calls made before the script arrives are not lost: the vendor exposes a `q` array for
//  exactly this, and drains it on load.
//

const CUSTOM_KEY = /^[a-z0-9_-]{1,32}$/;
const MAX_CUSTOM_KEYS = 10;
const MAX_VALUE_LENGTH = 255;

/** datafa.st's own custom-data rules, applied here so a goal that is accepted on this lane is
 *  accepted on the others. Over-long values are truncated rather than rejected, which is what
 *  the vendor does; an invalid KEY is dropped, because silently renaming it would be worse. */
export function sanitize(data) {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return {};
  const out = {};
  let n = 0;
  for (const [key, value] of Object.entries(data)) {
    if (n >= MAX_CUSTOM_KEYS) break;
    const name = String(key).toLowerCase();
    if (!CUSTOM_KEY.test(name)) continue;
    out[name] = String(value ?? "").slice(0, MAX_VALUE_LENGTH);
    n++;
  }
  return out;
}

let loading = null;
function load(cfg, dsx) {
  if (loading !== null) return loading;
  const attrs = {
    defer: true,
    "data-website-id": String(cfg.websiteId ?? ""),
    "data-domain": String(cfg.domain ?? location.hostname),
  };
  const add = (src) => new Promise((resolve) => {
    const el = document.createElement("script");
    el.async = true;
    for (const [k, v] of Object.entries(attrs)) {
      if (v === true) el.setAttribute(k, "");
      else if (v !== "" && v != null) el.setAttribute(k, String(v));
    }
    el.src = src;
    el.addEventListener("load", () => resolve(true), { once: true });
    el.addEventListener("error", () => resolve(false), { once: true });
    document.head.appendChild(el);
  });

  const first = String(cfg.script ?? "");
  const origin = String(cfg.origin ?? "https://datafa.st/js/script.js");
  loading = (async () => {
    if (first !== "") {
      await add(first);
      // The check is BEHAVIOURAL, not transport. A host with no proxy answers that path with a
      // 200 and an HTML body, so the load event fires and the PARSE is what fails. What settles
      // it is whether the vendor's own global turned up.
      if (typeof window.datafast === "function") return publish(dsx);
    }
    await add(origin);
    return publish(dsx);
  })();
  return loading;
}

/** The identity the vendor script writes into first-party cookies, mirrored onto the declared
 *  plane so markup can bind it without reaching for document.cookie. */
function publish(dsx) {
  const read = (name) => {
    const hit = document.cookie.split("; ").find((row) => row.startsWith(name + "="));
    return hit === undefined ? "" : decodeURIComponent(hit.slice(name.length + 1));
  };
  dsx.state.set("visitorId", read("datafast_visitor_id"));
  dsx.state.set("sessionId", read("datafast_session_id"));
  return typeof window.datafast === "function";
}

/** Queue-safe send. The vendor drains `datafast.q` on load, so a tap during the first frame
 *  still lands rather than being dropped for arriving early. */
function send(name, payload) {
  if (typeof window.datafast === "function") {
    payload === undefined ? window.datafast(name) : window.datafast(name, payload);
    return true;
  }
  window.datafast = window.datafast || function queued(...args) { queued.q.push(args); };
  window.datafast.q = window.datafast.q || [];
  window.datafast.q.push(payload === undefined ? [name] : [name, payload]);
  return true;
}

export default {
  scheme: "datafast",
  state: { ready: false, visitorId: "", sessionId: "" },

  boot(dsx) {
    const cfg = dsx.config ?? {};
    if (String(cfg.websiteId ?? "") === "") return;   // inert, not broken
    dsx.state.set("ready", true);
    void load(cfg, dsx);
  },

  actions: {
    goal(ctx) {
      const name = String(ctx.args("name") ?? "").trim();
      if (name === "") { ctx.fail("bad_event", "A goal needs a name.", false); return null; }
      // "payment" and "identify" are RESERVED words in the vendor's entry function; a custom
      // goal that used one would be routed to the wrong branch and dropped for a missing field.
      if (name === "payment" || name === "identify") {
        ctx.fail("bad_event", `"${name}" is reserved by datafa.st; call the action of that name.`, false);
        return null;
      }
      const data = sanitize(ctx.args("data"));
      send(name, Object.keys(data).length > 0 ? data : undefined);
      return { sent: true, visitorId: String(ctx.dsx.state.get("visitorId") ?? "") };
    },

    pageview(ctx) {
      // The vendor script already fires pageviews on load and on history changes, and throttles
      // a repeat of the same URL within a minute. Asking for another one here would double-count
      // the view it just sent, so this lane reports what is true: it is handled.
      return { sent: typeof window.datafast === "function" };
    },

    identify(ctx) {
      const userId = String(ctx.args("userId") ?? "").trim();
      if (userId === "") { ctx.fail("bad_identity", "Identifying a visitor needs a user id.", false); return null; }
      send("identify", {
        user_id: userId,
        name: String(ctx.args("name") ?? ""),
        image: String(ctx.args("image") ?? ""),
        ...sanitize(ctx.args("data")),
      });
      return { sent: true, visitorId: String(ctx.dsx.state.get("visitorId") ?? "") };
    },

    payment(ctx) {
      const email = String(ctx.args("email") ?? "").trim();
      if (email === "") { ctx.fail("bad_payment", "A payment needs an email.", false); return null; }
      send("payment", { email });
      return { sent: true };
    },
  },
};
