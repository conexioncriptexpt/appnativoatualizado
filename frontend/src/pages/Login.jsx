import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ShieldCheck, Loader2, LogIn, MonitorSmartphone } from "lucide-react";
import api, { formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

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
    <div className="min-h-screen operator-bg flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="h-12 w-12 rounded-2xl bg-indigo-500 flex items-center justify-center text-white">
            <MonitorSmartphone size={26} />
          </div>
          <div>
            <div className="font-display font-extrabold text-2xl text-white tracking-tight leading-none">
              Crypto Conex
            </div>
            <div className="text-sm text-gray-400 font-mono">Painel de Gestão · CRM</div>
          </div>
        </div>

        <form
          onSubmit={submit}
          className="bg-[#111827] border border-gray-800 rounded-2xl p-7 flex flex-col gap-5"
        >
          <div>
            <h1 className="font-display text-xl font-bold text-white">Acesso da equipe técnica</h1>
            <p className="text-sm text-gray-400 mt-1">Entre com suas credenciais.</p>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">E-mail</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              data-testid="crm-login-form-email-input"
              className="mt-1 w-full h-12 px-4 rounded-xl bg-[#0B0F17] border border-gray-700 text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 transition-colors"
              placeholder="voce@cryptoconex.com"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Senha</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              data-testid="crm-login-form-password-input"
              className="mt-1 w-full h-12 px-4 rounded-xl bg-[#0B0F17] border border-gray-700 text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 transition-colors"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            data-testid="crm-login-form-submit-button"
            className="h-12 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
          >
            {loading ? <Loader2 className="animate-spin" size={20} /> : <LogIn size={20} />}
            Entrar
          </button>

          <div className="flex items-center gap-2 text-xs text-gray-500 justify-center">
            <ShieldCheck size={14} /> Autenticação segura via JWT
          </div>
        </form>

        <div className="text-center mt-5">
          <a href="/" className="text-sm text-gray-500 hover:text-gray-300 underline" data-testid="back-to-public-link">
            ← Voltar à página de conexão
          </a>
        </div>
      </div>
    </div>
  );
}
