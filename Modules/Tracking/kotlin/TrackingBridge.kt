//
//  TrackingBridge.kt
//  despia.com - Modules/Tracking
//
//  The Android lane, and the twin of swift/TrackingBridge.swift line for line.
//
//  Same reasoning as iOS: the browser lane loads each vendor's CDN script because those vendors
//  want a document to live in, and there is no document here. This lane reports over HTTP.
//
//  WHAT IS FULL, AND WHAT IS NAMED (constitution, Article 10):
//    - datafa.st is FULL: its ingest endpoint takes the website id, so a goal from a phone is
//      the same event as a goal from the page.
//    - The affiliate referral is FULL: `?via=` arrives on the deep link that opened the app,
//      is persisted for the same cookie window, and rides every goal.
//    - Google Analytics, the X pixel and Intercom are PLATFORM-LIMITED. Each needs a
//      server-held credential a client must never carry, so they are reported through the
//      app's own `collectorUrl` when one is configured, and not at all when none is. The
//      `delivered` count says which of the two happened rather than claiming a call nobody made.
//

package despia.modules.tracking

import android.net.Uri
import despia.engine.Context
import despia.engine.JSON
import despia.engine.Module
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

class TrackingBridge : Module() {

    /// The container scopes by scheme, so these are `tracking.referral` on disk - the same
    /// key the Swift twin writes.
    private var referral: String
        get() = dsx.container.string("referral") ?: ""
        set(value) {
            dsx.container.set("referral", value)
            dsx.container.set("referralAt", System.currentTimeMillis() / 1000.0)
        }

    override fun setup() {
        // A referred install opens on a link carrying `?via=`. Claiming the open lets the code
        // be recorded before any screen asks for it.
        dsx.delegate.listen("lifecycle.openURL") { input ->
            val uri = when (input) {
                is Uri -> input
                is String -> runCatching { Uri.parse(input) }.getOrNull()
                is Map<*, *> -> runCatching { Uri.parse(input["url"].toString()) }.getOrNull()
                else -> null
            }
            if (uri != null) capture(uri)
            null   // observed, never consumed: the link still belongs to whoever it is for
        }

        dsx.action("goal") { ctx -> goal(ctx) }
        dsx.action("referral") { ctx -> ctx.resolve(publish()) }
        dsx.action("identify") { ctx -> identify(ctx) }

        publish()
    }

    /// `?via=<code>` off an inbound link. A fresh click is a fresh attribution, so a present
    /// code always wins over a remembered one.
    private fun capture(uri: Uri) {
        val code = runCatching { uri.getQueryParameter("via") }.getOrNull() ?: return
        if (code.isEmpty()) return
        referral = code
        publish()
        dsx.broadcast("referred", JSON(mapOf("code" to code)))
    }

    /// The remembered code, or empty once the cookie window has closed.
    private fun liveReferral(): String {
        val code = referral
        if (code.isEmpty()) return ""
        val days = cfgDouble("affonsoCookieDays", 30.0)
        val at = dsx.container.double("referralAt")
        if (at > 0.0 && System.currentTimeMillis() / 1000.0 - at > days * 86_400.0) return ""
        return code
    }

    private fun goal(ctx: Context) {
        val name = ((ctx.args("name") as? String) ?: "").trim()
        if (name.isEmpty()) {
            ctx.fail("bad_goal", "A goal needs a name.", false)
            return
        }
        val code = liveReferral()
        var delivered = 0

        val websiteId = cfgString("datafastWebsiteId")
        if (websiteId.isNotEmpty()) {
            post(
                "https://datafa.st/api/events",
                mapOf(
                    "websiteId" to websiteId,
                    "domain" to cfgString("datafastDomain"),
                    "goal" to name,
                    "referral" to code,
                ),
            )
            delivered += 1
        }

        // The vendors that need a server-held secret ride the app's own collector, when there
        // is one. This is the whole native story for GA, the X pixel and Intercom.
        val collector = cfgString("collectorUrl")
        if (collector.isNotEmpty()) {
            post(collector, mapOf("goal" to name, "referral" to code, "platform" to "android"))
            delivered += 1
        }

        ctx.broadcast("goal", JSON(mapOf("name" to name, "delivered" to delivered, "referral" to code)))
        ctx.resolve(JSON(mapOf("delivered" to delivered, "referral" to code)))
    }

    private fun identify(ctx: Context) {
        val userId = ((ctx.args("userId") as? String) ?: "").trim()
        if (userId.isEmpty()) {
            ctx.fail("bad_identity", "Identifying a visitor needs a user id.", false)
            return
        }
        val code = liveReferral()
        var identified = false
        val collector = cfgString("collectorUrl")
        if (collector.isNotEmpty()) {
            post(
                collector,
                mapOf(
                    "identify" to userId,
                    "email" to ((ctx.args("email") as? String) ?: ""),
                    "name" to ((ctx.args("name") as? String) ?: ""),
                    "createdAt" to ((ctx.args("createdAt") as? String) ?: ""),
                    "referral" to code,
                    "platform" to "android",
                ),
            )
            identified = true
        }
        dsx.context.set("visitorId", userId)
        ctx.broadcast("identified", JSON(mapOf("userId" to userId, "referral" to code)))
        ctx.resolve(JSON(mapOf("identified" to identified, "referral" to code)))
    }

    private fun publish(): JSON {
        val code = liveReferral()
        val ready = cfgString("datafastWebsiteId").isNotEmpty() || cfgString("collectorUrl").isNotEmpty()
        dsx.context.set("referral", code)
        dsx.context.set("ready", ready)
        return JSON(mapOf("code" to code, "stored" to code.isNotEmpty()))
    }

    private fun cfgString(key: String): String {
        val v = dsx.config[key]
        return if (v.exists) v.value else ""
    }

    private fun cfgDouble(key: String, default: Double): Double {
        val v = dsx.config[key]
        return if (v.exists) v.double else default
    }

    /// Fire and forget, exactly like the browser beacon: a blocked or slow tracker must never
    /// hold up the tap that caused it, and a failed report is not the app's problem.
    private fun post(urlString: String, body: Map<String, Any?>) {
        thread(isDaemon = true) {
            runCatching {
                val connection = URL(urlString).openConnection() as HttpURLConnection
                connection.requestMethod = "POST"
                connection.setRequestProperty("Content-Type", "application/json")
                connection.doOutput = true
                connection.connectTimeout = 10_000
                connection.readTimeout = 10_000
                OutputStreamWriter(connection.outputStream).use { it.write(JSON(body).toString()) }
                connection.responseCode
                connection.disconnect()
            }
        }
    }
}
