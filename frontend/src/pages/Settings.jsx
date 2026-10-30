import { useState } from "react";
import { toast } from "sonner";
import { UserRound, KeyRound, BellRing } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import CrmLayout, { PageHeader, card, input, btnPrimary, btnOutline } from "@/components/CrmLayout";
import { playAlert, alertEnabled, setAlertEnabled } from "@/lib/alert";

const err = (e) => e?.response?.data?.detail?.[0]?.msg || e?.response?.data?.detail || "Ocorreu um erro.";

function Section({ icon: Icon, title, children }) {
  return (
    <section className={`${card} p-6`}>
      <h2 className="font-display font-bold text-white flex items-center gap-2 mb-5"><Icon size={18} className="text-[#7FD113]" /> {title}</h2>
      {children}
    </section>
  );
}

export default function Settings() {
  const { user, setUser } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [pw, setPw] = useState({ current: "", next: "" });
  const [sound, setSound] = useState(alertEnabled());

  const saveName = async (e) => {
    e.preventDefault();
    try {
      const { data } = await api.put("/auth/me", { name });
      setUser?.(data);
      toast.success("Perfil atualizado.");
    } catch (e2) { toast.error(err(e2)); }
  };
  const savePw = async (e) => {
    e.preventDefault();
    try {
      await api.put("/auth/me", { current_password: pw.current, new_password: pw.next });
      setPw({ current: "", next: "" });
      toast.success("Palavra-passe alterada.");
    } catch (e2) { toast.error(err(e2)); }
  };
  const toggleSound = () => {
    setAlertEnabled(!sound);
    setSound(!sound);
    if (!sound) playAlert(true);
  };

  return (
    <CrmLayout>
      <div className="p-5 lg:p-8 max-w-3xl space-y-5">
        <PageHeader title="Configurações" subtitle="O seu perfil e preferências" />
        <Section icon={UserRound} title="Perfil">
          <form onSubmit={saveName} className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[220px]">
              <label className="text-[11px] font-mono uppercase tracking-wider text-[#6B717C]">Nome</label>
              <input required value={name} onChange={(e) => setName(e.target.value)} className={`${input} w-full mt-1.5`} data-testid="settings-name-input" />
            </div>
            <button className={btnPrimary} data-testid="settings-name-save">Guardar</button>
          </form>
          <p className="text-xs font-mono text-[#6B717C] mt-3">{user?.email}</p>
        </Section>
        <Section icon={KeyRound} title="Alterar palavra-passe">
          <form onSubmit={savePw} className="grid sm:grid-cols-2 gap-3">
            <input required type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} placeholder="Palavra-passe atual" className={input} data-testid="settings-current-password" />
            <input required minLength={6} type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} placeholder="Nova (mín. 6)" className={input} data-testid="settings-new-password" />
            <button className={`${btnPrimary} sm:col-span-2`} data-testid="settings-password-save">Alterar palavra-passe</button>
          </form>
        </Section>
        <Section icon={BellRing} title="Alertas">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm text-white">Som quando chega um novo pedido de ajuda</div>
              <div className="text-xs text-[#6B717C] mt-0.5">Toca na Consola ao Vivo sempre que um aparelho se liga.</div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => playAlert(true)} className={btnOutline} data-testid="settings-sound-test">Testar</button>
              <button
                onClick={toggleSound}
                role="switch"
                aria-checked={sound}
                data-testid="settings-sound-toggle"
                className={`h-7 w-12 rounded-full p-1 transition-colors ${sound ? "bg-[#7FD113]" : "bg-[#2A2F38]"}`}
              >
                <span className={`block h-5 w-5 rounded-full bg-white transition-transform ${sound ? "translate-x-5" : ""}`} />
              </button>
            </div>
          </div>
        </Section>
      </div>
    </CrmLayout>
  );
}
