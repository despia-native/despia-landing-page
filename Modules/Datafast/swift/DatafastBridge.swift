//
//  DatafastBridge.swift
//  Modules/Datafast - the iOS lane.
//
//  The browser lane loads datafa.st's own script, because that script does a pile of things
//  that only exist in a document. None of them exist here, so this lane is not a degraded copy
//  of it: it speaks the ingest protocol directly, which is what the script itself ends up doing.
//
//  One POST of JSON per event to `/api/events`, carrying the same envelope the script sends:
//  the website id, the current href, the visitor and session identity, locale and screen facts,
//  and an `extraData` bag whose shape depends on the event type. The identity is the part that
//  matters most - a visitor id that survives relaunches is what makes a phone a returning
//  visitor rather than a new one every cold start - so it is persisted, with the same lifetimes
//  the script gives its cookies: a year for the visitor, thirty idle minutes for the session.
//

import Foundation
#if canImport(UIKit)
import UIKit
#endif

final class DatafastBridge: Module {

    private static let visitorTTL: TimeInterval = 365 * 86_400
    private static let sessionTTL: TimeInterval = 30 * 60
    private static let pageviewThrottle: TimeInterval = 60

    private var lastPageview: (href: String, at: TimeInterval) = ("", 0)

    override func setup() {
        dsx.action("goal")     { [self] ctx in self.goal(ctx) }
        dsx.action("pageview") { [self] ctx in self.pageview(ctx) }
        dsx.action("identify") { [self] ctx in self.identify(ctx) }
        dsx.action("payment")  { [self] ctx in self.payment(ctx) }
        publish()
    }

    // MARK: - identity

    /// The visitor id, minted once and kept for a year. Refreshed on read so an active visitor
    /// never ages out mid-use, exactly as the script's cookie refresh does.
    private var visitorId: String {
        let now = Date().timeIntervalSince1970
        if let id = dsx.container.string("visitorId"), !id.isEmpty,
           now - dsx.container.double("visitorIdAt") < Self.visitorTTL {
            dsx.container.set("visitorIdAt", now)
            return id
        }
        let id = UUID().uuidString.lowercased()
        dsx.container.set("visitorId", id)
        dsx.container.set("visitorIdAt", now)
        dsx.container.set("visitorFirstSeenAt", ISO8601DateFormatter().string(from: Date()))
        dsx.container.set("sessionCount", 0)   // a new visitor starts its session count over
        return id
    }

    /// The session id. Thirty idle minutes ends a session, and the next event starts a new one
    /// AND increments the visitor's session number, which is how datafa.st counts returns.
    private var sessionId: String {
        let now = Date().timeIntervalSince1970
        if let id = dsx.container.string("sessionId"), !id.isEmpty,
           now - dsx.container.double("sessionIdAt") < Self.sessionTTL {
            dsx.container.set("sessionIdAt", now)
            return id
        }
        let id = "s" + UUID().uuidString.lowercased()
        dsx.container.set("sessionId", id)
        dsx.container.set("sessionIdAt", now)
        dsx.container.set("sessionCount", dsx.container.int("sessionCount") + 1)
        return id
    }

    // MARK: - the envelope

    /// datafa.st's custom-data rules, identical on every lane: at most ten keys, a key of
    /// lowercase letters, digits, underscore or hyphen up to 32 characters, and a value
    /// stringified and truncated to 255.
    private func sanitize(_ raw: Any?) -> [String: Any] {
        guard let dict = raw as? [String: Any] else { return [:] }
        var out: [String: Any] = [:]
        for (key, value) in dict {
            if out.count >= 10 { break }
            let name = key.lowercased()
            guard !name.isEmpty, name.count <= 32,
                  name.allSatisfy({ $0.isNumber || ($0.isLowercase && $0.isLetter) || $0 == "_" || $0 == "-" })
            else { continue }
            out[name] = String(String(describing: value).prefix(255))
        }
        return out
    }

    private func envelope(type: String, href: String?, extra: [String: Any]) -> [String: Any] {
        let websiteId = dsx.config.websiteId.string ?? ""
        let domain = dsx.config.domain.string ?? ""
        var body: [String: Any] = [
            "type": type,
            "websiteId": websiteId,
            "domain": domain,
            "href": href ?? "https://\(domain)/",
            "referrer": NSNull(),
            "visitorId": visitorId,
            "sessionId": sessionId,
            "visitorFirstSeenAt": dsx.container.string("visitorFirstSeenAt")
                ?? ISO8601DateFormatter().string(from: Date()),
            "visitorSessionNumber": max(1, dsx.container.int("sessionCount")),
            "language": Locale.preferredLanguages.first ?? "",
            "timezone": TimeZone.current.identifier,
        ]
        #if canImport(UIKit)
        let screen = UIScreen.main.bounds.size
        body["screenWidth"] = Int(screen.width)
        body["screenHeight"] = Int(screen.height)
        body["viewport"] = ["width": Int(screen.width), "height": Int(screen.height)]
        #else
        body["screenWidth"] = 0
        body["screenHeight"] = 0
        body["viewport"] = ["width": 0, "height": 0]
        #endif
        if !extra.isEmpty { body["extraData"] = extra }
        return body
    }

    // MARK: - actions

    private func goal(_ ctx: Context) {
        let name = ((ctx.args("name") as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty {
            ctx.fail("bad_event", "A goal needs a name.", false); return
        }
        if name == "payment" || name == "identify" {
            ctx.fail("bad_event", "\"\(name)\" is reserved by datafa.st; call the action of that name.", false)
            return
        }
        var extra = sanitize(ctx.args("data"))
        extra["eventName"] = name
        post(envelope(type: "custom", href: nil, extra: extra))
        ctx.resolve(JSON(["sent": true, "visitorId": visitorId]))
    }

    private func pageview(_ ctx: Context) {
        let domain = dsx.config.domain.string ?? ""
        let path = (ctx.args("path") as? String) ?? "/"
        let href = path.hasPrefix("http") ? path : "https://\(domain)\(path.hasPrefix("/") ? path : "/" + path)"
        // The script drops a repeat of the same URL inside a minute; a screen that re-appears on
        // every tab switch would otherwise inflate the count.
        let now = Date().timeIntervalSince1970
        if lastPageview.href == href, now - lastPageview.at < Self.pageviewThrottle {
            ctx.resolve(JSON(["sent": false])); return
        }
        lastPageview = (href, now)
        post(envelope(type: "pageview", href: href, extra: [:]))
        ctx.resolve(JSON(["sent": true]))
    }

    private func identify(_ ctx: Context) {
        let userId = ((ctx.args("userId") as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if userId.isEmpty {
            ctx.fail("bad_identity", "Identifying a visitor needs a user id.", false); return
        }
        var extra = sanitize(ctx.args("data"))
        extra["user_id"] = userId
        extra["name"] = (ctx.args("name") as? String) ?? ""
        extra["image"] = (ctx.args("image") as? String) ?? ""
        post(envelope(type: "identify", href: nil, extra: extra))
        ctx.resolve(JSON(["sent": true, "visitorId": visitorId]))
    }

    private func payment(_ ctx: Context) {
        let email = ((ctx.args("email") as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if email.isEmpty {
            ctx.fail("bad_payment", "A payment needs an email.", false); return
        }
        post(envelope(type: "payment", href: nil, extra: ["email": email]))
        ctx.resolve(JSON(["sent": true]))
    }

    @discardableResult
    private func publish() -> Bool {
        let ready = !(dsx.config.websiteId.string ?? "").isEmpty
        dsx.context.set("ready", ready)
        dsx.context.set("visitorId", dsx.container.string("visitorId") ?? "")
        dsx.context.set("sessionId", dsx.container.string("sessionId") ?? "")
        return ready
    }

    /// Fire and forget. An analytics beacon that blocks a tap is worse than a lost event, and a
    /// failed report is not the app's problem.
    ///
    /// ORIGIN IS REQUIRED, and this is the whole reason this lane works. The ingest endpoint
    /// screens callers before it even looks the website id up: without an `Origin` header it
    /// answers 403 "Invalid request" to a perfectly formed envelope, which would have made
    /// every native event vanish while this code cheerfully reported success. Measured against
    /// the live endpoint. The User-Agent needs nothing: URLSession's own default passes the
    /// same screen, so nothing here pretends to be a browser.
    ///
    /// The status is not swallowed either. A rejection is logged and published, because
    /// analytics that fail silently are worse than analytics that are missing - one you can
    /// see, the other you trust wrongly for a quarter.
    private func post(_ body: [String: Any]) {
        let endpoint = dsx.config.endpoint.string ?? "https://datafa.st/api/events"
        let domain = dsx.config.domain.string ?? ""
        guard !(dsx.config.websiteId.string ?? "").isEmpty,
              let url = URL(string: endpoint),
              let data = try? JSONSerialization.data(withJSONObject: body) else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("https://\(domain)", forHTTPHeaderField: "Origin")
        request.httpBody = data
        request.timeoutInterval = 10
        let type = (body["type"] as? String) ?? "event"
        URLSession.shared.dataTask(with: request) { [weak self] _, response, error in
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard let self else { return }
            if let error {
                self.dsx.log("datafast: \(type) not sent -", error.localizedDescription)
            } else if status != 200 {
                self.dsx.log("datafast: \(type) rejected with HTTP \(status)")
            }
            self.dsx.context.set("lastStatus", status)
        }.resume()
        publish()
    }
}
