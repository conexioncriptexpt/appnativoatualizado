import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Smartphone, Monitor, Globe, Pencil, Trash2, Check, X, Circle, Search } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import CrmLayout, { PageHeader } from "@/components/CrmLayout";
import { fmtDateTime } from "@/lib/datetime";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const ICONS = { android: Smartphone, windows: Monitor, web: Globe };
const errMsg = (e) => e?.response?.data?.detail || "Ocorreu um erro.";

function DeviceRow({ d, isAdmin, onRename, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(d.display_name);
  useEffect(() => { if (!editing) setName(d.display_name); }, [editing, d.display_name]);
  const Icon = ICONS[d.platform] || Globe;
  const save = async () => {
    if (!name.trim()) return;
    if (await onRename(d, name.trim())) setEditing(false);
  };
  return (
    <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl border border-[#22262E] bg-[#0B0D10]" data-testid={`device-row-${d.device_id}`}>
      <div className="h-10 w-10 rounded-lg bg-gray-800 flex items-center justify-center relative">
        <Icon size={18} className="text-gray-300" />
        <Circle size={9} className={`absolute -top-0.5 -right-0.5 ${d.online ? "fill-emerald-400 text-emerald-400" : "fill-gray-600 text-gray-600"}`} />
      </div>
      <div className="flex-1 min-w-[200px]">
        {editing ? (
          <div className="flex gap-2">
            <input
              autoFocus
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
              className="flex-1 h-9 px-3 rounded-lg bg-[#121419] border border-[#7FD113] text-white text-sm outline-none"
              data-testid="device-rename-input"
            />
            <button onClick={save} className="h-9 w-9 rounded-lg bg-[#7FD113] text-black flex items-center justify-center" data-testid="device-rename-save"><Check size={15} /></button>
            <button onClick={() => setEditing(false)} className="h-9 w-9 rounded-lg border border-[#2A2F38] flex items-center justify-center" data-testid="device-rename-cancel"><X size={15} /></button>
          </div>
        ) : (
          <>
            <div className="text-sm font-semibold text-white" data-testid="device-display-name">{d.display_name}</div>
            <div className="text-[11px] font-mono text-gray-500">
              {d.custom_name ? `${d.original_name} · ` : ""}{d.platform.toUpperCase()} · {d.connections || 1} {(d.connections || 1) === 1 ? "ligação" : "ligações"} · última {fmtDateTime(new Date(d.last_seen))}
            </div>
          </>
        )}
      </div>
      <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${d.online ? "text-emerald-300 border-emerald-500/40 bg-emerald-500/10" : "text-gray-400 border-[#2A2F38]"}`}>
        {d.online ? "LIGADO" : "DESLIGADO"}
      </span>
      {isAdmin && !editing && (
        <>
          <button onClick={() => setEditing(true)} title="Renomear" className="h-9 w-9 rounded-lg border border-[#2A2F38] flex items-center justify-center hover:bg-gray-800 transition-colors" data-testid="device-rename-button">
            <Pencil size={15} />
          </button>
          <button onClick={() => onDelete(d)} title="Apagar" className="h-9 w-9 rounded-lg border border-red-900 text-red-400 flex items-center justify-center hover:bg-red-500/10 transition-colors" data-testid="device-delete-button">
            <Trash2 size={15} />
          </button>
        </>
      )}
    </div>
  );
}

export default function Devices() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [devices, setDevices] = useState([]);
  const [query, setQuery] = useState("");
  const [toDelete, setToDelete] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/devices");
      setDevices(data);
    } catch (e) { toast.error(errMsg(e)); }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  const rename = async (d, name) => {
    try {
      await api.put(`/devices/${encodeURIComponent(d.device_id)}`, { name });
      toast.success("Nome atualizado.");
      load();
      return true;
    } catch (e) { toast.error(errMsg(e)); return false; }
  };
  const confirmDelete = async () => {
    try {
      await api.delete(`/devices/${encodeURIComponent(toDelete.device_id)}`);
      toast.success(`«${toDelete.display_name}» foi apagado.`);
      load();
    } catch (e) { toast.error(errMsg(e)); }
    setToDelete(null);
  };

  const q = query.trim().toLowerCase();
  const shown = devices.filter((d) => !q || `${d.display_name} ${d.original_name} ${d.platform}`.toLowerCase().includes(q));
  const online = devices.filter((d) => d.online).length;

  return (
    <CrmLayout>
      <div className="p-5 lg:p-8 max-w-7xl">
        <PageHeader title="Dispositivos" subtitle="Todos os aparelhos que já se ligaram ficam guardados aqui" />
        <section className="bg-[#121419] border border-[#22262E] rounded-2xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="font-display font-bold text-white text-lg">Aparelhos guardados</h2>
              <span className="text-xs font-mono text-gray-500" data-testid="devices-count">
                {devices.length} {devices.length === 1 ? "aparelho" : "aparelhos"} · {online} {online === 1 ? "ligado" : "ligados"} agora
              </span>
            </div>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Procurar…"
                className="h-9 pl-8 pr-3 rounded-lg bg-[#0B0D10] border border-[#2A2F38] text-sm text-white outline-none focus:border-[#7FD113]"
                data-testid="devices-search-input"
              />
            </div>
          </div>
          <div className="space-y-2" data-testid="devices-list">
            {shown.map((d) => (
              <DeviceRow key={d.device_id} d={d} isAdmin={isAdmin} onRename={rename} onDelete={setToDelete} />
            ))}
            {!shown.length && <div className="text-sm text-gray-500 text-center py-10" data-testid="devices-empty">Nenhum aparelho encontrado.</div>}
          </div>
        </section>
      </div>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent data-testid="device-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar «{toDelete?.display_name}»?</AlertDialogTitle>
            <AlertDialogDescription>
              O nome e o histórico de sessões deste aparelho são apagados. Se voltar a carregar em CONECTAR, aparece como aparelho novo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="device-delete-cancel">Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700" data-testid="device-delete-confirm">Apagar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CrmLayout>
  );
}
