import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ShieldCheck, Loader2, LogIn } from "lucide-react";
import api, { formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import Logo from "@/components/Logo";

const field = "mt-1.5 w-full h-12 px-4 rounded-xl bg-[#0B0D10] border border-[#2A2F38] text-white placeholder-[#5B616B] focus:border-[#7FD113] focus:outline-none focus:ring-2 focus:ring-[#7FD113]/25 transition-colors";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post("/auth/login", { email, password });
      login(data.token, data.user);
      toast.success(`Bem-vindo, ${data.user.name}`);
      navigate("/crm");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen public-bg flex items-center justify-center px-4 text-white">
      <div className="w-full max-w-md fade-up">
        <div className="flex justify-center mb-8">
          <Logo height={110} className="drop-shadow-[0_0_30px_rgba(127,209,19,0.2)]" />
        </div>

        <form onSubmit={submit} className="bg-[#121419]/90 backdrop-blur border border-[#20242C] rounded-3xl p-7 flex flex-col gap-5">
          <div>
            <h1 className="font-display text-2xl font-extrabold">Acesso da equipa técnica</h1>
            <p className="text-sm text-[#8A8F98] mt-1">Introduza as suas credenciais.</p>
          </div>
          <div>
            <label className="text-[11px] font-mono uppercase tracking-wider text-[#6B717C]">E-mail</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required data-testid="crm-login-form-email-input" className={field} placeholder="voce@cryptoconex.com" />
          </div>
          <div>
            <label className="text-[11px] font-mono uppercase tracking-wider text-[#6B717C]">Palavra-passe</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required data-testid="crm-login-form-password-input" className={field} placeholder="••••••••" />
          </div>
          <button
            type="submit"
            disabled={loading}
            data-testid="crm-login-form-submit-button"
            className="h-12 rounded-xl bg-[#7FD113] hover:bg-[#93E62A] text-black font-extrabold flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
          >
            {loading ? <Loader2 className="animate-spin" size={20} /> : <LogIn size={20} />}
            Entrar
          </button>
          <div className="flex items-center gap-2 text-xs text-[#6B717C] justify-center">
            <ShieldCheck size={14} className="text-[#7FD113]" /> Ligação segura
          </div>
        </form>

        <div className="text-center mt-5">
          <a href="/" className="text-sm text-[#6B717C] hover:text-gray-300 underline" data-testid="back-to-public-link">
            ← Voltar à página de ligação
          </a>
        </div>
      </div>
    </div>
  );
}
