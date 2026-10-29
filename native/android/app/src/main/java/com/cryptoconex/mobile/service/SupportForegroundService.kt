package com.cryptoconex.mobile.service

import android.app.*
import android.content.Context
import android.content.Intent
import android.graphics.ImageFormat
import android.graphics.Rect
import android.graphics.YuvImage
import android.media.projection.MediaProjection
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Base64
import android.util.DisplayMetrics
import android.view.WindowManager
import androidx.core.app.NotificationCompat
import org.json.JSONObject
import org.webrtc.*
import java.io.ByteArrayOutputStream

/**
 * Foreground Service responsável por:
 *  - Manter a sessão viva (WakeLock + WifiLock) contra otimizações de bateria.
 *  - Capturar o ecrã (MediaProjection via ScreenCapturerAndroid) e enviá-lo por WebRTC
 *    (servidores TURN Metered). Enquanto o WebRTC não liga, envia frames JPEG por Socket.io.
 */
class SupportForegroundService : Service() {

    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null

    private var egl: EglBase? = null
    private var factory: PeerConnectionFactory? = null
    private var capturer: ScreenCapturerAndroid? = null
    private var surfaceHelper: SurfaceTextureHelper? = null
    private var videoSource: VideoSource? = null
    private var videoTrack: VideoTrack? = null
    private var peer: PeerConnection? = null
    private val pendingIce = mutableListOf<IceCandidate>()
    private var remoteSet = false
    @Volatile private var rtcConnected = false

    private var lastJpeg = 0L
    private val jpegFps = 8
    private val scale = 0.6

    companion object {
        const val CHANNEL_ID = "crypto_conex_support"
        const val EXTRA_RESULT_CODE = "result_code"
        const val EXTRA_RESULT_DATA = "result_data"
    }

    override fun onCreate() {
        super.onCreate()
        createChannel()
        startForeground(1, buildNotification())
        acquireLocks()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val data = intent?.getParcelableExtra<Intent>(EXTRA_RESULT_DATA) ?: return START_NOT_STICKY
        if (capturer == null) startCapture(data)
        return START_STICKY
    }

    private fun acquireLocks() {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "CryptoConex:Session").apply { acquire() }
        val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "CryptoConex:Wifi").apply { acquire() }
    }

    private fun startCapture(permissionData: Intent) {
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        (getSystemService(Context.WINDOW_SERVICE) as WindowManager).defaultDisplay.getRealMetrics(metrics)
        val width = (metrics.widthPixels * scale).toInt() / 2 * 2
        val height = (metrics.heightPixels * scale).toInt() / 2 * 2

        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(applicationContext).createInitializationOptions()
        )
        val eglBase = EglBase.create().also { egl = it }
        factory = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(eglBase.eglBaseContext, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(eglBase.eglBaseContext))
            .createPeerConnectionFactory()

        val source = factory!!.createVideoSource(true).also { videoSource = it }
        surfaceHelper = SurfaceTextureHelper.create("ScreenCapture", eglBase.eglBaseContext)
        capturer = ScreenCapturerAndroid(permissionData, object : MediaProjection.Callback() {
            override fun onStop() { stopSelf() }
        }).apply {
            initialize(surfaceHelper, applicationContext, source.capturerObserver)
            startCapture(width, height, 15)
        }
        videoTrack = factory!!.createVideoTrack("screen", source).apply {
            addSink { frame -> maybeSendJpeg(frame) }
        }

        SocketManager.onOperatorJoined = { createOffer() }
        SocketManager.onAnswer = { sdp -> setAnswer(sdp) }
        SocketManager.onRemoteIce = { c -> addRemoteIce(c) }
    }

    // ---------------------------------------------------------------- WebRTC
    private fun createOffer() {
        val f = factory ?: return
        peer?.close()
        rtcConnected = false
        remoteSet = false
        synchronized(pendingIce) { pendingIce.clear() }

        val servers = SocketManager.iceServers.map { s ->
            PeerConnection.IceServer.builder(s.getString("urls"))
                .setUsername(s.optString("username", ""))
                .setPassword(s.optString("credential", ""))
                .createIceServer()
        }
        val config = PeerConnection.RTCConfiguration(servers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }
        val pc = f.createPeerConnection(config, object : PeerObserver() {
            override fun onIceCandidate(c: IceCandidate) {
                SocketManager.sendIce(JSONObject().apply {
                    put("candidate", c.sdp)
                    put("sdpMid", c.sdpMid)
                    put("sdpMLineIndex", c.sdpMLineIndex)
                })
            }
            override fun onConnectionChange(newState: PeerConnection.PeerConnectionState) {
                rtcConnected = newState == PeerConnection.PeerConnectionState.CONNECTED
            }
        }) ?: return
        peer = pc
        pc.addTrack(videoTrack, listOf("screen"))
        pc.createOffer(object : SdpAdapter() {
            override fun onCreateSuccess(desc: SessionDescription) {
                pc.setLocalDescription(SdpAdapter(), desc)
                SocketManager.sendOffer(desc.description)
            }
        }, MediaConstraints())
    }

    private fun setAnswer(sdp: String) {
        val pc = peer ?: return
        pc.setRemoteDescription(object : SdpAdapter() {
            override fun onSetSuccess() {
                remoteSet = true
                synchronized(pendingIce) {
                    pendingIce.forEach { pc.addIceCandidate(it) }
                    pendingIce.clear()
                }
            }
        }, SessionDescription(SessionDescription.Type.ANSWER, sdp))
    }

    private fun addRemoteIce(c: JSONObject) {
        val cand = c.optString("candidate")
        if (cand.isNullOrEmpty()) return
        val ice = IceCandidate(c.optString("sdpMid", "0"), c.optInt("sdpMLineIndex", 0), cand)
        val pc = peer ?: return
        if (remoteSet) pc.addIceCandidate(ice) else synchronized(pendingIce) { pendingIce.add(ice) }
    }

    // ---------------------------------------------------- JPEG fallback (Socket.io)
    private fun maybeSendJpeg(frame: VideoFrame) {
        if (rtcConnected || SocketManager.sessionId == null) return
        val now = System.currentTimeMillis()
        if (now - lastJpeg < 1000L / jpegFps) return
        lastJpeg = now
        val i420 = frame.buffer.toI420() ?: return
        try {
            val w = i420.width / 2 * 2
            val h = i420.height / 2 * 2
            val nv21 = toNv21(i420, w, h)
            val out = ByteArrayOutputStream()
            YuvImage(nv21, ImageFormat.NV21, w, h, null).compressToJpeg(Rect(0, 0, w, h), 50, out)
            val b64 = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
            SocketManager.sendScreenPacket(JSONObject().apply { put("data", b64) })
        } finally {
            i420.release()
        }
    }

    private fun toNv21(b: VideoFrame.I420Buffer, w: Int, h: Int): ByteArray {
        val out = ByteArray(w * h * 3 / 2)
        val y = b.dataY; val u = b.dataU; val v = b.dataV
        for (row in 0 until h) {
            y.position(row * b.strideY)
            y.get(out, row * w, w)
        }
        var o = w * h
        for (row in 0 until h / 2) {
            for (col in 0 until w / 2) {
                out[o++] = v.get(row * b.strideV + col)
                out[o++] = u.get(row * b.strideU + col)
            }
        }
        return out
    }

    // ---------------------------------------------------------------- misc
    private fun buildNotification(): Notification =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Crypto Conex — Suporte ativo")
            .setContentText("Um técnico pode estar a ajudá-lo agora.")
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setOngoing(true)
            .build()

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(CHANNEL_ID, "Suporte Crypto Conex", NotificationManager.IMPORTANCE_LOW)
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(ch)
        }
    }

    override fun onDestroy() {
        SocketManager.onOperatorJoined = null
        SocketManager.onAnswer = null
        SocketManager.onRemoteIce = null
        wakeLock?.let { if (it.isHeld) it.release() }
        wifiLock?.let { if (it.isHeld) it.release() }
        peer?.close()
        try { capturer?.stopCapture() } catch (_: InterruptedException) {}
        capturer?.dispose()
        videoTrack?.dispose()
        videoSource?.dispose()
        surfaceHelper?.dispose()
        factory?.dispose()
        egl?.release()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}

/** Observer com implementações vazias — sobrepõe só o necessário. */
open class PeerObserver : PeerConnection.Observer {
    override fun onSignalingChange(state: PeerConnection.SignalingState) {}
    override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {}
    override fun onIceConnectionReceivingChange(receiving: Boolean) {}
    override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) {}
    override fun onIceCandidate(candidate: IceCandidate) {}
    override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) {}
    override fun onAddStream(stream: MediaStream) {}
    override fun onRemoveStream(stream: MediaStream) {}
    override fun onDataChannel(channel: DataChannel) {}
    override fun onRenegotiationNeeded() {}
}

open class SdpAdapter : SdpObserver {
    override fun onCreateSuccess(desc: SessionDescription) {}
    override fun onSetSuccess() {}
    override fun onCreateFailure(error: String?) {}
    override fun onSetFailure(error: String?) {}
}
