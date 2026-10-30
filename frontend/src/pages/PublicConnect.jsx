import { useEffect, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import {
  ShieldCheck, Download, Wifi, WifiOff, Loader2, CheckCircle2, MonitorUp, Volume2, VolumeX, UserCheck,
} from "lucide-react";
import { createSocket } from "@/lib/socket";
import api from "@/lib/api";
import { detectOS } from "@/lib/datetime";
import Logo from "@/components/Logo";

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
  android: "Sistema detetado: Android · Crypto Conex (telemóvel)",
  windows: "Sistema detetado: Windows 10/11 · Crypto Conex PC (Windows)",
  ios: "Sistema detetado: iPhone · escolha Android ou Windows",
  mac: "Sistema detetado: Mac · escolha Android ou Windows",
  other: "Escolha Android ou Windows",
};

export default function PublicConnect() {
  const [status, setStatus] = useState("idle"); // idle | connecting | connected | error
  const [sessionId, setSessionId] = useState(null);
  const [pin, setPin] = useState(null);
  const [online, setOnline] = useState(false);
  const [techWatching, setTechWatching] = useState(false);
  useEffect(() => { if (status !== "connected") setTechWatching(false); }, [status]);
  const os = useRef(detectOS()).current;
  const linkCode = useRef(new URLSearchParams(window.location.search).get("l")).current;
  const [linkInfo, setLinkInfo] = useState(null);
  const [soundOn, setSoundOn] = useState(localStorage.getItem("cc_voice") !== "off");
  const soundRef = useRef(soundOn);
  useEffect(() => { soundRef.current = soundOn; localStorage.setItem("cc_voice", soundOn ? "on" : "off"); }, [soundOn]);
  useEffect(() => {
    if (!linkCode) return;
    api.get(`/public/links/${linkCode}`).then((r) => setLinkInfo(r.data)).catch(() => setLinkInfo(false));
  }, [linkCode]);

  const socketRef = useRef(null);
  const pcRef = useRef(null);
  const streamRef = useRef(null);
  const iceBuffer = useRef([]);
  const remoteSet = useRef(false);
  const iceServersRef = useRef([]);
  const sessionIdRef = useRef(null);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  const speak = useCallback((text) => {
    if (!soundRef.current) return;
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
          ...(linkCode ? { link_code: linkCode } : {}),
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
    const url = { android: process.env.REACT_APP_DOWNLOAD_ANDROID_URL, windows: process.env.REACT_APP_DOWNLOAD_WINDOWS_URL }[os];
    if (!url) {
      window.location.href = "/instrucoes";
      return;
    }
    const a = document.createElement("a");
    a.href = url;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast.success("A transferência começou.", { description: "A seguir, siga os passos de instalação." });
    speak("A transferência começou. Siga os passos no ecrã para instalar.");
    setTimeout(() => { window.location.href = `/instrucoes?os=${os}`; }, 1500);
  };

  return (
    <div className="min-h-screen public-bg text-white flex flex-col relative overflow-hidden">
      <div className="absolute top-4 right-4 z-10">
        <button
          onClick={() => setSoundOn((v) => !v)}
          data-testid="voice-toggle-button"
          aria-pressed={soundOn}
          className="h-10 px-4 rounded-xl border border-[#2A2F38] bg-[#0B0D10]/70 backdrop-blur text-sm flex items-center gap-2 hover:border-[#7FD113]/60 transition-colors"
        >
          {soundOn ? <Volume2 size={16} /> : <VolumeX size={16} />} {soundOn ? "Som ligado" : "Som desligado"}
        </button>
      </div>

      <main className="flex-1 flex flex-col items-center justify-center px-5 py-14">
        <div className="w-full max-w-md flex flex-col items-center text-center gap-5 fade-up" aria-live="polite">
          <Logo height={150} className="drop-shadow-[0_0_40px_rgba(127,209,19,0.25)] max-w-[80vw] object-contain" />

          <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.05] mt-2">
            Bem-vindo ao <span className="text-[#7FD113]">Crypto Conex</span>
          </h1>
          <p className="text-lg text-gray-300 -mt-1">Vamos ajudar-te a resolver o teu problema</p>

          {linkInfo && (
            <div className="w-full rounded-2xl border border-[#7FD113]/40 bg-[#7FD113]/[0.07] px-4 py-3 text-sm flex items-center gap-3 text-left" data-testid="assist-link-banner">
              <UserCheck size={20} className="text-[#7FD113] shrink-0" />
              <span>Olá <b>{linkInfo.label}</b>! Ao carregar em CONECTAR vai direto para <b>{linkInfo.technician_name}</b>.</span>
            </div>
          )}
          {linkInfo === false && (
            <div className="w-full rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200" data-testid="assist-link-invalid">
              Este link já não é válido. Pode carregar em CONECTAR na mesma.
            </div>
          )}

          {status !== "idle" && (
            <div
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold border ${
                status === "connected" ? "border-[#7FD113]/50 text-[#7FD113] bg-[#7FD113]/10" : status === "error" ? "border-red-500/50 text-red-300 bg-red-500/10" : "border-[#2A2F38] text-gray-300"
              }`}
              data-testid="connection-status-banner"
            >
              {status === "connected" ? <CheckCircle2 size={18} /> : online ? <Wifi size={18} /> : <WifiOff size={18} />}
              {status === "connecting" && "A ligar…"}
              {status === "connected" && (techWatching ? "Técnico a ver o seu ecrã" : "Ligado — à espera do técnico")}
              {status === "error" && "Falha na ligação"}
            </div>
          )}

          {status !== "connected" ? (
            <div className="w-full p-2.5 rounded-[26px] border border-[#7FD113]/25 bg-[#7FD113]/[0.03] shadow-[0_0_60px_-20px_rgba(127,209,19,0.45)] mt-1">
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={handleConnect}
                disabled={status === "connecting"}
                data-testid="public-connect-button"
                className="w-full h-24 sm:h-28 rounded-[20px] bg-[#7FD113] hover:bg-[#93E62A] text-black text-3xl sm:text-4xl font-extrabold flex items-center justify-center gap-4 transition-colors disabled:opacity-70"
              >
                {status === "connecting" ? (
                  <><Loader2 className="animate-spin" size={36} /> A ligar…</>
                ) : (
                  <><MonitorUp size={38} /> CONECTAR</>
                )}
              </motion.button>
            </div>
          ) : (
            <div className="w-full flex flex-col items-center gap-4">
              <div className="w-full rounded-3xl border border-[#7FD113]/50 bg-[#7FD113]/[0.06] p-6">
                <div className="text-sm font-bold text-gray-300 mb-1">Código da sessão</div>
                <div
                  className="font-mono text-5xl font-bold tracking-[0.3em] text-[#7FD113] cursor-pointer"
                  onClick={() => { navigator.clipboard?.writeText(pin); toast.success("Código copiado"); }}
                  data-testid="session-pin"
                  title="Carregue para copiar"
                >
                  {pin}
                </div>
                <div className="text-sm text-gray-400 mt-2">Indique este código ao técnico, se lhe for pedido.</div>
              </div>
              <button
                onClick={disconnect}
                data-testid="public-disconnect-button"
                className="w-full h-16 rounded-2xl border-2 border-red-500/70 text-red-300 text-lg font-bold hover:bg-red-500/10 transition-colors"
              >
                Terminar sessão
              </button>
            </div>
          )}

          {status !== "connected" && (
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={installApp}
              data-testid="install-app-button"
              className="w-full h-16 sm:h-[72px] rounded-2xl border border-[#3A3F48] bg-[#0B0D10]/60 text-white text-lg sm:text-xl font-bold flex items-center justify-center gap-3 hover:border-[#7FD113]/70 hover:bg-[#7FD113]/[0.05] transition-colors"
            >
              <Download size={24} /> INSTALAR APP
            </motion.button>
          )}
          <div className="text-xs font-mono text-[#6B717C] -mt-2" data-testid="install-app-os-label">{OS_LABEL[os]}</div>

          <div className="w-full rounded-2xl border border-[#20242C] bg-[#121419]/80 p-4 flex items-start gap-3 text-left text-sm text-gray-300">
            <ShieldCheck size={20} className="text-[#7FD113] shrink-0 mt-0.5" />
            A tua privacidade é importante. A partilha do ecrã só começa depois da tua autorização.
          </div>
        </div>
      </main>

      <footer className="text-center py-4 text-xs text-[#5B616B]">
        Crypto Conex · Assistência Digital Inclusiva ·{" "}
        <a href="/login" className="underline hover:text-gray-300" data-testid="crm-access-link">
          Acesso da equipa técnica
        </a>
      </footer>
    </div>
  );
}
