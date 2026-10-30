import { useEffect, useState } from "react";
import { Activity, CalendarDays, MonitorSmartphone, Timer, Smartphone, Monitor, Globe, Link2 } from "lucide-react";
import api from "@/lib/api";
import CrmLayout, { PageHeader, card } from "@/components/CrmLayout";

const PLATFORM = { android: { label: "Android", icon: Smartphone }, windows: { label: "Windows", icon: Monitor }, web: { label: "Navegador", icon: Globe } };

function fmtDuration(s) {
  if (!s) return "—";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}

function StatCard({ icon: Icon, label, value, accent, testid }) {
  return (
    <div className={`${card} p-5 relative overflow-hidden`} data-testid={testid}>
      <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-[#7FD113]/[0.06]" />
      <Icon size={20} className={accent} />
      <div className="font-display text-3xl font-extrabold text-white mt-4">{value}</div>
      <div className="text-xs font-mono text-[#6B717C] mt-1 uppercase tracking-wider">{label}</div>
    </div>
  );
}

function WeekChart({ data }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="flex items-end gap-1.5 sm:gap-3 h-48 min-w-0 overflow-hidden" data-testid="overview-week-chart">
      {data.map((d) => {
        const day = new Date(d.date + "T12:00:00").toLocaleDateString("pt-PT", { weekday: "short" }).replace(".", "");
        return (
          <div key={d.date} className="flex-1 min-w-0 flex flex-col items-center gap-2 h-full justify-end">
            <span className="text-xs font-mono text-gray-300">{d.count}</span>
            <div
              className="w-full rounded-t-lg bg-gradient-to-t from-[#4E820B] to-[#7FD113] transition-[height] duration-700"
              style={{ height: `${Math.max(4, (d.count / max) * 100)}%` }}
            />
            <span className="text-[11px] font-mono text-[#6B717C] uppercase">{day}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function Overview() {
  const [o, setO] = useState(null);
  useEffect(() => {
    api.get("/stats/overview").then((r) => setO(r.data)).catch(() => {});
  }, []);

  const totalPlat = o ? Object.values(o.by_platform).reduce((a, b) => a + b, 0) || 1 : 1;

  return (
    <CrmLayout>
      <div className="p-5 lg:p-8 max-w-7xl">
        <PageHeader title="Dashboard" subtitle="Resumo da atividade de assistência" />
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
          <StatCard icon={CalendarDays} label="Atendimentos hoje" value={o?.today ?? "—"} accent="text-[#7FD113]" testid="overview-today" />
          <StatCard icon={Activity} label="Total de sessões" value={o?.total_sessions ?? "—"} accent="text-sky-400" testid="overview-total" />
          <StatCard icon={MonitorSmartphone} label="Aparelhos guardados" value={o?.devices ?? "—"} accent="text-amber-400" testid="overview-devices" />
          <StatCard icon={Link2} label="Links de assistência" value={o?.links ?? "—"} accent="text-[#7FD113]" testid="overview-links" />
          <StatCard icon={Timer} label="Duração média" value={fmtDuration(o?.avg_duration_s)} accent="text-sky-400" testid="overview-avg" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <section className={`${card} p-6 lg:col-span-2`}>
            <h2 className="font-display font-bold text-white mb-6">Últimos 7 dias</h2>
            {o && <WeekChart data={o.per_day} />}
          </section>
          <div className="space-y-4">
            <section className={`${card} p-6`} data-testid="overview-platforms">
              <h2 className="font-display font-bold text-white mb-4">Por sistema</h2>
              <div className="space-y-3">
                {o && Object.entries(PLATFORM).map(([k, p]) => {
                  const n = o.by_platform[k] || 0;
                  return (
                    <div key={k}>
                      <div className="flex justify-between text-sm mb-1.5">
                        <span className="flex items-center gap-2 text-gray-300"><p.icon size={14} /> {p.label}</span>
                        <span className="font-mono text-gray-400">{n}</span>
                      </div>
                      <div className="h-2 rounded-full bg-[#1A1D23] overflow-hidden">
                        <div className="h-full rounded-full bg-[#7FD113]" style={{ width: `${(n / totalPlat) * 100}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
            <section className={`${card} p-6`} data-testid="overview-top-technicians">
              <h2 className="font-display font-bold text-white mb-4">Técnicos mais ativos</h2>
              {o?.top_technicians?.length ? (
                <ol className="space-y-2">
                  {o.top_technicians.map((t, i) => (
                    <li key={t.name} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-3 text-gray-200">
                        <span className="h-6 w-6 rounded-full bg-[#7FD113]/15 text-[#7FD113] text-xs font-bold flex items-center justify-center">{i + 1}</span>
                        {t.name}
                      </span>
                      <span className="font-mono text-gray-400">{t.sessions}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-[#6B717C]">Ainda sem sessões atribuídas.</p>
              )}
            </section>
          </div>
        </div>
      </div>
    </CrmLayout>
  );
}
