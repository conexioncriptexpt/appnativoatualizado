import { createContext, useContext, useEffect, useState } from "react";
import api from "@/lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null = checking, false = logged out
  const [token, setToken] = useState(localStorage.getItem("cc_token"));

  useEffect(() => {
    if (!token) {
      setUser(false);
      return;
    }
    api
      .get("/auth/me")
      .then((r) => setUser(r.data))
      .catch(() => {
        localStorage.removeItem("cc_token");
        setToken(null);
        setUser(false);
      });
  }, [token]);

  const login = (tok, u) => {
    localStorage.setItem("cc_token", tok);
    setToken(tok);
    setUser(u);
  };

  const logout = () => {
    localStorage.removeItem("cc_token");
    setToken(null);
    setUser(false);
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
