import { useEffect, useState } from "react";
import { Search, Smartphone, Monitor, Globe, X } from "lucide-react";
import api from "@/lib/api";
import CrmLayout, { PageHeader, card, input } from "@/components/CrmLayout";
import { fmtDateTime, fmtTime } from "@/lib/datetime";

const ICONS = { android: Smartphone, windows: Monitor, web: Globe };
const STATUS = {
  waiting: { label: "Em espera", cls: "text-amber-400 bg-amber-500/10 border-amber-500/30" },
  assigned: { label: "Atribuída", cls: "text-sky-400 bg-sky-500/10 border-sky-500/30" },
  active: { label: "Ao vivo", cls: "text-[#7FD113] bg-[#7FD113]/10 border-[#7FD113]/30" },
  ended: { label: "Terminada", cls: "text-gray-400 bg-white/[0.03] border-[#2A2F38]" },
};
const FILTERS = [["all", "Todas"], ["live", "A decorrer"], ["ended", "Terminadas"]];

function duration(s) {
  if (!s.ended_at) return "—";
  const sec = Math.max(0, (new Date(s.ended_at) - new Date(s.created_at)) / 1000);
  return sec < 60 ? `${Math.round(sec)}s` : `${Math.round(sec / 60)} min`;
}

function LogsDrawer({ session, onClose }) {
  const [logs, setLogs] = useState([]);
  useEffect(() => {
    api.get(`/sessions/${session.id}/logs`).then((r) => setLogs(r.data)).catch(() => {});
  }, [session.id]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end" data-testid="history-logs-drawer">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-md h-full bg-[#121419] border-l border-[#20242C] p-6 overflow-y-auto thin-scroll">
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="font-display font-bold text-white text-lg">{session.name}</h2>
            <p className="text-xs font-mono text-[#6B717C]">{fmtDateTime(new Date(session.created_at))} · {session.platform}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white" data-testid="history-logs-close"><X size={20} /></button>
        </div>
        <div className="space-y-1.5 font-mono text-xs">
          {logs.length === 0 && <p className="text-[#6B717C]">Sem registos.</p>}
          {logs.map((l, i) => (
            <div key={i} className="px-3 py-2 rounded-lg bg-[#0B0D10] border border-[#20242C]">
              <span className="text-[#6B717C]">{fmtTime(new Date(l.timestamp))}</span>{" "}
              <span className="text-[#7FD113]">{l.type}</span>
              {l.payload?.command && <span className="text-sky-300"> · {l.payload.command.type}</span>}
              {l.payload?.by && <span className="text-gray-500"> · {l.payload.by}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function History() {
  const [sessions, setSessions] = useState([]);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);

  useEffect(() => {
    api.get("/sessions").then((r) => setSessions(r.data)).catch(() => {});
  }, []);

  const term = q.trim().toLowerCase();
  const shown = sessions.filter((s) =>
    (filter === "all" || (filter === "ended" ? s.status === "ended" : s.status !== "ended")) &&
    (!term || `${s.name} ${s.assigned_to_name || ""} ${s.platform}`.toLowerCase().includes(term)));

  return (
    <CrmLayout>
      <div className="p-5 lg:p-8 max-w-7xl">
        <PageHeader title="Atendimentos" subtitle="Histórico de todas as sessões de assistência">
          <div className="flex flex-wrap gap-2">
            <div className="flex p-1 rounded-xl bg-[#121419] border border-[#20242C]">
              {FILTERS.map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setFilter(k)}
                  data-testid={`history-filter-${k}`}
                  className={`h-9 px-4 rounded-lg text-xs font-bold transition-colors ${filter === k ? "bg-[#7FD113] text-black" : "text-gray-400 hover:text-white"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#5B616B]" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar…" className={`${input} pl-8 w-56`} data-testid="history-search-input" />
            </div>
          </div>
        </PageHeader>

        <div className={`${card} overflow-x-auto`}>
          <table className="w-full text-sm" data-testid="history-table">
            <thead>
              <tr className="text-left text-[11px] font-mono uppercase tracking-wider text-[#6B717C] border-b border-[#20242C]">
                <th className="px-5 py-3.5">Aparelho</th>
                <th className="px-5 py-3.5">Estado</th>
                <th className="px-5 py-3.5">Técnico</th>
                <th className="px-5 py-3.5">Início</th>
                <th className="px-5 py-3.5">Duração</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => {
                const Icon = ICONS[s.platform] || Globe;
                const st = STATUS[s.status] || STATUS.ended;
                return (
                  <tr key={s.id} onClick={() => setOpen(s)} className="border-b border-[#1A1D23] last:border-0 hover:bg-white/[0.02] cursor-pointer transition-colors" data-testid="history-row">
                    <td className="px-5 py-3.5">
                      <span className="flex items-center gap-3 text-white font-medium"><Icon size={15} className="text-gray-400" /> {s.name}</span>
                    </td>
                    <td className="px-5 py-3.5"><span className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${st.cls}`}>{st.label}</span></td>
                    <td className="px-5 py-3.5 text-gray-300">{s.assigned_to_name || "—"}</td>
                    <td className="px-5 py-3.5 font-mono text-xs text-gray-400">{fmtDateTime(new Date(s.created_at))}</td>
                    <td className="px-5 py-3.5 font-mono text-xs text-gray-400">{duration(s)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!shown.length && <div className="text-center text-sm text-[#6B717C] py-14" data-testid="history-empty">Nenhum atendimento encontrado.</div>}
        </div>
      </div>
      {open && <LogsDrawer session={open} onClose={() => setOpen(null)} />}
    </CrmLayout>
  );
}
