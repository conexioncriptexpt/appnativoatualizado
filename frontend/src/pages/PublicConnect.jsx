import { useEffect, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import {
  ShieldCheck, Download, Wifi, WifiOff, Loader2, CheckCircle2,
  Plus, Minus, Volume2,
} from "lucide-react";
import { createSocket } from "@/lib/socket";
import { detectOS } from "@/lib/datetime";
import Logo from "@/components/Logo";
import LisbonClock from "@/components/LisbonClock";

const DEVICE_KEY = "cc_device_id";
function getDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = "web-" + crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

const OS_LABEL = {
  android: "Instalar Aplicação Android",
  windows: "Instalar Aplicação Windows",
  ios: "Instalar Aplicação",
  mac: "Instalar Aplicação",
  other: "Instalar Aplicação",
};

export default function PublicConnect() {
  const [status, setStatus] = useState("idle"); // idle | connecting | connected | error
  const [sessionId, setSessionId] = useState(null);
  const [pin, setPin] = useState(null);
  const [fontScale, setFontScale] = useState(1);
  const [online, setOnline] = useState(false);
  const [techWatching, setTechWatching] = useState(false);
  useEffect(() => { if (status !== "connected") setTechWatching(false); }, [status]);
  const os = useRef(detectOS()).current;

  const socketRef = useRef(null);
  const pcRef = useRef(null);
  const streamRef = useRef(null);
  const iceBuffer = useRef([]);
  const remoteSet = useRef(false);
  const iceServersRef = useRef([]);
  const sessionIdRef = useRef(null);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  // Scale the <html> root font-size so Tailwind rem-based text actually grows.
  useEffect(() => {
    document.documentElement.style.fontSize = `${fontScale * 100}%`;
    return () => { document.documentElement.style.fontSize = ""; };
  }, [fontScale]);

  const speak = useCallback((text) => {
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "pt-PT";
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }, []);

  const cleanup = useCallback(() => {
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    if (pcRef.current) { try { pcRef.current.close(); } catch (e) {} }
    if (socketRef.current) socketRef.current.disconnect();
    streamRef.current = null;
    pcRef.current = null;
    socketRef.current = null;
    remoteSet.current = false;
    iceBuffer.current = [];
  }, []);

  useEffect(() => cleanup, [cleanup]);

  // Build a FRESH peer connection whenever an operator joins (re-open / troca de técnico).
  const startStreamToOperator = useCallback(async () => {
    if (!streamRef.current || !socketRef.current) return;
    const sid = sessionIdRef.current;
    if (pcRef.current) { try { pcRef.current.close(); } catch (e) {} }
    remoteSet.current = false;
    iceBuffer.current = [];
    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
    pcRef.current = pc;
    streamRef.current.getTracks().forEach((t) => pc.addTrack(t, streamRef.current));
    pc.onicecandidate = (e) => {
      if (e.candidate) socketRef.current.emit("rtc:ice", { session_id: sid, candidate: e.candidate });
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socketRef.current.emit("rtc:offer", { session_id: sid, sdp: pc.localDescription });
  }, []);

  const handleConnect = async () => {
    if (status === "connecting" || status === "connected") return;
    setStatus("connecting");
    speak("A iniciar a ligação. Por favor, confirme a partilha do seu ecrã.");
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 15 },
        audio: false,
      });
      streamRef.current = stream;
      stream.getVideoTracks()[0].addEventListener("ended", () => {
        toast.info("Partilha de ecrã terminada.");
        cleanup();
        setStatus("idle");
        setSessionId(null);
        setPin(null);
      });

      const sock = createSocket();
      socketRef.current = sock;

      const register = () =>
        sock.emit("device:register", {
          device_id: getDeviceId(),
          platform: "web",
          name: "Navegador (" + (navigator.platform || "PC") + ")",
        });

      sock.on("connect", () => { setOnline(true); register(); });
      sock.on("disconnect", () => setOnline(false));

      sock.on("device:registered", ({ session_id, pin: p, iceServers }) => {
        setSessionId(session_id);
        sessionIdRef.current = session_id;
        setPin(p);
        setStatus("connected");
        iceServersRef.current = iceServers || [];
        speak("Ligado. Um técnico irá ajudá-lo dentro de instantes.");
      });

      sock.on("operator:joined", async () => {
        await startStreamToOperator();
        setTechWatching(true);
        toast.success("Técnico ligado ao seu ecrã.");
        speak("O técnico já consegue ver o seu ecrã para o ajudar.");
      });

      sock.on("rtc:answer", async ({ sdp }) => {
        try {
          if (!pcRef.current) return;
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(sdp));
          remoteSet.current = true;
          for (const c of iceBuffer.current) await pcRef.current.addIceCandidate(c);
          iceBuffer.current = [];
        } catch (e) { console.warn("rtc:answer", e); }
      });

      sock.on("rtc:ice", async ({ candidate }) => {
        try {
          if (!candidate || !pcRef.current) return;
          if (remoteSet.current) await pcRef.current.addIceCandidate(candidate);
          else iceBuffer.current.push(candidate);
        } catch (e) { console.warn("rtc:ice", e); }
      });

      sock.on("command:receive", ({ command }) => {
        if (command?.type === "message") {
          toast.message("Mensagem do técnico", { description: command.text });
          speak(command.text);
        }
      });
    } catch (e) {
      console.error(e);
      setStatus("error");
      toast.error("Não foi possível iniciar a partilha de ecrã.");
      speak("Não foi possível iniciar. Tente novamente.");
    }
  };

  const disconnect = () => {
    cleanup();
    setStatus("idle");
    setSessionId(null);
    setPin(null);
    toast.info("Sessão terminada.");
  };

  const installApp = () => {
    window.location.href = `/instrucoes${os === "android" || os === "windows" ? `?os=${os}` : ""}`;
  };

  return (
    <div className="min-h-screen bg-[#FAFAFD] text-[#0F172A] flex flex-col">
      {/* Header */}
      <header className="w-full border-b-2 border-slate-900/10 bg-white">
        <div className="max-w-5xl mx-auto px-5 py-4 flex items-center justify-between gap-3">
          <Logo size={44} />
          <div className="hidden sm:block">
            <LisbonClock />
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
              onClick={() => speak("Para pedir ajuda, carregue no grande botão azul escrito Conectar, no centro do ecrã.")}
              className="h-11 w-11 rounded-xl border-2 border-slate-900 flex items-center justify-center hover:bg-slate-100 transition-colors"
              aria-label="Ouvir instruções"
              data-testid="voice-help-button"
            >
              <Volume2 size={20} />
            </button>
          </div>
        </div>
        <div className="sm:hidden max-w-5xl mx-auto px-5 pb-3">
          <LisbonClock />
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
            {status === "idle" && "Pronto para ligar"}
            {status === "connecting" && "A ligar…"}
            {status === "connected" && (techWatching ? "Técnico a ver o seu ecrã" : "Ligado — à espera do técnico")}
            {status === "error" && "Falha na ligação"}
          </div>

          <h1 className="font-display text-4xl sm:text-5xl font-extrabold tracking-tight leading-tight">
            Precisa de ajuda no seu computador?
          </h1>
          <p className="text-xl text-[#475569] leading-snug">
            Carregue no botão abaixo. Um técnico vê o seu ecrã e orienta-o passo a passo.
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
                  <Loader2 className="animate-spin" size={36} /> A ligar…
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
                  title="Carregue para copiar"
                >
                  {pin}
                </div>
                <div className="text-base text-emerald-700 mt-2">Indique este código ao técnico, se lhe for pedido.</div>
              </div>
              <button
                onClick={disconnect}
                data-testid="public-disconnect-button"
                className="w-full max-w-md h-16 rounded-2xl border-2 border-red-600 text-red-700 text-lg font-bold hover:bg-red-50 transition-colors"
              >
                Terminar sessão
              </button>
            </div>
          )}

          {/* Install native app (single button for the detected system) */}
          <div className="w-full pt-4 border-t-2 border-slate-200 mt-2">
            <div className="text-base font-bold text-[#475569] mb-3">Ou instale a aplicação assistente</div>
            <button
              onClick={installApp}
              data-testid="install-app-button"
              className="h-16 w-full rounded-2xl border-2 border-slate-900 bg-white text-slate-900 text-lg font-bold flex items-center justify-center gap-3 hover:bg-slate-100 transition-colors"
            >
              <Download size={22} /> {OS_LABEL[os]}
            </button>
          </div>

          <div className="flex items-center gap-2 text-sm text-[#475569] mt-2">
            <ShieldCheck size={18} className="text-[#0D5C75]" />
            Ligação protegida. Pode terminar a qualquer momento.
          </div>
        </div>
      </main>

      <footer className="text-center py-4 text-sm text-slate-400">
        Crypto Conex · Assistência Digital Inclusiva ·{" "}
        <a href="/login" className="underline hover:text-slate-600" data-testid="crm-access-link">
          Acesso da equipa técnica
        </a>
      </footer>
    </div>
  );
}
