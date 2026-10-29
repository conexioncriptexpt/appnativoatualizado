import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, UserPlus, Trash2, KeyRound, ShieldCheck, Wrench, Circle } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import Logo from "@/components/Logo";
import LisbonClock from "@/components/LisbonClock";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const errMsg = (e) => e?.response?.data?.detail?.[0]?.msg || e?.response?.data?.detail || "Ocorreu um erro.";
const inputCls = "w-full h-11 px-3 rounded-lg bg-[#0B0F17] border border-gray-700 text-white text-sm focus:border-indigo-500 outline-none";

function RoleBadge({ role }) {
  const admin = role === "admin";
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold font-mono px-2 py-0.5 rounded-full border ${
      admin ? "text-amber-300 border-amber-500/40 bg-amber-500/10" : "text-sky-300 border-sky-500/40 bg-sky-500/10"
    }`}>
      {admin ? <ShieldCheck size={11} /> : <Wrench size={11} />} {admin ? "ADMINISTRADOR" : "TÉCNICO"}
    </span>
  );
}

function CreateForm({ onCreated }) {
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "technician" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/auth/register", form);
      toast.success(`Conta de ${form.name} criada.`);
      setForm({ name: "", email: "", password: "", role: "technician" });
      onCreated();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="bg-[#111827] border border-gray-800 rounded-xl p-5 space-y-3" data-testid="team-create-form">
      <h2 className="font-display font-bold text-white flex items-center gap-2 mb-1">
        <UserPlus size={18} className="text-indigo-400" /> Nova conta
      </h2>
      <input required value={form.name} onChange={set("name")} placeholder="Nome" className={inputCls} data-testid="team-name-input" />
      <input required type="email" value={form.email} onChange={set("email")} placeholder="E-mail" className={inputCls} data-testid="team-email-input" />
      <input required minLength={6} type="password" value={form.password} onChange={set("password")} placeholder="Palavra-passe (mín. 6)" className={inputCls} data-testid="team-password-input" />
      <select value={form.role} onChange={set("role")} className={inputCls} data-testid="team-role-select">
        <option value="technician">Técnico — atende sessões</option>
        <option value="admin">Administrador — gere a equipa</option>
      </select>
      <button disabled={busy} className="w-full h-11 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-bold transition-colors disabled:opacity-60" data-testid="team-create-submit">
        {busy ? "A criar…" : "Criar conta"}
      </button>
    </form>
  );
}

function MemberRow({ m, me, onChange, onDelete, onReset }) {
  const self = m.id === me.id;
  return (
    <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl border border-gray-800 bg-[#0B0F17]" data-testid={`team-member-${m.email}`}>
      <Circle size={10} className={m.online ? "fill-emerald-400 text-emerald-400" : "text-gray-600"} />
      <div className="flex-1 min-w-[160px]">
        <div className="text-sm font-semibold text-white">{m.name}{self && <span className="text-gray-500"> (você)</span>}</div>
        <div className="text-xs font-mono text-gray-500">{m.email}</div>
      </div>
      <RoleBadge role={m.role} />
      <select
        value={m.role}
        disabled={self}
        onChange={(e) => onChange(m, e.target.value)}
        className="h-9 rounded-lg bg-gray-800 border border-gray-700 text-xs text-white px-2 disabled:opacity-40"
        data-testid="team-member-role-select"
      >
        <option value="technician">Técnico</option>
        <option value="admin">Administrador</option>
      </select>
      <button onClick={() => onReset(m)} title="Redefinir palavra-passe" className="h-9 w-9 rounded-lg border border-gray-700 flex items-center justify-center hover:bg-gray-800 transition-colors" data-testid="team-member-reset-button">
        <KeyRound size={15} />
      </button>
      <button disabled={self} onClick={() => onDelete(m)} title="Remover" className="h-9 w-9 rounded-lg border border-red-900 text-red-400 flex items-center justify-center hover:bg-red-500/10 transition-colors disabled:opacity-30" data-testid="team-member-delete-button">
        <Trash2 size={15} />
      </button>
    </div>
  );
}

export default function Team() {
  const { user } = useAuth();
  const [members, setMembers] = useState([]);
  const [toDelete, setToDelete] = useState(null);
  const [toReset, setToReset] = useState(null);
  const [newPass, setNewPass] = useState("");

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/users");
      setMembers(data);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const changeRole = async (m, role) => {
    try {
      await api.put(`/users/${m.id}`, { role });
      toast.success("Tipo de conta atualizado.");
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const confirmDelete = async () => {
    try {
      await api.delete(`/users/${toDelete.id}`);
      toast.success(`${toDelete.name} foi removido.`);
      load();
    } catch (e) { toast.error(errMsg(e)); }
    setToDelete(null);
  };
  const confirmReset = async () => {
    try {
      await api.put(`/users/${toReset.id}`, { password: newPass });
      toast.success("Palavra-passe redefinida.");
      setToReset(null);
      setNewPass("");
    } catch (e) { toast.error(errMsg(e)); }
  };

  const admins = members.filter((m) => m.role === "admin").length;

  return (
    <div className="min-h-screen operator-bg text-gray-200">
      <header className="h-16 border-b border-gray-800 bg-[#111827] flex items-center justify-between px-5 sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <Logo size={40} dark />
          <span className="hidden md:inline text-[11px] text-gray-500 font-mono border-l border-gray-700 pl-3">GESTÃO DE EQUIPA</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden lg:block"><LisbonClock dark /></div>
          <Link to="/crm" className="h-9 px-3 rounded-lg border border-gray-700 flex items-center gap-2 text-sm hover:bg-gray-800 transition-colors" data-testid="team-back-button">
            <ArrowLeft size={16} /> Painel
          </Link>
        </div>
      </header>

      <div className="max-w-6xl mx-auto p-5 grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-1"><CreateForm onCreated={load} /></div>
        <section className="lg:col-span-2 bg-[#111827] border border-gray-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h1 className="font-display font-bold text-white text-xl">Equipa</h1>
            <span className="text-xs font-mono text-gray-500" data-testid="team-count">
              {members.length} contas · {admins} admin · {members.length - admins} técnicos
            </span>
          </div>
          <div className="space-y-2" data-testid="team-member-list">
            {members.map((m) => (
              <MemberRow key={m.id} m={m} me={user} onChange={changeRole} onDelete={setToDelete} onReset={setToReset} />
            ))}
          </div>
        </section>
      </div>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent data-testid="team-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Remover {toDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              A pessoa perde o acesso de imediato. As sessões atribuídas voltam para a fila.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="team-delete-cancel">Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700" data-testid="team-delete-confirm">Remover</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!toReset} onOpenChange={(o) => { if (!o) { setToReset(null); setNewPass(""); } }}>
        <AlertDialogContent data-testid="team-reset-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Nova palavra-passe para {toReset?.name}</AlertDialogTitle>
            <AlertDialogDescription>Mínimo de 6 caracteres. Comunique-a à pessoa de forma segura.</AlertDialogDescription>
          </AlertDialogHeader>
          <input type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} className="w-full h-11 px-3 rounded-lg border border-gray-300 text-sm" placeholder="Nova palavra-passe" data-testid="team-reset-input" />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <button disabled={newPass.length < 6} onClick={confirmReset} className="h-10 px-4 rounded-md bg-indigo-600 text-white text-sm font-semibold disabled:opacity-50" data-testid="team-reset-confirm">Guardar</button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
