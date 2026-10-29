package com.cryptoconex.mobile.service

import android.app.*
import android.content.Context
import android.content.Intent
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Base64
import android.util.DisplayMetrics
import android.view.WindowManager
import androidx.core.app.NotificationCompat
import org.json.JSONObject
import java.nio.ByteBuffer

/**
 * Foreground Service responsável por:
 *  - Manter a sessão viva (WakeLock + WifiLock) contra otimizações de bateria.
 *  - Capturar a tela com MediaProjection e codificar em H.264 via MediaCodec,
 *    enviando os pacotes ao servidor (baixa latência).
 */
class SupportForegroundService : Service() {

    private var projection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var codec: MediaCodec? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null

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
        val resultCode = intent?.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED) ?: return START_NOT_STICKY
        val data = intent.getParcelableExtra<Intent>(EXTRA_RESULT_DATA) ?: return START_NOT_STICKY
        val mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        projection = mpm.getMediaProjection(resultCode, data)
        startScreenEncoding()
        return START_STICKY
    }

    private fun acquireLocks() {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "CryptoConex:Session").apply { acquire() }
        val wm = getSystemService(Context.WIFI_SERVICE) as WifiManager
        wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "CryptoConex:Wifi").apply { acquire() }
    }

    private fun startScreenEncoding() {
        val metrics = DisplayMetrics()
        (getSystemService(Context.WINDOW_SERVICE) as WindowManager).defaultDisplay.getRealMetrics(metrics)
        val width = metrics.widthPixels / 2 * 2
        val height = metrics.heightPixels / 2 * 2

        val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height).apply {
            setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
            setInteger(MediaFormat.KEY_BIT_RATE, 3_000_000)
            setInteger(MediaFormat.KEY_FRAME_RATE, 25)
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 2)
        }
        codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC).apply {
            configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        }
        val surface = codec!!.createInputSurface()
        codec!!.start()

        virtualDisplay = projection!!.createVirtualDisplay(
            "CryptoConexScreen", width, height, metrics.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, surface, null, null
        )
        drainEncoder()
    }

    private fun drainEncoder() {
        Thread {
            val info = MediaCodec.BufferInfo()
            while (codec != null) {
                val outIndex = codec!!.dequeueOutputBuffer(info, 10_000)
                if (outIndex >= 0) {
                    val buffer: ByteBuffer? = codec!!.getOutputBuffer(outIndex)
                    buffer?.let {
                        val bytes = ByteArray(info.size)
                        it.get(bytes)
                        val packet = JSONObject().apply {
                            put("type", "frame")
                            put("flags", info.flags)
                            put("pts", info.presentationTimeUs)
                            put("data", Base64.encodeToString(bytes, Base64.NO_WRAP))
                        }
                        SocketManager.sendScreenPacket(packet)
                    }
                    codec!!.releaseOutputBuffer(outIndex, false)
                }
            }
        }.start()
    }

    private fun buildNotification(): Notification =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Crypto Conex — Suporte ativo")
            .setContentText("Um técnico pode estar ajudando você agora.")
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
        wakeLock?.let { if (it.isHeld) it.release() }
        wifiLock?.let { if (it.isHeld) it.release() }
        virtualDisplay?.release()
        codec?.stop(); codec?.release(); codec = null
        projection?.stop()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
