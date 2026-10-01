'use client';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { api, tokens } from './api';

export interface User { id: string; email: string; name: string; role: string; permissions: string[] }
interface Ctx { user: User | null; loading: boolean; login: (email: string, password: string) => Promise<void>; logout: () => Promise<void>; can: (perm: string) => boolean }
const AuthCtx = React.createContext<Ctx>(null as unknown as Ctx);
export const useAuth = () => React.useContext(AuthCtx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<User | null>(null);
  const [loading, setLoading] = React.useState(true);
  const router = useRouter();

  React.useEffect(() => {
    (async () => {
      try { if (tokens.access || tokens.refresh) setUser(await api<User>('/auth/me')); } catch { tokens.clear(); }
      setLoading(false);
    })();
  }, []);

  const login = async (email: string, password: string) => {
    const d = await api<{ accessToken: string; refreshToken: string; user: User }>('/auth/login', { body: { email, password } });
    tokens.set(d.accessToken, d.refreshToken);
    setUser(d.user);
  };
  const logout = async () => {
    const rt = tokens.refresh;
    if (rt) await api('/auth/logout', { body: { refreshToken: rt } }).catch(() => undefined);
    tokens.clear(); setUser(null); router.push('/login');
  };
  const can = React.useCallback((p: string) => !!user && (user.permissions.includes('*') || user.permissions.includes(p)), [user]);
  return <AuthCtx.Provider value={{ user, loading, login, logout, can }}>{children}</AuthCtx.Provider>;
}
