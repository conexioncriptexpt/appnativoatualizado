import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  MonitorPlay, LayoutGrid, Headset, MonitorSmartphone, Link2, Users, Settings, LogOut, Wifi, Menu, X,
} from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import Logo from "@/components/Logo";
import { TZ } from "@/lib/datetime";

const NAV = [
  { to: "/crm", label: "Consola ao Vivo", icon: MonitorPlay, end: true, id: "console" },
  { to: "/crm/dashboard", label: "Dashboard", icon: LayoutGrid, id: "dashboard" },
  { to: "/crm/atendimentos", label: "Atendimentos", icon: Headset, id: "history" },
  { to: "/crm/aparelhos", label: "Dispositivos", icon: MonitorSmartphone, id: "devices" },
  { to: "/crm/links", label: "Links de Assistência", icon: Link2, id: "links" },
  { to: "/crm/equipa", label: "Equipa", icon: Users, id: "team", admin: true },
  { to: "/crm/configuracoes", label: "Configurações", icon: Settings, id: "settings" },
];

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(i);
  }, []);
  const date = new Intl.DateTimeFormat("pt-PT", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }).format(now);
  const time = new Intl.DateTimeFormat("pt-PT", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(now);
  return (
    <div className="hidden lg:flex items-center gap-2 h-9 px-3 rounded-full border border-[#22262E] bg-[#121419] font-mono text-xs" data-testid="lisbon-clock">
      <span className="text-[#6B717C]">LISBOA</span>
      <span className="text-gray-300">{date}</span>
      <span className="text-[#7FD113] font-bold tabular-nums">{time}</span>
    </div>
  );
}

function Counter({ label, value, color, testid }) {
  return (
    <div className="text-center leading-none" data-testid={testid}>
      <div className={`font-mono text-base font-bold ${color}`}>{value ?? 0}</div>
      <div className="font-mono text-[9px] text-[#6B717C] mt-1">{label}</div>
    </div>
  );
}

function Sidebar({ isAdmin, onNavigate }) {
  return (
    <nav className="flex flex-col gap-1.5 px-3" data-testid="crm-sidebar-nav">
      {NAV.filter((n) => !n.admin || isAdmin).map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.end}
          onClick={onNavigate}
          data-testid={`nav-${n.id}`}
          className={({ isActive }) =>
            `h-11 px-3.5 rounded-xl flex items-center gap-3 text-sm transition-colors ${
              isActive
                ? "border border-[#7FD113]/70 text-[#7FD113] bg-[#7FD113]/[0.06] shadow-[0_0_18px_-6px_rgba(127,209,19,0.5)]"
                : "border border-transparent text-gray-300 hover:bg-white/[0.04] hover:text-white"
            }`
          }
        >
          <n.icon size={17} /> {n.label}
        </NavLink>
      ))}
    </nav>
  );
}

export default function CrmLayout({ children }) {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === "admin";
  const [stats, setStats] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const load = () => api.get("/stats").then((r) => setStats(r.data)).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const initials = (user?.name || "?").split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="min-h-screen bg-[#0B0D10] text-gray-200 flex crm-shell">
      <aside className={`fixed lg:sticky top-0 z-40 h-screen w-64 shrink-0 bg-[#0B0D10] border-r border-[#1A1D23] flex flex-col transition-transform ${open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}>
        <div className="h-24 flex items-center justify-between px-5">
          <Logo height={64} />
          <button className="lg:hidden text-gray-400" onClick={() => setOpen(false)} aria-label="Fechar menu"><X size={20} /></button>
        </div>
        <Sidebar isAdmin={isAdmin} onNavigate={() => setOpen(false)} />
        <div className="mt-auto p-3">
          <button
            onClick={logout}
            data-testid="logout-button"
            className="w-full h-11 px-3.5 rounded-xl flex items-center gap-3 text-sm text-gray-400 hover:text-white hover:bg-white/[0.04] transition-colors"
          >
            <LogOut size={17} /> Sair
          </button>
        </div>
      </aside>
      {open && <div className="fixed inset-0 bg-black/60 z-30 lg:hidden" onClick={() => setOpen(false)} />}

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-16 border-b border-[#1A1D23] bg-[#0B0D10]/90 backdrop-blur flex items-center justify-between px-5 sticky top-0 z-20">
          <div className="flex items-center gap-3">
            <button className="lg:hidden text-gray-300" onClick={() => setOpen(true)} aria-label="Abrir menu" data-testid="sidebar-open-button"><Menu size={20} /></button>
            <span className="flex items-center gap-2 font-mono text-[11px] text-gray-400 tracking-wider">
              <Wifi size={14} className="text-[#7FD113]" /> TEMPO REAL ATIVO
            </span>
          </div>
          <div className="flex items-center gap-5">
            <div className="hidden md:flex items-center gap-5">
              <Counter label="NOVOS" value={stats?.waiting} color="text-amber-400" testid="stat-waiting" />
              <Counter label="ATIVAS" value={stats?.active} color="text-[#7FD113]" testid="stat-active" />
              <Counter label="ONLINE" value={stats?.online_operators} color="text-sky-400" testid="stat-online" />
            </div>
            <Clock />
            <div className="flex items-center gap-3">
              <div className="text-right leading-tight hidden sm:block">
                <div className="text-sm font-semibold text-white" data-testid="current-user-name">{user?.name}</div>
                <div className="font-mono text-[10px] text-[#7FD113]">{isAdmin ? "SUPER ADMIN" : "TÉCNICO"}</div>
              </div>
              <div className="h-9 w-9 rounded-full bg-gradient-to-br from-[#7FD113] to-[#3F6B0A] text-black text-xs font-extrabold flex items-center justify-center">
                {initials}
              </div>
            </div>
          </div>
        </header>
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-white tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-[#8A8F98] mt-1">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export const card = "bg-[#121419] border border-[#20242C] rounded-2xl";
export const input = "h-11 px-3 rounded-xl bg-[#0B0D10] border border-[#2A2F38] text-white text-sm outline-none focus:border-[#7FD113] transition-colors placeholder:text-[#5B616B]";
export const btnPrimary = "h-11 px-5 rounded-xl bg-[#7FD113] hover:bg-[#93E62A] text-black text-sm font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50";
export const btnOutline = "h-10 px-4 rounded-xl border border-[#2A2F38] text-gray-200 text-sm flex items-center justify-center gap-2 hover:border-[#7FD113]/60 hover:text-white transition-colors";
