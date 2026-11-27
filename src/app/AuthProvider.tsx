import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { authApi, type User } from "../lib/auth";
import { errorText } from "../lib/db";

interface AuthContextValue {
  user: User | null;
  ready: boolean;
  error: string;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const revision = useRef(0);
  const changing = useRef(false);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      const version = revision.current;
      try {
        if (changing.current) return;
        const current = await authApi.me();
        if (active && version === revision.current) { setUser(current); setError(""); setReady(true); }
      } catch (e) {
        if (active && version === revision.current) {
          // Fail closed; the next refresh can recover a session after a DB outage.
          setUser(null); setError(errorText(e)); setReady(true);
        }
      } finally {
        if (active) timer = setTimeout(refresh, 5000);
      }
    };
    void refresh();
    return () => { active = false; clearTimeout(timer); };
  }, []);

  const changeSession = async (request: () => Promise<User | null>) => {
    if (changing.current) throw new Error("Đang xử lý tài khoản. Vui lòng chờ.");
    changing.current = true;
    revision.current++;
    try { setUser(await request()); setError(""); setReady(true); }
    finally { revision.current++; changing.current = false; }
  };

  return <AuthContext.Provider value={{ user, ready, error,
    login: (username, password) => changeSession(() => authApi.login(username, password)),
    logout: () => changeSession(async () => { await authApi.logout(); return null; }),
    changePassword: (current, next) => changeSession(() => authApi.changePassword(current, next)),
  }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("useAuth outside AuthProvider");
  return auth;
}
