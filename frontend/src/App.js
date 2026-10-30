import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import PublicConnect from "@/pages/PublicConnect";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Team from "@/pages/Team";
import Devices from "@/pages/Devices";
import Overview from "@/pages/Overview";
import History from "@/pages/History";
import AssistLinks from "@/pages/AssistLinks";
import Settings from "@/pages/Settings";
import Instructions from "@/pages/Instructions";
import "@/App.css";

function Protected({ children, adminOnly }) {
  const { user } = useAuth();
  if (user === null)
    return (
      <div className="min-h-screen bg-[#0B0D10] flex items-center justify-center text-gray-400 font-mono">
        A carregar…
      </div>
    );
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== "admin") return <Navigate to="/crm" replace />;
  return children;
}

const CRM_ROUTES = [
  ["/crm", Dashboard],
  ["/crm/dashboard", Overview],
  ["/crm/atendimentos", History],
  ["/crm/aparelhos", Devices],
  ["/crm/links", AssistLinks],
  ["/crm/configuracoes", Settings],
];

function App() {
  return (
    <div className="App">
      <AuthProvider>
        <BrowserRouter>
          <Toaster position="top-right" richColors closeButton theme="dark" />
          <Routes>
            <Route path="/" element={<PublicConnect />} />
            <Route path="/login" element={<Login />} />
            {CRM_ROUTES.map(([path, Page]) => (
              <Route key={path} path={path} element={<Protected><Page /></Protected>} />
            ))}
            <Route path="/crm/equipa" element={<Protected adminOnly><Team /></Protected>} />
            <Route path="/instrucoes" element={<Instructions />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </div>
  );
}

export default App;
