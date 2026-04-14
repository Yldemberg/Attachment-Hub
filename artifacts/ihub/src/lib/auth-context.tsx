import React, { createContext, useContext, useEffect, useState } from "react";
import { configureApiClient, getStoredToken, clearStoredToken } from "./api-client";

export interface IHubUser {
  id: string;
  email: string;
}

interface AuthContextType {
  session: IHubUser | null;
  user: IHubUser | null;
  loading: boolean;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  signOut: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<IHubUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    configureApiClient();

    const token = getStoredToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    fetch("/api/auth/me", { credentials: "include", headers })
      .then((res) => (res.ok ? res.json() : null))
      .then((profile) => {
        if (profile?.id) {
          setUser({ id: profile.id, email: profile.email });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const signOut = () => {
    clearStoredToken();
    fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => {});
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ session: user, user, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
