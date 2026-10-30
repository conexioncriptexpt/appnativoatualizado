import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Link2, Copy, Trash2, Share2, Plus } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import CrmLayout, { PageHeader, card, input, btnPrimary } from "@/components/CrmLayout";
import { fmtDateTime } from "@/lib/datetime";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const linkUrl = (code) => `${window.location.origin}/?l=${code}`;

function CreateLink({ isAdmin, technicians, ready, onCreated }) {
  const [label, setLabel] = useState("");
  const [tech, setTech] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.post("/links", { label, technician_id: tech || undefined });
      await navigator.clipboard?.writeText(linkUrl(data.code)).catch(() => {});
      toast.success("Link criado e copiado.", { description: linkUrl(data.code) });
      setLabel("");
      onCreated();
    } catch (err) {
      toast.error(err?.response?.data?.detail?.[0]?.msg || err?.response?.data?.detail || "Ocorreu um erro.");
    } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className={`${card} p-5 flex flex-wrap items-end gap-3 mb-6`} data-testid="link-create-form">
      <div className="flex-1 min-w-[220px]">
        <label className="text-[11px] font-mono uppercase tracking-wider text-[#6B717C]">Para quem é?</label>
        <input required maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex.: D. Maria — telemóvel" className={`${input} w-full mt-1.5`} data-testid="link-label-input" />
      </div>
      {isAdmin && (
        <div className="min-w-[200px]">
          <label className="text-[11px] font-mono uppercase tracking-wider text-[#6B717C]">Técnico</label>
          <select value={tech} onChange={(e) => setTech(e.target.value)} className={`${input} w-full mt-1.5`} data-testid="link-technician-select">
            <option value="">Eu próprio</option>
            {technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      )}
      <button disabled={busy || !ready} className={btnPrimary} data-testid="link-create-submit"><Plus size={16} /> Criar link</button>
    </form>
  );
}

function LinkRow({ l, onDelete }) {
  const url = linkUrl(l.code);
  const copy = () => navigator.clipboard.writeText(url).then(() => toast.success("Link copiado."));
  const share = () => {
    const text = `Olá! Para receber ajuda, abra este link e carregue em CONECTAR: ${url}`;
    if (navigator.share) navigator.share({ title: "Assistência Crypto Conex", text }).catch(() => {});
    else window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  };
  return (
    <div className="flex flex-wrap items-center gap-3 p-4 rounded-xl border border-[#20242C] bg-[#0B0D10]" data-testid={`link-row-${l.code}`}>
      <div className="h-10 w-10 rounded-xl bg-[#7FD113]/10 text-[#7FD113] flex items-center justify-center"><Link2 size={17} /></div>
      <div className="flex-1 min-w-[220px]">
        <div className="text-sm font-semibold text-white">{l.label}</div>
        <div className="text-[11px] font-mono text-[#6B717C] truncate" data-testid="link-url">{url}</div>
        <div className="text-[11px] text-gray-500 mt-0.5">
          Técnico: {l.technician_name} · {l.uses} {l.uses === 1 ? "utilização" : "utilizações"}
          {l.last_used ? ` · último uso ${fmtDateTime(new Date(l.last_used))}` : ""}
        </div>
      </div>
      <button onClick={copy} title="Copiar" className="h-9 w-9 rounded-lg border border-[#2A2F38] flex items-center justify-center hover:border-[#7FD113]/60 transition-colors" data-testid="link-copy-button"><Copy size={15} /></button>
      <button onClick={share} title="Partilhar" className="h-9 w-9 rounded-lg border border-[#2A2F38] flex items-center justify-center hover:border-[#7FD113]/60 transition-colors" data-testid="link-share-button"><Share2 size={15} /></button>
      <button onClick={() => onDelete(l)} title="Apagar" className="h-9 w-9 rounded-lg border border-red-900 text-red-400 flex items-center justify-center hover:bg-red-500/10 transition-colors" data-testid="link-delete-button"><Trash2 size={15} /></button>
    </div>
  );
}

export default function AssistLinks() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [links, setLinks] = useState([]);
  const [technicians, setTechnicians] = useState(null);
  const [toDelete, setToDelete] = useState(null);

  const load = useCallback(() => api.get("/links").then((r) => setLinks(r.data)).catch(() => {}), []);
  useEffect(() => {
    load();
    if (isAdmin) api.get("/technicians").then((r) => setTechnicians(r.data)).catch(() => setTechnicians([]));
    else setTechnicians([]);
  }, [load, isAdmin]);

  const remove = async () => {
    const l = toDelete;
    setToDelete(null);
    try {
      await api.delete(`/links/${l.code}`);
      toast.success("Link apagado.");
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Ocorreu um erro."); }
  };

  return (
    <CrmLayout>
      <div className="p-5 lg:p-8 max-w-5xl">
        <PageHeader
          title="Links de Assistência"
          subtitle="Envie um link pessoal: quem o abrir e carregar em CONECTAR vai direto para o técnico escolhido."
        />
        <CreateLink isAdmin={isAdmin} technicians={technicians || []} ready={technicians !== null} onCreated={load} />
        <div className="space-y-2" data-testid="links-list">
          {links.map((l) => <LinkRow key={l.code} l={l} onDelete={setToDelete} />)}
          {!links.length && <div className={`${card} text-center text-sm text-[#6B717C] py-14`} data-testid="links-empty">Ainda não criou nenhum link.</div>}
        </div>
      </div>
      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent data-testid="link-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar o link de «{toDelete?.label}»?</AlertDialogTitle>
            <AlertDialogDescription>Quem tiver este link deixa de ser encaminhado para o técnico.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="link-delete-cancel">Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={remove} className="bg-red-600 hover:bg-red-700" data-testid="link-delete-confirm">Apagar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CrmLayout>
  );
}
