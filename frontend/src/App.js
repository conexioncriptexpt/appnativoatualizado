import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import PublicConnect from "@/pages/PublicConnect";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Team from "@/pages/Team";
import Devices from "@/pages/Devices";
import Instructions from "@/pages/Instructions";
import "@/App.css";

function Protected({ children, adminOnly }) {
  const { user } = useAuth();
  if (user === null)
    return (
      <div className="min-h-screen operator-bg flex items-center justify-center text-gray-400 font-mono">
        Carregando…
      </div>
    );
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== "admin") return <Navigate to="/crm" replace />;
  return children;
}

function App() {
  return (
    <div className="App">
      <AuthProvider>
        <BrowserRouter>
          <Toaster position="top-right" richColors closeButton />
          <Routes>
            <Route path="/" element={<PublicConnect />} />
            <Route path="/login" element={<Login />} />
            <Route
              path="/crm"
              element={
                <Protected>
                  <Dashboard />
                </Protected>
              }
            />
            <Route
              path="/crm/aparelhos"
              element={
                <Protected>
                  <Devices />
                </Protected>
              }
            />
            <Route path="/instrucoes" element={<Instructions />} />
            <Route
              path="/crm/equipa"
              element={
                <Protected adminOnly>
                  <Team />
                </Protected>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </div>
  );
}

export default App;
