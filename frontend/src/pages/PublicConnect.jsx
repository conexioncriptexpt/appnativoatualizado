import { useEffect, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import {
  MonitorSmartphone, ShieldCheck, Download, Wifi, WifiOff,
  Loader2, CheckCircle2, Plus, Minus, Volume2, Apple,
} from "lucide-react";
import { createSocket } from "@/lib/socket";

const DEVICE_KEY = "cc_device_id";
function getDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = "web-" + crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export default function PublicConnect() {
  const [status, setStatus] = useState("idle"); // idle | connecting | connected | error
  const [sessionId, setSessionId] = useState(null);
  const [pin, setPin] = useState(null);
  const [fontScale, setFontScale] = useState(1);
  const [online, setOnline] = useState(false);

  const socketRef = useRef(null);
  const pcRef = useRef(null);
  const streamRef = useRef(null);
  const iceBuffer = useRef([]);
  const remoteSet = useRef(false);

  const speak = useCallback((text) => {
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "pt-BR";
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }, []);

  const cleanup = useCallback(() => {
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    if (pcRef.current) pcRef.current.close();
    if (socketRef.current) socketRef.current.disconnect();
    streamRef.current = null;
    pcRef.current = null;
    socketRef.current = null;
    remoteSet.current = false;
    iceBuffer.current = [];
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const buildPeer = useCallback((iceServers, sock, sid) => {
    const pc = new RTCPeerConnection({ iceServers });
    streamRef.current.getTracks().forEach((t) => pc.addTrack(t, streamRef.current));

    pc.onicecandidate = (e) => {
      if (e.candidate) sock.emit("rtc:ice", { session_id: sid, candidate: e.candidate });
    };
    pc.onconnectionstatechange = () => {
      if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
        // keep socket; WebRTC may renegotiate when operator rejoins
      }
    };
    return pc;
  }, []);

  const sendOffer = useCallback(async (sid) => {
    const pc = pcRef.current;
    if (!pc) return;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socketRef.current.emit("rtc:offer", { session_id: sid, sdp: pc.localDescription });
  }, []);

  const handleConnect = async () => {
    if (status === "connecting" || status === "connected") return;
    setStatus("connecting");
    speak("Iniciando conexão. Por favor, confirme o compartilhamento da sua tela.");
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 15 },
        audio: false,
      });
      streamRef.current = stream;
      // if user stops sharing from the browser bar
      stream.getVideoTracks()[0].addEventListener("ended", () => {
        toast.info("Compartilhamento encerrado.");
        cleanup();
        setStatus("idle");
        setSessionId(null);
        setPin(null);
      });

      const sock = createSocket();
      socketRef.current = sock;

      sock.on("connect", () => {
        setOnline(true);
        sock.emit("device:register", {
          device_id: getDeviceId(),
          platform: "web",
          name: "Navegador (" + (navigator.platform || "PC") + ")",
        });
      });
      sock.on("disconnect", () => setOnline(false));
      sock.io.on("reconnect", () => {
        setOnline(true);
        sock.emit("device:register", {
          device_id: getDeviceId(),
          platform: "web",
          name: "Navegador (" + (navigator.platform || "PC") + ")",
        });
      });

      sock.on("device:registered", ({ session_id, pin: p, iceServers }) => {
        setSessionId(session_id);
        setPin(p);
        setStatus("connected");
        speak("Conectado. Um técnico irá ajudá-lo em instantes.");
        pcRef.current = buildPeer(iceServers, sock, session_id);
      });

      // operator joined the room -> (re)send an offer so they receive the stream
      sock.on("operator:joined", async () => {
        if (!pcRef.current && streamRef.current) {
          // peer may have been reset; rebuild
        }
        await sendOffer(sessionIdRef.current);
        toast.success("Técnico conectado à sua tela.");
        speak("Técnico conectado. Ele já pode ver a sua tela para ajudá-lo.");
      });

      sock.on("rtc:answer", async ({ sdp }) => {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(sdp));
        remoteSet.current = true;
        for (const c of iceBuffer.current) await pcRef.current.addIceCandidate(c);
        iceBuffer.current = [];
      });

      sock.on("rtc:ice", async ({ candidate }) => {
        if (!candidate) return;
        if (remoteSet.current) await pcRef.current.addIceCandidate(candidate);
        else iceBuffer.current.push(candidate);
      });

      sock.on("command:receive", ({ command }) => {
        // On a browser we cannot inject OS events; show the guidance to the user.
        if (command?.type === "message") {
          toast.message("Mensagem do técnico", { description: command.text });
          speak(command.text);
        }
      });
    } catch (e) {
      console.error(e);
      setStatus("error");
      toast.error("Não foi possível iniciar o compartilhamento de tela.");
      speak("Não foi possível iniciar. Tente novamente.");
    }
  };

  // keep latest sessionId available inside socket callbacks
  const sessionIdRef = useRef(null);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  const disconnect = () => {
    cleanup();
    setStatus("idle");
    setSessionId(null);
    setPin(null);
    toast.info("Sessão encerrada.");
  };

  const downloadInfo = (plat) => {
    toast.message(`Aplicativo ${plat}`, {
      description:
        "O instalador nativo estará disponível no repositório GitHub do projeto. O código-fonte completo já acompanha esta entrega.",
      duration: 6000,
    });
  };

  return (
    <div
      className="min-h-screen bg-[#FAFAFD] text-[#0F172A] flex flex-col"
      style={{ fontSize: `${fontScale}rem` }}
    >
      {/* Header */}
      <header className="w-full border-b-2 border-slate-900/10 bg-white">
        <div className="max-w-5xl mx-auto px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl bg-[#0D5C75] flex items-center justify-center text-white">
              <MonitorSmartphone size={24} />
            </div>
            <div>
              <div className="font-display font-extrabold text-xl tracking-tight leading-none">Crypto Conex</div>
              <div className="text-sm text-[#475569]">Suporte Assistido</div>
            </div>
          </div>
          <div className="flex items-center gap-2" data-testid="accessibility-controls">
            <button
              onClick={() => setFontScale((s) => Math.max(0.9, s - 0.1))}
              className="h-11 w-11 rounded-xl border-2 border-slate-900 flex items-center justify-center font-bold hover:bg-slate-100 transition-colors"
              aria-label="Diminuir texto"
              data-testid="font-decrease-button"
            >
              <Minus size={20} />
            </button>
            <button
              onClick={() => setFontScale((s) => Math.min(1.5, s + 0.1))}
              className="h-11 w-11 rounded-xl border-2 border-slate-900 flex items-center justify-center font-bold hover:bg-slate-100 transition-colors"
              aria-label="Aumentar texto"
              data-testid="font-increase-button"
            >
              <Plus size={20} />
            </button>
            <button
              onClick={() => speak("Para pedir ajuda, toque no grande botão azul escrito Conectar, no centro da tela.")}
              className="h-11 w-11 rounded-xl border-2 border-slate-900 flex items-center justify-center hover:bg-slate-100 transition-colors"
              aria-label="Ouvir instruções"
              data-testid="voice-help-button"
            >
              <Volume2 size={20} />
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 flex flex-col items-center justify-center px-5 py-12">
        <div className="w-full max-w-md flex flex-col items-center text-center gap-6" aria-live="polite">
          <div
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-base font-bold border-2 ${
              status === "connected"
                ? "bg-emerald-50 border-emerald-600 text-emerald-700"
                : "bg-slate-50 border-slate-300 text-slate-600"
            }`}
            data-testid="connection-status-banner"
          >
            {status === "connected" ? <CheckCircle2 size={20} /> : online ? <Wifi size={20} /> : <WifiOff size={20} />}
            {status === "idle" && "Pronto para conectar"}
            {status === "connecting" && "Conectando…"}
            {status === "connected" && "Conectado — aguardando técnico"}
            {status === "error" && "Falha ao conectar"}
          </div>

          <h1 className="font-display text-4xl sm:text-5xl font-extrabold tracking-tight leading-tight">
            Precisa de ajuda no seu computador?
          </h1>
          <p className="text-xl text-[#475569] leading-snug">
            Toque no botão abaixo. Um técnico verá a sua tela e vai guiá-lo passo a passo.
          </p>

          {status !== "connected" ? (
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={handleConnect}
              disabled={status === "connecting"}
              data-testid="public-connect-button"
              className="w-full max-w-md h-28 sm:h-32 rounded-3xl bg-[#0D5C75] hover:bg-[#083D4E] text-white text-2xl sm:text-3xl font-extrabold border-4 border-slate-900 shadow-[0_12px_32px_rgba(13,92,117,0.35)] flex items-center justify-center gap-4 transition-colors disabled:opacity-70"
            >
              {status === "connecting" ? (
                <>
                  <Loader2 className="animate-spin" size={36} /> Conectando…
                </>
              ) : (
                <>
                  <Wifi size={40} /> CONECTAR
                </>
              )}
            </motion.button>
          ) : (
            <div className="w-full flex flex-col items-center gap-4">
              <div className="w-full rounded-3xl border-4 border-emerald-600 bg-emerald-50 p-6">
                <div className="text-lg font-bold text-emerald-800 mb-1">Código da sessão</div>
                <div
                  className="font-mono text-5xl font-bold tracking-[0.3em] text-emerald-900 cursor-pointer"
                  onClick={() => { navigator.clipboard?.writeText(pin); toast.success("Código copiado"); }}
                  data-testid="session-pin"
                  title="Clique para copiar"
                >
                  {pin}
                </div>
                <div className="text-base text-emerald-700 mt-2">Informe este código ao técnico, se solicitado.</div>
              </div>
              <button
                onClick={disconnect}
                data-testid="public-disconnect-button"
                className="w-full max-w-md h-16 rounded-2xl border-2 border-red-600 text-red-700 text-lg font-bold hover:bg-red-50 transition-colors"
              >
                Encerrar sessão
              </button>
            </div>
          )}

          {/* Download native apps */}
          <div className="w-full pt-4 border-t-2 border-slate-200 mt-2">
            <div className="text-base font-bold text-[#475569] mb-3">Ou instale o aplicativo assistente</div>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => downloadInfo("Windows")}
                data-testid="download-app-windows-button"
                className="h-16 w-full rounded-2xl border-2 border-slate-900 bg-white text-slate-900 text-lg font-bold flex items-center justify-center gap-3 hover:bg-slate-100 transition-colors"
              >
                <Download size={22} /> Baixar App — Windows
              </button>
              <button
                onClick={() => downloadInfo("Android")}
                data-testid="download-app-android-button"
                className="h-16 w-full rounded-2xl border-2 border-slate-900 bg-white text-slate-900 text-lg font-bold flex items-center justify-center gap-3 hover:bg-slate-100 transition-colors"
              >
                <Apple size={22} className="hidden" /> <Download size={22} /> Baixar App — Android
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 text-sm text-[#475569] mt-2">
            <ShieldCheck size={18} className="text-[#0D5C75]" />
            Conexão protegida. Você pode encerrar a qualquer momento.
          </div>
        </div>
      </main>

      <footer className="text-center py-4 text-sm text-slate-400">
        Crypto Conex · Assistência Digital Inclusiva ·{" "}
        <a href="/login" className="underline hover:text-slate-600" data-testid="crm-access-link">
          Acesso da equipe técnica
        </a>
      </footer>
    </div>
  );
}
