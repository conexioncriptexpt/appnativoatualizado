import { useEffect, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  MonitorSmartphone, LogOut, Users, Radio, Clock, Smartphone, Monitor, Globe,
  MousePointerClick, Hand, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home,
  ChevronLeft, Send, RefreshCw, ListTree, ScrollText, Circle, UserCheck,
  CircleDot, Keyboard, MessageSquare,
} from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { createSocket } from "@/lib/socket";
import { fmtTime } from "@/lib/datetime";
import Logo from "@/components/Logo";
import LisbonClock from "@/components/LisbonClock";
import { RemoteControlLayer } from "@/components/RemoteControlLayer";

const PLATFORM_ICON = { android: Smartphone, windows: Monitor, web: Globe };
const STATUS_STYLE = {
  waiting: { label: "AGUARDANDO", cls: "text-amber-400 border-amber-500/40 bg-amber-500/10" },
  assigned: { label: "ATRIBUÍDA", cls: "text-indigo-300 border-indigo-500/40 bg-indigo-500/10" },
  active: { label: "AO VIVO", cls: "text-emerald-400 border-emerald-500/40 bg-emerald-500/10" },
  ended: { label: "ENCERRADA", cls: "text-gray-500 border-gray-600/40 bg-gray-600/10" },
};

function waitTime(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}min`;
  return `${Math.floor(s / 3600)}h`;
}

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [stats, setStats] = useState(null);
  const [active, setActive] = useState(null); // active session object
  const [tree, setTree] = useState([]);
  const [logs, setLogs] = useState([]);
  const [rightTab, setRightTab] = useState("commands");
  const [coords, setCoords] = useState({ x: 540, y: 960 });
  const [msg, setMsg] = useState("");
  const [typeText, setTypeText] = useState("");
  const [rtcState, setRtcState] = useState("idle");
  const [frameSrc, setFrameSrc] = useState(null); // native (Android/Windows) JPEG frames

  const socketRef = useRef(null);
  const pcRef = useRef(null);
  const videoRef = useRef(null);
  const imgRef = useRef(null);
  const iceBuffer = useRef([]);
  const remoteSet = useRef(false);
  const rtcLive = useRef(false);
  const activeRef = useRef(null);
  useEffect(() => { activeRef.current = active; }, [active]);

  const isAdmin = user?.role === "admin";

  const refresh = useCallback(async () => {
    try {
      const [s, st] = await Promise.all([api.get("/sessions"), api.get("/stats")]);
      setSessions(s.data);
      setStats(st.data);
      if (isAdmin) {
        const t = await api.get("/technicians");
        setTechnicians(t.data);
      }
    } catch (e) {}
  }, [isAdmin]);

  // socket lifecycle
  useEffect(() => {
    const token = localStorage.getItem("cc_token");
    const sock = createSocket({ token });
    socketRef.current = sock;
    sock.on("queue:update", ({ sessions }) => {
      setSessions(sessions);
      // keep header counters live without a REST round-trip
      setStats((prev) => ({
        ...(prev || {}),
        waiting: sessions.filter((s) => s.status === "waiting").length,
        active: sessions.filter((s) => s.status === "active").length,
        assigned: sessions.filter((s) => s.status === "assigned").length,
      }));
    });
    sock.on("operator:ready", () => refresh());
    sock.on("session:assigned-to-you", ({ session_id }) => {
      toast.success("Nova sessão atribuída a si!");
      refresh();
    });
    sock.on("rtc:offer", async ({ sdp }) => {
      const pc = pcRef.current;
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      remoteSet.current = true;
      for (const c of iceBuffer.current) await pc.addIceCandidate(c);
      iceBuffer.current = [];
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sock.emit("rtc:answer", { session_id: activeRef.current?.id, sdp: pc.localDescription });
    });
    sock.on("rtc:ice", async ({ candidate }) => {
      if (!candidate) return;
      if (pcRef.current && remoteSet.current) await pcRef.current.addIceCandidate(candidate);
      else iceBuffer.current.push(candidate);
    });
    sock.on("a11y:tree", ({ tree }) => setTree(tree || []));
    sock.on("screen:frame", (d) => {
      if (activeRef.current && d.session_id === activeRef.current.id && d.data && !rtcLive.current) {
        setFrameSrc("data:image/jpeg;base64," + d.data);
        setRtcState("live");
      }
    });
    sock.on("device:disconnected", ({ session_id }) => {
      if (activeRef.current?.id === session_id) {
        toast.info("O utilizador terminou a sessão.");
        setFrameSrc(null);
        setRtcState("ended");
      }
      refresh();
    });
    refresh();
    return () => { sock.disconnect(); if (pcRef.current) pcRef.current.close(); };
    // eslint-disable-next-line
  }, []);

  const teardownPeer = () => {
    if (pcRef.current) pcRef.current.close();
    pcRef.current = null;
    remoteSet.current = false;
    rtcLive.current = false;
    iceBuffer.current = [];
    if (videoRef.current) videoRef.current.srcObject = null;
    setFrameSrc(null);
  };

  const openSession = async (session) => {
    if (active?.id === session.id) return;
    teardownPeer();
    setActive(session);
    setTree([]);
    setRtcState("connecting");
    try {
      const { data } = await api.get("/config/ice");
      const pc = new RTCPeerConnection({ iceServers: data.iceServers });
      pcRef.current = pc;
      pc.ontrack = (e) => {
        if (videoRef.current) videoRef.current.srcObject = e.streams[0] || new MediaStream([e.track]);
        rtcLive.current = true;
        setFrameSrc(null);
        setRtcState("live");
      };
      pc.onconnectionstatechange = () => {
        if (["failed", "disconnected", "closed"].includes(pc.connectionState)) rtcLive.current = false;
      };
      pc.onicecandidate = (e) => {
        if (e.candidate) socketRef.current.emit("rtc:ice", { session_id: session.id, candidate: e.candidate });
      };
      socketRef.current.emit("operator:subscribe", { session_id: session.id });
      loadLogs(session.id);
    } catch (e) {
      toast.error("Falha ao abrir a sessão.");
    }
  };

  const loadLogs = async (id) => {
    try {
      const { data } = await api.get(`/sessions/${id}/logs`);
      setLogs(data);
    } catch (e) {}
  };

  const assign = (session, techId) => {
    socketRef.current.emit("session:assign", { session_id: session.id, technician_id: techId });
    toast.success("Sessão atribuída.");
  };

  const sendCommand = (command) => {
    const sess = activeRef.current;
    if (!sess) return toast.error("Abra uma sessão primeiro.");
    socketRef.current.emit("command:send", { session_id: sess.id, command });
    setLogs((l) => [...l.slice(-299), { type: "command", payload: { command, by: user.email }, timestamp: new Date().toISOString() }]);
  };

  const requestTree = () => {
    const sess = activeRef.current;
    if (!sess) return;
    socketRef.current.emit("a11y:request", { session_id: sess.id });
    toast.message("Solicitando hierarquia de acessibilidade…");
  };

  const liveSessions = sessions.filter((s) => s.status !== "ended");

  return (
    <div className="min-h-screen operator-bg text-gray-200">
      {/* Top bar */}
      <header className="h-16 border-b border-gray-800 bg-[#111827] flex items-center justify-between px-5 sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <Logo size={40} dark />
          <span className="hidden md:inline text-[11px] text-gray-500 font-mono border-l border-gray-700 pl-3">
            {isAdmin ? "SUPER ADMIN" : "TÉCNICO"} · {user?.name}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden lg:block">
            <LisbonClock dark />
          </div>
          {stats && (
            <div className="hidden md:flex items-center gap-4 text-xs font-mono">
              <Stat label="FILA" value={stats.waiting} color="text-amber-400" />
              <Stat label="ATIVAS" value={stats.active} color="text-emerald-400" />
              <Stat label="ONLINE" value={stats.online_operators} color="text-indigo-300" />
            </div>
          )}
          <Link
            to="/crm/aparelhos"
            data-testid="devices-link"
            className="h-9 px-3 rounded-lg border border-gray-700 flex items-center gap-2 text-sm hover:bg-gray-800 transition-colors"
          >
            <Smartphone size={16} /> Aparelhos
          </Link>
          {isAdmin && (
            <Link
              to="/crm/equipa"
              data-testid="team-management-link"
              className="h-9 px-3 rounded-lg border border-gray-700 flex items-center gap-2 text-sm hover:bg-gray-800 transition-colors"
            >
              <Users size={16} /> Equipa
            </Link>
          )}
          <button
            onClick={refresh}
            className="h-9 w-9 rounded-lg border border-gray-700 flex items-center justify-center hover:bg-gray-800 transition-colors"
            data-testid="refresh-button"
            title="Atualizar"
          >
            <RefreshCw size={16} />
          </button>
          <button
            onClick={logout}
            data-testid="logout-button"
            className="h-9 px-3 rounded-lg border border-gray-700 flex items-center gap-2 text-sm hover:bg-gray-800 transition-colors"
          >
            <LogOut size={16} /> Sair
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 p-4">
        {/* Queue */}
        <aside className="lg:col-span-3 bg-[#111827] border border-gray-800 rounded-xl p-4 flex flex-col lg:h-[calc(100vh-6rem)]">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display font-bold text-white flex items-center gap-2">
              <Radio size={18} className="text-indigo-400" /> Fila de Atendimento
            </h2>
            <span className="text-xs font-mono text-gray-500">{liveSessions.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto thin-scroll space-y-2 pr-1" data-testid="crm-global-queue-list">
            <AnimatePresence>
              {liveSessions.length === 0 && (
                <div className="text-center text-gray-600 text-sm py-10">Nenhuma solicitação no momento.</div>
              )}
              {liveSessions.map((s) => {
                const Icon = PLATFORM_ICON[s.platform] || Globe;
                const stStyle = STATUS_STYLE[s.status] || STATUS_STYLE.waiting;
                const mine = s.assigned_to === user?.id;
                return (
                  <motion.div
                    key={s.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    onClick={() => (mine || isAdmin || s.status === "waiting") && openSession(s)}
                    className={`rounded-xl border p-3 cursor-pointer transition-colors ${
                      active?.id === s.id ? "border-indigo-500 bg-indigo-500/10" : "border-gray-800 bg-[#0B0F17] hover:border-gray-700"
                    }`}
                    data-testid="queue-session-item"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-lg bg-gray-800 flex items-center justify-center text-gray-300">
                          <Icon size={16} />
                        </div>
                        <div className="leading-tight">
                          <div className="text-sm font-semibold text-white truncate max-w-[130px]">{s.name}</div>
                          <div className="text-[11px] font-mono text-gray-500 flex items-center gap-1">
                            <Clock size={10} /> {waitTime(s.created_at)}
                          </div>
                        </div>
                      </div>
                      <span className={`text-[10px] font-bold font-mono px-2 py-0.5 rounded-full border ${stStyle.cls} ${s.status === "active" ? "live-pulse" : ""}`}>
                        {stStyle.label}
                      </span>
                    </div>
                    {s.assigned_to_name && (
                      <div className="text-[11px] text-gray-500 flex items-center gap-1 mb-2">
                        <UserCheck size={11} /> {s.assigned_to_name}
                      </div>
                    )}
                    <div className="flex gap-2">
                      {s.status === "waiting" && !isAdmin && (
                        <button
                          onClick={(e) => { e.stopPropagation(); assign(s, user.id); }}
                          data-testid="crm-assign-to-me-button"
                          className="flex-1 h-8 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-bold transition-colors"
                        >
                          Atribuir a mim
                        </button>
                      )}
                      {isAdmin && s.status !== "active" && (
                        <select
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => e.target.value && assign(s, e.target.value)}
                          defaultValue=""
                          data-testid="crm-assign-session-button"
                          className="flex-1 h-8 rounded-lg bg-gray-800 border border-gray-700 text-xs text-white px-2"
                        >
                          <option value="" disabled>Atribuir a…</option>
                          {technicians.map((t) => (
                            <option key={t.id} value={t.id}>{t.name}{t.online ? " 🟢" : ""}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </aside>

        {/* Stream viewer */}
        <main className="lg:col-span-6 bg-[#111827] border border-gray-800 rounded-xl p-4 flex flex-col lg:h-[calc(100vh-6rem)]">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display font-bold text-white flex items-center gap-2">
              <Monitor size={18} className="text-indigo-400" /> Visualizador ao Vivo
            </h2>
            {active && (
              <span className={`text-xs font-mono px-2 py-1 rounded-full border ${
                rtcState === "live" ? "text-emerald-400 border-emerald-500/40 bg-emerald-500/10 live-pulse"
                : rtcState === "connecting" ? "text-amber-400 border-amber-500/40 bg-amber-500/10"
                : "text-gray-500 border-gray-700"
              }`} data-testid="rtc-state-badge">
                {rtcState === "live" ? "● AO VIVO" : rtcState === "connecting" ? "conectando…" : rtcState === "ended" ? "encerrada" : "ocioso"}
              </span>
            )}
          </div>
          <div className="flex-1 rounded-xl bg-black border border-gray-800 relative overflow-hidden flex items-center justify-center">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-contain"
              data-testid="crm-webrtc-stream-canvas"
            />
            {frameSrc && (
              <img
                ref={imgRef}
                src={frameSrc}
                alt="Ecrã do utilizador"
                className="absolute inset-0 w-full h-full object-contain"
                data-testid="native-frame-view"
              />
            )}
            {active && rtcState === "live" && (
              <RemoteControlLayer
                getMedia={() => (frameSrc ? imgRef.current : videoRef.current)}
                onCommand={sendCommand}
              />
            )}
            {rtcState !== "live" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-600 gap-3 pointer-events-none">
                <CircleDot size={48} className={rtcState === "connecting" ? "animate-pulse text-amber-500" : ""} />
                <div className="text-sm font-mono">
                  {active ? (rtcState === "connecting" ? "Estabelecendo WebRTC…" : "Sem transmissão") : "Selecione uma sessão na fila"}
                </div>
              </div>
            )}
          </div>
          {active && (
            <div className="mt-3 text-xs font-mono text-gray-500 flex items-center justify-between">
              <span>Sessão: {active.id.slice(0, 8)} · {active.platform}</span>
              <span>Dispositivo: {active.device_id?.slice(0, 16)}</span>
            </div>
          )}
        </main>

        {/* Control + tree + logs */}
        <aside className="lg:col-span-3 bg-[#111827] border border-gray-800 rounded-xl p-4 flex flex-col lg:h-[calc(100vh-6rem)]">
          <div className="flex gap-1 mb-3 bg-[#0B0F17] rounded-lg p-1">
            {[
              { k: "commands", label: "Comandos", icon: MousePointerClick },
              { k: "tree", label: "Acessib.", icon: ListTree },
              { k: "logs", label: "Logs", icon: ScrollText },
            ].map((t) => (
              <button
                key={t.k}
                onClick={() => { setRightTab(t.k); if (t.k === "logs" && active) loadLogs(active.id); }}
                data-testid={`right-tab-${t.k}`}
                className={`flex-1 h-9 rounded-md text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${
                  rightTab === t.k ? "bg-indigo-500 text-white" : "text-gray-400 hover:text-white"
                }`}
              >
                <t.icon size={14} /> {t.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto thin-scroll pr-1">
            {rightTab === "commands" && (
              <div className="space-y-4" data-testid="crm-command-console">
                <Section title="Navegação">
                  <div className="grid grid-cols-3 gap-2">
                    <CmdBtn testid="crm-command-back-button" icon={ChevronLeft} label="Voltar" onClick={() => sendCommand({ type: "back" })} />
                    <CmdBtn testid="crm-command-home-button" icon={Home} label="Início" onClick={() => sendCommand({ type: "home" })} />
                    <CmdBtn icon={MousePointerClick} label="Clique" onClick={() => sendCommand({ type: "click", x: coords.x, y: coords.y })} testid="crm-command-click-button" />
                    <CmdBtn icon={ArrowUp} label="Cima" onClick={() => sendCommand({ type: "swipe", dir: "up" })} />
                    <CmdBtn icon={ArrowDown} label="Baixo" onClick={() => sendCommand({ type: "swipe", dir: "down" })} />
                    <CmdBtn icon={Hand} label="Longo" onClick={() => sendCommand({ type: "longpress", x: coords.x, y: coords.y })} />
                    <CmdBtn icon={ArrowLeft} label="Esq." onClick={() => sendCommand({ type: "swipe", dir: "left" })} />
                    <CmdBtn icon={ArrowRight} label="Dir." onClick={() => sendCommand({ type: "swipe", dir: "right" })} />
                  </div>
                </Section>

                <Section title="Coordenadas do clique (X, Y)">
                  <div className="flex gap-2">
                    <input
                      type="number" value={coords.x}
                      onChange={(e) => setCoords((c) => ({ ...c, x: +e.target.value }))}
                      data-testid="crm-coord-x-input"
                      className="w-full h-10 px-3 rounded-lg bg-[#0B0F17] border border-gray-700 text-white font-mono text-sm"
                      placeholder="X"
                    />
                    <input
                      type="number" value={coords.y}
                      onChange={(e) => setCoords((c) => ({ ...c, y: +e.target.value }))}
                      data-testid="crm-coord-y-input"
                      className="w-full h-10 px-3 rounded-lg bg-[#0B0F17] border border-gray-700 text-white font-mono text-sm"
                      placeholder="Y"
                    />
                  </div>
                </Section>

                <Section title="Digitar texto no dispositivo">
                  <div className="flex gap-2">
                    <input
                      value={typeText}
                      onChange={(e) => setTypeText(e.target.value)}
                      data-testid="crm-type-text-input"
                      className="flex-1 h-10 px-3 rounded-lg bg-[#0B0F17] border border-gray-700 text-white text-sm"
                      placeholder="Texto…"
                    />
                    <button
                      onClick={() => { sendCommand({ type: "type", text: typeText }); setTypeText(""); }}
                      data-testid="crm-send-type-button"
                      className="h-10 w-10 rounded-lg bg-gray-800 hover:bg-gray-700 flex items-center justify-center transition-colors"
                    >
                      <Keyboard size={16} />
                    </button>
                  </div>
                </Section>

                <Section title="Mensagem guiada ao usuário">
                  <div className="flex gap-2">
                    <input
                      value={msg}
                      onChange={(e) => setMsg(e.target.value)}
                      data-testid="crm-message-input"
                      className="flex-1 h-10 px-3 rounded-lg bg-[#0B0F17] border border-gray-700 text-white text-sm"
                      placeholder="Ex: Toque no botão verde"
                    />
                    <button
                      onClick={() => { if (msg) { sendCommand({ type: "message", text: msg }); setMsg(""); toast.success("Mensagem enviada"); } }}
                      data-testid="crm-send-message-button"
                      className="h-10 w-10 rounded-lg bg-indigo-500 hover:bg-indigo-600 flex items-center justify-center transition-colors"
                    >
                      <MessageSquare size={16} />
                    </button>
                  </div>
                </Section>
              </div>
            )}

            {rightTab === "tree" && (
              <div data-testid="crm-accessibility-node-tree">
                <button
                  onClick={requestTree}
                  data-testid="crm-request-tree-button"
                  className="w-full h-10 mb-3 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
                >
                  <RefreshCw size={14} /> Ler tela do usuário
                </button>
                {tree.length === 0 ? (
                  <div className="text-center text-gray-600 text-sm py-8">
                    Nenhum nó carregado. Em dispositivos Android, o serviço de acessibilidade envia a hierarquia da interface.
                  </div>
                ) : (
                  <div className="space-y-1 font-mono text-xs">
                    {tree.map((n, i) => (
                      <button
                        key={i}
                        onClick={() => sendCommand({ type: "click", x: n.cx, y: n.cy, node: n.id })}
                        className="w-full text-left px-2 py-1.5 rounded hover:bg-indigo-500/20 border border-gray-800 text-sky-300"
                      >
                        <span className="text-gray-500">{n.className || "node"}</span> · {n.text || n.desc || "—"}
                        {n.clickable && <span className="text-emerald-400 ml-1">[click]</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {rightTab === "logs" && (
              <div className="space-y-1.5 font-mono text-xs" data-testid="crm-session-history-table">
                {logs.length === 0 ? (
                  <div className="text-center text-gray-600 py-8">Sem registros nesta sessão.</div>
                ) : (
                  logs.map((l, i) => (
                    <div key={i} className="px-2 py-1.5 rounded bg-[#0B0F17] border border-gray-800">
                      <span className="text-gray-600">{fmtTime(new Date(l.timestamp))}</span>{" "}
                      <span className="text-indigo-300">{l.type}</span>
                      {l.payload?.command && <span className="text-sky-300"> · {l.payload.command.type}</span>}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div className="text-center">
      <div className={`text-lg font-bold ${color}`}>{value}</div>
      <div className="text-[10px] text-gray-600">{label}</div>
    </div>
  );
}
function Section({ title, children }) {
  return (
    <div>
      <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2">{title}</div>
      {children}
    </div>
  );
}
function CmdBtn({ icon: Icon, label, onClick, testid }) {
  return (
    <button
      onClick={onClick}
      data-testid={testid}
      className="h-14 rounded-lg bg-[#0B0F17] border border-gray-800 hover:border-indigo-500 hover:bg-indigo-500/10 flex flex-col items-center justify-center gap-1 text-gray-300 transition-colors"
    >
      <Icon size={16} />
      <span className="text-[10px]">{label}</span>
    </button>
  );
}
