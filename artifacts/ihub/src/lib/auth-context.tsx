import React, { createContext, useContext, useEffect, useState } from "react";
import { configureApiClient } from "./api-client";
import { getStoredToken, clearToken } from "./auth-storage";

export interface IHubUser {
  id: string;
  email: string;
  exp?: number;
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

function parseToken(token: string): IHubUser | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]!));
    if (!payload.sub || !payload.email) return null;
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return { id: payload.sub as string, email: payload.email as string, exp: payload.exp };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<IHubUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    configureApiClient();

    const token = getStoredToken();
    if (token) {
      const parsed = parseToken(token);
      setUser(parsed ?? null);
    }
    setLoading(false);
  }, []);

  const signOut = () => {
    clearToken();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ session: user, user, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
