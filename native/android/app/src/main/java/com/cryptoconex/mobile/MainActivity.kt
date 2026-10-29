package com.cryptoconex.mobile

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.cryptoconex.mobile.service.SocketManager
import com.cryptoconex.mobile.service.SupportForegroundService
import java.util.UUID

/**
 * Tela única: apenas um botão central "CONECTAR".
 * Ao tocar: solicita permissões (acessibilidade + captura) e inicia o suporte.
 */
class MainActivity : AppCompatActivity() {

    private val REQ_PROJECTION = 1001

    private val deviceId: String by lazy {
        val prefs = getSharedPreferences("cc", Context.MODE_PRIVATE)
        prefs.getString("device_id", null) ?: UUID.randomUUID().toString().also {
            prefs.edit().putString("device_id", it).apply()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        findViewById<Button>(R.id.btnConnect).setOnClickListener {
            if (!isAccessibilityEnabled()) {
                Toast.makeText(this, "Ative a Acessibilidade do Crypto Conex", Toast.LENGTH_LONG).show()
                startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
                return@setOnClickListener
            }
            if (!Settings.canDrawOverlays(this)) {
                startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
                return@setOnClickListener
            }
            requestScreenCapture()
        }
    }

    private fun requestScreenCapture() {
        val mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        startActivityForResult(mpm.createScreenCaptureIntent(), REQ_PROJECTION)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_PROJECTION && resultCode == Activity.RESULT_OK && data != null) {
            SocketManager.connect(deviceId)
            val svc = Intent(this, SupportForegroundService::class.java).apply {
                putExtra(SupportForegroundService.EXTRA_RESULT_CODE, resultCode)
                putExtra(SupportForegroundService.EXTRA_RESULT_DATA, data)
            }
            startForegroundService(svc)
            Toast.makeText(this, "Conectado! Um técnico irá ajudá-lo.", Toast.LENGTH_LONG).show()
        }
    }

    private fun isAccessibilityEnabled(): Boolean {
        val enabled = Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
        return enabled.contains("$packageName/.service.CryptoConexAccessibilityService")
    }
}
