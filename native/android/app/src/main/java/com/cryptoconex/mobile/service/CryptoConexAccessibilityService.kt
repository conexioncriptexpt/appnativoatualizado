package com.cryptoconex.mobile.service

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.graphics.Rect
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject

/**
 * Serviço de acessibilidade do Crypto Conex.
 *  - Lê a hierarquia de nós da interface (UI Automator) para que o técnico possa descrever
 *    rótulos de botões e campos ao usuário que não consegue ler a tela.
 *  - Executa cliques e swipes por coordenadas (X, Y) enviadas pelo servidor.
 */
class CryptoConexAccessibilityService : AccessibilityService() {

    companion object {
        @Volatile var instance: CryptoConexAccessibilityService? = null
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Opcional: ao mudar a janela, reenviar a árvore automaticamente.
        if (event?.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            SocketManager.sendAccessibilityTree(dumpTree())
        }
    }

    override fun onInterrupt() {}

    override fun onDestroy() {
        instance = null
        super.onDestroy()
    }

    /** Percorre a árvore de nós ativos e devolve uma lista JSON para o painel. */
    fun dumpTree(): JSONArray {
        val arr = JSONArray()
        val root = rootInActiveWindow ?: return arr
        traverse(root, arr)
        return arr
    }

    private fun traverse(node: AccessibilityNodeInfo?, out: JSONArray) {
        if (node == null) return
        val bounds = Rect()
        node.getBoundsInScreen(bounds)
        if (bounds.width() > 0 && bounds.height() > 0) {
            val obj = JSONObject().apply {
                put("id", node.viewIdResourceName ?: "")
                put("className", node.className?.toString()?.substringAfterLast('.') ?: "view")
                put("text", node.text?.toString() ?: "")
                put("desc", node.contentDescription?.toString() ?: "")
                put("clickable", node.isClickable)
                put("cx", bounds.centerX())
                put("cy", bounds.centerY())
            }
            out.put(obj)
        }
        for (i in 0 until node.childCount) traverse(node.getChild(i), out)
    }

    /** Clique por coordenada (gesture dispatch). */
    fun tap(x: Int, y: Int) {
        val path = Path().apply { moveTo(x.toFloat(), y.toFloat()) }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 50))
            .build()
        dispatchGesture(gesture, null, null)
    }

    fun longPress(x: Int, y: Int) {
        val path = Path().apply { moveTo(x.toFloat(), y.toFloat()) }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 800))
            .build()
        dispatchGesture(gesture, null, null)
    }

    fun swipe(x1: Int, y1: Int, x2: Int, y2: Int, duration: Long = 300) {
        val path = Path().apply {
            moveTo(x1.toFloat(), y1.toFloat())
            lineTo(x2.toFloat(), y2.toFloat())
        }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, duration))
            .build()
        dispatchGesture(gesture, null, null)
    }

    fun pressBack() = performGlobalAction(GLOBAL_ACTION_BACK)
    fun pressHome() = performGlobalAction(GLOBAL_ACTION_HOME)

    /** Digita texto no campo em foco. */
    fun typeText(text: String) {
        val focused = findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: return
        val args = android.os.Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        }
        focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
    }

    /** Coordenadas: normalizadas (nx/ny 0..1, enviadas pelo ecrã do painel) ou píxeis absolutos (x/y). */
    private fun point(cmd: JSONObject, kx: String = "nx", ky: String = "ny", px: String = "x", py: String = "y"): Pair<Int, Int> {
        val m = android.util.DisplayMetrics()
        @Suppress("DEPRECATION")
        (getSystemService(WINDOW_SERVICE) as android.view.WindowManager).defaultDisplay.getRealMetrics(m)
        return if (cmd.has(kx)) {
            Pair((cmd.optDouble(kx) * m.widthPixels).toInt().coerceIn(0, m.widthPixels - 1),
                 (cmd.optDouble(ky) * m.heightPixels).toInt().coerceIn(0, m.heightPixels - 1))
        } else Pair(cmd.optInt(px), cmd.optInt(py))
    }

    /** Teclado do técnico: acrescenta texto, apaga ou confirma no campo em foco. */
    private fun keyInput(cmd: JSONObject) {
        val focused = findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: return
        val current = focused.text?.toString() ?: ""
        val newText = when {
            cmd.has("text") -> current + cmd.optString("text")
            cmd.optString("key") == "Backspace" -> current.dropLast(1)
            cmd.optString("key") == "Enter" && android.os.Build.VERSION.SDK_INT >= 30 -> {
                focused.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id)
                return
            }
            cmd.optString("key") == "Escape" -> { pressBack(); return }
            else -> return
        }
        val args = android.os.Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, newText)
        }
        focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
    }

    /** Executa um comando recebido do servidor. */
    fun handleCommand(cmd: JSONObject) {
        when (cmd.optString("type")) {
            "click" -> point(cmd).let { (x, y) -> tap(x, y) }
            "doubleclick" -> point(cmd).let { (x, y) -> tap(x, y); android.os.Handler(mainLooper).postDelayed({ tap(x, y) }, 120) }
            "longpress", "rightclick" -> point(cmd).let { (x, y) -> longPress(x, y) }
            "drag" -> {
                val (x1, y1) = point(cmd)
                val (x2, y2) = point(cmd, "nx2", "ny2", "x2", "y2")
                swipe(x1, y1, x2, y2, cmd.optLong("duration", 300).coerceIn(100, 2000))
            }
            "scroll" -> {
                val (x, y) = point(cmd)
                val h = (getSystemService(WINDOW_SERVICE) as android.view.WindowManager).let {
                    val m = android.util.DisplayMetrics()
                    @Suppress("DEPRECATION") it.defaultDisplay.getRealMetrics(m); m.heightPixels
                }
                val dist = (h * 0.25).toInt() * (if (cmd.optInt("delta") < 0) -1 else 1)
                swipe(x, y, x, (y + dist).coerceIn(1, h - 1), 250)
            }
            "key" -> keyInput(cmd)
            "type" -> typeText(cmd.optString("text"))
            "back" -> pressBack()
            "home" -> pressHome()
            "swipe" -> {
                val w = resources.displayMetrics.widthPixels
                val h = resources.displayMetrics.heightPixels
                when (cmd.optString("dir")) {
                    "up" -> swipe(w / 2, (h * 0.7).toInt(), w / 2, (h * 0.3).toInt())
                    "down" -> swipe(w / 2, (h * 0.3).toInt(), w / 2, (h * 0.7).toInt())
                    "left" -> swipe((w * 0.7).toInt(), h / 2, (w * 0.3).toInt(), h / 2)
                    "right" -> swipe((w * 0.3).toInt(), h / 2, (w * 0.7).toInt(), h / 2)
                }
            }
        }
    }
}
