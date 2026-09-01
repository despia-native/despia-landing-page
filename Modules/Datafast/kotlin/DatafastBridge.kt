//
//  DatafastBridge.kt
//  Modules/Datafast - the Android lane, and the twin of swift/DatafastBridge.swift.
//
//  Same reasoning as iOS: the browser lane loads datafa.st's own script because that script
//  does a pile of things that only exist in a document, and none of them exist here. So this
//  lane speaks the ingest protocol directly - one POST of JSON per event, carrying the same
//  envelope, with visitor and session identity persisted across launches on the same lifetimes
//  the script gives its cookies: a year for the visitor, thirty idle minutes for the session.
//

package despia.modules.datafast

import android.content.res.Resources
import despia.engine.Context
import despia.engine.JSON
import despia.engine.Module
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import kotlin.concurrent.thread

class DatafastBridge : Module() {

    private companion object {
        const val VISITOR_TTL = 365.0 * 86_400.0
        const val SESSION_TTL = 30.0 * 60.0
        const val PAGEVIEW_THROTTLE = 60.0
        const val MAX_CUSTOM_KEYS = 10
        const val MAX_VALUE_LENGTH = 255
    }

    private var lastPageviewHref = ""
    private var lastPageviewAt = 0.0

    override fun setup() {
        dsx.action("goal") { ctx -> goal(ctx) }
        dsx.action("pageview") { ctx -> pageview(ctx) }
        dsx.action("identify") { ctx -> identify(ctx) }
        dsx.action("payment") { ctx -> payment(ctx) }
        publish()
    }

    private fun now(): Double = System.currentTimeMillis() / 1000.0

    private fun iso(date: Date): String =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
            .apply { timeZone = TimeZone.getTimeZone("UTC") }
            .format(date)

    // MARK: - identity

    /// Minted once and kept for a year, refreshed on read so an active visitor never ages out
    /// mid-use - the script's cookie refresh, in a container.
    private fun visitorId(): String {
        val t = now()
        val existing = dsx.container.string("visitorId") ?: ""
        if (existing.isNotEmpty() && t - dsx.container.double("visitorIdAt") < VISITOR_TTL) {
            dsx.container.set("visitorIdAt", t)
            return existing
        }
        val id = UUID.randomUUID().toString().lowercase()
        dsx.container.set("visitorId", id)
        dsx.container.set("visitorIdAt", t)
        dsx.container.set("visitorFirstSeenAt", iso(Date()))
        dsx.container.set("sessionCount", 0)
        return id
    }

    /// Thirty idle minutes ends a session; the next event starts a new one and increments the
    /// visitor's session number, which is how datafa.st counts returns.
    private fun sessionId(): String {
        val t = now()
        val existing = dsx.container.string("sessionId") ?: ""
        if (existing.isNotEmpty() && t - dsx.container.double("sessionIdAt") < SESSION_TTL) {
            dsx.container.set("sessionIdAt", t)
            return existing
        }
        val id = "s" + UUID.randomUUID().toString().lowercase()
        dsx.container.set("sessionId", id)
        dsx.container.set("sessionIdAt", t)
        dsx.container.set("sessionCount", dsx.container.int("sessionCount") + 1)
        return id
    }

    // MARK: - the envelope

    /// datafa.st's custom-data rules, identical on every lane.
    private fun sanitize(raw: Any?): MutableMap<String, Any?> {
        val out = LinkedHashMap<String, Any?>()
        val dict = raw as? Map<*, *> ?: return out
        for ((key, value) in dict) {
            if (out.size >= MAX_CUSTOM_KEYS) break
            val name = key.toString().lowercase()
            if (name.isEmpty() || name.length > 32) continue
            if (!name.all { it.isDigit() || (it in 'a'..'z') || it == '_' || it == '-' }) continue
            out[name] = value.toString().take(MAX_VALUE_LENGTH)
        }
        return out
    }

    private fun envelope(type: String, href: String?, extra: Map<String, Any?>): Map<String, Any?> {
        val domain = cfg("domain")
        val metrics = Resources.getSystem().displayMetrics
        val body = linkedMapOf<String, Any?>(
            "type" to type,
            "websiteId" to cfg("websiteId"),
            "domain" to domain,
            "href" to (href ?: "https://$domain/"),
            "referrer" to null,
            "visitorId" to visitorId(),
            "sessionId" to sessionId(),
            "visitorFirstSeenAt" to (dsx.container.string("visitorFirstSeenAt") ?: iso(Date())),
            "visitorSessionNumber" to maxOf(1, dsx.container.int("sessionCount")),
            "language" to Locale.getDefault().toLanguageTag(),
            "timezone" to TimeZone.getDefault().id,
            "screenWidth" to metrics.widthPixels,
            "screenHeight" to metrics.heightPixels,
            "viewport" to mapOf("width" to metrics.widthPixels, "height" to metrics.heightPixels),
        )
        if (extra.isNotEmpty()) body["extraData"] = extra
        return body
    }

    // MARK: - actions

    private fun goal(ctx: Context) {
        val name = ((ctx.args("name") as? String) ?: "").trim()
        if (name.isEmpty()) {
            ctx.fail("bad_event", "A goal needs a name.", false); return
        }
        if (name == "payment" || name == "identify") {
            ctx.fail("bad_event", "\"$name\" is reserved by datafa.st; call the action of that name.", false)
            return
        }
        val extra = sanitize(ctx.args("data"))
        extra["eventName"] = name
        post(envelope("custom", null, extra))
        ctx.resolve(JSON(mapOf("sent" to true, "visitorId" to visitorId())))
    }

    private fun pageview(ctx: Context) {
        val domain = cfg("domain")
        val path = (ctx.args("path") as? String) ?: "/"
        val href = if (path.startsWith("http")) path
        else "https://$domain" + (if (path.startsWith("/")) path else "/$path")
        // The script drops a repeat of the same URL inside a minute; a screen that re-appears on
        // every tab switch would otherwise inflate the count.
        val t = now()
        if (lastPageviewHref == href && t - lastPageviewAt < PAGEVIEW_THROTTLE) {
            ctx.resolve(JSON(mapOf("sent" to false))); return
        }
        lastPageviewHref = href
        lastPageviewAt = t
        post(envelope("pageview", href, emptyMap()))
        ctx.resolve(JSON(mapOf("sent" to true)))
    }

    private fun identify(ctx: Context) {
        val userId = ((ctx.args("userId") as? String) ?: "").trim()
        if (userId.isEmpty()) {
            ctx.fail("bad_identity", "Identifying a visitor needs a user id.", false); return
        }
        val extra = sanitize(ctx.args("data"))
        extra["user_id"] = userId
        extra["name"] = (ctx.args("name") as? String) ?: ""
        extra["image"] = (ctx.args("image") as? String) ?: ""
        post(envelope("identify", null, extra))
        ctx.resolve(JSON(mapOf("sent" to true, "visitorId" to visitorId())))
    }

    private fun payment(ctx: Context) {
        val email = ((ctx.args("email") as? String) ?: "").trim()
        if (email.isEmpty()) {
            ctx.fail("bad_payment", "A payment needs an email.", false); return
        }
        post(envelope("payment", null, mapOf("email" to email)))
        ctx.resolve(JSON(mapOf("sent" to true)))
    }

    private fun publish(): Boolean {
        val ready = cfg("websiteId").isNotEmpty()
        dsx.context.set("ready", ready)
        dsx.context.set("visitorId", dsx.container.string("visitorId") ?: "")
        dsx.context.set("sessionId", dsx.container.string("sessionId") ?: "")
        return ready
    }

    private fun cfg(key: String): String {
        val v = dsx.config[key]
        return if (v.exists) v.value else ""
    }

    /// Fire and forget. An analytics beacon that blocks a tap is worse than a lost event, and a
    /// failed report is not the app's problem.
    ///
    /// ORIGIN IS REQUIRED, and this is the whole reason this lane works. The ingest endpoint
    /// screens callers before it even looks the website id up: without an `Origin` header it
    /// answers 403 "Invalid request" to a perfectly formed envelope, which would have made
    /// every native event vanish while this code cheerfully reported success. Measured against
    /// the live endpoint. The User-Agent needs nothing: the platform default passes the same
    /// screen, so nothing here pretends to be a browser.
    ///
    /// The status is not swallowed either. A rejection is logged and published, because
    /// analytics that fail silently are worse than analytics that are missing - one you can
    /// see, the other you trust wrongly for a quarter.
    private fun post(body: Map<String, Any?>) {
        val endpoint = cfg("endpoint").ifEmpty { "https://datafa.st/api/events" }
        if (cfg("websiteId").isEmpty()) return
        val type = (body["type"] as? String) ?: "event"
        val domain = cfg("domain")
        thread(isDaemon = true) {
            val status = runCatching {
                val connection = URL(endpoint).openConnection() as HttpURLConnection
                connection.requestMethod = "POST"
                connection.setRequestProperty("Content-Type", "application/json")
                connection.setRequestProperty("Origin", "https://$domain")
                connection.doOutput = true
                connection.connectTimeout = 10_000
                connection.readTimeout = 10_000
                OutputStreamWriter(connection.outputStream).use { it.write(JSON(body).toString()) }
                val code = connection.responseCode
                connection.disconnect()
                code
            }.getOrElse { error ->
                dsx.log("datafast: $type not sent -", error.message ?: "request failed")
                0
            }
            if (status != 200 && status != 0) dsx.log("datafast: $type rejected with HTTP $status")
            dsx.context.set("lastStatus", status)
        }
        publish()
    }
}
