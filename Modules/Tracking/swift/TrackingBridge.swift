//
//  TrackingBridge.swift
//  despia.com - Modules/Tracking
//
//  The iOS lane. Same three actions as the browser, reached the way a phone can reach them.
//
//  The browser lane loads each vendor's CDN script because those vendors want to run in a
//  document: they set first-party cookies and read the referrer. None of that exists here, so
//  this lane does not pretend to load JavaScript. It reports over HTTP instead, which is the
//  same thing the vendor's script would eventually do, minus the document.
//
//  WHAT IS FULL, AND WHAT IS NAMED (constitution, Article 10):
//    - datafa.st is FULL: its ingest endpoint takes the website id directly, so a goal from a
//      phone is the same event as a goal from the page.
//    - The affiliate referral is FULL: `?via=` arrives on the deep link that opened the app
//      (or the install referrer), is persisted for the same cookie window, and rides every goal.
//    - Google Analytics, the X pixel and Intercom are PLATFORM-LIMITED here. Each needs a
//      server-side credential (a Measurement Protocol api_secret, a conversion-API bearer
//      token, an Intercom identity HMAC) and a client must never carry one. Configure
//      `collectorUrl` and the goal is forwarded to your own endpoint, which holds those
//      secrets and fans out server-side. Unconfigured, those three are simply not reported
//      from a phone, and `delivered` says so honestly rather than counting a call nobody made.
//

import Foundation

final class TrackingBridge: Module {

    /// The container scopes by scheme, so these are `tracking.referral` on disk - the same
    /// key the Kotlin twin writes.
    private var referral: String {
        get { dsx.container.string("referral") ?? "" }
        set {
            dsx.container.set("referral", newValue)
            dsx.container.set("referralAt", Date().timeIntervalSince1970)
        }
    }

    override func setup() {
        // A referred install opens on a link carrying `?via=`. Claiming the open lets the code
        // be recorded before any screen asks for it.
        dsx.delegate.listen("lifecycle.openURL") { [weak self] input in
            guard let d = input as? [String: Any], let url = d["url"] as? URL else { return nil }
            self?.capture(url.absoluteString)
            return nil   // observed, never consumed: the link still belongs to whoever it is for
        }

        dsx.action("goal")     { [self] dsx in self.goal(dsx) }
        dsx.action("referral") { [self] dsx in dsx.resolve(self.publish()) }
        dsx.action("identify") { [self] dsx in self.identify(dsx) }

        publish()
    }

    /// `?via=<code>` off an inbound link. A fresh click is a fresh attribution, so a present
    /// code always wins over a remembered one.
    private func capture(_ raw: String) {
        guard let comps = URLComponents(string: raw),
              let code = comps.queryItems?.first(where: { $0.name == "via" })?.value,
              !code.isEmpty else { return }
        referral = code
        publish()
        dsx.broadcast("referred", JSON(["code": code]))
    }

    /// The remembered code, or empty once the cookie window has closed.
    private func liveReferral() -> String {
        let code = referral
        if code.isEmpty { return "" }
        let days = dsx.config.affonsoCookieDays.double ?? 30
        let at = dsx.container.double("referralAt")
        if at > 0, Date().timeIntervalSince1970 - at > days * 86_400 { return "" }
        return code
    }

    private func goal(_ ctx: Context) {
        let name = ((ctx.args("name") as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty {
            ctx.fail("bad_goal", message: "A goal needs a name.", recoverable: false)
            return
        }
        let code = liveReferral()
        var delivered = 0

        let websiteId = dsx.config.datafastWebsiteId.string
        if !websiteId.isEmpty {
            post("https://datafa.st/api/events", [
                "websiteId": websiteId,
                "domain": dsx.config.datafastDomain.string,
                "goal": name,
                "referral": code,
            ])
            delivered += 1
        }

        // The vendors that need a server-held secret ride the app's own collector, when there
        // is one. This is the whole native story for GA, the X pixel and Intercom.
        let collector = dsx.config.collectorUrl.string
        if !collector.isEmpty {
            post(collector, ["goal": name, "referral": code, "platform": "ios"])
            delivered += 1
        }

        ctx.broadcast("goal", JSON(["name": name, "delivered": delivered, "referral": code]))
        ctx.resolve(JSON(["delivered": delivered, "referral": code]))
    }

    private func identify(_ ctx: Context) {
        let userId = ((ctx.args("userId") as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if userId.isEmpty {
            ctx.fail("bad_identity", message: "Identifying a visitor needs a user id.", recoverable: false)
            return
        }
        let code = liveReferral()
        var identified = false
        let collector = dsx.config.collectorUrl.string
        if !collector.isEmpty {
            post(collector, [
                "identify": userId,
                "email": (ctx.args("email") as? String) ?? "",
                "name": (ctx.args("name") as? String) ?? "",
                "createdAt": (ctx.args("createdAt") as? String) ?? "",
                "referral": code,
                "platform": "ios",
            ])
            identified = true
        }
        dsx.context.set("visitorId", userId)
        ctx.broadcast("identified", JSON(["userId": userId, "referral": code]))
        ctx.resolve(JSON(["identified": identified, "referral": code]))
    }

    @discardableResult
    private func publish() -> JSON {
        let code = liveReferral()
        let ready = !dsx.config.datafastWebsiteId.string.isEmpty
            || !dsx.config.collectorUrl.string.isEmpty
        dsx.context.set("referral", code)
        dsx.context.set("ready", ready)
        return JSON(["code": code, "stored": !code.isEmpty])
    }

    /// Fire and forget, exactly like the browser beacon: a blocked or slow tracker must never
    /// hold up the tap that caused it, and a failed report is not the app's problem.
    private func post(_ urlString: String, _ body: [String: Any]) {
        guard let url = URL(string: urlString),
              let data = try? JSONSerialization.data(withJSONObject: body) else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = data
        request.timeoutInterval = 10
        URLSession.shared.dataTask(with: request).resume()
    }
}
